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
