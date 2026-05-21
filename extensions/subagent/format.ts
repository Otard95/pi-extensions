import type { Message } from "@mariozechner/pi-ai";
import { at } from "../../utils/array/at";
import { last } from "../../utils/array/last";
import { formatMessage } from "../../utils/conversation/messages";
import { isLiveTask, type LiveTask, type LiveTaskGroup } from "./schema";
import type { SingleResult, UsageStats } from "./types";

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns)
		parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = at(messages, i);
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

/** Format all messages into summary lines using the conversation utility. */
export function getMessageSummaryLines(messages: Message[]): string[] {
	return messages.flatMap(formatMessage);
}

/**
 * Get the final output of a single item (task or group).
 */
export function getItemOutput(item: LiveTask | LiveTaskGroup): string {
	if (isLiveTask(item)) return getFinalOutput(item.result?.messages ?? []);
	return collectFinalOutput(item);
}

/**
 * Collect final output text from a LiveTaskGroup tree.
 *
 * - Leaf task: last assistant text from its messages
 * - Sequential: recurse into last item only
 * - Parallel: recurse into all items, join outputs
 */
export function collectFinalOutput(group: LiveTaskGroup): string {
	if (group.tasks.length === 0) return "";

	if (group.mode === "sequential") {
		const lastItem = last(group.tasks);
		return getItemOutput(lastItem);
	}

	// Parallel: collect from all items
	const outputs: string[] = [];
	for (const item of group.tasks) {
		const text = getItemOutput(item);
		if (!text) continue;
		const label = isLiveTask(item) ? item.name : undefined;
		outputs.push(label ? `[${label}]\n${text}` : text);
	}
	return outputs.join("\n\n");
}

export function aggregateUsage(
	results: SingleResult[],
): Omit<UsageStats, "contextTokens"> {
	const total = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		turns: 0,
	};
	for (const r of results) {
		total.input += r.usage.input;
		total.output += r.usage.output;
		total.cacheRead += r.usage.cacheRead;
		total.cacheWrite += r.usage.cacheWrite;
		total.cost += r.usage.cost;
		total.turns += r.usage.turns;
	}
	return total;
}
