/**
 * BTW Side Questions
 *
 * Ask a quick side question about the current session without polluting
 * conversation history. Inspired by Claude Code / OpenClaw's /btw.
 *
 * Usage:
 *   /btw what file are we editing?
 *   /btw what does this error mean?
 *   /btw summarize what we've done so far
 *
 * Behavior:
 * - Snapshots session context (no agent turn, nothing written to history)
 * - Shows a cancellable spinner while the model call is in flight
 * - Displays the answer in a scrollable full-screen panel
 * - ↑/↓ or k/j to scroll, q/Esc to dismiss
 */

import { type Message, stream } from "@mariozechner/pi-ai";
import {
	BorderedLoader,
	type ExtensionAPI,
	type ExtensionContext,
	getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import {
	Key,
	Markdown,
	matchesKey,
	truncateToWidth,
} from "@mariozechner/pi-tui";

const BTW_SYSTEM_PROMPT = `\
You are answering a brief side question about an active coding session.

Rules:
- Answer ONLY the specific side question asked
- Use the conversation history as background context only
- Be concise: 1-3 paragraphs or a short list is ideal
- Do NOT resume, continue, or comment on pending tasks
- Do NOT emit tool calls or suggest tool use
- Speak directly; skip filler like "Based on the conversation..."`;

// ── context helpers ───────────────────────────────────────────────────────────

const MAX_CONTEXT_CHARS = 40_000;
const MAX_CONTEXT_MESSAGES = 40;

function messageText(msg: Message): string {
	const content = (msg as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return (
			content as Array<{
				type: string;
				text?: string;
				thinking?: string;
			}>
		)
			.map((c) => c.text ?? c.thinking ?? "")
			.join("");
	}
	return "";
}

function getSessionMessages(ctx: ExtensionContext): Message[] {
	const all: Message[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const role = (entry.message as { role?: string }).role;
		if (role === "user" || role === "assistant" || role === "toolResult") {
			all.push(entry.message as Message);
		}
	}

	const recent = all.slice(-MAX_CONTEXT_MESSAGES);

	// Walk backwards accumulating size; find oldest message that fits
	let chars = 0;
	let cutoff = 0;
	for (let i = recent.length - 1; i >= 0; i--) {
		const msg = recent[i];
		if (msg) chars += messageText(msg).length;
		if (chars > MAX_CONTEXT_CHARS) {
			cutoff = i + 1;
			break;
		}
	}

	// Never start on an orphaned toolResult — advance to next user message
	while (
		cutoff < recent.length &&
		(recent[cutoff] as { role?: string }).role !== "user"
	) {
		cutoff++;
	}

	return recent.slice(cutoff);
}

async function pickModel(ctx: ExtensionContext) {
	const preferred: Array<[string, string]> = [
		["anthropic", "claude-haiku-4-5"],
		["google", "gemini-2.5-flash"],
		["openai", "gpt-4.1-mini"],
		["openai", "gpt-4o-mini"],
	];
	for (const [provider, id] of preferred) {
		const model = ctx.modelRegistry.find(provider, id);
		if (!model) continue;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (auth.ok && auth.apiKey) return { model, auth };
	}
	if (ctx.model) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (auth.ok && auth.apiKey) return { model: ctx.model, auth };
	}
	return null;
}

// ── scrollable result panel ───────────────────────────────────────────────────

