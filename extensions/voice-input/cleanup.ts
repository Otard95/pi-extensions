/**
 * Transcription Cleanup
 *
 * Post-processes whisper transcriptions using a fast LLM to clean up
 * spoken language artifacts while preserving original meaning.
 */

import type { Message } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	filterContentTypes,
	getMessages,
	messageText,
} from "../../utils/conversation/messages";
import { complete } from "../../utils/model/complete";
import { pickModel } from "../../utils/model/pick";
import { resolveModelPattern } from "../../utils/model/resolvePattern";
import type { VoiceInputSettings } from "./settings";

/**
 * System prompt for transcription cleanup
 *
 * Uses XML structure similar to semantic-compaction for clarity
 */
const CLEANUP_SYSTEM_PROMPT = `You are a transcription cleanup agent. Your job is to clean up spoken language transcripts while preserving the exact meaning and intent.

You will receive a message with two XML sections:
- <context> - recent conversation history for understanding what the user is talking about
- <transcript> - the raw speech-to-text output that needs cleanup

Your output should ONLY contain the cleaned transcript. No preamble, no explanation, no XML tags.

Rules:
1. Remove filler words (um, uh, like, you know, etc.)
2. Fix grammar and punctuation
3. **Condense reiteration** - when the user says the same thing multiple ways, they're thinking out loud; extract the final intent
4. Remove false starts, backtracking, and self-corrections
5. **Err on the side of caution** - it's hard to tell "thinking out loud" from intentional verbosity
6. PRESERVE the original meaning - do NOT rephrase or reinterpret
7. Keep the user's voice and style - do NOT make it overly formal
8. If unsure, prefer keeping the original wording

Important: It's better to leave text slightly rough than to change what the user actually meant.
`;

/**
 * Get recent conversation context for cleanup agent
 */
function getConversationContext(
	ctx: ExtensionContext,
	maxMessages = 5,
): string {
	const messages = filterContentTypes(
		getMessages(ctx)
			.filter((m) => ["user", "assistant"].includes(m.role))
			.slice(-maxMessages),
		"raw",
		"text",
	).map((m) => `[${m.role}] ${messageText(m)}`);

	return messages.length > 0 ? messages.join("\n\n") : "(no recent context)";
}

/**
 * Build user message for cleanup agent
 */
function buildCleanupPrompt(
	rawTranscript: string,
	ctx: ExtensionContext,
): string {
	const context = getConversationContext(ctx);

	return `<context>
${context}
</context>

<transcript>
${rawTranscript}
</transcript>`;
}

/**
 * Clean up transcription using fast LLM
 *
 * @param rawTranscript - Raw whisper output
 * @param settings - Voice input settings
 * @param ctx - Extension context (for conversation history)
 * @returns Object with cleaned text and whether cleanup was attempted
 */
export type CleanupResult = {
	text: string;
	attempted: boolean;
	modelId?: string;
	provider?: string;
	selection?: "override" | "auto";
	durationMs?: number;
	changed?: boolean;
	charDiff?: number;
	error?: string;
};

export async function cleanupTranscript(
	rawTranscript: string,
	settings: VoiceInputSettings,
	ctx: ExtensionContext,
): Promise<CleanupResult> {
	// Check if cleanup is enabled (default: true)
	const cleanupEnabled = settings.cleanup?.enabled ?? true;
	if (!cleanupEnabled) {
		return {
			text: rawTranscript,
			attempted: false,
			error: "cleanup disabled by settings",
		};
	}

	const startedAt = Date.now();

	try {
		// Determine model to use
		let choice = null;
		let selection: "override" | "auto" = "auto";
		if (settings.cleanup?.model) {
			selection = "override";
			choice = await resolveModelPattern(ctx, settings.cleanup.model);
		}

		if (!choice) {
			choice = await pickModel(ctx, {
				noFallback: true,
			});
		}

		if (!choice) {
			ctx.ui.notify(
				"⚠️ Cleanup skipped: no authenticated model available",
				"warning",
			);
			return {
				text: rawTranscript,
				attempted: false,
				durationMs: Date.now() - startedAt,
				error: "no authenticated model available",
			};
		}

		ctx.ui.notify(`🔄 Cleanup starting (model: ${choice.model.id})...`, "info");

		const userMessage = buildCleanupPrompt(rawTranscript, ctx);
		const messages: Message[] = [
			{ role: "user", content: userMessage, timestamp: Date.now() } as Message,
		];

		const response = await complete(
			choice,
			CLEANUP_SYSTEM_PROMPT,
			messages,
			AbortSignal.timeout(8000),
		);

		const result = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();

		const finalText = result || rawTranscript;
		const changed = finalText !== rawTranscript;
		const charDiff = Math.abs(finalText.length - rawTranscript.length);
		const durationMs = Date.now() - startedAt;
		ctx.ui.notify(
			`✅ Cleanup complete (${changed ? `changed, ${charDiff} char diff` : "no changes"})`,
			"info",
		);

		return {
			text: finalText,
			attempted: true,
			modelId: choice.model.id,
			provider: choice.model.provider,
			selection,
			durationMs,
			changed,
			charDiff,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		ctx.ui.notify(`⚠️ Cleanup failed: ${message}`, "warning");
		return {
			text: rawTranscript,
			attempted: true,
			durationMs: Date.now() - startedAt,
			error: message,
		};
	}
}
