/**
 * Screenshot Extension
 *
 * Gives the LLM a `screenshot` tool to capture what's on screen,
 * and a `list_windows` tool to discover visible applications.
 *
 * Architecture:
 *   - Layout providers: list monitors and windows (for targeting by app name)
 *   - Capture providers: take screenshots (full screen or region)
 *   - Strategy pattern: first compatible provider wins. Easy to add new platforms.
 *
 * Currently implemented:
 *   - Layout: Hyprland (hyprctl)
 *   - Capture: Grimblast/grim (wlroots Wayland)
 */

import { readFile, unlink } from "node:fs/promises";
import { Type } from "@mariozechner/pi-ai";
import {
	type AgentToolResult,
	type ExtensionAPI,
	keyHint,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type as T } from "@sinclair/typebox";
import { loadSettings } from "../../utils/settings.js";
import { grimblastCapture } from "./capture/grimblast.js";
import { hyprlandLayout } from "./layout/hyprland.js";
import type {
	CaptureProvider,
	LayoutProvider,
	LayoutResult,
	MonitorInfo,
	Rect,
	WindowInfo,
} from "./types.js";

// ── Settings ──────────────────────────────────────────────────────────────────

const ExcludeRule = T.Object({
	class: T.Optional(T.String()),
	title: T.Optional(T.String()),
});

const ScreenshotSchema = T.Object({
	exclude: T.Optional(T.Array(ExcludeRule)),
});

type ScreenshotSettings = Static<typeof ScreenshotSchema>;

const SETTINGS = loadSettings<ScreenshotSettings>(
	"screenshot",
	ScreenshotSchema,
).unwrapOr({});

// ── Exclusion Filter ──────────────────────────────────────────────────────────

function isExcluded(
	w: WindowInfo,
	rules: ScreenshotSettings["exclude"],
): boolean {
	if (!rules) return false;

	return rules.some((rule) => {
		const classMatch = rule.class
			? w.appName.toLowerCase().includes(rule.class.toLowerCase())
			: false;
		const titleMatch = rule.title
			? w.title.toLowerCase().includes(rule.title.toLowerCase())
			: false;

		if (rule.class && rule.title) return classMatch && titleMatch;
		return classMatch || titleMatch;
	});
}

// ── Provider Registries ───────────────────────────────────────────────────────

const layoutProviders: LayoutProvider[] = [hyprlandLayout];
const captureProviders: CaptureProvider[] = [grimblastCapture];

async function resolveProvider<
	T extends { name: string; isCompatible(): Promise<boolean> },
>(providers: T[]): Promise<T | null> {
	for (const p of providers) {
		if (await p.isCompatible()) return p;
	}
	return null;
}

async function getFilteredLayout(
	layout: LayoutProvider,
): Promise<LayoutResult> {
	const result = await layout.getLayout();
	return {
		monitors: result.monitors,
		windows: result.windows.filter((w) => !isExcluded(w, SETTINGS.exclude)),
	};
}

// ── Window Matching ───────────────────────────────────────────────────────────

