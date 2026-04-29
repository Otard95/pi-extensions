import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ModelChoice } from "./type";

export async function resolveModelPattern(
	ctx: ExtensionContext,
	pattern: string,
): Promise<ModelChoice | undefined> {
	const [provider, ...idParts] = pattern.split("/");
	const id = idParts.join("/");
	if (provider && id) {
		const model = ctx.modelRegistry.find(provider, id);
		if (model) {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (auth.ok) {
				return {
					model,
					auth: { apiKey: auth.apiKey, headers: auth.headers },
				};
			}
		}
	}
}
