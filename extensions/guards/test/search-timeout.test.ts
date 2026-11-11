import type {
	ExtensionAPI,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isSearchCommand,
	registerSearchTimeouts,
	searchTimeout,
	timeoutMessage,
	withSearchTimeout,
} from "../search-timeout.js";

afterEach(() => vi.useRealTimers());

describe("search timeout", () => {
	it.each([
		[undefined, 2],
		[0, 2],
		[-1, 2],
		[Number.NaN, 2],
		[Number.POSITIVE_INFINITY, 2],
		[0.5, 0.5],
		[2, 2],
		[8, 8],
		[10, 10],
		[60, 10],
	])("maps %s seconds to %s", (input, expected) => {
		expect(searchTimeout(input)).toBe(expected);
	});

	it.each([
		"grep x /",
		"rg x /home",
		"ripgrep x .",
		"find / -name x",
		"git status | grep x",
	])("limits search commands: %s", (command) =>
		expect(isSearchCommand(command)).toBe(true));

	it.each([
		"pnpm test",
		"sleep 30",
		"git status",
	])("leaves other commands alone: %s", (command) =>
		expect(isSearchCommand(command)).toBe(false));

	it("returns successful results and clears its timer", async () => {
		vi.useFakeTimers();
		expect(await withSearchTimeout(2, undefined, async () => "matches")).toBe(
			"matches",
		);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("aborts the search and gives the custom timeout error", async () => {
		vi.useFakeTimers();
		let searchSignal: AbortSignal | undefined;
		const result = withSearchTimeout(2, undefined, (signal) => {
			searchSignal = signal;
			return new Promise((_, reject) => {
				signal.addEventListener("abort", () =>
					reject(new Error("Operation aborted")),
				);
			});
		});
		const assertion = expect(result).rejects.toThrow(timeoutMessage(2));
		await vi.advanceTimersByTimeAsync(2000);
		await assertion;
		expect(searchSignal?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("bounds the wait even when the operation ignores cancellation", async () => {
		vi.useFakeTimers();
		const result = withSearchTimeout(2, undefined, () => new Promise(() => {}));
		const assertion = expect(result).rejects.toThrow(timeoutMessage(2));
		await vi.advanceTimersByTimeAsync(2000);
		await assertion;
		expect(vi.getTimerCount()).toBe(0);
	});

	it("keeps ordinary errors", async () => {
		await expect(
			withSearchTimeout(2, undefined, async () => {
				throw new Error("Path not found");
			}),
		).rejects.toThrow("Path not found");
	});

	it("preserves user cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			withSearchTimeout(2, controller.signal, async (signal) => {
				expect(signal.aborted).toBe(true);
				throw new Error("Operation aborted");
			}),
		).rejects.toThrow("Operation aborted");
	});

	it("registers direct tools with timeout parameters", () => {
		const registerTool = vi.fn();
		registerSearchTimeouts({
			on: vi.fn(),
			registerTool,
		} as unknown as ExtensionAPI);
		expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
			"grep",
			"find",
		]);
		for (const [tool] of registerTool.mock.calls) {
			expect(tool.parameters.properties.timeout.type).toBe("number");
			expect(tool.parameters.required).not.toContain("timeout");
		}
	});

	it("only patches bash inputs when explicitly selected", () => {
		const on = vi.fn();
		const limitSearch = registerSearchTimeouts({
			on,
			registerTool: vi.fn(),
		} as unknown as ExtensionAPI);
		expect(on.mock.calls.some(([name]) => name === "tool_call")).toBe(false);
		for (const timeout of [undefined, 5, 30]) {
			const event = { toolName: "bash", input: { command: "rg x /", timeout } };
			limitSearch(event as ToolCallEvent);
			expect(event.input.timeout).toBe(searchTimeout(timeout));
		}
	});

	it("keeps partial bash output with the custom error", () => {
		const on = vi.fn();
		const limitSearch = registerSearchTimeouts({
			on,
			registerTool: vi.fn(),
		} as unknown as ExtensionAPI);
		const handler = on.mock.calls.find(([name]) => name === "tool_result")?.[1];
		const event = {
			toolCallId: "limited-search",
			toolName: "bash",
			isError: true,
			input: { command: "find /", timeout: 2 },
			content: [
				{
					type: "text",
					text: "partial output\nCommand timed out after 2 seconds",
				},
			],
		};
		expect(handler(event)).toBeUndefined();
		limitSearch({ ...event, type: "tool_call" } as ToolCallEvent);
		expect(handler(event).content[0].text).toBe(
			`partial output\n${timeoutMessage(2)}`,
		);
		expect(handler({ ...event, isError: false })).toBeUndefined();
	});
});
