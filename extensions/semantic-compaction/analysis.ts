import type { AssistantMessage } from "@mariozechner/pi-ai";
import type {
	SessionEntry,
	SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";
import { estimateTokens } from "@mariozechner/pi-coding-agent";
import { at } from "../../utils/array/at";
import { last } from "../../utils/array/last";

// --- Classification helpers ---

export function isMessageEntry(
	entry: SessionEntry,
): entry is SessionMessageEntry {
	return entry.type === "message";
}

export function isUserMessage(
	entry: SessionEntry,
): entry is SessionMessageEntry {
	return isMessageEntry(entry) && entry.message.role === "user";
}

export function isAssistantMessage(
	entry: SessionEntry,
): entry is SessionMessageEntry {
	return isMessageEntry(entry) && entry.message.role === "assistant";
}

export function assistantdMessageHasText(entry: SessionMessageEntry): boolean {
	if (entry.message.role !== "assistant") return false;
	return entry.message.content.some((c) => c.type === "text");
}

/** Classify an assistant message: does it have context (thinking/text), tool calls, or both? */
export function classifyAssistant(
	entry: SessionMessageEntry,
): "context" | "toolcall" | "mixed" {
	if (entry.message.role !== "assistant") return "context";
	const content = entry.message.content;
	const hasContext = content.some(
		(c) => c.type === "thinking" || c.type === "text",
	);
	const hasToolCalls = content.some((c) => c.type === "toolCall");
	if (hasContext && hasToolCalls) return "mixed";
	if (hasToolCalls) return "toolcall";
	return "context";
}

/** Is this entry part of a tool group? (pure toolCall assistant msg or toolResult) */
function isToolGroupEntry(entry: SessionEntry): boolean {
	if (entry.type !== "message") return false;
	if (entry.message.role === "toolResult") return true;
	if (entry.message.role === "assistant")
		return classifyAssistant(entry) === "toolcall";
	return false;
}

/** Estimate tokens for just the toolCall blocks in an assistant message. */
function estimateToolCallTokens(msg: AssistantMessage): number {
	let tokens = 0;
	for (const block of msg.content) {
		if (block.type === "toolCall") {
			tokens += Math.ceil(
				(block.name.length + JSON.stringify(block.arguments).length) / 4,
			);
		}
	}
	return tokens;
}

/** Create a copy of a mixed assistant entry with toolCall blocks removed. */
export function stripToolCalls(entry: SessionMessageEntry): SessionEntry {
	if (entry.message.role !== "assistant") return entry;
	return {
		...entry,
		message: {
			...entry.message,
			content: entry.message.content.filter((c) => c.type !== "toolCall"),
		},
	} as SessionEntry;
}

/** Estimate tokens for tool-related content in a list of entries.
 *  For mixed entries, only counts the toolCall blocks.
 *  For pure toolCall/toolResult entries, counts everything. */
function estimateToolGroupTokens(entries: SessionEntry[]): number {
	let tokens = 0;
	for (const entry of entries) {
		if (entry.type === "message") {
			if (classifyAssistant(entry) === "mixed") {
				tokens += estimateToolCallTokens(entry.message as AssistantMessage);
			} else {
				tokens += estimateTokens(entry.message);
			}
		}
	}
	return tokens;
}

/** Is this entry a context-bearing message? (user, or assistant with thinking/text) */
function isContextEntry(entry: SessionEntry): boolean {
	if (entry.type !== "message") return false;
	if (entry.message.role === "user") return true;
	if (entry.message.role === "assistant")
		return classifyAssistant(entry) !== "toolcall";
	return false;
}

// --- Types ---

export interface ToolGroup {
	/** ID of the first entry in the group (the mixed assistant msg or first pure toolCall) */
	startId: string;
	/** ID of the last entry in the group (last toolResult) */
	endId: string;
	/** The tool-related entries (assistant toolCall msgs + toolResult msgs) */
	toolEntries: SessionEntry[];
	/** Whether the group starts with a mixed assistant message (thinking/text + toolCall) */
	mixedStart: boolean;
	/** Preceding context entry (user msg or assistant with thinking/text) */
	preContext: SessionEntry | null;
	/** Following context entry */
	postContext: SessionEntry | null;
	/** Estimated tokens in the tool entries */
	tokenEstimate: number;
}

export interface ToolCompaction extends ToolGroup {
	/** The compacted summary text */
	compacted: string;
}

// --- Core functions ---

/** Split a flat entry list into turns. Each turn starts with a user message. */
export function splitIntoTurns(entries: SessionEntry[]): SessionEntry[][] {
	const turns: SessionEntry[][] = [];
	let current: SessionEntry[] = [];

	for (const entry of entries) {
		if (entry.type === "message" && entry.message.role === "user") {
			if (current.length > 0) {
				turns.push(current);
			}
			current = [entry];
		} else {
			current.push(entry);
		}
	}

	if (current.length > 0) {
		turns.push(current);
	}

	return turns;
}

/** Find tool groups within a turn's entries. */
export function findToolGroups(turnEntries: SessionEntry[]): ToolGroup[] {
	const groups: ToolGroup[] = [];
	let i = 0;

	while (i < turnEntries.length) {
		const entry = at(turnEntries, i);

		// Detect group start
		let toolStart = -1;
		let mixedStart = false;
		const toolEntries: SessionEntry[] = [];

		if (isToolGroupEntry(entry)) {
			toolStart = i;
		} else if (
			entry.type === "message" &&
			entry.message.role === "assistant" &&
			classifyAssistant(entry) === "mixed"
		) {
			// Mixed entry: check if followed by tool entries (its own toolResult or another toolCall)
			toolStart = i;
			mixedStart = true;
		}
		toolEntries.push(entry);

		if (toolStart === -1) {
			i++;
			continue;
		}

		// Collect consecutive tool entries
		let j = toolStart + 1;
		while (j < turnEntries.length && isToolGroupEntry(at(turnEntries, j))) {
			toolEntries.push(at(turnEntries, j));
			j++;
		}

		// Find pre-context: walk backwards from group start
		const preContext = mixedStart
			? entry // The mixed entry itself serves as pre-context
			: findContextBefore(turnEntries, toolStart);

		// Find post-context: walk forwards from group end
		const postContext = findContextAfter(turnEntries, j);

		const tokenEstimate = estimateToolGroupTokens(toolEntries);

		const startId = at(toolEntries, 0).id;
		const endId = last(toolEntries).id;

		groups.push({
			startId,
			endId,
			toolEntries,
			mixedStart,
			preContext,
			postContext,
			tokenEstimate,
		});

		i = j;
	}

	return groups;
}

/** Walk backwards from `beforeIndex` to find the nearest context entry. */
function findContextBefore(
	entries: SessionEntry[],
	beforeIndex: number,
): SessionEntry | null {
	for (let k = beforeIndex - 1; k >= 0; k--) {
		const e = at(entries, k);
		if (isContextEntry(e)) return e;
	}
	return null;
}

/** Walk forwards from `afterIndex` to find the nearest context entry. */
function findContextAfter(
	entries: SessionEntry[],
	afterIndex: number,
): SessionEntry | null {
	for (let k = afterIndex; k < entries.length; k++) {
		const e = at(entries, k);
		if (isContextEntry(e)) return e;
	}
	return null;
}
