import { describe, expect, it } from "vitest";
import { ProviderRateLimiter } from "./rate-limit.js";

describe("ProviderRateLimiter", () => {
	it("limits a provider within its configured window", () => {
		const limiter = new ProviderRateLimiter({
			brave: [{ count: 2, window: { s: 10 } }],
		});

		expect(limiter.acquire("brave", 0).allowed).toBe(true);
		expect(limiter.acquire("brave", 5_000).allowed).toBe(true);
		expect(limiter.acquire("brave", 9_999)).toEqual({
			allowed: false,
			reason: "Local rate limit reached for brave: 2 requests per 10 seconds.",
		});
		expect(limiter.acquire("brave", 10_000).allowed).toBe(true);
	});

	it("uses the configured message", () => {
		const limiter = new ProviderRateLimiter({
			duckduckgo: [
				{ count: 1, window: { m: 1 }, message: "Wait before another search." },
			],
		});

		expect(limiter.acquire("duckduckgo", 0).allowed).toBe(true);
		expect(limiter.acquire("duckduckgo", 1)).toEqual({
			allowed: false,
			reason: "Wait before another search.",
		});
	});

	it("applies every configured limit", () => {
		const limiter = new ProviderRateLimiter({
			searxng: [
				{ count: 3, window: { s: 10 } },
				{ count: 4, window: { m: 1 } },
			],
		});

		for (let index = 0; index < 3; index += 1) {
			expect(limiter.acquire("searxng", index * 1_000).allowed).toBe(true);
		}
		expect(limiter.acquire("searxng", 3_000).allowed).toBe(false);
		expect(limiter.acquire("searxng", 10_000).allowed).toBe(true);
	});
});
