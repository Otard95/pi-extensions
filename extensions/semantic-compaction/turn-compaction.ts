import type { Message } from "@mariozechner/pi-ai";
import type {
	ExtensionCommandContext,
	ExtensionContext,
	SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { at } from "../../utils/array/at";
import { complete } from "../../utils/model/complete";
import { pickModel } from "../../utils/model/pick";
import { groupTurns, splitIntoTurns, type TurnGroup } from "./analysis";
import type { CompactionResult } from "./compaction";
import { formatEntryLines } from "./formatting";

// --- Model selection ---

const TURN_COMPACTION_PREFERRED: ReadonlyArray<readonly [string, string]> = [
	["anthropic", "claude-sonnet-4-6"],
	["anthropic", "claude-sonnet-4-5"],
	["anthropic", "claude-sonnet-4-0"],
	["openai", "gpt-4.1"],
	["google", "gemini-2.5-pro"],
	["github-copilot", "claude-sonnet-4.6"],
	["github-copilot", "claude-sonnet-4.5"],
	["github-copilot", "gpt-4.1"],
	["github-copilot", "gemini-2.5-pro"],
];

// --- System prompt ---

const TURN_COMPACTION_SYSTEM_PROMPT = `You are a conversation compaction agent. You compress conversation turns into terse structured summaries that preserve all technical substance while removing noise.

## Goal

Produce a summary that a developer (or AI agent) can read later and understand: what was asked, what was done, what was decided, and what changed. The summary should be dense but not lossy — every piece of meaningful information survives in compressed form.

## Guiding principle

The rules and examples below describe our intent, not an exhaustive list. Apply this principle throughout: if removing or compressing something would cause a reader to lose understanding of what happened or why, keep it. If it's redundant with what the actions and outcomes already show, remove it.

## What to remove

Remove content that adds no information beyond what the actions and outcomes already convey:

- **Thinking blocks where the conclusion is already reflected in the assistant's actions or response.** Most thinking falls into this category — the assistant reasons through something, then acts on it. The action speaks for itself. However, if thinking contains a realization that changed direction, a correction based on earlier mistakes, or reasoning behind a non-obvious decision, that insight should be preserved in the summary (not the full thinking block, but the key takeaway).

- **Filler and pleasantries.** Phrases like "Let me check", "Good idea!", "Sure!", "Let me fix that", "Here's what I found" carry no information.

- **Tool failures that were immediately retried with the same intent.** If an edit failed because the match text was wrong, and the assistant read the file and retried successfully, only the success matters. But if a failure revealed something unexpected — a wrong assumption, a missing file, an API that doesn't work as expected — that discovery is meaningful and should be noted.

- **Repetitive cycles.** If the assistant ran type checking, got errors, fixed them, and ran checks again multiple times, compress to the final state: what errors were found and that they were resolved. The individual check-fix-check iterations are noise.

## What to compress

Reduce to core substance. Fragments OK. Use arrows for causality (X → Y).

- **User messages**: The core request, correction, or instruction. Drop conversational framing.
- **Assistant responses**: Decisions made, approaches chosen, things explained to the user. Not the full explanation — just the key points.
- **Tool outcomes**: What was learned, found, or changed. Not raw output.

## What to keep verbatim

Some content must survive exactly as-is because paraphrasing would lose precision:

- **Pre-compacted tool summaries** ([tool-compaction] entries): Already compressed by a previous pass. Include as-is.
- **File paths that are relevant to the work**: Paths of files that were read, edited, created, or are the subject of discussion. If the agent searched or listed files to find something, include the path of what was found, not every path that was searched. Use judgment — the path matters when it identifies something the developer would need to locate later.
- **Specific values, names, and identifiers**: Config values, model names, error codes, version numbers, command flags — anything where the exact value matters.
- **Error messages that led to a fix or decision**: Keep the error (not the full stack trace), because it explains why something was changed.
- **Decisions and their rationale**: "Chose X over Y because Z" — both the choice and the reason. Negative decisions too ("decided against X because Y").

## Output format

Use [user] / [assistant] / [tools] blocks as many times as needed to capture the exchange. One [outcome] block at the end covering the entire summary.

[user] <core request — terse, fragments OK>
[assistant] <decisions, actions, key explanations>
[tools]
  <meaningful tool interactions — one line per tool or group>
[outcome] <what changed, what was resolved, what was decided>

Omit blocks that have no content. When multiple turns are grouped together, summarize them as one cohesive unit.

## Style

Terse. All technical substance stays. Only fluff dies. Abbreviate where obvious (fn, config, impl, pkg, deps, etc). Arrows for causality. Fragments OK. One word when one word enough.

Do NOT add information that wasn't in the original conversation.
Do NOT narrate ("the user asked..." — just state what was asked).`;

// --- Prompt building ---

function buildTurnGroupPrompt(group: TurnGroup): string {
	return group.turns
		.map((turn) => formatEntryLines(turn).join("\n"))
		.join("\n\n");
}

interface TurnCompaction {
	group: TurnGroup;
	compacted: string;
}

/**
 * Run turn compaction: group turns, compact each group, rebuild entries.
 * Handles confirmation, progress, and error reporting.
 * Returns null if nothing to compact or user cancels.
 */
export async function compactTurns(
	entriesToCompact: SessionEntry[],
	allEntries: SessionEntry[],
	threshold: number,
	ctx: ExtensionCommandContext,
): Promise<CompactionResult | null> {
	const turns = splitIntoTurns(entriesToCompact);

	if (turns.length === 0) {
		ctx.ui.notify("Nothing to compact (no turns above keep threshold)", "info");
		return null;
	}

	const allTurns = splitIntoTurns(allEntries);
	const keptCount = allTurns.length - turns.length;
	const groups = groupTurns(turns, threshold);

	if (groups.length === 0) {
		ctx.ui.notify("Nothing to compact (no turn groups formed)", "info");
		return null;
	}

	const confirmed = await ctx.ui.confirm(
		"Semantic Compaction (Turns)",
		`Compact ${turns.length} turns (${groups.length} groups), keep ${keptCount}?`,
	);
	if (!confirmed) return null;

	let completed = 0;
	ctx.ui.notify(
		`⏳ Compacting ${groups.length} turn groups in parallel...`,
		"info",
	);
	ctx.ui.setStatus(
		"compaction",
		`⏳ Compacting 0/${groups.length} turn groups`,
	);

	const settled = await Promise.allSettled(
		groups.map((g) =>
			compactTurnGroup(g, ctx).finally(() => {
				completed++;
				ctx.ui.setStatus(
					"compaction",
					`⏳ Compacting ${completed}/${groups.length} turn groups`,
				);
			}),
		),
	);

	ctx.ui.setStatus("compaction", undefined);

	const compactions: TurnCompaction[] = [];
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
			`All turn compactions failed:\n${failures.join("\n")}`,
			"error",
		);
		return null;
	}

	if (failures.length > 0) {
		ctx.ui.notify(
			`${failures.length} group(s) failed (will be left as-is):\n${failures.join("\n")}`,
			"warning",
		);
	}

	const rebuilt = rebuildEntriesWithTurns(allEntries, compactions);

	return {
		rebuilt,
		stats:
			`Groups: ${compactions.length}/${groups.length} compacted\n` +
			`Entries: ${allEntries.length} → ${rebuilt.length}\n` +
			`Turns compacted: ${turns.length}, kept: ${keptCount}`,
	};
}

