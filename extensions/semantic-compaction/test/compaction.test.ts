import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { at } from "../../../utils/array/at";
import { last } from "../../../utils/array/last";
import { findToolGroups, groupTurns, splitIntoTurns } from "../analysis";
import { buildCompactionPrompt, compactTools } from "../compaction";
import { formatEntryLines } from "../formatting";
import { compactTurns, rebuildEntriesWithTurns } from "../turn-compaction";
import {
	assistantText,
	assistantToolCall,
	multiTurnConversation,
	resetIds,
	toolCompaction,
	toolResult,
	userMessage,
} from "./fixtures";

// --- Mocks ---

const mockComplete = vi.fn();
const mockPickModel = vi.fn();

vi.mock("../../../utils/model/complete", () => ({
	complete: (...args: unknown[]) => mockComplete(...args),
}));

vi.mock("../../../utils/model/pick", () => ({
	pickModel: (...args: unknown[]) => mockPickModel(...args),
}));

const MOCK_MODEL_CHOICE = {
	model: { id: "test-model", provider: "test" },
	auth: { apiKey: "test-key" },
};

function mockCompleteResponse(text: string) {
	mockComplete.mockResolvedValue({
		content: [{ type: "text", text }],
		stopReason: "stop",
	});
}

beforeEach(() => {
	resetIds();
	mockComplete.mockReset();
	mockPickModel.mockReset();
});

// --- groupTurns ---

describe("groupTurns", () => {
	function makeTurns(tokenCounts: number[]): SessionEntry[][] {
		// Each turn gets a user message with text sized to approximate the token count
		return tokenCounts.map((tokens) => {
			const text = "x".repeat(tokens * 4); // ~4 chars per token
			return [userMessage(text), assistantText("response")];
		});
	}

	it("groups small turns into the next anchor", () => {
		// Small, small, large → one group
		const turns = makeTurns([100, 100, 600]);
		const groups = groupTurns(turns, 500);

		expect(groups).toHaveLength(1);
		expect(groups[0]?.turns).toHaveLength(3);
	});

	it("keeps large turns as standalone groups", () => {
		const turns = makeTurns([600, 700, 800]);
		const groups = groupTurns(turns, 500);

		expect(groups).toHaveLength(3);
		for (const g of groups) {
			expect(g.turns).toHaveLength(1);
		}
	});

	it("merges trailing small turns into last group", () => {
		// Large, small, small → large gets its own group, smalls merge backward
		const turns = makeTurns([600, 100, 100]);
		const groups = groupTurns(turns, 500);

		expect(groups).toHaveLength(1);
		expect(groups[0]?.turns).toHaveLength(3);
	});

	it("handles all small turns as one group", () => {
		const turns = makeTurns([100, 100, 100]);
		const groups = groupTurns(turns, 500);

		expect(groups).toHaveLength(1);
		expect(groups[0]?.turns).toHaveLength(3);
	});

	it("multiple anchors with leading small turns", () => {
		// Small, large, small, large → two groups of 2
		const turns = makeTurns([100, 600, 100, 700]);
		const groups = groupTurns(turns, 500);

		expect(groups).toHaveLength(2);
		expect(groups[0]?.turns).toHaveLength(2);
		expect(groups[1]?.turns).toHaveLength(2);
	});

	it("tracks turn indices correctly", () => {
		const turns = makeTurns([100, 600, 100, 700]);
		const groups = groupTurns(turns, 500);

		expect(groups[0]?.turnIndices).toEqual([0, 1]);
		expect(groups[1]?.turnIndices).toEqual([2, 3]);
	});

	it("flattens entries correctly", () => {
		const turns = makeTurns([100, 600]);
		const groups = groupTurns(turns, 500);

		expect(groups).toHaveLength(1);
		// Each turn has 2 entries (user + assistant)
		expect(groups[0]?.entries).toHaveLength(4);
	});
});

// --- buildCompactionPrompt ---

