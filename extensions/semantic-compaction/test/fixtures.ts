/**
 * Test fixtures for semantic-compaction tests.
 * Builds minimal mock SessionEntry objects.
 */

import type {
	AssistantMessage,
	ToolCall,
	ToolResultMessage,
	UserMessage,
} from "@mariozechner/pi-ai";
import type {
	SessionEntry,
	SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";

let idCounter = 0;

function nextId(): string {
	return `entry-${++idCounter}`;
}

export function resetIds(): void {
	idCounter = 0;
}

function baseEntry(): Omit<SessionMessageEntry, "message"> {
	const id = nextId();
	return {
		id,
		parentId: `parent-${id}`,
		type: "message",
		timestamp: new Date().toISOString(),
	};
}

export function userMessage(text: string): SessionMessageEntry {
	return {
		...baseEntry(),
		message: {
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		} as UserMessage,
	};
}

export function assistantText(text: string): SessionMessageEntry {
	return {
		...baseEntry(),
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			usage: {
				input: 100,
				output: 50,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 150,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		} as AssistantMessage,
	};
}

export function assistantToolCall(
	...calls: Array<{ name: string; args: Record<string, unknown> }>
): SessionMessageEntry {
	return {
		...baseEntry(),
		message: {
			role: "assistant",
			content: calls.map(
				(c, i) =>
					({
						type: "toolCall",
						id: `tc-${i}`,
						name: c.name,
						arguments: c.args,
					}) as ToolCall,
			),
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			usage: {
				input: 100,
				output: 50,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 150,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: Date.now(),
		} as AssistantMessage,
	};
}

export function assistantMixed(
	text: string,
	...calls: Array<{ name: string; args: Record<string, unknown> }>
): SessionMessageEntry {
	return {
		...baseEntry(),
		message: {
			role: "assistant",
			content: [
				{ type: "text", text },
				...calls.map(
					(c, i) =>
						({
							type: "toolCall",
							id: `tc-${i}`,
							name: c.name,
							arguments: c.args,
						}) as ToolCall,
				),
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			usage: {
				input: 100,
				output: 50,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 150,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: Date.now(),
		} as AssistantMessage,
	};
}

export function toolResult(
	toolName: string,
	content: string,
): SessionMessageEntry {
	return {
		...baseEntry(),
		message: {
			role: "toolResult",
			toolCallId: "tc-0",
			toolName,
			content: [{ type: "text", text: content }],
			isError: false,
			timestamp: Date.now(),
		} as ToolResultMessage,
	};
}

/**
 * Build a simple conversation: user → assistant text → tool calls → tool results
 */
export function simpleConversation(): SessionEntry[] {
	return [
		userMessage("Hello, can you read this file?"),
		assistantToolCall({ name: "Read", args: { path: "file.ts" } }),
		toolResult("Read", "const x = 1;"),
		assistantText("The file contains a simple variable declaration."),
	];
}

/**
 * Build a multi-turn conversation with tool groups
 */
export function multiTurnConversation(): SessionEntry[] {
	return [
		// Turn 1
		userMessage("Read file.ts and package.json"),
		assistantToolCall({ name: "Read", args: { path: "file.ts" } }),
		toolResult("Read", "const x = 1;"),
		assistantToolCall({ name: "Read", args: { path: "package.json" } }),
		toolResult("Read", '{"name": "test"}'),
		assistantText("I've read both files."),
		// Turn 2
		userMessage("Now edit file.ts"),
		assistantMixed("I'll update the file.", {
			name: "Edit",
			args: { path: "file.ts", content: "const x = 2;" },
		}),
		toolResult("Edit", "OK"),
		assistantText("Done! I've updated the variable."),
	];
}
