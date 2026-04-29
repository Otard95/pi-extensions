import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type ModelChoice = {
	model: NonNullable<ExtensionContext["model"]>;
	auth: { apiKey?: string; headers?: Record<string, string> };
};
