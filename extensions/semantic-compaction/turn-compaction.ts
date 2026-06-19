import type { Message } from "@mariozechner/pi-ai";
import type {
	ExtensionCommandContext,
	SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { at } from "../../utils/array/at";
import { settledPool } from "../../utils/async/pool";
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

const TURN_COMPACTION_SYSTEM_PROMPT = `You are a conversation compaction agent. You compress conversation turns into terse structured summaries.

You will receive a conversation between a user and an AI coding assistant containing messages, thinking blocks, tool calls, and tool results. Produce a structured summary following the EXACT format below.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.

## Hard rules

1. NEVER fabricate content. If a user message doesn't exist in the input, do NOT invent one.
2. NEVER include thinking blocks in output. If thinking revealed a non-obvious decision or direction change, extract ONE line into Decisions.
3. NEVER reproduce code. Describe what was written/changed.
4. NEVER reproduce raw tool output. Distill to what was learned.
5. Output MUST be <20% of input length.

## Output format

Fill in ONLY these fields. Leave a field blank if not applicable. Do NOT add any other content.

Request: <what the user asked for — one line>
Files read: <comma-separated paths>
Files written: <comma-separated paths of created/edited files>
Commands: <significant shell commands and key results — one per line, omit if none>
Decisions: <choices made and why — one per line, omit if none>
Outcome: <what changed, what was resolved, what remains open — one to three lines max>

When multiple turns are grouped, produce ONE summary covering all of them.

## Style

Terse. Fragments OK. Abbreviate (fn, config, impl, pkg, deps). No filler, no narration.`;

// --- Prompt building ---

function buildTurnGroupPrompt(group: TurnGroup): string {
	const conversation = group.turns
		.map((turn) => formatEntryLines(turn).join("\n"))
		.join("\n\n");

	return `Summarize the following conversation into the structured template described in your instructions.
Output ONLY the filled-in template fields. Do NOT reproduce the conversation format.

<conversation>
${conversation}
</conversation>`;
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

	const choice = await pickModel(ctx, {
		preferred: TURN_COMPACTION_PREFERRED,
		noFallback: true,
	});

	if (!choice) {
		ctx.ui.notify(
			"No authenticated sonnet-class model available for turn compaction",
			"error",
		);
		return null;
	}

	let completed = 0;
	ctx.ui.notify(
		`⏳ Compacting ${groups.length} turn groups (up to 10 at a time)...`,
		"info",
	);
	ctx.ui.setStatus(
		"compaction",
		`⏳ Compacting 0/${groups.length} turn groups`,
	);

	const settled = await settledPool(
		groups.map(
			(g) => () =>
				compactTurnGroup(g, choice).finally(() => {
					completed++;
					ctx.ui.setStatus(
						"compaction",
						`⏳ Compacting ${completed}/${groups.length} turn groups`,
					);
				}),
		),
		10,
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
	choice: Awaited<ReturnType<typeof pickModel>>,
	signal?: AbortSignal,
): Promise<TurnCompaction> {
	if (!choice) {
		throw new Error(
			"No authenticated sonnet-class model available for turn compaction",
		);
	}

	const userMessage = buildTurnGroupPrompt(group);
	const messages: Message[] = [
		{ role: "user", content: userMessage, timestamp: Date.now() } as Message,
	];

	const maxTokens = Math.min(
		6144,
		Math.max(1024, Math.ceil(group.tokenEstimate * 0.3)),
	);
	const response = await complete(
		choice,
		TURN_COMPACTION_SYSTEM_PROMPT,
		messages,
		{ signal, maxTokens },
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
