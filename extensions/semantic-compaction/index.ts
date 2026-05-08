import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";

import { at } from "../../utils/array/at";
import { Result } from "../../utils/monad/result";
import {
	assistantdMessageHasText,
	isMessageEntry,
	isUserMessage,
	splitIntoTurns,
} from "./analysis";
import {
	parseArgs,
	type SemanticCompactArgs,
	SemanticCompactKeepMode,
} from "./args";
import { compactTools } from "./compaction";
import { completions } from "./completions";
import { populateSession } from "./session";
import { compactTurns } from "./turn-compaction";

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

			const entries = ctx.sessionManager.getBranch();
			const entriesToCompact = excludeKeptEntries(entries, compactArgs.keep);

			const result =
				compactArgs.mode === "turns"
					? await compactTurns(
							entriesToCompact,
							entries,
							compactArgs.threshold,
							ctx,
						)
					: await compactTools(
							entriesToCompact,
							entries,
							compactArgs.threshold,
							ctx,
						);

			if (!result) return;

			const parentSession = ctx.sessionManager.getSessionFile();
			await ctx.newSession({
				parentSession,
				setup: async (sm) => {
					await populateSession(sm, result.rebuilt);
				},
			});

			ctx.ui.notify(
				`Compacted session created\n  ${result.stats.replace(/\n/g, "\n  ")}`,
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
