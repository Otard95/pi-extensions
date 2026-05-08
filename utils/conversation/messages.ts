import type {
	ImageContent,
	Message,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type ContentBlock =
	| TextContent
	| ThinkingContent
	| ImageContent
	| ToolCall;

export function blockText(block: ContentBlock): string {
	switch (block.type) {
		case "text":
			return block.text;
		case "thinking":
			return block.thinking;
		case "image":
		case "toolCall":
			return "";
	}
}

/** Format tool call arguments into a readable signature */
export function formatToolArgs(
	name: string,
	args: Record<string, unknown>,
): string {
	switch (name) {
		case "bash":
			return `bash(${truncate(String(args["command"] ?? ""), 60)})`;
		case "read":
			return `read(${args["path"]})`;
		case "write":
			return `write(${args["path"]})`;
		case "edit":
			return `edit(${args["path"]})`;
		case "find":
			return `find(${args["pattern"]}, ${args["path"]})`;
		case "grep":
			return `grep(${truncate(String(args["pattern"] ?? ""), 40)}, ${args["path"]})`;
		case "ls":
			return `ls(${args["path"]})`;
		default:
			return `${name}(${truncate(JSON.stringify(args), 60)})`;
	}
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen - 3)}...`;
}

/** Format a content block as a tagged string: [tag] content */
export function formatBlock(
	block: ContentBlock,
	textTag = "text",
): string | null {
	if (block.type === "toolCall") {
		return `[toolCall] ${formatToolArgs(block.name, block.arguments)}`;
	}
	const text = blockText(block);
	if (!text) return null;
	const tag = block.type === "text" ? textTag : block.type;
	return `[${tag}] ${text}`;
}

export function messageText(msg: Message): string {
	if (typeof msg.content === "string") return msg.content;
	return msg.content.map(blockText).filter(Boolean).join("\n");
}

/**
 * Filters out the specified content blocks, removing messages that become empty
 */
export function filterContentTypes(
	messages: Message[],
	...keep: ("raw" | ContentBlock["type"])[]
): Message[] {
	return messages
		.map((m) => {
			if (typeof m.content === "string" && !keep.includes("raw")) {
				return { ...m, content: "" } as Message;
			}
			if (typeof m.content !== "string") {
				return {
					...m,
					content: m.content.filter((c) => keep.includes(c.type)),
				} as Message;
			}
			return m;
		})
		.filter((m) => m.content.length > 0);
}

/**
 * Format a message into tagged lines: [user], [assistant], [thinking], [toolCall], [toolResult].
 * Each content block becomes its own line.
 */
export function formatMessage(msg: Message): string[] {
	// String content (user messages only)
	if (typeof msg.content === "string") {
		return [`[${msg.role}] ${msg.content}`];
	}

	// toolResult has its own structure
	if (msg.role === "toolResult") {
		const text = msg.content
			.filter((c) => c.type === "text")
			.map((c) => (c as { type: "text"; text: string }).text)
			.join("");
		const err = msg.isError ? " [ERROR]" : "";
		return [`[toolResult] ${msg.toolName}${err}: ${text}`];
	}

	// user (array content) and assistant — both use formatBlock with role as tag
	return msg.content
		.map((block) => formatBlock(block as ContentBlock, msg.role))
		.filter(Boolean) as string[];
}

export function isMessage(value: unknown): value is Message {
	if (typeof value !== "object" || value === null) return false;
	const role = (value as { role?: string }).role;
	return role === "user" || role === "assistant" || role === "toolResult";
}

export function getMessages(ctx: ExtensionContext): Message[] {
	const messages: Message[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		if (isMessage(entry.message)) {
			messages.push(entry.message);
		}
	}
	return messages;
}
