import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { estimateTokens } from "@mariozechner/pi-coding-agent";
import { at } from "../../utils/array/at";
import { formatEntry } from "../../utils/conversation/entries";
import { formatMessage, isMessage } from "../../utils/conversation/messages";
import type { ToolCompaction, TurnGroup } from "./analysis";

// --- Shared entry formatting ---

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen - 3)}...`;
}

type FormatOptions = {
	/** Max length for text previews. undefined = no truncation */
	maxLen?: number;
};

/**
 * Format session entries into tagged lines.
 * Used by both debug formatting (truncated) and prompt formatting (full).
 */
export function formatEntryLines(
	entries: SessionEntry[],
	opts: FormatOptions = {},
): string[] {
	const lines: string[] = [];
	const clip = (text: string) =>
		opts.maxLen ? truncate(text, opts.maxLen) : text;

	for (const entry of entries) {
		if (opts.maxLen && entry.type === "message" && isMessage(entry.message)) {
			// Debug mode: special handling for compact display
			if (entry.message.role === "toolResult") {
				const text = entry.message.content
					.filter((c) => c.type === "text")
					.map((c) => (c as { type: "text"; text: string }).text)
					.join("");
				const err = entry.message.isError ? " [ERROR]" : "";
				lines.push(
					`[toolResult] ${entry.message.toolName}: ${text.split("\n").length} lines${err}`,
				);
			} else if (entry.message.role === "assistant") {
				for (const block of entry.message.content) {
					if (block.type === "thinking") {
						lines.push(`[thinking] (${block.thinking.length} chars)`);
					} else {
						lines.push(
							...formatMessage({
								...entry.message,
								content: [block],
							}).map(clip),
						);
					}
				}
			} else {
				lines.push(...formatEntry(entry).map(clip));
			}
		} else if (
			opts.maxLen &&
			entry.type !== "message" &&
			entry.type !== "custom_message"
		) {
			// Debug mode: show entry type for non-content entries
			lines.push(`[${entry.type}]`);
		} else {
			// Prompt mode: use formatEntry (skips non-content entries)
			lines.push(...formatEntry(entry).map(clip));
		}
	}

	return lines;
}

/** Format the explore-groups output */
export interface TurnDeepDiveResult {
	text: string;
	error: boolean;
}

/** Format the result of a dry-run compaction. */
export function formatCompactionPreview(
	originalEntries: SessionEntry[],
	rebuiltEntries: SessionEntry[],
	compactions: ToolCompaction[],
): string {
	let output = `\n=== Compaction Preview ===\n\n`;

	const originalTokens = originalEntries.reduce((sum, e) => {
		if (e.type === "message") return sum + estimateTokens(e.message);
		return sum;
	}, 0);
	const rebuiltTokens = rebuiltEntries.reduce((sum, e) => {
		if (e.type === "message") return sum + estimateTokens(e.message);
		if (e.type === "custom_message") {
			const content =
				typeof e.content === "string" ? e.content : JSON.stringify(e.content);
			return sum + Math.ceil(content.length / 4);
		}
		return sum;
	}, 0);

	output += `Original entries: ${originalEntries.length} (~${originalTokens} tokens)\n`;
	output += `Rebuilt entries: ${rebuiltEntries.length} (~${rebuiltTokens} tokens)\n`;
	output += `Removed: ${originalEntries.length - rebuiltEntries.length} entries\n`;
	output += `Savings: ~${originalTokens - rebuiltTokens} tokens (${originalTokens > 0 ? Math.round((1 - rebuiltTokens / originalTokens) * 100) : 0}%)\n`;
	output += `\nCompactions applied: ${compactions.length}\n`;

	for (let i = 0; i < compactions.length; i++) {
		const comp = at(compactions, i);
		output += `\n--- Compaction ${i + 1} (~${comp.tokenEstimate} tokens) ---\n`;
		output += comp.compacted;
		output += `\n`;
	}

	output += `\n=== Rebuilt Entry Sequence ===\n\n`;
	for (const entry of rebuiltEntries) {
		if (entry.type === "message") {
			const msg = entry.message;
			if (msg.role === "user") {
				const preview = JSON.stringify(msg.content).slice(0, 60);
				output += `[user] ${preview}...\n`;
			} else if (msg.role === "assistant") {
				const types = msg.content.map((c) => c.type).join(", ");
				output += `[assistant] [${types}]\n`;
			} else if (msg.role === "toolResult") {
				output += `[toolResult] ${msg.toolName}\n`;
			} else {
				output += `[${msg.role}]\n`;
			}
		} else if (entry.type === "custom_message") {
			const preview =
				typeof entry.content === "string"
					? entry.content.slice(0, 80)
					: JSON.stringify(entry.content).slice(0, 80);
			if (entry.customType === "tool-compaction") {
				const content =
					typeof entry.content === "string"
						? entry.content
						: JSON.stringify(entry.content);
				const indented = content
					.split("\n")
					.map((l) => `  ${l}`)
					.join("\n");
				output += `[compaction]\n${indented}\n`;
			} else {
				output += `[custom_message:${entry.customType}] ${preview}...\n`;
			}
		} else {
			output += `[${entry.type}]\n`;
		}
	}

	return output;
}

/**
 * Format a turn group for debug output.
 * Shows each turn within the group and total token estimate.
 */
export function formatTurnGroupForDebug(
	group: TurnGroup,
	index: number,
): string {
	const lines: string[] = [];
	const turnLabel =
		group.turns.length === 1
			? `Turn ${at(group.turnIndices, 0) + 1}`
			: `Turns ${group.turnIndices.map((i) => i + 1).join(", ")}`;

	lines.push(
		`── Group ${index + 1}: ${turnLabel} (${group.entries.length} entries, ~${group.tokenEstimate} tokens) ──`,
	);

	for (let t = 0; t < group.turns.length; t++) {
		const turn = at(group.turns, t);
		const turnIdx = at(group.turnIndices, t);
		lines.push(`  ┌ Turn ${turnIdx + 1}`);
		lines.push(
			...formatEntryLines(turn, { maxLen: 120 }).map((l) => `  │  ${l}`),
		);
		lines.push(`  └`);
	}

	return lines.join("\n");
}
