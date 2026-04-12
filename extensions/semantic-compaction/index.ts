import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";
import { at } from "../../utils/array/at";
import { Result } from "../../utils/monad/result";
import {
	assistantdMessageHasText,
	findToolGroups,
	isMessageEntry,
	isUserMessage,
	splitIntoTurns,
	type ToolCompaction,
} from "./analysis";
import {
	parseArgs,
	type SemanticCompactArgs,
	SemanticCompactKeepMode,
} from "./args";
import { compactToolGroup } from "./compaction";
import { completions } from "./completions";
import { populateSession, rebuildEntries } from "./session";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("semantic-compact", {
		description: [
			"Run semantic compaction and create a new session with the result.",
			"  Args: [<mode>] [keep (<keep_mode> | <number>%) [<keep_value>]]",
			"",
			"    <mode>",
			"      tools (default) - Compact only tool calls",
			"      turns           - Compact full turns (groups of entries from one user message to another)",
			"",
			"    keep: Keep some portion of the latest conversation history uncompressed.",
			"          keep_mode and keep_value together describe how much of the conversation",
			"          to keep uncompressed.",
			"    <keep_mode>",
			"      percent  (default) - Keep a percentage of messages*",
			"      messages           - Keep a set number of messages*",
			"      turns              - Keep a set number of turns**",
			"",
			"    *  Messages are only user messages or assistant messages with text content (not thinking, tools, etc.)",
			"    ** Turns are the entries starting at and including a user message, to but not including the next user message",
		].join("\n"),
		getArgumentCompletions: completions,
		handler: async (args, ctx) => {
			const argsResult = Result.try(() => parseArgs(args));
			if (argsResult.isErr()) {
				ctx.ui.notify(argsResult.unwrapErr().message, "error");
				return;
			}
			const compactArgs = argsResult.unwrap();
			if (compactArgs.mode === "turns") {
				ctx.ui.notify("This mode is not implemented yet", "error");
				return;
			}

			const entries = ctx.sessionManager.getBranch();

			const entriesToCompact = excludeKeptEntries(entries, compactArgs.keep);

			const groups = findToolGroups(entriesToCompact).filter(
				(g) => g.tokenEstimate >= compactArgs.threshold,
			);

			if (groups.length === 0) {
				ctx.ui.notify(
					"Nothing to compact (no tool groups above threshold)",
					"info",
				);
				return;
			}

			const confirmed = await ctx.ui.confirm(
				"Semantic Compaction",
				`Compact ${groups.length} tool groups using Haiku?`,
			);
			if (!confirmed) return;

			let completed = 0;
			ctx.ui.notify(
				`⏳ Compacting ${groups.length} tool groups in parallel...`,
				"info",
			);
			ctx.ui.setStatus(
				"compaction",
				`⏳ Compacting 0/${groups.length} tool groups`,
			);

			const settled = await Promise.allSettled(
				groups.map((g) =>
					compactToolGroup(g).finally(() => {
						completed++;
						ctx.ui.setStatus(
							"compaction",
							`⏳ Compacting ${completed}/${groups.length} tool groups`,
						);
					}),
				),
			);

			ctx.ui.setStatus("compaction", undefined);

			const compactions: ToolCompaction[] = [];
			const failures: string[] = [];
			for (let i = 0; i < settled.length; i++) {
				const result = at(settled, i);
				if (result.status === "fulfilled") {
					compactions.push(result.value);
				} else {
					failures.push(`Group ${i + 1}: ${result.reason}`);
				}
			}

			if (compactions.length === 0) {
				ctx.ui.notify(
					`All compactions failed:\n${failures.join("\n")}`,
					"error",
				);
				return;
			}

			if (failures.length > 0) {
				ctx.ui.notify(
					`${failures.length} group(s) failed (will be left as-is):\n${failures.join("\n")}`,
					"warning",
				);
			}

			const rebuilt = rebuildEntries(entries, compactions);

			const originalTokens = groups.reduce(
				(sum, g) => sum + g.tokenEstimate,
				0,
			);
			const savedTokens =
				compactions.reduce((sum, c) => sum + c.tokenEstimate, 0) -
				compactions.reduce(
					(sum, c) => sum + Math.ceil(c.compacted.length / 4),
					0,
				);

			const parentSession = ctx.sessionManager.getSessionFile();
			await ctx.newSession({
				parentSession,
				setup: async (sm) => {
					await populateSession(sm, rebuilt);
				},
			});

			ctx.ui.notify(
				`Compacted session created\n` +
					`  Groups: ${compactions.length}/${groups.length} compacted\n` +
					`  Entries: ${entries.length} → ${rebuilt.length}\n` +
					`  Tokens: ~${originalTokens} → ~${originalTokens - savedTokens} (saved ~${savedTokens})`,
				"info",
			);
		},
	});
}

function excludeKeptEntries(
	entries: SessionEntry[],
	keep: SemanticCompactArgs["keep"],
): SessionEntry[] {
	if (keep.value === 0) return entries;
	switch (keep.type) {
		case SemanticCompactKeepMode.Percent:
			return excludeByPercent(entries, keep.value);
		case SemanticCompactKeepMode.Messages:
			return excludeByMessages(entries, keep.value);
		case SemanticCompactKeepMode.Turns:
			return excludeByTurns(entries, keep.value);
	}
}

function excludeByPercent(
	entries: SessionEntry[],
	keep: number,
): SessionEntry[] {
	const keepCount = Math.ceil((entries.length * keep) / 100);

	for (let i = entries.length - keepCount; i >= 0; i--) {
		const entry = at(entries, i);
		if (
			isMessageEntry(entry) &&
			(isUserMessage(entry) || assistantdMessageHasText(entry))
		) {
			return entries.slice(0, i);
		}
	}

	return [];
}

function excludeByMessages(
	entries: SessionEntry[],
	keep: number,
): SessionEntry[] {
	let countMessages = 0;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = at(entries, i);
		if (
			isMessageEntry(entry) &&
			(isUserMessage(entry) || assistantdMessageHasText(entry))
		) {
			countMessages++;
		}
		if (countMessages >= keep) {
			return entries.slice(0, i);
		}
	}
	return [];
}

function excludeByTurns(entries: SessionEntry[], keep: number): SessionEntry[] {
	const turns = splitIntoTurns(entries);
	return turns.slice(0, Math.max(turns.length - keep, 0)).flat();
}
