import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { formatMessage, isMessage } from "./messages";

/** Extract text content from a custom_message entry */
function customMessageContent(
	entry: SessionEntry & { type: "custom_message" },
): string {
	return typeof entry.content === "string"
		? entry.content
		: JSON.stringify(entry.content);
}

/**
 * Format a session entry into tagged lines.
 * Handles message entries (via formatMessage) and custom_message entries.
 */
export function formatEntry(entry: SessionEntry): string[] {
	if (entry.type === "message" && isMessage(entry.message)) {
		return formatMessage(entry.message);
	}

	if (entry.type === "custom_message") {
		const content = customMessageContent(entry);
		return [`[${entry.customType}] ${content}`];
	}

	return [];
}
