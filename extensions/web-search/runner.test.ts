import { describe, expect, it } from "vitest";
import { MockProvider } from "./providers/mock.js";
import { ProviderRateLimiter } from "./rate-limit.js";
import { runSearch } from "./runner.js";

describe("runSearch", () => {
	it("skips a locally limited provider", async () => {
		const limiter = new ProviderRateLimiter({
			mock: [{ count: 1, window: { m: 1 }, message: "Search limit reached." }],
		});
		const providers = [{ name: "mock", provider: new MockProvider({}) }];
		const context = { timeoutMs: 1_000, rateLimiter: limiter };

		expect(
			(
				await runSearch(providers, { query: "first", maxResults: 5 }, context)
			).isOk(),
		).toBe(true);
		const result = await runSearch(
			providers,
			{ query: "second", maxResults: 5 },
			context,
		);

		expect(result.isErr()).toBe(true);
		expect(result.unwrapErr().attempts).toEqual([
			{
				provider: "mock",
				status: "skipped",
				reason: "Search limit reached.",
			},
		]);
	});
});
