import { type Static, Type } from "@sinclair/typebox";
import { loadSettings } from "../../utils/settings.js";

const RateLimitWindowSchema = Type.Object(
	{
		s: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
		m: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
	},
	{ minProperties: 1 },
);

const RateLimitRuleSchema = Type.Object({
	count: Type.Integer({ minimum: 1 }),
	window: RateLimitWindowSchema,
	message: Type.Optional(Type.String()),
});

export const WebSearchSettingsSchema = Type.Object({
	providers: Type.Optional(Type.Array(Type.String())),
	timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 60 })),
	"rate-limit": Type.Optional(
		Type.Record(Type.String(), Type.Array(RateLimitRuleSchema)),
	),
});

export type WebSearchSettings = Static<typeof WebSearchSettingsSchema> &
	Record<string, unknown>;

export const DEFAULT_PROVIDER_ORDER = ["searxng", "duckduckgo", "brave"];

export function loadWebSearchSettings() {
	return loadSettings<WebSearchSettings>("web-search", WebSearchSettingsSchema);
}

export function providerOrder(settings: WebSearchSettings): string[] {
	return settings.providers ?? DEFAULT_PROVIDER_ORDER;
}
