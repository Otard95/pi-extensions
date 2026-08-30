import { type Static, Type } from "@sinclair/typebox";
import { loadSettings } from "../../utils/settings.js";

export const WebSearchSettingsSchema = Type.Object({
	providers: Type.Optional(Type.Array(Type.String())),
	timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 60 })),
});

export type WebSearchSettings = Static<typeof WebSearchSettingsSchema> &
	Record<string, unknown>;

export const DEFAULT_PROVIDER_ORDER = ["searxng", "duckduckgo"];

export function loadWebSearchSettings() {
	return loadSettings<WebSearchSettings>("web-search", WebSearchSettingsSchema);
}

export function providerOrder(settings: WebSearchSettings): string[] {
	return settings.providers ?? DEFAULT_PROVIDER_ORDER;
}
