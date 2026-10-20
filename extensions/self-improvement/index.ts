import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { evaluate } from "./evaluator";
import { matchesRule, matchesTouchedFile } from "./matcher";
import {
	createLocalState,
	getTouchedFilePath,
	hasReviewMarker,
	latestUserEntryId,
	REVIEW_MARKER_TYPE,
	RULE_ENTRY_TYPE,
} from "./session";
import { loadRuleStore } from "./store";
import type { LocalState, Rule } from "./types";

export default async function selfImprovementExtension(pi: ExtensionAPI) {
	const store = await loadRuleStore();
	let localState: LocalState = { loadedRuleIds: new Set() };
	let learning = false;
	let evaluating = false;

	const setIndicator = (ctx: ExtensionContext, checking = false) => {
		ctx.ui.setStatus(
			"self-improvement",
			checking
				? "Learning: checking"
				: learning
					? "Learning: on"
					: "Learning: off",
		);
	};

	pi.on("session_start", async (_event, ctx) => {
		localState = createLocalState(ctx.sessionManager.getBranch());
		setIndicator(ctx);
	});

	pi.on("tool_execution_start", async (event) => {
		const path = getTouchedFilePath(event.toolName, event.args);
		if (!path) return;
		const rules = store.rules.filter(
			(rule) =>
				rule.state === "active" &&
				!localState.loadedRuleIds.has(rule.id) &&
				matchesTouchedFile(rule, path),
		);
		if (rules.length === 0) return;

		for (const rule of rules) localState.loadedRuleIds.add(rule.id);
		pi.sendMessage(
			{
				customType: RULE_ENTRY_TYPE,
				content: formatRules(rules),
				display: false,
				details: { ruleIds: rules.map((rule) => rule.id) },
			},
			{ deliverAs: "steer" },
		);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!learning || evaluating) return;
		void runEvaluation(ctx, 2);
	});

	pi.registerCommand("learning", {
		description: "Enable learning and review a number of recent turns",
		handler: async (args, ctx) => {
			if (learning) {
				learning = false;
				setIndicator(ctx);
				ctx.ui.notify("Learning disabled.", "info");
				return;
			}
			const turns = Number(args);
			if (!Number.isInteger(turns) || turns < 1) {
				ctx.ui.notify("Use /learning <turns>.", "warning");
				return;
			}
			learning = true;
			setIndicator(ctx);
			ctx.ui.notify("Learning enabled.", "info");
			if (!evaluating) void runEvaluation(ctx, turns);
		},
	});
	pi.registerCommand("learning-review", {
		description: "Run self-improvement learning again for recent turns",
		handler: async (_args, ctx) => {
			if (evaluating) {
				ctx.ui.notify("Learning is already checking.", "info");
				return;
			}
			ctx.ui.notify("Learning review started.", "info");
			void runEvaluation(ctx, 3, true, true);
		},
	});

	pi.registerCommand("learning-rules", {
		description: "Show loaded and inactive self-improvement rules",
		handler: async (_args, ctx) => {
			const text = formatRuleReview(store.rules, localState);
			if (!ctx.hasUI) {
				ctx.ui.notify(text, "info");
				return;
			}
			await ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) => {
					let scrollOffset = 0;
					return {
						render: (width) => {
							const border = theme.fg("accent", "─".repeat(Math.max(1, width)));
							const lines = [
								border,
								theme.fg("accent", theme.bold("Learning rules")),
								border,
								...text
									.split("\n")
									.flatMap((line) => renderReviewLine(line, theme, width)),
								border,
								theme.fg("dim", "↑/↓ scroll · q/Esc close"),
								border,
							];
							const maxHeight = Math.max(1, Math.floor(tui.terminal.rows * 0.8));
							scrollOffset = Math.min(
								scrollOffset,
								Math.max(0, lines.length - maxHeight),
							);
							return lines.slice(scrollOffset, scrollOffset + maxHeight);
						},
						handleInput: (data) => {
							if (matchesKey(data, Key.escape) || data === "q") done(undefined);
							else if (matchesKey(data, Key.up) || data === "k")
								scrollOffset = Math.max(0, scrollOffset - 1);
							else if (matchesKey(data, Key.down) || data === "j")
								scrollOffset++;
							tui.requestRender();
						},
						invalidate: () => {},
					};
				},
				{
					overlay: true,
					overlayOptions: { width: "70%", maxHeight: "80%", margin: 1 },
				},
			);
		},
	});

	pi.registerShortcut("ctrl+alt+l", {
		description: "Enable or disable self-improvement learning",
		handler: async (ctx) => {
			learning = !learning;
			setIndicator(ctx);
			ctx.ui.notify(`Learning ${learning ? "enabled" : "disabled"}.`, "info");
			if (learning && !evaluating) void runEvaluation(ctx, 3);
		},
	});

	async function runEvaluation(
		ctx: Parameters<typeof evaluate>[0],
		turns: number,
		force = false,
		showResult = false,
	) {
		const branch = ctx.sessionManager.getBranch();
		const userEntryId = latestUserEntryId(branch);
		if (!userEntryId || (!force && hasReviewMarker(branch, userEntryId)))
			return;

		evaluating = true;
		setIndicator(ctx, true);
		try {
			const starts = branch
				.map((entry, index) =>
					entry.type === "message" && entry.message.role === "user"
						? index
						: -1,
				)
				.filter((index) => index >= 0);
			const start = starts.at(-turns) ?? 0;
			const summary = await evaluate(ctx, store, branch.slice(start));
			await logEvaluation(ctx, userEntryId, showResult, summary);
			pi.appendEntry(REVIEW_MARKER_TYPE, { userEntryId });
			if (showResult) {
				ctx.ui.notify(
					`Learning review completed. Added: ${summary.added}, updated: ${summary.updated}, removed: ${summary.removed}.\n${summary.decision}`,
					"info",
				);
			}
		} catch (error) {
			if (showResult) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Learning review failed: ${message}`, "error");
			}
		} finally {
			evaluating = false;
			setIndicator(ctx);
		}
	}

	pi.on("before_agent_start", async (_event, ctx) => {
		const rules = store.rules.filter(
			(rule) =>
				rule.state === "active" &&
				!localState.loadedRuleIds.has(rule.id) &&
				matchesRule(rule, ctx.cwd),
		);
		if (rules.length === 0) return;

		for (const rule of rules) localState.loadedRuleIds.add(rule.id);
		return {
			message: {
				customType: RULE_ENTRY_TYPE,
				content: formatRules(rules),
				display: false,
				details: { ruleIds: rules.map((rule) => rule.id) },
			},
		};
	});
}

async function logEvaluation(
	ctx: ExtensionContext,
	userEntryId: string,
	manual: boolean,
	summary: Awaited<ReturnType<typeof evaluate>>,
): Promise<void> {
	const directory = join(getAgentDir(), "self-improvement");
	await mkdir(directory, { recursive: true });
	await appendFile(
		join(directory, "evaluations.jsonl"),
		`${JSON.stringify({
			timestamp: new Date().toISOString(),
			sessionId: ctx.sessionManager.getHeader()?.id,
			userEntryId,
			trigger: manual ? "manual" : "automatic",
			...summary,
		})}\n`,
	);
}

function formatRuleReview(rules: Rule[], state: LocalState): string {
	const loaded = rules.filter((rule) => state.loadedRuleIds.has(rule.id));
	const inactive = rules.filter((rule) => !state.loadedRuleIds.has(rule.id));
	return [
		"Loaded",
		...formatRuleList(loaded),
		"",
		"Inactive",
		...formatRuleList(inactive),
	].join("\n");
}

function formatRuleList(rules: Rule[]): string[] {
	if (rules.length === 0) return ["- None"];
	return rules.flatMap((rule) => [
		`Rule: ${rule.id}`,
		`  State: ${rule.state}`,
		`  Triggers: ${rule.when.map(formatTrigger).join(", ")}`,
		"  Text:",
		`    ${rule.text}`,
		"  Scratchpad:",
		...rule.scratchpad.split("\n").map((line) => `    ${line}`),
		"  Citations:",
		...(rule.citations.length === 0
			? ["    None"]
			: rule.citations.flatMap((citation) => [
					`    ${citation.id}: ${citation.sessionId} / ${citation.entryId}`,
					...citation.excerpts.map((excerpt) => `      ${excerpt}`),
				])),
		`  Created: ${rule.createdAt}`,
		`  Updated: ${rule.updatedAt}`,
		`  Latest evidence: ${rule.lastEvidenceAt ?? "None"}`,
		`  Latest review: ${rule.lastReviewedAt ?? "None"}`,
		"",
	]);
}

function formatTrigger(rule: Rule["when"][number]): string {
	return rule.kind === "always" ? "always" : `${rule.kind}: ${rule.glob}`;
}

function renderReviewLine(
	line: string,
	theme: {
		fg: (
			color: "accent" | "success" | "warning" | "dim",
			text: string,
		) => string;
		bold: (text: string) => string;
	},
	width: number,
): string[] {
	const text = line;
	const styled =
		text === "Loaded" || text === "Inactive"
			? theme.fg("accent", theme.bold(text))
			: text.startsWith("Rule: ")
				? theme.fg("success", theme.bold(text))
				: text.startsWith("  State:") || text.startsWith("  Triggers:")
					? theme.fg("warning", text)
					: text.startsWith("  Text:") || text.startsWith("  Scratchpad:")
						? theme.fg("accent", text)
						: text.startsWith("  Created:") ||
								text.startsWith("  Updated:") ||
								text.startsWith("  Latest")
							? theme.fg("dim", text)
							: text;
	return wrapTextWithAnsi(styled, width);
}

function formatRules(rules: Rule[]): string {
	return [
		"<persistent-rules>",
		...rules.map((rule) => `  <rule>${escapeXml(rule.text)}</rule>`),
		"</persistent-rules>",
	].join("\n");
}

function escapeXml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}
