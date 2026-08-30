import { afterEach, describe, expect, it, vi } from "vitest";
import { configureProviders } from "../provider-registry.js";
import { DuckDuckGoProvider } from "./duckduckgo.js";

const originalFetch = globalThis.fetch;

function response(body: string, init?: ResponseInit): Response {
	return new Response(body, {
		status: 200,
		headers: { "content-type": "text/html; charset=UTF-8" },
		...init,
	});
}

function search(instance: DuckDuckGoProvider) {
	return instance.search(
		{ query: "test query", maxResults: 5 },
		{ timeoutMs: 1_000 },
	);
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.useRealTimers();
});

describe("DuckDuckGoProvider", () => {
	it("is registered without provider-specific settings", () => {
		const resolution = configureProviders(
			["duckduckgo"],
			{ duckduckgo: { render: "simple" } },
			{ duckduckgo: DuckDuckGoProvider },
		);

		expect(resolution.issues).toEqual([]);
		expect(resolution.providers).toHaveLength(1);
	});

	it("sends a browser-like request and normalizes organic results", async () => {
		const fetch = vi.fn().mockResolvedValue(
			response(`
				<div class="result results_links results_links_deep web-result">
					<div class="links_main links_deep result__body">
						<h2 class="result__title"><a class="result__a" href="https://example.com/guide">Example &amp; guide</a></h2>
						<div class="result__extras"><div class="result__extras__url"><a class="result__url" href="https://example.com/guide">example.com/guide</a></div></div>
						<a class="result__snippet" href="https://example.com/guide">A useful <b>snippet</b>.</a>
					</div>
				</div>
			`),
		);
		globalThis.fetch = fetch;

		const result = await search(new DuckDuckGoProvider());

		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(String(url)).toBe("https://html.duckduckgo.com/html/?q=test+query");
		expect(init).toMatchObject({
			headers: {
				Accept: expect.stringContaining("text/html"),
				"Accept-Language": "en-US,en;q=0.9",
				"User-Agent": expect.stringContaining("Mozilla/5.0"),
			},
		});
		expect(result.unwrap().payload).toEqual({
			kind: "results",
			results: [
				{
					title: "Example & guide",
					url: "https://example.com/guide",
					snippet: "A useful snippet.",
					source: "duckduckgo",
				},
			],
		});
	});

	it("enters a cooldown when DuckDuckGo returns a challenge", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(response("<title>CAPTCHA challenge</title>"));
		const instance = new DuckDuckGoProvider();

		expect((await search(instance)).unwrapErr().kind).toBe("blocked");
		expect((await instance.checkAvailability()).isErr()).toBe(true);
	});

	it("uses Retry-After when rate limited", async () => {
		vi.useFakeTimers();
		globalThis.fetch = vi.fn().mockResolvedValue(
			response("slow down", {
				status: 429,
				headers: { "retry-after": "10" },
			}),
		);
		const instance = new DuckDuckGoProvider();

		expect((await search(instance)).unwrapErr().kind).toBe("rate_limited");
		expect((await instance.checkAvailability()).isErr()).toBe(true);
		await vi.advanceTimersByTimeAsync(10_000);
		expect((await instance.checkAvailability()).isOk()).toBe(true);
	});
});
