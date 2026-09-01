import type { SupportedProviders } from "../provider-registry.js";
import { BraveProvider } from "./brave.js";
import { DuckDuckGoProvider } from "./duckduckgo.js";
import { MockProvider } from "./mock.js";
import { SearxngProvider } from "./searxng.js";

export const supportedProviders = {
	searxng: SearxngProvider,
	duckduckgo: DuckDuckGoProvider,
	brave: BraveProvider,
	mock: MockProvider,
} satisfies SupportedProviders;
