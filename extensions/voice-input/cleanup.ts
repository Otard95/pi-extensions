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
const CLEANUP_SYSTEM_PROMPT = `You are a transcription cleanup agent. Your job is to fix transcription artifacts — nothing more.

You will receive a message with two XML sections:
- <context> - recent conversation history for understanding what the user is talking about
- <transcript> - the raw speech-to-text output that needs cleanup

Your output should ONLY contain the cleaned transcript. No preamble, no explanation, no XML tags.

The transcript may contain artifact tags from the speech-to-text engine, such as [SILENCE], [MUSIC], [LAUGHTER], [INAUDIBLE], etc. These are NOT part of the speech — they are metadata emitted by the transcriber to describe non-verbal audio. You may use them to understand context (e.g. a pause before a sentence) but do NOT include them in the output.

CRITICAL: Your output must always be the transcript — either lightly corrected per the rules below, or verbatim if you are unsure. Never output explanations, questions, refusals, or commentary of any kind. If you don't know what to do, reproduce the transcript exactly as given. A verbatim transcript with artifacts in it is always better than anything else.

You are ONLY allowed to make three types of changes:
1. **Remove filler words** - um, uh, ah, hmm, and similar sounds with no semantic content.
2. **Remove stutters and immediate word repetitions** - e.g. "I I want" → "I want", "the the thing" → "the thing". Only remove a repeat if it is clearly a speech artifact, not intentional emphasis.
3. **Fix misrecognised words** - if the transcriber has picked the wrong word and you can tell from context what the correct word should be, replace it. Only do this when you are confident. Do NOT guess.

Do NOT:
- Rephrase, reword, or restructure sentences
- Fix grammar or punctuation
- Condense or summarise anything
- Remove false starts or self-corrections — the user meant to say them
- Add any words that were not in the original
- Output anything other than the transcript itself
`;

/** Matches Whisper artifact tags like [SILENCE], [MUSIC], (inaudible), etc. */
const ARTIFACT_TAG_RE = /\[[^\]]*\]|\([^)]*\)/gi;

/**
 * Returns true if the transcript contains no actual speech — only artifact
 * tags and whitespace. There is nothing for the cleanup agent to work with.
 */
function isEmptyTranscript(raw: string): boolean {
	return raw.replace(ARTIFACT_TAG_RE, "").trim().length === 0;
}

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

	if (isEmptyTranscript(rawTranscript)) {
		return {
			text: "",
			attempted: false,
			error: "empty transcript",
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

		const response = await complete(choice, CLEANUP_SYSTEM_PROMPT, messages, {
			signal: AbortSignal.timeout(8000),
		});

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
