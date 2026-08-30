import { afterEach, describe, expect, it, vi } from "vitest";
import { abortSignalWithTimeout } from "./abort.js";

afterEach(() => {
	vi.useRealTimers();
});

describe("abortSignalWithTimeout", () => {
	it("aborts when the caller signal aborts", () => {
		const caller = new AbortController();
		const { signal, dispose } = abortSignalWithTimeout(caller.signal, 1_000);

		caller.abort();

		expect(signal.aborted).toBe(true);
		dispose();
	});

	it("stops the timeout when disposed", async () => {
		vi.useFakeTimers();
		const { signal, dispose } = abortSignalWithTimeout(undefined, 1_000);

		dispose();
		await vi.advanceTimersByTimeAsync(1_000);

		expect(signal.aborted).toBe(false);
	});
});
