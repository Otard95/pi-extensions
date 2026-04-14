/**
 * Modes Extension
 *
 * Switch between custom modes defined as markdown files in ~/.pi/agent/modes/.
 * Each mode appends its content to the system prompt, optionally restricting
 * tools and setting a model.
 *
 * Mode files use frontmatter for metadata and the body as the system prompt addition:
 *
 * ```markdown
 * ---
 * name: plan
 * description: Read-only planning mode
 * tools: read, bash, grep, find, ls
 * model: claude-sonnet-4-5
 * ---
 *
 * You are in PLANNING MODE. Analyze the codebase and create a detailed plan...
 * ```
 *
 * Usage:
 *   /mode           - show mode selector (or clear mode)
 *   /mode plan      - switch to "plan" mode directly
 *   Ctrl+}          - cycle through modes (configurable via "ext.modes.cycle" in keybindings.json)
 *   Ctrl+{          - cycle reverse (configurable via "ext.modes.cycleReverse" in keybindings.json)
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { KeyId } from "@mariozechner/pi-tui";
import { ModeManager } from "./manager.js";
import { loadModes, type ModeConfig } from "./modes.js";

export type { ModeConfig } from "./modes.js";

function loadKeybindings(): Record<string, string | string[]> {
	const kbPath = path.join(getAgentDir(), "keybindings.json");
	if (!existsSync(kbPath)) return {};
	try {
		const raw = JSON.parse(readFileSync(kbPath, "utf-8"));
		if (typeof raw === "object" && raw !== null && !Array.isArray(raw))
			return raw;
	} catch {}
	return {};
}

export default function modesExtension(pi: ExtensionAPI) {
	const mgr = new ModeManager(pi);

	// --- Commands ---

	pi.registerCommand("mode", {
		description: "Switch mode or clear active mode",
		getArgumentCompletions(prefix: string) {
			const modes = loadModes();
			const items = [
				{ value: "off", label: "off — clear active mode" },
				{ value: "debug", label: "debug — show current mode state" },
				...modes.map((m) => ({
					value: m.name,
					label: `${m.name}${m.description ? ` — ${m.description}` : ""}`,
				})),
			];
			if (!prefix) return items;
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const modes = loadModes();

			if (modes.length === 0) {
				ctx.ui.notify(
					`No modes found. Create .md files in ${path.join(getAgentDir(), "modes")}/`,
					"warning",
				);
				return;
			}

			// Direct argument: /mode plan or /mode off
			if (args?.trim()) {
				const arg = args.trim().toLowerCase();
				if (arg === "off" || arg === "clear" || arg === "none") {
					mgr.deactivate(ctx);
					return;
				}
				if (arg === "debug") {
					const active = mgr.activeMode;
					const tools = active?.tools ?? null;
					const previousTools = mgr.previousTools;
					const lines = [
						`Active: ${active ? active.name : "none"}`,
						`Model: ${active?.model ?? "default"}`,
						`Mode tools: ${tools ? tools.join(", ") : "all (unrestricted)"}`,
						`Previous tools: ${previousTools ? previousTools.join(", ") : "none (unmanaged)"}`,
						`Previous: ${mgr.previousModeName ?? "none"}`,
						`Available modes: ${modes.map((m) => m.name).join(", ")}`,
					];
					ctx.ui.notify(lines.join("\n"), "info");
					return;
				}
				const mode = modes.find((m) => m.name.toLowerCase() === arg);
				if (mode) {
					await mgr.activate(mode, ctx);
					return;
				}
				ctx.ui.notify(
					`Unknown mode: "${args.trim()}". Available: ${modes.map((m) => m.name).join(", ")}`,
					"warning",
				);
				return;
			}

			// Interactive selector
			const options = [
				...(mgr.activeMode ? ["✕  Clear mode"] : []),
				...modes.map((m) => {
					const active = mgr.activeMode?.name === m.name ? " ●" : "";
					const tools = m.tools ? ` [${m.tools.join(", ")}]` : "";
					const model = m.model ? ` (${m.model})` : "";
					return `${m.name}${active}  ${m.description || ""}${model}${tools}`;
				}),
			];

			const choice = await ctx.ui.select("Switch mode:", options);
			if (!choice) return;

			if (choice.startsWith("✕")) {
				mgr.deactivate(ctx);
				return;
			}

			const chosenName = choice.split(/\s/)[0];
			const mode = modes.find((m) => m.name === chosenName);
			if (mode) {
				await mgr.activate(mode, ctx);
			}
		},
	});

	// --- Keyboard shortcut: cycle modes ---

	const userBindings = loadKeybindings();
	const cycleKey = (userBindings["ext.modes.cycle"] ?? "ctrl+}") as KeyId;
	const cycleReverseKey = (userBindings["ext.modes.cycleReverse"] ??
		"ctrl+{") as KeyId;

	function cycleModes(modes: ModeConfig[], direction: 1 | -1) {
		if (!mgr.activeMode) {
			return direction === 1 ? modes[0] : modes[modes.length - 1];
		}

		const currentIndex = modes.findIndex(
			(m) => m.name === mgr.activeMode?.name,
		);
		const nextIndex = currentIndex + direction;

		if (nextIndex < 0 || nextIndex >= modes.length) return null; // deactivate
		return modes[nextIndex];
	}

	for (const [key, direction] of [
		[cycleKey, 1],
		[cycleReverseKey, -1],
	] as const) {
		pi.registerShortcut(key, {
			description:
				direction === 1
					? "Cycle through modes"
					: "Cycle through modes (reverse)",
			handler: async (ctx) => {
				const modes = loadModes();
				if (modes.length === 0) return;

				const next = cycleModes(modes, direction);
				if (next) {
					await mgr.activate(next, ctx);
				} else {
					mgr.deactivate(ctx);
				}
			},
		});
	}

	// --- System prompt injection + mode switch context ---

	pi.on("before_agent_start", async (event) => {
		const currentName = mgr.activeMode?.name ?? null;
		const switched = mgr.previousModeName !== currentName;
		mgr.previousModeName = currentName;

		if (!switched && !mgr.activeMode) return;

		const ret: {
			systemPrompt?: string;
			message?: { customType: string; content: string; display: boolean };
		} = {};

		if (mgr.activeMode?.systemPrompt)
			ret.systemPrompt = `${event.systemPrompt}\n\n${mgr.activeMode.systemPrompt}`;

		if (switched)
			ret.message = {
				customType: "mode-switch",
				content: mgr.activeMode
					? `Mode switched to "${mgr.activeMode.name}". You now have different capabilities and constraints. Review the system prompt for your current role.`
					: `Mode cleared — default settings restored. You now have full tool access. Review the system prompt for your current role.`,
				display: false,
			};

		return ret;
	});
}
