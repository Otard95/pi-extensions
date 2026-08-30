import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { abortSignalWithTimeout } from "../../../utils/async/abort.js";
import { Result } from "../../../utils/monad/result.js";
import { resolveValue } from "../../../utils/secret/index.js";
import { writeWebSearchDebugLog } from "../debug.js";
import {
	ProviderUnavailableError,
	type SearchContext,
	type SearchProvider,
	SearchProviderError,
	type SearchProviderResult,
	type SearchRequest,
} from "../types.js";

const SearxngSettingsSchema = Type.Object({
	url: Type.String({ minLength: 1 }),
	authorization: Type.Optional(Type.String({ minLength: 1 })),
});

type SearxngSettings = Static<typeof SearxngSettingsSchema>;

type AuthorizationState =
	| { status: "unresolved" }
	| { status: "resolved"; value?: string };

type SearxngAvailability =
	| { status: "available" }
	| { status: "unavailable"; reason: string; retryAt: number };

interface ResolvedConfiguration {
	baseUrl: URL;
	authorization?: string;
}

const SearxngResultSchema = Type.Object({
	title: Type.String(),
	url: Type.String(),
	content: Type.Optional(Type.String()),
	engine: Type.Optional(Type.String()),
});

const SearxngUnresponsiveEngineSchema = Type.Tuple([
	Type.String(),
	Type.String(),
]);

const SearxngResponseSchema = Type.Object({
	results: Type.Array(Type.Unknown()),
	unresponsive_engines: Type.Optional(
		Type.Array(SearxngUnresponsiveEngineSchema),
	),
});

type SearxngResult = Static<typeof SearxngResultSchema>;
type SearxngUnresponsiveEngine = Static<typeof SearxngUnresponsiveEngineSchema>;

interface ParsedSearxngResponse {
	results: SearxngResult[];
	unresponsiveEngines: SearxngUnresponsiveEngine[];
}

const MAX_SNIPPET_LENGTH = 180;
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
	"cf-chl-",
	"hcaptcha",
	"turnstile",
];

export class SearxngProvider implements SearchProvider {
	static readonly settingsSchema = SearxngSettingsSchema;

	readonly label = "SearXNG";

	private baseUrl?: URL;
	private authorization: AuthorizationState = { status: "unresolved" };
	private availability: SearxngAvailability = { status: "available" };

	constructor(private readonly settings: SearxngSettings) {}

	async checkAvailability(): Promise<Result<void, ProviderUnavailableError>> {
		if (
			this.availability.status === "unavailable" &&
			Date.now() < this.availability.retryAt
		) {
			return Result.Err(
				new ProviderUnavailableError("searxng", this.availability.reason),
			);
		}

		const configuration = await this.resolveConfiguration();
		if (configuration.isErr()) {
			return Result.Err(
				new ProviderUnavailableError("searxng", configuration.unwrapErr()),
			);
		}
		return Result.Ok(undefined);
	}