function makeResultPanel(
	question: string,
	answer: string,
	done: () => void,
	tui: { requestRender: () => void },
) {
	let scrollOffset = 0;
	let cachedWidth = -1;
	let cachedHeader: string[] = [];
	let cachedFooter: string[] = [];
	let mdComponent: Markdown | null = null;
	// Re-fetched in invalidate() so theme switches are picked up
	let mdTheme = getMarkdownTheme();

	function rebuildChrome(width: number) {
		cachedHeader = [
			truncateToWidth(`BTW: ${question}`, width),
			truncateToWidth("-".repeat(width), width),
		];
		cachedFooter = [
			"",
			truncateToWidth("-".repeat(width), width),
			truncateToWidth("  ↑/↓  scroll    q/Esc  dismiss", width),
		];
	}

	return {
		render(width: number): string[] {
			if (cachedWidth !== width) {
				rebuildChrome(width);
				if (!mdComponent) {
					mdComponent = new Markdown(answer || " ", 0, 0, mdTheme);
				} else {
					mdComponent.setText(answer || " ");
					mdComponent.invalidate();
				}
				cachedWidth = width;
			}

			const body = mdComponent?.render(width) ?? [];
			const all = [...cachedHeader, ...body, ...cachedFooter];
			// Cap scroll so the last line is always reachable but never exceeded
			scrollOffset = Math.min(scrollOffset, Math.max(0, all.length - 1));
			return all.slice(scrollOffset);
		},

		handleInput(data: string): void {
			if (matchesKey(data, Key.escape) || data === "q") {
				done();
			} else if (matchesKey(data, Key.up) || data === "k") {
				if (scrollOffset > 0) {
					scrollOffset--;
					tui.requestRender();
				}
			} else if (matchesKey(data, Key.down) || data === "j") {
				scrollOffset++;
				tui.requestRender();
			}
		},

		invalidate(): void {
			cachedWidth = -1;
			mdTheme = getMarkdownTheme(); // pick up any theme change
			if (mdComponent) {
				// Recreate with updated theme rather than just invalidating cache
				mdComponent = new Markdown(answer || " ", 0, 0, mdTheme);
			}
		},
	};
}

// ── extension ─────────────────────────────────────────────────────────────────

export default function btwExtension(pi: ExtensionAPI) {
	pi.registerCommand("btw", {
		description: "Ask a quick side question (ephemeral — not saved to history)",
		handler: async (args, ctx) => {
			const question = args?.trim();
			if (!question) {
				ctx.ui.notify(
					"/btw: provide a question, e.g.  /btw what file are we editing?",
					"warning",
				);
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("BTW requires interactive mode", "error");
				return;
			}

			const choice = await pickModel(ctx);
			if (!choice) {
				ctx.ui.notify("BTW: no model with a valid API key found", "error");
				return;
			}
			const { model, auth } = choice;

			const messages: Message[] = [
				...getSessionMessages(ctx),
				{
					role: "user",
					content: question,
					timestamp: Date.now(),
				} as Message,
			];

			// Phase 1: stream the answer while showing a cancellable loader
			let answer = "";
			let streamError: string | null = null;

			const outcome = await ctx.ui.custom<"done" | "cancelled">(
				(tui, theme, _kb, done) => {
					const loader = new BorderedLoader(
						tui,
						theme,
						`BTW (${model.id}): thinking…`,
					);
					loader.onAbort = () => done("cancelled");

					void (async () => {
						try {
							const events = stream(
								model,
								{ systemPrompt: BTW_SYSTEM_PROMPT, messages },
								{
									apiKey: auth.apiKey,
									headers: auth.headers,
									maxTokens: 4096,
									signal: loader.signal,
								},
							);
							for await (const event of events) {
								if (event.type === "text_delta") {
									answer += event.delta;
								}
							}
							done("done");
						} catch (err) {
							streamError = err instanceof Error ? err.message : String(err);
							done("done");
						}
					})();

					return loader;
				},
			);

			if (outcome === "cancelled") return;

			if (streamError) {
				ctx.ui.notify(`BTW failed: ${streamError}`, "error");
				return;
			}

			if (!answer.trim()) {
				ctx.ui.notify("BTW: got an empty response", "warning");
				return;
			}

			// Phase 2: show answer in a scrollable panel
			await ctx.ui.custom<void>((tui, _theme, _kb, done) =>
				makeResultPanel(question, answer, done, tui),
			);
		},
	});
}
