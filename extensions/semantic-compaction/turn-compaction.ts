import type { Message } from "@earendil-works/pi-ai";
import type {
	ExtensionCommandContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { at } from "../../utils/array/at";
import { settledPool } from "../../utils/async/pool";
import { complete } from "../../utils/model/complete";
import { pickModel } from "../../utils/model/pick";
import { groupTurns, splitIntoTurns, type TurnGroup } from "./analysis";
import type { CompactionResult } from "./compaction";
import { formatEntryLines } from "./formatting";
import { logCompactionFailure } from "./log";

// --- Model selection ---

const TURN_COMPACTION_PREFERRED: ReadonlyArray<readonly [string, string]> = [
	["anthropic", "claude-sonnet-5-5"],
	["anthropic", "claude-sonnet-5"],
	["anthropic", "claude-sonnet-4-6"],
	["anthropic", "claude-sonnet-4-5"],
	["github-copilot", "claude-sonnet-5.5"],
	["github-copilot", "claude-sonnet-5"],
	["github-copilot", "claude-sonnet-4.6"],
	["openai-codex", "gpt-5.6-terra"],
	["github-copilot", "gpt-5.4"],
];

// --- System prompt ---

const TURN_COMPACTION_SYSTEM_PROMPT = `You are a context summarization assistant. You receive ONE SEGMENT of a longer conversation between a user and an AI coding assistant.

Your summary REPLACES that segment in place. The conversation continues before and after it, and other segments are summarized separately. So:

- Summarize ONLY what is in this segment. Do not describe the session as a whole.
- Do not write session-level status, next steps, or conclusions. Later turns you cannot see may change them.
- Do not assume the segment starts a task or finishes one. It is a middle slice.
- If the segment contains an earlier summary block, carry its content forward into yours. Never drop it.

Do NOT continue the conversation. Do NOT answer questions in it. Output only the summary.

Write these labeled sections. Omit any that do not apply:

Asked: what the user wanted in this segment, in their terms.
Discussed: the exchange itself — positions, objections, corrections, rejected options, and why. Keep the reasoning that a later reader could not reconstruct from the outcome alone. This section matters most, give it the most room.
Decided: each decision with its rationale.
Did: work performed and what it changed.
Found: findings, errors, and facts that stay relevant.
Files: read and written paths.
Open: questions or disagreements still unresolved at the end of the segment.

Rules:
- Never invent content that is not in the segment.
- Describe code and tool output, do not reproduce them.
- Preserve exact paths, identifiers, and error strings.
- Be terse everywhere except Discussed and Decided.`;

// --- Prompt building ---

function buildTurnGroupPrompt(group: TurnGroup): string {
	const conversation = group.turns
		.map((turn) => formatEntryLines(turn).join("\n"))
		.join("\n\n");

	return `Summarize this conversation segment as described in your instructions.

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
	const failures: Array<{ group: number; reason: unknown }> = [];
	for (let i = 0; i < settled.length; i++) {
		const result = at(settled, i);
		if (result.status === "fulfilled") {
			compactions.push(result.value);
		} else {
			failures.push({ group: i + 1, reason: result.reason });
		}
	}

	const failureMessages = failures.map(
		({ group, reason }) => `Group ${group}: ${reason}`,
	);
	const failureLevel = compactions.length === 0 ? "error" : "warning";
	await Promise.all(
		failures.map(({ group, reason }) =>
			logCompactionFailure(failureLevel, "turn-group-failed", reason, {
				mode: "turns",
				group,
				sessionId: ctx.sessionManager.getHeader()?.id,
			}),
		),
	);

	if (compactions.length === 0) {
		ctx.ui.notify(
			`All turn compactions failed:\n${failureMessages.join("\n")}`,
			"error",
		);
		return null;
	}

	if (failures.length > 0) {
		ctx.ui.notify(
			`${failures.length} group(s) failed (will be left as-is):\n${failureMessages.join("\n")}`,
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
