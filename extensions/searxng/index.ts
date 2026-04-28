/**
 * SearXNG Extension
 *
 * Gives the LLM a web_search tool and adds /search + /searxng commands.
 *
 * URL configuration (priority order):
 *   1. SEARXNG_URL environment variable
 *   2. "searxng.url" in settings.json
 *
 * Authorization (priority order):
 *   1. SEARXNG_AUTHORIZATION environment variable
 *   2. "searxng.authorization" in settings.json (supports "pass:" prefix)
 */

import { Type } from "@mariozechner/pi-ai";
import { type ExtensionAPI, keyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type as T } from "@sinclair/typebox";
import { at } from "../../utils/array/at";
import { resolveValue } from "../../utils/secret";
import { loadSettings } from "../../utils/settings.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearxResult {
	title: string;
	url: string;
	content?: string;
	engine?: string;
}

interface SearxResponse {
	query: string;
	results: SearxResult[];
	answers?: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ENV_URL = "SEARXNG_URL";
const ENV_AUTH = "SEARXNG_AUTHORIZATION";
const MAX_SNIPPET_LEN = 180;

// ─── Extension ────────────────────────────────────────────────────────────────

export default function searxngExtension(pi: ExtensionAPI) {
	// ── Helpers ──────────────────────────────────────────────────────────────

	// Settings schema
	const SearxngSchema = T.Object({
		url: T.Optional(T.String()),
		authorization: T.Optional(T.String()),
	});

	type SearxngSettings = Static<typeof SearxngSchema>;

	const SEARXNG_SETTINGS = loadSettings<SearxngSettings>(
		"searxng",
		SearxngSchema,
	).unwrapOr({});

	function getSearxngSettings(): SearxngSettings {
		return SEARXNG_SETTINGS;
	}

	let cachedAuth: string | undefined;
	let authResolved = false;

	function getBaseUrl(): string | undefined {
		if (process.env[ENV_URL]) return process.env[ENV_URL];
		const s = getSearxngSettings();
		return s.url || undefined;
	}

	async function getAuthorization(): Promise<string | undefined> {
		if (process.env[ENV_AUTH]) return process.env[ENV_AUTH];
		if (authResolved) return cachedAuth;
		const s = getSearxngSettings();
		if (s.authorization) {
			cachedAuth = await resolveValue(s.authorization);
		}
		authResolved = true;
		return cachedAuth;
	}

	function configSource(): string {
		if (process.env[ENV_URL]) return `env var ${ENV_URL}`;
		if (getBaseUrl()) return "settings.json";
		return "not configured";
	}

	async function runSearch(
		query: string,
		maxResults: number,
		signal?: AbortSignal,
	): Promise<SearxResult[]> {
		const base = getBaseUrl();
		if (!base)
			throw new Error(
				`SearXNG URL not configured. Set ${ENV_URL} env var or add "searxng": { "url": "..." } to settings.json`,
			);
		const url = new URL("/search", base);
		url.searchParams.set("q", query);
		url.searchParams.set("format", "json");
		url.searchParams.set("categories", "general");

		const headers: Record<string, string> = {};
		const auth = await getAuthorization();
		if (auth) headers["Authorization"] = auth;

		const res = await fetch(url.toString(), { signal, headers });

		if (!res.ok) {
			throw new Error(`SearXNG returned HTTP ${res.status}: ${res.statusText}`);
		}

		const data = (await res.json()) as SearxResponse;
		return (data.results ?? []).slice(0, maxResults);
	}

	function stripTags(str: string): string {
		return str.replace(/<[^>]+>/g, "").trim();
	}

	function formatResults(results: SearxResult[], query: string): string {
		if (results.length === 0) {
			return `No results found for "${query}".`;
		}

		const lines: string[] = [`Search results for "${query}":`, ""];

		for (let i = 0; i < results.length; i++) {
			const r = at(results, i);
			lines.push(`${i + 1}. ${stripTags(r.title)}`);
			lines.push(`   ${r.url}`);
			if (r.content) {
				const snippet = r.content
					.replace(/\s+/g, " ")
					.trim()
					.slice(0, MAX_SNIPPET_LEN);
				lines.push(
					`   ${snippet}${r.content.length > MAX_SNIPPET_LEN ? "…" : ""}`,
				);
			}
			lines.push("");
		}

		return lines.join("\n").trimEnd();
	}

	// ── web_search tool (for the LLM) ─────────────────────────────────────────

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web using a self-hosted SearXNG instance. Returns titles, URLs, and text snippets. Use this for current events, documentation, or any information that may not be in your training data.",
		promptSnippet: "Search the web for up-to-date information via SearXNG",
		parameters: Type.Object({
			query: Type.String({ description: "The search query" }),
			max_results: Type.Optional(
				Type.Number({
					description: "Number of results to return (default: 5, max: 20)",
					minimum: 1,
					maximum: 20,
				}),
			),
		}),
		renderCall(args, theme) {
			const query = args.query ?? "";
			const truncated = query.length > 60 ? `${query.slice(0, 57)}...` : query;
			let text = theme.fg("toolTitle", theme.bold("web_search "));
			text += theme.fg("accent", `"${truncated}"`);
			if (args.max_results) {
				text += theme.fg("muted", ` (max: ${args.max_results})`);
			}
			return new Text(text, 0, 0);
		},

		async execute(_toolCallId, params, signal, onUpdate, _ctx) {
			const max = params.max_results ?? 5;
			onUpdate?.({
				content: [{ type: "text", text: `Searching "${params.query}"…` }],
				details: {},
			});

			try {
				const results = await runSearch(params.query, max, signal ?? undefined);
				const text = formatResults(results, params.query);
				return {
					content: [{ type: "text", text }],
					details: {
						query: params.query,
						resultCount: results.length,
						results,
					},
				};
			} catch (err) {
				if ((err as Error)?.name === "AbortError") {
					return {
						content: [{ type: "text", text: "Search cancelled." }],
						isError: false,
						details: {},
					};
				}
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Search failed: ${msg}` }],
					isError: true,
					details: {},
				};
			}
		},
		renderResult(result, options, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const output =
				result.content
					.filter((c) => c.type === "text")
					.map((c) => ("text" in c ? c.text : ""))
					.join("\n") || "";
			const lines = output.split("\n");
			const maxLines = options.expanded ? lines.length : 10;
			const displayLines = lines.slice(0, maxLines);
			const remaining = lines.length - maxLines;

			let rendered = displayLines
				.map((l) => theme.fg("toolOutput", l))
				.join("\n");

			if (remaining > 0) {
				rendered += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
			}

			text.setText(`\n${rendered}`);
			return text;
		},
	});

	// ── /search command (for the user) ────────────────────────────────────────

	pi.registerCommand("search", {
		description:
			"Search the web and pass results to the LLM. Usage: /search <query>",
		handler: async (args, ctx) => {
			const query = args?.trim();
			if (!query) {
				ctx.ui.notify("Usage: /search <query>", "warning");
				return;
			}

			ctx.ui.setStatus("searxng", `🔍 Searching "${query}"…`);

			try {
				const results = await runSearch(query, 5);
				ctx.ui.setStatus("searxng", "");
				pi.sendUserMessage(formatResults(results, query));
			} catch (err) {
				ctx.ui.setStatus("searxng", "");
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Search failed: ${msg}`, "error");
			}
		},
	});

	// ── /searxng command (configuration) ─────────────────────────────────────

	pi.registerCommand("searxng", {
		description: "Show current SearXNG configuration",
		handler: async (_args, ctx) => {
			const base = getBaseUrl();
			const hasAuth = !!(
				process.env[ENV_AUTH] || getSearxngSettings()["authorization"]
			);
			ctx.ui.notify(
				base
					? `SearXNG: ${base}  (${configSource()})${hasAuth ? " [auth configured]" : ""}`
					: `SearXNG not configured. Set ${ENV_URL} env var or add "searxng": { "url": "..." } to settings.json`,
				base ? "info" : "warning",
			);
		},
	});
}
