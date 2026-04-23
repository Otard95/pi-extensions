import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type ModelChoice = {
	model: NonNullable<ExtensionContext["model"]>;
	auth: { apiKey: string; headers?: Record<string, string> };
};

const DEFAULT_PREFERRED: ReadonlyArray<readonly [string, string]> = [
	["google", "gemini-2.5-flash"],
	["anthropic", "claude-haiku-4-5"],
	["openai", "gpt-5-mini"],
	["openai-codex", "gpt-5-mini"],
	["openai", "gpt-4.1-mini"],
	["openai", "gpt-4o-mini"],
];

/**
 * Find the first available cheap model from a preferred list.
 * Falls back to the current session model if none match.
 */
export async function pickModel(
	ctx: ExtensionContext,
	preferred: ReadonlyArray<readonly [string, string]> = DEFAULT_PREFERRED,
): Promise<ModelChoice | null> {
	for (const [provider, id] of preferred) {
		const model = ctx.modelRegistry.find(provider, id);
		if (!model) continue;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (auth.ok && auth.apiKey) {
			return { model, auth: { apiKey: auth.apiKey, headers: auth.headers } };
		}
	}

	if (ctx.model) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (auth.ok && auth.apiKey) {
			return {
				model: ctx.model,
				auth: { apiKey: auth.apiKey, headers: auth.headers },
			};
		}
	}

	return null;
}
