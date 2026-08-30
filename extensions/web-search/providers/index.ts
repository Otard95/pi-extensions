import type { SupportedProviders } from "../provider-registry.js";
import { DuckDuckGoProvider } from "./duckduckgo.js";
import { MockProvider } from "./mock.js";
import { SearxngProvider } from "./searxng.js";

export const supportedProviders = {
	searxng: SearxngProvider,
	duckduckgo: DuckDuckGoProvider,
	mock: MockProvider,
} satisfies SupportedProviders;
