import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ModelChoice } from "./type";

const DEFAULT_PREFERRED: ReadonlyArray<readonly [string, string]> = [
	["google", "gemini-2.5-flash"],
	["anthropic", "claude-haiku-4-5"],
	["openai", "gpt-5-mini"],
	["openai-codex", "gpt-5.1-codex-mini"],
	["openai", "gpt-4.1-mini"],
	["openai", "gpt-4o-mini"],
];

type PickModelOptions = {
	preferred?: ReadonlyArray<readonly [string, string]>;
	preferCurrentProvider?: boolean;
	noFallback?: boolean;
};

/**
 * Find the first available cheap model from a preferred list.
 * Falls back to the current session model if none match.
 */
export async function pickModel(
	ctx: ExtensionContext,
	opts?: PickModelOptions,
): Promise<ModelChoice | null> {
	const options = { preferred: DEFAULT_PREFERRED, ...(opts ?? {}) };

	if (ctx.model && options.preferCurrentProvider === true) {
		const m = await pickModel(ctx, {
			preferred: options.preferred.filter(([p]) => p === ctx.model?.provider),
			preferCurrentProvider: false,
			noFallback: true,
		});
		if (m) return m;
	}

	for (const [provider, id] of options.preferred) {
		const model = ctx.modelRegistry.find(provider, id);
		if (!model) continue;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (auth.ok) {
			return { model, auth: { apiKey: auth.apiKey, headers: auth.headers } };
		}
	}

	if (ctx.model && options.noFallback !== true) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (auth.ok) {
			return {
				model: ctx.model,
				auth: { apiKey: auth.apiKey, headers: auth.headers },
			};
		}
	}

	return null;
}