	async search(
		request: SearchRequest,
		context: SearchContext,
	): Promise<Result<SearchProviderResult, SearchProviderError>> {
		const configuration = await this.resolveConfiguration();
		if (configuration.isErr()) {
			return Result.Err(
				new SearchProviderError(configuration.unwrapErr(), "configuration"),
			);
		}

		const { signal, dispose } = abortSignalWithTimeout(
			context.signal,
			context.timeoutMs,
		);
		try {
			const { baseUrl, authorization } = configuration.unwrap();
			const url = new URL("search", baseUrl);
			url.searchParams.set("q", request.query);
			url.searchParams.set("format", "json");
			url.searchParams.set("categories", "general");

			const headers: Record<string, string> = { Accept: "application/json" };
			if (authorization !== undefined) headers["Authorization"] = authorization;

			const response = await fetch(url, { headers, signal });
			const body = await response.text();
			await writeWebSearchDebugLog("searxng-response", {
				request: {
					url: url.toString(),
					headers: {
						...headers,
						...(authorization ? { Authorization: "[redacted]" } : {}),
					},
				},
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
				const inspectedBody = body.slice(0, BODY_INSPECTION_LIMIT);
				return Result.Err(
					this.httpError(
						response,
						inspectedBody,
						this.hasBlockIndicator(inspectedBody),
					),
				);
			}

			let payload: unknown;
			try {
				payload = JSON.parse(body);
			} catch {
				const inspectedBody = body.slice(0, BODY_INSPECTION_LIMIT);
				if (this.hasBlockIndicator(inspectedBody)) {
					return Result.Err(
						this.unavailableError(
							"SearXNG returned a CAPTCHA or challenge response",
							"blocked",
							BLOCKED_COOLDOWN_MS,
						),
					);
				}
				return Result.Err(
					this.unavailableError(
						"SearXNG returned an invalid response",
						"invalid_response",
						NETWORK_COOLDOWN_MS,
					),
				);
			}

			const parsed = this.parseResponse(payload);
			if (!parsed) {
				return Result.Err(
					this.unavailableError(
						"SearXNG returned an invalid response",
						"invalid_response",
						NETWORK_COOLDOWN_MS,
					),
				);
			}

			if (
				parsed.results.length === 0 &&
				parsed.unresponsiveEngines.length > 0
			) {
				return Result.Err(
					this.unresponsiveEnginesError(parsed.unresponsiveEngines),
				);
			}

			this.availability = { status: "available" };
			return Result.Ok({
				payload: {
					kind: "results",
					results: parsed.results
						.map((result) => this.normalizeResult(result))
						.slice(0, request.maxResults),
				},
			});
		} catch (error) {
			await writeWebSearchDebugLog("searxng-request-error", {
				message: error instanceof Error ? error.message : String(error),
			});
			if (signal.aborted) {
				return Result.Err(
					new SearchProviderError("SearXNG request timed out", "timeout"),
				);
			}
			const message = error instanceof Error ? error.message : String(error);
			return Result.Err(
				this.unavailableError(
					`SearXNG request failed: ${message}`,
					"network",
					NETWORK_COOLDOWN_MS,
				),
			);
		} finally {
			dispose();
		}
	}

	private async resolveConfiguration(): Promise<
		Result<ResolvedConfiguration, string>
	> {
		let baseUrl = this.baseUrl;
		if (!baseUrl) {
			try {
				baseUrl = new URL(this.settings.url);
				if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
					return Result.Err("SearXNG URL must use HTTP or HTTPS");
				}
				if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
				baseUrl.search = "";
				baseUrl.hash = "";
				this.baseUrl = baseUrl;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return Result.Err(`Invalid SearXNG URL: ${message}`);
			}
		}

		if (this.authorization.status === "unresolved") {
			try {
				this.authorization = {
					status: "resolved",
					value: this.settings.authorization
						? await resolveValue(this.settings.authorization)
						: undefined,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return Result.Err(
					`Unable to resolve SearXNG authorization: ${message}`,
				);
			}
		}

		return Result.Ok({ baseUrl, authorization: this.authorization.value });
	}

	private httpError(
		response: Response,
		body: string,
		bodyIndicatesBlock: boolean,
	): SearchProviderError {
		if (response.status === 429) {
			return this.unavailableError(
				"SearXNG rate limited this request",
				"rate_limited",
				this.retryAfterMs(response.headers.get("retry-after")),
			);
		}
		if (response.status === 401) {
			return new SearchProviderError(
				"SearXNG rejected the authorization",
				"configuration",
			);
		}
		if (response.status === 403 && this.isJsonFormatDisabled(body)) {
			return new SearchProviderError(
				"SearXNG JSON output is disabled by this instance",
				"configuration",
			);
		}
		if (response.status === 403 && bodyIndicatesBlock) {
			return this.unavailableError(
				"SearXNG blocked this request",
				"blocked",
				BLOCKED_COOLDOWN_MS,
			);
		}
		if (response.status >= 500) {
			return this.unavailableError(
				`SearXNG returned HTTP ${response.status}`,
				"server",
				NETWORK_COOLDOWN_MS,
			);
		}
		return new SearchProviderError(
			`SearXNG returned HTTP ${response.status}`,
			"server",
		);
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

	private parseResponse(value: unknown): ParsedSearxngResponse | undefined {
		if (!Value.Check(SearxngResponseSchema, value)) return undefined;
		return {
			results: value.results.filter((result): result is SearxngResult =>
				Value.Check(SearxngResultSchema, result),
			),
			unresponsiveEngines: value.unresponsive_engines ?? [],
		};
	}

	private unresponsiveEnginesError(
		engines: SearxngUnresponsiveEngine[],
	): SearchProviderError {
		const details = engines
			.map(([name, reason]) => `${name}: ${reason}`)
			.join(", ");
		const blocked = engines.some(([, reason]) =>
			/(captcha|access denied|blocked|suspended)/i.test(reason),
		);
		return this.unavailableError(
			`SearXNG returned no results because its search engines are unavailable (${details})`,
			blocked ? "blocked" : "rate_limited",
			blocked ? BLOCKED_COOLDOWN_MS : RATE_LIMIT_COOLDOWN_MS,
		);
	}

	private normalizeResult(result: SearxngResult) {
		const snippet = result.content
			? this.normalizeSnippet(result.content)
			: undefined;
		return {
			title: this.stripTags(result.title),
			url: result.url,
			...(snippet ? { snippet } : {}),
			...(result.engine ? { source: result.engine } : {}),
		};
	}

	private stripTags(value: string): string {
		return value.replace(/<[^>]+>/g, "").trim();
	}

	private normalizeSnippet(value: string): string | undefined {
		const normalized = value.replace(/\s+/g, " ").trim();
		if (!normalized) return undefined;
		if (normalized.length <= MAX_SNIPPET_LENGTH) return normalized;
		return `${normalized.slice(0, MAX_SNIPPET_LENGTH)}…`;
	}

	private hasBlockIndicator(body: string): boolean {
		const normalized = body.toLowerCase();
		return BLOCK_INDICATORS.some((indicator) => normalized.includes(indicator));
	}

	private isJsonFormatDisabled(body: string): boolean {
		const normalized = body.toLowerCase();
		return /(?:format.*json|json.*format).{0,80}(?:disabled|forbidden|not allowed)/.test(
			normalized,
		);
	}

	private retryAfterMs(value: string | null): number {
		if (!value) return RATE_LIMIT_COOLDOWN_MS;
		const seconds = Number(value);
		if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
		const retryAt = Date.parse(value);
		if (Number.isNaN(retryAt)) return RATE_LIMIT_COOLDOWN_MS;
		return Math.max(0, retryAt - Date.now());
	}
}
