import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { loadWebSearchSettings, providerOrder } from "./config.js";
import { writeWebSearchDebugLog } from "./debug.js";
import { configureProviders } from "./provider-registry.js";
import { supportedProviders } from "./providers/index.js";
import { runSearch } from "./runner.js";
import type {
	ProviderSetupError,
	SearchAttempt,
	SearchPayload,
} from "./types.js";

const WebSearchParams = Type.Object({
	query: Type.String({
		description: "The search query",
		minLength: 1,
	}),
	max_results: Type.Optional(
		Type.Integer({
			description: "Number of results to return (default: 5, max: 20)",
			minimum: 1,
			maximum: 20,
		}),
	),
});

const DEFAULT_TIMEOUT_MS = 30_000;

export default function webSearchExtension(pi: ExtensionAPI) {
	const settingsResult = loadWebSearchSettings();
	const resolution = settingsResult.isOk()
		? configureProviders(
				providerOrder(settingsResult.unwrap()),
				settingsResult.unwrap(),
				supportedProviders,
			)
		: undefined;
	const setupIssues = settingsResult.isOk()
		? (resolution?.issues ?? [])
		: [settingsResult.unwrapErr()];

	pi.on("session_start", (_event, ctx) => {
		if (setupIssues.length === 0) return;
		ctx.ui.notify(formatSetupIssues(setupIssues), "warning");
	});

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web. Returns titles, URLs, and text snippets. Use this for current events, documentation, or information that may not be in your training data.",
		promptSnippet: "Search the web for up-to-date information",
		parameters: WebSearchParams,
		renderCall(args, theme) {
			const query = args.query ?? "";
			const displayedQuery =
				query.length > 60 ? `${query.slice(0, 59)}…` : query;
			let text = theme.fg("toolTitle", theme.bold("web_search "));
			text += theme.fg("accent", `"${displayedQuery}"`);
			if (args.max_results !== undefined) {
				text += theme.fg("dim", ` (max: ${args.max_results})`);
			}
			return new Text(text, 0, 0);
		},
		async execute(_toolCallId, params, signal, onUpdate) {
			if (settingsResult.isErr()) {
				return textResult(formatSetupIssues(setupIssues));
			}

			const settings = settingsResult.unwrap();
			const providers = resolution?.providers ?? [];
			if (providers.length === 0) {
				return textResult(
					setupIssues.length > 0
						? formatSetupIssues(setupIssues)
						: "No web search providers are configured.",
				);
			}

			if (!params.query) {
				return textResult("The search query must not be empty.");
			}
			const query = params.query;
			const maxResults = params.max_results ?? 5;
			onUpdate?.(textResult(`Searching "${query}"…`));
			const result = await runSearch(
				providers,
				{ query, maxResults },
				{
					signal,
					timeoutMs: settings.timeoutSeconds
						? settings.timeoutSeconds * 1_000
						: DEFAULT_TIMEOUT_MS,
				},
			);

			if (result.isErr()) {
				const attempts = result.unwrapErr().attempts;
				await writeWebSearchDebugLog("search-failure", { query, attempts });
				return textResult(formatSearchFailure(query, attempts), {
					query,
					attempts,
				});
			}

			const search = result.unwrap();
			await writeWebSearchDebugLog("search-success", {
				query,
				provider: search.provider.name,
				attempts: search.attempts,
				payload: search.result.payload,
			});
			return textResult(
				formatPayload(
					query,
					search.provider.provider.label,
					search.result.payload,
				),
				{
					query,
					provider: search.provider.name,
					payload: search.result.payload,
					attempts: search.attempts,
				},
			);
		},
	});
}

function textResult(text: string, details: unknown = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

function formatSetupIssues(issues: Array<ProviderSetupError | Error>): string {
	const lines = issues.map((issue) => {
		if (issue instanceof Error && "path" in issue && issue.path) {
			return `- ${issue.path}: ${issue.message}`;
		}
		return `- ${issue.message}`;
	});
	return `Web search configuration issues:\n${lines.join("\n")}`;
}

function formatPayload(
	query: string,
	providerLabel: string,
	payload: SearchPayload,
): string {
	if (payload.kind === "text") {
		return `${providerLabel} results for "${query}":\n\n${payload.text}`;
	}
	if (payload.results.length === 0) {
		return `No results found for "${query}" (${providerLabel}).`;
	}

	const lines = [`Search results for "${query}" (${providerLabel}):`, ""];
	for (const [index, result] of payload.results.entries()) {
		lines.push(`${index + 1}. ${result.title}`);
		lines.push(`   ${result.url}`);
		if (result.snippet) lines.push(`   ${result.snippet}`);
		if (result.source) lines.push(`   Source: ${result.source}`);
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

function formatSearchFailure(query: string, attempts: SearchAttempt[]): string {
	if (attempts.length === 0) {
		return `No configured web search provider could search for "${query}".`;
	}
	const lines = attempts.map((attempt) => {
		const duration =
			attempt.durationMs === undefined ? "" : ` in ${attempt.durationMs}ms`;
		const reason = attempt.reason ? `: ${attempt.reason}` : "";
		return `- ${attempt.provider}: ${attempt.status}${duration}${reason}`;
	});
	return `Web search failed for "${query}":\n${lines.join("\n")}`;
}
