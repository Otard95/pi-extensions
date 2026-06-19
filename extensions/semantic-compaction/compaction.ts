import type { Message } from "@mariozechner/pi-ai";
import type {
	ExtensionCommandContext,
	ExtensionContext,
	SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { at } from "../../utils/array/at";
import { formatEntry } from "../../utils/conversation/entries";
import { formatToolArgs } from "../../utils/conversation/messages";
import { complete } from "../../utils/model/complete";
import { pickModel } from "../../utils/model/pick";
import {
	findToolGroups,
	type ToolCompaction,
	type ToolGroup,
} from "./analysis";
import { rebuildEntries } from "./session";

export interface CompactionResult {
	rebuilt: SessionEntry[];
	stats: string;
}

/**
 * Run tool compaction: find tool groups, compact each, rebuild entries.
 * Handles confirmation, progress, and error reporting.
 * Returns null if nothing to compact or user cancels.
 */
export async function compactTools(
	entriesToCompact: SessionEntry[],
	allEntries: SessionEntry[],
	threshold: number,
	ctx: ExtensionCommandContext,
): Promise<CompactionResult | null> {
	const groups = findToolGroups(entriesToCompact).filter(
		(g) => g.tokenEstimate >= threshold,
	);

	if (groups.length === 0) {
		ctx.ui.notify(
			"Nothing to compact (no tool groups above threshold)",
			"info",
		);
		return null;
	}

	const confirmed = await ctx.ui.confirm(
		"Semantic Compaction",
		`Compact ${groups.length} tool groups?`,
	);
	if (!confirmed) return null;

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
			compactToolGroup(g, ctx).finally(() => {
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
		ctx.ui.notify(`All compactions failed:\n${failures.join("\n")}`, "error");
		return null;
	}

	if (failures.length > 0) {
		ctx.ui.notify(
			`${failures.length} group(s) failed (will be left as-is):\n${failures.join("\n")}`,
			"warning",
		);
	}

	const rebuilt = rebuildEntries(allEntries, compactions);

	const originalTokens = groups.reduce((sum, g) => sum + g.tokenEstimate, 0);
	const savedTokens =
		compactions.reduce((sum, c) => sum + c.tokenEstimate, 0) -
		compactions.reduce((sum, c) => sum + Math.ceil(c.compacted.length / 4), 0);

	return {
		rebuilt,
		stats:
			`Groups: ${compactions.length}/${groups.length} compacted\n` +
			`Entries: ${allEntries.length} → ${rebuilt.length}\n` +
			`Tokens: ~${originalTokens} → ~${originalTokens - savedTokens} (saved ~${savedTokens})`,
	};
}

/** Compact a single tool group by calling a fast model. */
async function compactToolGroup(
	group: ToolGroup,
	ctx: ExtensionContext,
	signal?: AbortSignal,
): Promise<ToolCompaction> {
	const choice = await pickModel(ctx, { noFallback: true });
	if (!choice) {
		throw new Error("No authenticated model available for tool compaction");
	}

	const userMessage = buildCompactionPrompt(group);
	const messages: Message[] = [
		{ role: "user", content: userMessage, timestamp: Date.now() } as Message,
	];

	const response = await complete(choice, COMPACTION_SYSTEM_PROMPT, messages, {
		signal,
	});

	const compacted = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();

	if (!compacted) {
		throw new Error("Tool compaction returned empty response");
	}

	return { ...group, compacted };
}

/** Placeholder compaction: summarises tool calls as name + line count. */
export function compactToolGroupTest(group: ToolGroup): ToolCompaction {
	const lines: string[] = [];

	for (const entry of group.toolEntries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;

		if (msg.role === "assistant") {
			for (const block of msg.content) {
				if (block.type === "toolCall") {
					const argsPreview = formatToolArgs(block.name, block.arguments);
					lines.push(argsPreview);
				}
			}
		} else if (msg.role === "toolResult") {
			const text = msg.content
				.filter((c) => c.type === "text")
				.map((c) => (c as { type: "text"; text: string }).text)
				.join("");
			const lineCount = text.split("\n").length;
			const suffix = msg.isError ? " [ERROR]" : "";
			lines.push(`  ${lineCount} lines${suffix}`);
		}
	}

	return { ...group, compacted: lines.join("\n") };
}

// --- Prompt construction ---

export const COMPACTION_SYSTEM_PROMPT = `You are a compaction agent. Your job is to summarize tool calls from an AI assistant conversation.

You will receive a message with three XML sections:
- <preceding_message> — context for WHY the tools were called. Do NOT summarize this.
- <tool_calls> — the tool calls and their results. You SHOULD summarize this.
- <following_message> — what the assistant concluded. Do NOT summarize this.

Your output should ONLY contain the summarized tool calls. No preamble, no explanation, no XML tags.

Use this format for each tool call:

[tool] <call signature>
<condensed content>

Example:

[tool] read(/home/user/config.json)
Database host: localhost:5432, pool size: 10, retry: 3. Auth uses JWT with 24h expiry.

[tool] bash(grep -r "TODO" src/)
5 matches: src/api.ts:12, src/auth.ts:45, src/db.ts:3, src/util.ts:88, src/main.ts:201

Guidelines:
- Focus on information relevant to the surrounding conversation context.
- Preserve specific values, paths, names, and findings the assistant used.
- For errors, note what failed and why.
- Omit boilerplate, verbose output, and redundant details.
- The condensed content should be the actual distilled information, not a description of it.`;

/** Build the user message for the compaction agent. */
export function buildCompactionPrompt(group: ToolGroup): string {
	const sections: string[] = [];

	// Pre-context
	sections.push("<preceding_message>");
	sections.push(
		group.preContext ? formatEntry(group.preContext).join("\n") : "(none)",
	);
	sections.push("</preceding_message>");

	// Tool calls
	sections.push("");
	sections.push("<tool_calls>");
	for (const entry of group.toolEntries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;

		if (msg.role === "assistant") {
			for (const block of msg.content) {
				if (block.type === "toolCall") {
					sections.push(
						`[call] ${formatToolArgs(block.name, block.arguments)}`,
					);
				}
			}
		} else if (msg.role === "toolResult") {
			const text = msg.content
				.filter((c) => c.type === "text")
				.map((c) => (c as { type: "text"; text: string }).text)
				.join("");
			const errLabel = msg.isError ? " [ERROR]" : "";
			sections.push(`[result]${errLabel} ${text}`);
		}
	}
	sections.push("</tool_calls>");

	// Post-context
	sections.push("");
	sections.push("<following_message>");
	sections.push(
		group.postContext ? formatEntry(group.postContext).join("\n") : "(none)",
	);
	sections.push("</following_message>");

	return sections.join("\n");
}