function matchWindow(windows: WindowInfo[], target: string): WindowInfo | null {
	const lower = target.toLowerCase();
	const visible = windows.filter((w) => w.visible);

	for (const pool of [visible, windows]) {
		const byClass = pool.find((w) => w.appName.toLowerCase() === lower);
		if (byClass) return byClass;

		const byClassPartial = pool.find((w) =>
			w.appName.toLowerCase().includes(lower),
		);
		if (byClassPartial) return byClassPartial;

		const byTitle = pool.find((w) => w.title.toLowerCase().includes(lower));
		if (byTitle) return byTitle;
	}

	return null;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatRect(r: Rect): string {
	return `[${r.x},${r.y} ${r.width}x${r.height}]`;
}

function formatLayout(layout: LayoutResult): string {
	const lines: string[] = [];

	if (layout.monitors.length > 0) {
		lines.push("Monitors:");
		for (const m of layout.monitors) {
			lines.push(
				`  ${m.name} (${m.rect.width}x${m.rect.height}, workspace ${m.activeWorkspace})`,
			);
		}
		lines.push("");
	}

	const visible = layout.windows.filter((w) => w.visible);
	const hidden = layout.windows.filter((w) => !w.visible);

	if (visible.length > 0) {
		lines.push("Visible windows:");
		for (const w of visible) {
			const focus = w.focused ? " (focused)" : "";
			lines.push(`- ${w.appName}: "${w.title}"${focus} ${formatRect(w.rect)}`);
		}
	}

	if (hidden.length > 0) {
		if (visible.length > 0) lines.push("");
		lines.push(
			"Other workspaces (not visible — screenshot will capture wrong content):",
		);
		for (const w of hidden) {
			lines.push(`- ${w.appName}: "${w.title}" (workspace ${w.workspace})`);
		}
	}

	if (layout.windows.length === 0) {
		lines.push("No windows found.");
	}

	return lines.join("\n");
}

// ── Result Helpers ────────────────────────────────────────────────────────────

function textResult(
	text: string,
	details: unknown = {},
): AgentToolResult<unknown> {
	return { content: [{ type: "text", text }], details };
}

function errorResult(
	text: string,
	details: unknown = {},
): AgentToolResult<unknown> & { isError: true } {
	return { content: [{ type: "text", text }], isError: true, details };
}

async function captureToImage(
	capture: CaptureProvider,
	target: Rect | "all",
): Promise<AgentToolResult<unknown>> {
	const result =
		target === "all"
			? await capture.captureAll()
			: await capture.captureRegion(target);

	const imageData = await readFile(result.path);
	const base64 = imageData.toString("base64");
	await unlink(result.path).catch(() => {});

	const mimeType = result.format === "png" ? "image/png" : "image/jpeg";

	return {
		content: [{ type: "image" as const, data: base64, mimeType }],
		details: { format: result.format },
	};
}

// ── Render Helpers ────────────────────────────────────────────────────────────

function extractText(result: AgentToolResult<unknown>): string {
	return result.content
		.filter((c) => c.type === "text")
		.map((c) => ("text" in c ? c.text : ""))
		.join("\n");
}

const SECTION_HEADERS = [
	"Monitors:",
	"Visible windows:",
	"Other workspaces",
	"No windows",
	"No window",
	'Window "',
];

function isSectionHeader(line: string): boolean {
	return SECTION_HEADERS.some((h) => line.startsWith(h));
}

function getOrCreateText(last: unknown): Text {
	return (last as Text | undefined) ?? new Text("", 0, 0);
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function screenshotExtension(pi: ExtensionAPI) {
	// ── List Windows Tool ────────────────────────────────────────────────────

	pi.registerTool({
		name: "list_windows",
		label: "List Windows",
		description:
			"List all visible application windows with their names and titles. " +
			"Use this to discover what's on screen before taking a screenshot.",
		promptSnippet: "List visible windows to discover what's on screen",
		parameters: Type.Object({}),

		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("list_windows")), 0, 0);
		},

		renderResult(result, options, theme, context) {
			const comp = getOrCreateText(context.lastComponent);
			const lines = extractText(result).split("\n");
			const maxLines = options.expanded ? lines.length : 12;
			const displayLines = lines.slice(0, maxLines);
			const remaining = lines.length - maxLines;

			let rendered = displayLines
				.map((l) => {
					if (isSectionHeader(l)) return theme.fg("toolTitle", l);
					if (l.includes("(focused)")) return theme.fg("accent", l);
					return theme.fg("toolOutput", l);
				})
				.join("\n");

			if (remaining > 0) {
				rendered += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
			}

			comp.setText(`\n${rendered}`);
			return comp;
		},

		async execute() {
			const layout = await resolveProvider(layoutProviders);
			if (!layout) {
				return errorResult(
					"No compatible layout provider found on this system.",
					{ monitors: [] as MonitorInfo[], windows: [] as WindowInfo[] },
				);
			}

			const result = await getFilteredLayout(layout);
			return textResult(formatLayout(result), {
				monitors: result.monitors,
				windows: result.windows,
			});
		},
	});

	// ── Screenshot Tool ──────────────────────────────────────────────────────

	pi.registerTool({
		name: "screenshot",
		label: "Screenshot",
		description:
			"Take a screenshot of the entire screen or a specific application window. " +
			"Returns the image for visual inspection. " +
			"When targeting an app, matches against window class and title.",
		promptSnippet:
			"Capture screenshots of the full screen or specific application windows",
		parameters: Type.Object({
			target: Type.Optional(
				Type.String({
					description:
						"Application name or window title to capture. " +
						"Omit for full screen screenshot. " +
						"Matches against application name first (e.g. window class), then title. " +
						"Short app names work best — use list_windows to discover them. " +
						'Examples: "firefox", "ghostty", "Volume Control"',
				}),
			),
			region: Type.Optional(
				Type.Object(
					{
						x: Type.Number({ description: "X coordinate (global)" }),
						y: Type.Number({ description: "Y coordinate (global)" }),
						width: Type.Number({ description: "Width in pixels" }),
						height: Type.Number({ description: "Height in pixels" }),
					},
					{
						description:
							"Capture an explicit region instead of a full window or screen. " +
							"Use list_windows to get window coordinates, then compute sub-regions. " +
							"Takes priority over target if both are provided.",
					},
				),
			),
		}),

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("screenshot "));
			if (args.region) {
				text += theme.fg("accent", `region ${formatRect(args.region)}`);
			} else if (args.target) {
				text += theme.fg("accent", `"${args.target}"`);
			} else {
				text += theme.fg("muted", "full screen");
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, context) {
			const comp = getOrCreateText(context.lastComponent);

			if (context.isError) {
				const rendered = extractText(result)
					.split("\n")
					.map((l) =>
						isSectionHeader(l)
							? theme.fg("error", l)
							: theme.fg("toolOutput", l),
					)
					.join("\n");
				comp.setText(`\n${rendered}`);
			} else {
				const text = extractText(result);
				const hasImage = result.content.some((c) => c.type === "image");
				let rendered = theme.fg("toolOutput", text);
				if (hasImage) rendered += theme.fg("muted", " [image attached]");
				comp.setText(`\n${rendered}`);
			}

			return comp;
		},

		async execute(_toolCallId, params, _signal, onUpdate) {
			const capture = await resolveProvider(captureProviders);
			if (!capture) {
				return errorResult(
					"No compatible screenshot capture provider found on this system.",
				);
			}

			try {
				return await captureScreenshot(capture, params, onUpdate);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return errorResult(`Screenshot failed: ${msg}`);
			}
		},
	});
}

