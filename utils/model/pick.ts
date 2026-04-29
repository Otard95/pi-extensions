import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ModelChoice } from "./type";

const DEFAULT_PREFERRED: ReadonlyArray<readonly [string, string]> = [
	["google", "gemini-2.5-flash"],
	["anthropic", "claude-haiku-4-5"],
	["openai", "gpt-5-mini"],
	["openai-codex", "gpt-5.1-codex-mini"],
	["github-copilot", "gpt-5-mini"],
	["openai", "gpt-4.1-mini"],
	["openai", "gpt-4o-mini"],
];

type PickModelOptions = {
	preferred?: ReadonlyArray<readonly [string, string]>;
	preferCurrentProvider?: boolean;
	noFallback?: boolean;
};

/**
 * Find the first available authenticated model from a preferred list.
 * Uses getAvailable() as the source of truth for auth — no manual key checks.
 * Falls back to the current session model if none match (unless noFallback).
 */
export async function pickModel(
	ctx: ExtensionContext,
	opts?: PickModelOptions,
): Promise<ModelChoice | null> {
	const options = { preferred: DEFAULT_PREFERRED, ...(opts ?? {}) };
	const available = ctx.modelRegistry.getAvailable();

	if (ctx.model && options.preferCurrentProvider === true) {
		const m = await pickModel(ctx, {
			preferred: options.preferred.filter(([p]) => p === ctx.model?.provider),
			preferCurrentProvider: false,
			noFallback: true,
		});
		if (m) return m;
	}

	for (const [provider, id] of options.preferred) {
		const model = available.find((m) => m.provider === provider && m.id === id);
		if (!model) continue;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) continue;
		return { model, auth: { apiKey: auth.apiKey, headers: auth.headers } };
	}

	if (ctx.model && options.noFallback !== true) {
		const isCurrent = available.some(
			(m) => m.provider === ctx.model?.provider && m.id === ctx.model?.id,
		);
		if (isCurrent) {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
			if (!auth.ok) return null;
			return {
				model: ctx.model,
				auth: { apiKey: auth.apiKey, headers: auth.headers },
			};
		}
	}

	return null;
}