describe("buildCompactionPrompt", () => {
	it("includes pre-context and post-context", () => {
		const entries = multiTurnConversation();
		const turns = splitIntoTurns(entries);
		const groups = findToolGroups(turns[0] ?? []);

		if (groups.length > 0) {
			const prompt = buildCompactionPrompt(at(groups, 0));
			expect(prompt).toContain("<preceding_message>");
			expect(prompt).toContain("</preceding_message>");
			expect(prompt).toContain("<tool_calls>");
			expect(prompt).toContain("</tool_calls>");
			expect(prompt).toContain("<following_message>");
			expect(prompt).toContain("</following_message>");
		}
	});
});

// --- formatEntryLines ---

describe("formatEntryLines", () => {
	it("formats messages with tags in prompt mode", () => {
		const entries = [userMessage("hello"), assistantText("hi there")];
		const lines = formatEntryLines(entries);

		expect(lines).toEqual(["[user] hello", "[assistant] hi there"]);
	});

	it("formats tool calls and results", () => {
		const entries = [
			assistantToolCall({ name: "read", args: { path: "file.ts" } }),
			toolResult("read", "const x = 1;"),
		];
		const lines = formatEntryLines(entries);

		expect(lines[0]).toContain("[toolCall]");
		expect(lines[0]).toContain("read");
		expect(lines[1]).toContain("[toolResult]");
		expect(lines[1]).toContain("const x = 1;");
	});

	it("formats tool-compaction entries", () => {
		const entries = [toolCompaction("[tool] read(file.ts)\nconst x = 1;")];
		const lines = formatEntryLines(entries);

		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("[tool-compaction]");
		expect(lines[0]).toContain("read(file.ts)");
	});

	it("truncates in debug mode", () => {
		const longText = "x".repeat(200);
		const entries = [userMessage(longText)];
		const lines = formatEntryLines(entries, { maxLen: 50 });

		expect(at(lines, 0).length).toBeLessThanOrEqual(60); // [user] + truncated
		expect(lines[0]).toContain("...");
	});

	it("shows line count for toolResult in debug mode", () => {
		const entries = [toolResult("read", "line1\nline2\nline3")];
		const lines = formatEntryLines(entries, { maxLen: 120 });

		expect(lines[0]).toContain("3 lines");
		expect(lines[0]).not.toContain("line1");
	});
});

// --- rebuildEntriesWithTurns ---

describe("rebuildEntriesWithTurns", () => {
	it("replaces compacted turn entries with custom_message", () => {
		const entries = multiTurnConversation();
		const turns = splitIntoTurns(entries);
		const group = {
			turns: [at(turns, 0)],
			turnIndices: [0],
			entries: at(turns, 0),
			tokenEstimate: 1000,
		};

		const rebuilt = rebuildEntriesWithTurns(entries, [
			{ group, compacted: "Turn 1 summary" },
		]);

		// Should have one turn-compaction entry replacing the first turn
		const compactionEntries = rebuilt.filter(
			(e): e is SessionEntry & { type: "custom_message"; customType: string } =>
				e.type === "custom_message" &&
				"customType" in e &&
				(e as SessionEntry & { customType: string }).customType ===
					"turn-compaction",
		);
		expect(compactionEntries).toHaveLength(1);

		// Second turn should be untouched
		expect(rebuilt.length).toBeLessThan(entries.length);
	});

	it("keeps entries outside compacted groups", () => {
		const entries = multiTurnConversation();
		const turns = splitIntoTurns(entries);

		// Only compact first turn
		const group = {
			turns: [at(turns, 0)],
			turnIndices: [0],
			entries: at(turns, 0),
			tokenEstimate: 1000,
		};

		const rebuilt = rebuildEntriesWithTurns(entries, [
			{ group, compacted: "summary" },
		]);

		// Last entry of second turn should still be there
		const lastOriginal = last(entries);
		expect(rebuilt.some((e) => e.id === lastOriginal.id)).toBe(true);
	});
});

// --- Mock context ---