/** Compact a single turn group by calling a sonnet-class model. */
async function compactTurnGroup(
	group: TurnGroup,
	ctx: ExtensionContext,
	signal?: AbortSignal,
): Promise<TurnCompaction> {
	const choice = await pickModel(ctx, {
		preferred: TURN_COMPACTION_PREFERRED,
		noFallback: true,
	});

	if (!choice) {
		throw new Error(
			"No authenticated sonnet-class model available for turn compaction",
		);
	}

	const userMessage = buildTurnGroupPrompt(group);
	const messages: Message[] = [
		{ role: "user", content: userMessage, timestamp: Date.now() } as Message,
	];

	const response = await complete(
		choice,
		TURN_COMPACTION_SYSTEM_PROMPT,
		messages,
		signal,
	);

	const compacted = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();

	if (!compacted) {
		throw new Error("Turn compaction returned empty response");
	}

	return { group, compacted };
}

// --- Session rebuild ---

/**
 * Rebuild entries, replacing compacted turn groups with custom_message entries.
 * Entries within compacted groups are removed; entries outside are kept as-is.
 */
export function rebuildEntriesWithTurns(
	originalEntries: SessionEntry[],
	compactions: TurnCompaction[],
): SessionEntry[] {
	// Build a set of entry IDs that are part of compacted groups
	const compactedIds = new Set<string>();
	const startIdToCompaction = new Map<string, TurnCompaction>();

	for (const comp of compactions) {
		const firstEntry = comp.group.entries[0];
		if (firstEntry) {
			startIdToCompaction.set(firstEntry.id, comp);
		}
		for (const entry of comp.group.entries) {
			compactedIds.add(entry.id);
		}
	}

	const result: SessionEntry[] = [];

	for (const entry of originalEntries) {
		// Check if this entry starts a compacted group
		const comp = startIdToCompaction.get(entry.id);
		if (comp) {
			result.push({
				type: "custom_message",
				id: `tcomp${entry.id.slice(0, 4)}`,
				parentId: entry.parentId,
				timestamp: new Date().toISOString(),
				customType: "turn-compaction",
				content: comp.compacted,
				display: true,
			} as SessionEntry);
			continue;
		}

		// Skip entries that are inside a compacted group (but not the start)
		if (compactedIds.has(entry.id)) {
			continue;
		}

		// Keep everything else
		result.push(entry);
	}

	return result;
}
