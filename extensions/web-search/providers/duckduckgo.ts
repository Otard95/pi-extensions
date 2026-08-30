import domino from "@mixmark-io/domino";
import { Type } from "@sinclair/typebox";
import { abortSignalWithTimeout } from "../../../utils/async/abort.js";
import { Result } from "../../../utils/monad/result.js";
import { writeWebSearchDebugLog } from "../debug.js";
import {
	ProviderUnavailableError,
	type SearchContext,
	type SearchProvider,
	SearchProviderError,
	type SearchProviderResult,
	type SearchRequest,
	type SearchResult,
} from "../types.js";

const DuckDuckGoSettingsSchema = Type.Object({
	render: Type.Optional(Type.Literal("simple")),
});
const SEARCH_URL = "https://html.duckduckgo.com/html/";
const NETWORK_COOLDOWN_MS = 15_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const BLOCKED_COOLDOWN_MS = 5 * 60_000;
const BODY_INSPECTION_LIMIT = 8_192;
const BLOCK_INDICATORS = [
	"captcha",
	"challenge",
	"too many requests",
	"rate limit",
	"access denied",
	"temporarily blocked",
	"cloudflare",
];
const BROWSER_HEADERS = {
	Accept:
		"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
	"Accept-Language": "en-US,en;q=0.9",
	"Upgrade-Insecure-Requests": "1",
	"User-Agent":
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
};

type DuckDuckGoAvailability =
	| { status: "available" }
	| { status: "unavailable"; reason: string; retryAt: number };

export class DuckDuckGoProvider implements SearchProvider {
	static readonly settingsSchema = DuckDuckGoSettingsSchema;

	readonly label = "DuckDuckGo";

	private availability: DuckDuckGoAvailability = { status: "available" };

	async checkAvailability(): Promise<Result<void, ProviderUnavailableError>> {
		if (
			this.availability.status === "unavailable" &&
			Date.now() < this.availability.retryAt
		) {
			return Result.Err(
				new ProviderUnavailableError("duckduckgo", this.availability.reason),
			);
		}
		return Result.Ok(undefined);
	}

	async search(
		request: SearchRequest,
		context: SearchContext,
	): Promise<Result<SearchProviderResult, SearchProviderError>> {
		const { signal, dispose } = abortSignalWithTimeout(
			context.signal,
			context.timeoutMs,
		);
		try {
			const url = new URL(SEARCH_URL);
			url.searchParams.set("q", request.query);
			const response = await fetch(url, { headers: BROWSER_HEADERS, signal });
			const body = await response.text();
			await writeWebSearchDebugLog("duckduckgo-response", {
				request: { url: url.toString(), headers: BROWSER_HEADERS },
				response: {
					url: response.url,
					status: response.status,
					statusText: response.statusText,
					redirected: response.redirected,
					type: response.type,
					headers: Object.fromEntries(response.headers.entries()),
					body,
				},
			});
			if (!response.ok) {
				return Result.Err(this.httpError(response, body));
			}

			if (this.hasBlockIndicator(body.slice(0, BODY_INSPECTION_LIMIT))) {
				return Result.Err(
					this.unavailableError(
						"DuckDuckGo returned a CAPTCHA or challenge response",
						"blocked",
						BLOCKED_COOLDOWN_MS,
					),
				);
			}

			const results = this.parseResults(body);
			if (!results) {
				return Result.Err(
					this.unavailableError(
						"DuckDuckGo returned an invalid response",
						"invalid_response",
						NETWORK_COOLDOWN_MS,
					),
				);
			}

			this.availability = { status: "available" };
			return Result.Ok({
				payload: {
					kind: "results",
					results: results.slice(0, request.maxResults),
				},
			});
		} catch (error) {
			await writeWebSearchDebugLog("duckduckgo-request-error", {
				message: error instanceof Error ? error.message : String(error),
			});
			if (signal.aborted) {
				return Result.Err(
					new SearchProviderError("DuckDuckGo request timed out", "timeout"),
				);
			}
			const message = error instanceof Error ? error.message : String(error);
			return Result.Err(
				this.unavailableError(
					`DuckDuckGo request failed: ${message}`,
					"network",
					NETWORK_COOLDOWN_MS,
				),
			);
		} finally {
			dispose();
		}
	}

	private httpError(response: Response, body: string): SearchProviderError {
		if (response.status === 429) {
			return this.unavailableError(
				"DuckDuckGo rate limited this request",
				"rate_limited",
				this.retryAfterMs(response.headers.get("retry-after")),
			);
		}
		if (response.status === 403 && this.hasBlockIndicator(body)) {
			return this.unavailableError(
				"DuckDuckGo blocked this request",
				"blocked",
				BLOCKED_COOLDOWN_MS,
			);
		}
		return this.unavailableError(
			`DuckDuckGo returned HTTP ${response.status}`,
			response.status >= 500 ? "server" : "blocked",
			response.status >= 500 ? NETWORK_COOLDOWN_MS : BLOCKED_COOLDOWN_MS,
		);
	}

	private parseResults(body: string): SearchResult[] {
		const document = domino.createDocument(body);
		return Array.from(document.querySelectorAll(".result"))
			.map((r) => {
				const url = r.querySelector("a.result__url")?.getAttribute("href");
				const title = r.querySelector("a.result__a")?.textContent;
				const snippet = r.querySelector("a.result__snippet")?.textContent;
				if (!url || !title) return null;
				return {
					url,
					title,
					source: "duckduckgo",
					snippet: snippet ? this.text(snippet) : undefined,
				} satisfies SearchResult;
			})
			.filter(Boolean) as SearchResult[];
	}

	private text(value: string | null): string {
		return value?.replace(/\s+/g, " ").trim() ?? "";
	}

	private hasBlockIndicator(body: string): boolean {
		const normalized = body.toLowerCase();
		return BLOCK_INDICATORS.some((indicator) => normalized.includes(indicator));
	}

	private unavailableError(
		message: string,
		kind:
			| "network"
			| "rate_limited"
			| "blocked"
			| "server"
			| "invalid_response",
		cooldownMs: number,
	): SearchProviderError {
		this.availability = {
			status: "unavailable",
			reason: message,
			retryAt: Date.now() + cooldownMs,
		};
		return new SearchProviderError(message, kind);
	}

	private retryAfterMs(value: string | null): number {
		if (!value) return RATE_LIMIT_COOLDOWN_MS;
		const seconds = Number(value);
		if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
		const retryAt = Date.parse(value);
		return Number.isNaN(retryAt)
			? RATE_LIMIT_COOLDOWN_MS
			: Math.max(0, retryAt - Date.now());
	}
}
