import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import guardsExtension from "../index.js";
import { DIRECTORY_SEARCH_QUESTION } from "../search-timeout.js";

const { systemOne, appendFile, settings } = vi.hoisted(() => ({
	systemOne: vi.fn(),
	appendFile: vi.fn(),
	settings: { typesafe: {} },
}));

vi.mock("@typesafe-ai/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@typesafe-ai/sdk")>()),
	TypeSafeClient: class {
		systemOne = systemOne;
	},
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs/promises")>()),
	appendFile,
	mkdir: vi.fn(),
}));
vi.mock("../../../utils/settings.js", () => ({
	loadSettings: () => ({ unwrapOr: () => settings }),
}));

const testCommand = `./dev codecept melvis-ms run -c Privacy Functional --filter 'CacheLockCest|ReservationCest|HoldCest' > /tmp/codecept-privacy.log 2>&1; echo "exit=$?"; grep -E "OK \\(|FAILURES|ERRORS|Tests:|✔|✖|^\\s*[0-9]+\\) |Fatal|Error:" /tmp/codecept-privacy.log | tail -40`;

function setup(activeTools: string[] = ["write", "edit"]) {
	type Handler = (...args: unknown[]) => unknown;
	const handlers = new Map<string, Handler>();
	const pi = {
		on: vi.fn((name: string, handler: Handler) => handlers.set(name, handler)),
		registerTool: vi.fn(),
		getActiveTools: () => activeTools,
		getAllTools: () =>
			activeTools.map((name) => ({ name, description: name, parameters: {} })),
		sendMessage: vi.fn(),
	} as unknown as ExtensionAPI;
	guardsExtension(pi);
	const ctx = { cwd: "/project", hasUI: false } as ExtensionContext;
	return {
		handlers,
		async call(command: string, timeout?: number) {
			const event = {
				type: "tool_call",
				toolCallId: "test-call",
				toolName: "bash",
				input: { command, timeout },
			} satisfies ToolCallEvent;
			const result = await handlers.get("tool_call")?.(event, ctx);
			return { event, result };
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv("TYPESAFE_API_KEY", "test-key");
	systemOne.mockResolvedValue({
		answers: { directory_search: { noul: 0.01 } },
	});
});

afterEach(() => vi.unstubAllEnvs());

describe("Jev search timeout selection", () => {
	it("does not classify or clamp commands without search triggers", async () => {
		const { event } = await setup().call("pnpm test", 2400);
		expect(event.input.timeout).toBe(2400);
		expect(systemOne).not.toHaveBeenCalled();
	});
	it.each([
		testCommand,
		"pnpm test | grep FAIL",
		"grep ERROR app.log",
		"rg ERROR app.log server.log",
		"printf 'find /home'",
	])("preserves 2400 seconds when Jev excludes the command: %s", async (command) => {
		const { event, result } = await setup().call(command, 2400);
		expect(result).toBeUndefined();
		expect(event.input.timeout).toBe(2400);
		expect(systemOne).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				state: { command, cwd: "/project" },
				questions: expect.objectContaining({
					directory_search: expect.anything(),
				}),
			}),
		);
		expect(JSON.stringify(systemOne.mock.calls[0]?.[0].questions)).toContain(
			DIRECTORY_SEARCH_QUESTION,
		);
	});

	it.each([
		["rg needle /home", undefined, 2],
		["find / -name '*.ts'", 2400, 10],
		["grep -R needle src", 5, 5],
		["rg --files .", 10, 10],
	])("limits classified directory searches: %s", async (command, input, expected) => {
		systemOne.mockResolvedValue({
			answers: { directory_search: { noul: 0.95 } },
		});
		const { event, result } = await setup().call(command, input);
		expect(result).toBeUndefined();
		expect(event.input.timeout).toBe(expected);
		const record = JSON.parse(appendFile.mock.calls[0]?.[1]);
		expect(record.directorySearch).toBe(0.95);
		expect(record.searchTimeout).toBe(expected);
	});

	it.each([
		{},
		{ directory_search: { noul: 0.5 } },
		{ directory_search: { choice: "yes" } },
		{ directory_search: { noul: 2 } },
	])("preserves the timeout for uncertain or missing answers", async (answers) => {
		systemOne.mockResolvedValue({ answers });
		const { event } = await setup().call("rg needle /home", 2400);
		expect(event.input.timeout).toBe(2400);
	});

	it("preserves the timeout after an API error", async () => {
		systemOne.mockRejectedValue(new Error("TypeSafe unavailable"));
		const { event, result } = await setup().call(testCommand, 2400);
		expect(event.input.timeout).toBe(2400);
		expect(result).toBeUndefined();
	});

	it("preserves an absent timeout for an excluded command", async () => {
		const { event } = await setup().call("grep ERROR app.log");
		expect(event.input.timeout).toBeUndefined();
	});

	it("preserves the timeout without TypeSafe configuration", async () => {
		vi.stubEnv("TYPESAFE_API_KEY", "");
		const { event, result } = await setup([]).call("rg needle /home", 2400);
		expect(event.input.timeout).toBe(2400);
		expect(result).toBeUndefined();
		expect(systemOne).not.toHaveBeenCalled();
	});

	it("batches classification with existing guard questions", async () => {
		systemOne.mockResolvedValue({
			answers: {
				directory_search: { noul: 0.01 },
				read_duplicate: { noul: 0.1 },
			},
		});
		const { event } = await setup(["grep", "write", "edit"]).call(
			testCommand,
			2400,
		);
		expect(event.input.timeout).toBe(2400);
		expect(systemOne).toHaveBeenCalledTimes(1);
		expect(Object.keys(systemOne.mock.calls[0]?.[0].questions)).toEqual([
			"read_duplicate",
			"write_duplicate",
			"directory_search",
		]);
	});

	it("keeps other guard blocks", async () => {
		systemOne.mockResolvedValue({
			answers: {
				directory_search: { noul: 0.01 },
				write_in_readonly: { noul: 0.99 },
			},
		});
		const { result } = await setup([]).call(testCommand, 2400);
		expect(result).toEqual({
			block: true,
			reason: "Blocked: write_in_readonly (confidence: 99%)",
		});
	});

	it("does not relabel a normal bash timeout as a search timeout", async () => {
		const harness = setup(["write", "edit"]);
		const { event } = await harness.call(testCommand, 2400);
		expect(
			harness.handlers.get("tool_result")?.({
				...event,
				isError: true,
				content: [
					{ type: "text", text: "Command timed out after 2400 seconds" },
				],
			}),
		).toBeUndefined();
	});
});
