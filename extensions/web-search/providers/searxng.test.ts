import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveValue } = vi.hoisted(() => ({
	resolveValue: vi.fn((value: string) => Promise.resolve(value)),
}));

vi.mock("../../../utils/secret/index.js", () => ({ resolveValue }));

import { configureProviders } from "../provider-registry.js";
import { SearxngProvider } from "./searxng.js";

const originalFetch = globalThis.fetch;

function response(body: string, init?: ResponseInit): Response {
	return new Response(body, {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

function provider(settings: { url: string; authorization?: string }) {
	return new SearxngProvider(settings);
}

function search(instance: SearxngProvider, signal?: AbortSignal) {
	return instance.search(
		{ query: "test query", maxResults: 5 },
		{ timeoutMs: 1_000, signal },
	);
}

beforeEach(() => {
	resolveValue.mockReset();
	resolveValue.mockImplementation((value: string) => Promise.resolve(value));
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.useRealTimers();
});

describe("SearxngProvider", () => {
	it("is registered and validates required settings", () => {
		const resolution = configureProviders(
			["searxng"],
			{ searxng: {} },
			{ searxng: SearxngProvider },
		);

		expect(resolution.providers).toEqual([]);
		expect(resolution.issues).not.toHaveLength(0);
		expect(
			resolution.issues.some(
				(issue) => issue.path === "web-search.searxng/url",
			),
		).toBe(true);
	});

	it("retries failed secret resolution on the next availability check", async () => {
		resolveValue
			.mockRejectedValueOnce(new Error("pass is locked"))
			.mockResolvedValueOnce("Bearer token");
		const instance = provider({
			url: "https://search.example.com",
			authorization: "pass:searxng/auth",
		});

		expect((await instance.checkAvailability()).isErr()).toBe(true);
		expect((await instance.checkAvailability()).isOk()).toBe(true);
		expect(resolveValue).toHaveBeenCalledTimes(2);
	});

	it("preserves the configured subpath, sends authorization, and normalizes results", async () => {
		const fetch = vi.fn().mockResolvedValue(
			response(
				JSON.stringify({
					results: [
						{
							title: "<em>Example</em> result",
							url: "https://example.com",
							content: "  a   useful\n snippet ",
							engine: "brave",
						},
						{ title: 1, url: "https://discarded.example" },
					],
				}),
			),
		);
		globalThis.fetch = fetch;

		const result = await search(
			provider({
				url: "https://search.example.com/searxng",
				authorization: "Bearer token",
			}),
		);

		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(String(url)).toBe(
			"https://search.example.com/searxng/search?q=test+query&format=json&categories=general",
		);
		expect(init).toMatchObject({
			headers: { Accept: "application/json", Authorization: "Bearer token" },
		});
		expect(result.unwrap().payload).toEqual({
			kind: "results",
			results: [
				{
					title: "Example result",
					url: "https://example.com",
					snippet: "a useful snippet",
					source: "brave",
				},
			],
		});
	});

	it("returns invalid_response and enters a cooldown for malformed response roots", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(response(JSON.stringify({})));
		const instance = provider({ url: "https://search.example.com" });

		const result = await search(instance);

		expect(result.unwrapErr().kind).toBe("invalid_response");
		expect((await instance.checkAvailability()).unwrapErr().message).toBe(
			"SearXNG returned an invalid response",
		);
	});

	it("treats empty results with unresponsive engines as unavailable", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			response(
				JSON.stringify({
					results: [],
					unresponsive_engines: [
						["brave", "too many requests"],
						["duckduckgo", "CAPTCHA"],
					],
				}),
			),
		);
		const instance = provider({ url: "https://search.example.com" });

		const result = await search(instance);

		expect(result.unwrapErr().kind).toBe("blocked");
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
		const instance = provider({ url: "https://search.example.com" });

		expect((await search(instance)).unwrapErr().kind).toBe("rate_limited");
		expect((await instance.checkAvailability()).isErr()).toBe(true);
		await vi.advanceTimersByTimeAsync(10_000);
		expect((await instance.checkAvailability()).isOk()).toBe(true);
	});

	it("identifies disabled JSON output as a configuration failure", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(
				response("The format=json output is disabled", { status: 403 }),
			);

		const result = await search(
			provider({ url: "https://search.example.com" }),
		);

		expect(result.unwrapErr().kind).toBe("configuration");
	});

	it("maps caller cancellation to timeout without a cooldown", async () => {
		globalThis.fetch = vi.fn(
			(_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
				new Promise((_resolve, reject) => {
					if (init?.signal?.aborted) {
						reject(new DOMException("Aborted", "AbortError"));
						return;
					}
					init?.signal?.addEventListener("abort", () => {
						reject(new DOMException("Aborted", "AbortError"));
					});
				}),
		);
		const controller = new AbortController();
		const instance = provider({ url: "https://search.example.com" });
		const pending = search(instance, controller.signal);
		controller.abort();

		expect((await pending).unwrapErr().kind).toBe("timeout");
		expect((await instance.checkAvailability()).isOk()).toBe(true);
	});
});
