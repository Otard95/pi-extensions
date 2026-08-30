import type { Static, TSchema } from "@sinclair/typebox";
import type { Result } from "../../utils/monad/result.js";

export interface SearchRequest {
	query: string;
	maxResults: number;
}

export interface SearchContext {
	signal?: AbortSignal;
	timeoutMs: number;
}

export interface SearchResult {
	title: string;
	url: string;
	snippet?: string;
	source?: string;
}

export type SearchPayload =
	| {
			kind: "results";
			results: SearchResult[];
	  }
	| {
			kind: "text";
			text: string;
	  };

export interface SearchProviderResult {
	payload: SearchPayload;
}

export class ProviderSetupError extends Error {
	constructor(
		readonly providerName: string,
		message: string,
		readonly path?: string,
	) {
		super(message);
		this.name = "ProviderSetupError";
	}
}

export class ProviderConfigurationError extends Error {
	constructor(
		readonly providerName: string,
		readonly issues: ProviderSetupError[],
	) {
		super(`Invalid configuration for ${providerName}`);
		this.name = "ProviderConfigurationError";
	}
}

export class ProviderUnavailableError extends Error {
	constructor(
		readonly providerName: string,
		message: string,
	) {
		super(message);
		this.name = "ProviderUnavailableError";
	}
}

export type SearchProviderErrorKind =
	| "timeout"
	| "network"
	| "rate_limited"
	| "blocked"
	| "server"
	| "invalid_response"
	| "configuration";

export class SearchProviderError extends Error {
	constructor(
		message: string,
		readonly kind: SearchProviderErrorKind,
	) {
		super(message);
		this.name = "SearchProviderError";
	}
}

export interface SearchProvider {
	readonly label: string;
	checkAvailability(): Promise<Result<void, ProviderUnavailableError>>;
	search(
		request: SearchRequest,
		context: SearchContext,
	): Promise<Result<SearchProviderResult, SearchProviderError>>;
}

export interface SearchProviderClass<SettingsSchema extends TSchema> {
	new (settings: Static<SettingsSchema>): SearchProvider;
	readonly settingsSchema: SettingsSchema;
}

export interface SupportedSearchProviderClass {
	new (settings: never): SearchProvider;
	readonly settingsSchema: TSchema;
}

export interface ConfiguredSearchProvider {
	name: string;
	provider: SearchProvider;
}

export interface ProviderResolution {
	providers: ConfiguredSearchProvider[];
	issues: ProviderSetupError[];
}

export interface SearchAttempt {
	provider: string;
	status: "skipped" | "failed" | "success";
	durationMs?: number;
	reason?: string;
}

export class SearchRunError extends Error {
	constructor(readonly attempts: SearchAttempt[]) {
		super("No search provider completed the request");
		this.name = "SearchRunError";
	}
}
