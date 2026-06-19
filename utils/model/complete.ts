import { type Message, complete as piComplete } from "@mariozechner/pi-ai";
import type { ModelChoice } from "./type.js";

type CompleteOptions = {
	signal?: AbortSignal;
	maxTokens?: number;
};

export async function complete(
	choice: ModelChoice,
	systemPrompt: string,
	messages: Message[],
	opts?: CompleteOptions,
) {
	return piComplete(
		choice.model,
		{ systemPrompt, messages },
		{
			apiKey: choice.auth.apiKey,
			headers: choice.auth.headers,
			...opts,
		},
	);
}
