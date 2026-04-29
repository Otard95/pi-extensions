import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ModelChoice } from "./type";

export async function resolveModelPattern(
	ctx: ExtensionContext,
	pattern: string,
): Promise<ModelChoice | undefined> {
	const [provider, ...idParts] = pattern.split("/");
	const id = idParts.join("/");
	if (!provider || !id) return undefined;

	const available = ctx.modelRegistry.getAvailable();
	const model = available.find((m) => m.provider === provider && m.id === id);
	if (!model) return undefined;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) return undefined;
	return { model, auth: { apiKey: auth.apiKey, headers: auth.headers } };
}
