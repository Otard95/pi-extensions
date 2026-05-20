/**
 * Session Namer Extension
 *
 * Automatically names a session after sufficient task context is available.
 *
 * Behavior:
 * - Triggers after each agent turn until a name is successfully set
 * - Uses a cheap out-of-band model to generate a short title
 * - Returns no name if the model cannot identify a concrete task yet
 *   (e.g. only meta/setup prompts so far) — retries on the next turn
 * - Runs lazily in the background so turns are not delayed
 * - Never auto-renames after the first successful name
 * - Manual `/name` always takes priority
 */

import path from "node:path";
import { complete, type Message } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";

import {
	filterContentTypes,
	formatMessage,
	getMessages,
} from "../../utils/conversation/messages";
import { pickModel } from "../../utils/model/pick";

const MAX_SESSION_NAME_LENGTH = 72;
const MAX_PROMPT_CHARS = 600;

// Instructions sent to the lightweight naming model.
const NAMER_SYSTEM_PROMPT = `Generate a short coding session title from the user's message(s).

Rules:
- Return only the title text
- 3 to 6 words preferred
- Use sentence case
- Be concrete and task-focused
- No quotes
- No markdown
- No trailing punctuation
- Avoid vague filler like "Help with" or "Work on"
- Prefer concrete engineering verbs like Fix, Add, Refactor, Review, Debug, Investigate, Improve
- If the messages contain only meta-instructions, mode/persona setup, or style rules
  with no concrete task, ignore this, and do NOT use it as part of the title
- INSUFFICIENT_CONTEXT: if there is not enough context to determine a concrete task`;

const NAMER_RETRY_HINT =
	"- If context is insufficient, return nothing — this will be retried once more context is available";

// ── pure helpers (exported for tests) ─────────────────────────────────────────

export function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export function sentenceCase(text: string): string {
	if (!text) return text;
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	const clipped = text.slice(0, Math.max(0, maxLength - 1)).trimEnd();
	return `${clipped}…`;
}

export function sanitizeModelTitle(text: string): string | null {
	const normalized = normalizeWhitespace(text)
		.replace(/^(?:["'\x60]+)|(?:["'\x60]+)$/g, "")
		.replace(/[.!?]+$/g, "")
		.trim();
	if (!normalized) return null;
	return sentenceCase(normalized);
}

export function buildSessionName(task: string): string {
	return truncate(task, MAX_SESSION_NAME_LENGTH);
}

// ── context extraction ────────────────────────────────────────────────────────

/**
 * Collects user and assistant messages (text + thinking only) newest-first.
 * Stops after including a message that exceeds MAX_PROMPT_CHARS, keeping it
 * whole rather than cutting arbitrarily mid-message.
 * Uses tagged lines ([user], [assistant], [thinking]) for role context.
 * Tool calls and results are excluded.
 * Returns null when no relevant messages exist yet.
 */
function getSessionContext(
	ctx: ExtensionContext,
): { text: string; full: boolean } | null {
	const messages = filterContentTypes(getMessages(ctx), "text", "thinking");

	const parts: string[] = [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!msg) continue;

		const lines = formatMessage(msg);
		if (lines.length === 0) continue;

		const text = lines.join("\n");
		parts.unshift(text);

		if (text.length >= MAX_PROMPT_CHARS) break;
	}

	const combined = parts.join("\n");
	if (!combined) return null;
	return { text: combined, full: combined.length >= MAX_PROMPT_CHARS };
}

// ── title generation ──────────────────────────────────────────────────────────

async function generateTaskTitle(
	ctx: ExtensionContext,
	context: { text: string; full: boolean },
): Promise<string | null> {
	const candidatePrompt = normalizeWhitespace(context.text);
	if (!candidatePrompt) return null;

	const modelChoice = await pickModel(ctx);
	if (!modelChoice) return null;

	const { model, auth } = modelChoice;
	const systemPrompt = context.full
		? NAMER_SYSTEM_PROMPT
		: `${NAMER_SYSTEM_PROMPT}\n${NAMER_RETRY_HINT}`;
	const repo = path.basename(ctx.cwd) || "session";
	const messages: Message[] = [
		{
			role: "user",
			content: [
				{
					type: "text",
					text: `Repo: ${repo}\nUser prompt: ${candidatePrompt}`,
				},
			],
			timestamp: Date.now(),
		},
	];

	const response = await complete(
		model,
		{ systemPrompt, messages },
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			maxTokens: 24,
			signal: AbortSignal.timeout(4000),
		},
	);

	if (response.stopReason === "aborted") return null;
	const raw = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join(" ");
	return sanitizeModelTitle(raw);
}

// ── extension ─────────────────────────────────────────────────────────────────

export default function sessionNamerExtension(pi: ExtensionAPI) {
	const doAutoName = async (
		context: { text: string; full: boolean },
		ctx: ExtensionContext,
	) => {
		const task = await generateTaskTitle(ctx, context).catch((err) => {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`session-namer: model call failed: ${err instanceof Error ? err.message : String(err)}`,
					"warning",
				);
			}
			return null;
		});
		if (!task || pi.getSessionName()) return;
		pi.setSessionName(buildSessionName(task));
	};

	pi.registerCommand("name-auto", {
		description:
			"Generate and set a session name from the conversation context",
		handler: async (_args, ctx) => {
			const context = getSessionContext(ctx);
			if (!context) {
				ctx.ui.notify(
					"No user message found to generate a session name from",
					"warning",
				);
				return;
			}

			const task = await generateTaskTitle(ctx, context).catch((err) => {
				ctx.ui.notify(
					`Model call failed: ${err instanceof Error ? err.message : String(err)}`,
					"warning",
				);
				return null;
			});
			if (!task) return;

			const name = buildSessionName(task);
			pi.setSessionName(name);
			ctx.ui.notify(`Session named: ${name}`, "info");
		},
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (pi.getSessionName()) return;
		const context = getSessionContext(ctx);
		if (!context) return;
		void doAutoName(context, ctx);
	});
}
