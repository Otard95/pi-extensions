/**
 * Session Namer Extension
 *
 * Automatically names a brand-new session after the first complete turn.
 *
 * Behavior:
 * - Triggers after the first agent turn completes (user prompt + assistant response)
 * - Uses a cheap out-of-band model to generate a short title
 * - Falls back to heuristic naming if no model is available
 * - Runs lazily in the background so the turn is not delayed
 * - Never auto-renames after the first successful name
 * - Manual `/name` always takes priority
 */

import path from "node:path";
import { complete, type Message } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { once } from "../../utils/func/once";
import { pickModel } from "../../utils/pick-model";

const MAX_SESSION_NAME_LENGTH = 72;
const MAX_PROMPT_CHARS = 400;
const DEFAULT_TASK = "General work";

// Instructions sent to the lightweight naming model.
const NAMER_SYSTEM_PROMPT = `Generate a short coding session title.

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
- If the task is unclear, return: General work`;

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

export function buildSessionName(cwd: string, task: string): string {
	const cwdBase = path.basename(cwd) || "session";
	const prefix = `${cwdBase}: `;
	const availableTaskLength = Math.max(
		12,
		MAX_SESSION_NAME_LENGTH - prefix.length,
	);
	return `${prefix}${truncate(task || DEFAULT_TASK, availableTaskLength)}`;
}

/**
 * Simple heuristic fallback: first line, first sentence, max 8 words.
 * Only used when no model is available.
 */
export function heuristicTask(text: string): string {
	let summary = text.trim();
	if (!summary) return DEFAULT_TASK;

	summary = summary.split(/\n+/)[0] ?? summary;
	summary = summary.split(/(?<=[.!?])\s+/)[0] ?? summary;
	summary = normalizeWhitespace(summary);
	summary = summary.replace(/[.!?]+$/, "").trim();

	if (!summary) return DEFAULT_TASK;

	const words = summary.split(" ").filter(Boolean);
	if (words.length > 8) {
		summary = words.slice(0, 8).join(" ");
	}

	return sentenceCase(summary);
}

// ── context extraction ────────────────────────────────────────────────────────

function getLatestUserText(ctx: ExtensionContext): string | null {
	const branch = ctx.sessionManager.getBranch();

	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (!entry || entry.type !== "message") continue;

		const message = entry.message as {
			role?: string;
			content?: string | Array<{ type?: string; text?: string }>;
		};
		if (message.role !== "user") continue;

		if (typeof message.content === "string") {
			const text = normalizeWhitespace(message.content);
			if (text) return text;
			continue;
		}

		if (Array.isArray(message.content)) {
			const text = message.content
				.filter(
					(c: {
						type?: string;
						text?: string;
					}): c is { type: "text"; text: string } =>
						c.type === "text" && typeof c.text === "string",
				)
				.map((c) => c.text)
				.join("\n");
			const normalized = normalizeWhitespace(text);
			if (normalized) return normalized;
		}
	}

	return null;
}

// ── title generation ──────────────────────────────────────────────────────────

async function generateTaskTitle(
	ctx: ExtensionContext,
	text: string,
): Promise<string | null> {
	const candidatePrompt = normalizeWhitespace(text);
	if (!candidatePrompt) return null;

	const modelChoice = await pickModel(ctx);
	if (!modelChoice) return null;

	const { model, auth } = modelChoice;
	const userPrompt = truncate(candidatePrompt, MAX_PROMPT_CHARS);
	const repo = path.basename(ctx.cwd) || "session";
	const messages: Message[] = [
		{
			role: "user",
			content: [
				{
					type: "text",
					text: `Repo: ${repo}\nUser prompt: ${userPrompt}`,
				},
			],
			timestamp: Date.now(),
		},
	];

	const response = await complete(
		model,
		{ systemPrompt: NAMER_SYSTEM_PROMPT, messages },
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
	const tryAutoName = once(async (ctx: ExtensionContext) => {
		if (pi.getSessionName()) return;

		const sourceText = getLatestUserText(ctx);
		if (!sourceText) return;

		const task = await generateTaskTitle(ctx, sourceText).catch((err) => {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`session-namer: model call failed: ${err instanceof Error ? err.message : String(err)}`,
					"warning",
				);
			}
			return null;
		});
		const finalTask = task ?? heuristicTask(sourceText);
		if (pi.getSessionName()) return;

		pi.setSessionName(buildSessionName(ctx.cwd, finalTask));
	});

	pi.registerCommand("name-auto", {
		description:
			"Generate and set a session name from the conversation context",
		handler: async (_args, ctx) => {
			const sourceText = getLatestUserText(ctx);
			if (!sourceText) {
				ctx.ui.notify(
					"No user message found to generate a session name from",
					"warning",
				);
				return;
			}

			const task = await generateTaskTitle(ctx, sourceText).catch((err) => {
				ctx.ui.notify(
					`Model call failed: ${err instanceof Error ? err.message : String(err)}`,
					"warning",
				);
				return null;
			});
			const finalTask = task ?? heuristicTask(sourceText);

			const name = buildSessionName(ctx.cwd, finalTask);
			pi.setSessionName(name);
			ctx.ui.notify(`Session named: ${name}`, "info");
		},
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (pi.getSessionName()) return;
		void tryAutoName(ctx);
	});
}