// ── Screenshot Execution ──────────────────────────────────────────────────────

type ScreenshotParams = {
	target?: string;
	region?: Rect;
};

async function captureScreenshot(
	capture: CaptureProvider,
	params: ScreenshotParams,
	onUpdate: ((partial: AgentToolResult<unknown>) => void) | undefined,
): Promise<AgentToolResult<unknown>> {
	if (params.region) return captureRegion(capture, params.region, onUpdate);
	if (params.target) return captureTarget(capture, params.target, onUpdate);
	return captureFullScreen(capture, onUpdate);
}

async function captureRegion(
	capture: CaptureProvider,
	region: Rect,
	onUpdate: ((partial: AgentToolResult<unknown>) => void) | undefined,
): Promise<AgentToolResult<unknown>> {
	onUpdate?.(textResult(`Capturing region ${formatRect(region)}…`));

	const result = await captureToImage(capture, region);
	result.content.push({
		type: "text" as const,
		text: `Region ${formatRect(region)} captured.`,
	});
	return result;
}

async function captureTarget(
	capture: CaptureProvider,
	target: string,
	onUpdate: ((partial: AgentToolResult<unknown>) => void) | undefined,
): Promise<AgentToolResult<unknown>> {
	const layout = await resolveProvider(layoutProviders);
	if (!layout) {
		return errorResult(
			"No compatible layout provider found — cannot list windows. Try without a target for full screen capture.",
		);
	}

	onUpdate?.(textResult(`Listing windows to find "${target}"…`));

	const layoutResult = await getFilteredLayout(layout);
	const match = matchWindow(layoutResult.windows, target);

	if (!match) {
		return errorResult(
			`No window matching "${target}" found.\n\n${formatLayout(layoutResult)}`,
		);
	}

	if (!match.visible) {
		return errorResult(
			`Window "${match.appName}: ${match.title}" is on workspace ${match.workspace} ` +
				`which is not currently visible. Screenshot would capture wrong content.\n\n${formatLayout(layoutResult)}`,
		);
	}

	onUpdate?.(textResult(`Capturing ${match.appName}: "${match.title}"…`));

	const result = await captureToImage(capture, match.rect);
	result.content.push({
		type: "text" as const,
		text: `Screenshot of "${target}" captured.`,
	});
	return result;
}

async function captureFullScreen(
	capture: CaptureProvider,
	onUpdate: ((partial: AgentToolResult<unknown>) => void) | undefined,
): Promise<AgentToolResult<unknown>> {
	onUpdate?.(textResult("Capturing full screen…"));

	const result = await captureToImage(capture, "all");
	result.content.push({
		type: "text" as const,
		text: "Full screen screenshot captured.",
	});
	return result;
}