function mockCommandContext() {
	return {
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
			confirm: vi.fn().mockResolvedValue(true),
		},
		sessionManager: {
			getBranch: vi.fn(),
			getSessionFile: vi.fn().mockReturnValue("test-session"),
		},
		newSession: vi.fn(),
		model: { provider: "test", id: "test-model" },
		modelRegistry: {
			getAvailable: vi.fn().mockReturnValue([]),
			getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true }),
		},
		// biome-ignore lint/suspicious/noExplicitAny: mock context
	} as any;
}

// --- compactTools (mocked complete) ---

describe("compactTools", () => {
	it("calls complete with compaction prompt and returns rebuilt entries", async () => {
		mockPickModel.mockResolvedValue(MOCK_MODEL_CHOICE);
		mockCompleteResponse("[tool] read(file.ts)\nconst x = 1;");

		const entries = multiTurnConversation();
		const ctx = mockCommandContext();

		const result = await compactTools(entries, entries, 0, ctx);

		expect(result).not.toBeNull();
		expect(result?.rebuilt.length).toBeLessThan(entries.length);
		expect(result?.stats).toContain("Groups");

		// Verify complete was called
		expect(mockComplete).toHaveBeenCalled();

		// Verify the system prompt was passed
		const [choice, systemPrompt] = at(mockComplete.mock.calls, 0);
		expect(systemPrompt).toContain("compaction agent");
		expect(choice).toBe(MOCK_MODEL_CHOICE);
	});

	it("returns null when no tool groups found", async () => {
		const entries = [userMessage("hello"), assistantText("hi")];
		const ctx = mockCommandContext();

		const result = await compactTools(entries, entries, 0, ctx);

		expect(result).toBeNull();
		expect(mockComplete).not.toHaveBeenCalled();
	});

	it("returns null when user cancels", async () => {
		mockPickModel.mockResolvedValue(MOCK_MODEL_CHOICE);
		const entries = multiTurnConversation();
		const ctx = mockCommandContext();
		ctx.ui.confirm.mockResolvedValue(false);

		const result = await compactTools(entries, entries, 0, ctx);

		expect(result).toBeNull();
		expect(mockComplete).not.toHaveBeenCalled();
	});
});

// --- compactTurns (mocked complete) ---

describe("compactTurns", () => {
	it("calls complete for each turn group and returns rebuilt entries", async () => {
		mockPickModel.mockResolvedValue(MOCK_MODEL_CHOICE);
		mockCompleteResponse("[user] Read files\n[outcome] Files read");

		const entries = multiTurnConversation();
		const ctx = mockCommandContext();

		const result = await compactTurns(entries, entries, 0, ctx);

		expect(result).not.toBeNull();
		expect(result?.rebuilt.length).toBeLessThan(entries.length);
		expect(result?.stats).toContain("Groups");

		// Verify complete was called for each group
		expect(mockComplete).toHaveBeenCalled();

		// Verify the system prompt contains turn compaction instructions
		const [choice, systemPrompt] = at(mockComplete.mock.calls, 0);
		expect(systemPrompt).toContain("conversation compaction agent");
		expect(choice).toBe(MOCK_MODEL_CHOICE);
	});

	it("passes formatted turn content to complete", async () => {
		mockPickModel.mockResolvedValue(MOCK_MODEL_CHOICE);
		mockCompleteResponse("[user] summary\n[outcome] done");

		const entries = multiTurnConversation();
		const ctx = mockCommandContext();

		await compactTurns(entries, entries, 0, ctx);

		// The user message sent to complete should contain turn content
		const [, , messages] = at(mockComplete.mock.calls, 0);
		const userMsg = at(messages as unknown[], 0) as { content: string };
		expect(userMsg.content).toContain("[user]");
	});

	it("returns null when user cancels", async () => {
		const entries = multiTurnConversation();
		const ctx = mockCommandContext();
		ctx.ui.confirm.mockResolvedValue(false);

		const result = await compactTurns(entries, entries, 0, ctx);

		expect(result).toBeNull();
		expect(mockComplete).not.toHaveBeenCalled();
	});

	it("returns null with empty entries", async () => {
		const ctx = mockCommandContext();

		const result = await compactTurns([], [], 0, ctx);

		expect(result).toBeNull();
	});
});
