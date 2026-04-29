import { type Message, complete as piComplete } from "@mariozechner/pi-ai";
import type { ModelChoice } from "./type.js";

export async function complete(
	choice: ModelChoice,
	systemPrompt: string,
	messages: Message[],
	signal?: AbortSignal,
) {
	return piComplete(
		choice.model,
		{ systemPrompt, messages },
		{
			apiKey: choice.auth.apiKey,
			headers: choice.auth.headers,
			signal,
		},
	);
}
