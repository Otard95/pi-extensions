import { afterEach, describe, expect, it, vi } from "vitest";
import { configureProviders } from "../provider-registry.js";
import { BraveProvider } from "./brave.js";

const originalFetch = globalThis.fetch;

function response(body: string, init?: ResponseInit): Response {
	return new Response(body, {
		status: 200,
		headers: { "content-type": "text/html; charset=UTF-8" },
		...init,
	});
}

function search(instance: BraveProvider) {
	return instance.search(
		{ query: "test query", maxResults: 5 },
		{ timeoutMs: 1_000 },
	);
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.useRealTimers();
});

describe("BraveProvider", () => {
	it("is registered without provider-specific settings", () => {
		const resolution = configureProviders(
			["brave"],
			{ brave: { render: "simple" } },
			{ brave: BraveProvider },
		);

		expect(resolution.issues).toEqual([]);
		expect(resolution.providers).toHaveLength(1);
	});

	it("sends a browser-like request and normalizes result cards", async () => {
		const fetch = vi.fn().mockResolvedValue(
			response(`
				<div id="results">
					<div class="result-wrapper">
						<a href="https://example.com/guide"><div class="title">Example &amp; guide</div></a>
						<div class="generic-snippet">A useful <b>snippet</b>.</div>
					</div>
				</div>
			`),
		);
		globalThis.fetch = fetch;

		const result = await search(new BraveProvider());

		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(String(url)).toBe(
			"https://search.brave.com/search?q=test+query&source=web",
		);
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
					source: "brave",
				},
			],
		});
	});

	it("enters a cooldown when Brave Search returns a challenge", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(response("<title>CAPTCHA challenge</title>"));
		const instance = new BraveProvider();

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
		const instance = new BraveProvider();

		expect((await search(instance)).unwrapErr().kind).toBe("rate_limited");
		expect((await instance.checkAvailability()).isErr()).toBe(true);
		await vi.advanceTimersByTimeAsync(10_000);
		expect((await instance.checkAvailability()).isOk()).toBe(true);
	});
});
