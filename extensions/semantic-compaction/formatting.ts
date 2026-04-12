import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { estimateTokens } from "@mariozechner/pi-coding-agent";
import { at } from "../../utils/array/at";
import type { ToolCompaction } from "./analysis";

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
