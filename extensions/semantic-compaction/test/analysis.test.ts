import { beforeEach, describe, expect, it } from "vitest";
import {
	assistantdMessageHasText,
	classifyAssistant,
	findToolGroups,
	isAssistantMessage,
	isMessageEntry,
	isUserMessage,
	splitIntoTurns,
	stripToolCalls,
} from "../analysis";
import {
	assistantMixed,
	assistantText,
	assistantToolCall,
	multiTurnConversation,
	resetIds,
	simpleConversation,
	toolResult,
	userMessage,
} from "./fixtures";

beforeEach(() => {
	resetIds();
});

// --- Classification helpers ---

describe("isMessageEntry", () => {
	it("returns true for message entries", () => {
		expect(isMessageEntry(userMessage("hi"))).toBe(true);
	});

	it("returns false for non-message entries", () => {
		const entry = {
			id: "1",
			parentId: "0",
			type: "model_change" as const,
			timestamp: "",
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			modelId: "claude-sonnet-4-20250514",
		};
		expect(isMessageEntry(entry)).toBe(false);
	});
});

describe("isUserMessage", () => {
	it("returns true for user messages", () => {
		expect(isUserMessage(userMessage("hello"))).toBe(true);
	});

	it("returns false for assistant messages", () => {
		expect(isUserMessage(assistantText("hi"))).toBe(false);
	});
});

describe("isAssistantMessage", () => {
	it("returns true for assistant messages", () => {
		expect(isAssistantMessage(assistantText("hello"))).toBe(true);
	});

	it("returns true for assistant tool call messages", () => {
		expect(
			isAssistantMessage(
				assistantToolCall({ name: "Read", args: { path: "x" } }),
			),
		).toBe(true);
	});

	it("returns false for user messages", () => {
		expect(isAssistantMessage(userMessage("hi"))).toBe(false);
	});
});

describe("assistantdMessageHasText", () => {
	it("returns true when assistant message has text content", () => {
		expect(assistantdMessageHasText(assistantText("hello"))).toBe(true);
	});

	it("returns false for pure tool call messages", () => {
		const entry = assistantToolCall({ name: "Read", args: { path: "x" } });
		expect(assistantdMessageHasText(entry)).toBe(false);
	});

	it("returns true for mixed messages", () => {
		const entry = assistantMixed("thinking...", {
			name: "Read",
			args: { path: "x" },
		});
		expect(assistantdMessageHasText(entry)).toBe(true);
	});

	it("returns false for user messages", () => {
		expect(assistantdMessageHasText(userMessage("hi"))).toBe(false);
	});
});

describe("classifyAssistant", () => {
	it("classifies pure text as context", () => {
		expect(classifyAssistant(assistantText("hello"))).toBe("context");
	});

	it("classifies pure tool calls as toolcall", () => {
		const entry = assistantToolCall({ name: "Read", args: { path: "x" } });
		expect(classifyAssistant(entry)).toBe("toolcall");
	});

	it("classifies text + tool calls as mixed", () => {
		const entry = assistantMixed("I'll read that", {
			name: "Read",
			args: { path: "x" },
		});
		expect(classifyAssistant(entry)).toBe("mixed");
	});

	it("classifies non-assistant messages as context", () => {
		expect(classifyAssistant(userMessage("hi"))).toBe("context");
	});
});

// --- stripToolCalls ---

describe("stripToolCalls", () => {
	it("removes tool calls from mixed messages", () => {
		const entry = assistantMixed("some text", {
			name: "Read",
			args: { path: "x" },
		});
		const stripped = stripToolCalls(entry);
		expect(stripped).toMatchObject({
			type: "message",
			message: {
				role: "assistant",
				content: [{ type: "text" }],
			},
		});
	});

	it("returns entry unchanged for non-assistant messages", () => {
		const entry = userMessage("hi");
		expect(stripToolCalls(entry)).toBe(entry);
	});

	it("does not mutate the original entry", () => {
		const entry = assistantMixed("text", {
			name: "Read",
			args: { path: "x" },
		});
		stripToolCalls(entry);
		expect(entry).toMatchObject({
			message: {
				role: "assistant",
				content: [{ type: "text" }, { type: "toolCall" }],
			},
		});
	});
});

// --- splitIntoTurns ---

describe("splitIntoTurns", () => {
	it("splits on user messages", () => {
		const entries = simpleConversation();
		const turns = splitIntoTurns(entries);
		expect(turns).toHaveLength(1);
		expect(turns[0]).toHaveLength(4);
	});

	it("splits multi-turn conversations", () => {
		const entries = multiTurnConversation();
		const turns = splitIntoTurns(entries);
		expect(turns).toHaveLength(2);
	});

	it("first entry of each turn is a user message", () => {
		const entries = multiTurnConversation();
		const turns = splitIntoTurns(entries);
		for (const turn of turns) {
			expect(isUserMessage(turn[0]!)).toBe(true);
		}
	});

	it("handles empty input", () => {
		expect(splitIntoTurns([])).toEqual([]);
	});

	it("handles entries before first user message", () => {
		const entries = [
			assistantText("preamble"),
			userMessage("hello"),
			assistantText("hi"),
		];
		const turns = splitIntoTurns(entries);
		// Preamble is in its own "turn" (no user message start)
		expect(turns).toHaveLength(2);
		expect(turns[0]).toHaveLength(1); // preamble
		expect(turns[1]).toHaveLength(2); // user + assistant
	});
});

// --- findToolGroups ---

describe("findToolGroups", () => {
	it("finds a simple tool group", () => {
		const entries = simpleConversation();
		const groups = findToolGroups(entries);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.toolEntries).toHaveLength(2); // toolCall + toolResult
		expect(groups[0]!.mixedStart).toBe(false);
	});

	it("identifies pre-context", () => {
		const entries = simpleConversation();
		const groups = findToolGroups(entries);
		expect(groups[0]!.preContext).toMatchObject({
			type: "message",
			message: { role: "user" },
		});
	});

	it("identifies post-context", () => {
		const entries = simpleConversation();
		const groups = findToolGroups(entries);
		expect(groups[0]!.postContext).toMatchObject({
			type: "message",
			message: { role: "assistant" },
		});
	});

	it("finds multiple tool groups in a turn", () => {
		const entries = [
			userMessage("do two things"),
			assistantToolCall({ name: "Read", args: { path: "a.ts" } }),
			toolResult("Read", "content a"),
			assistantText("Found it. Now the next one."),
			assistantToolCall({ name: "Read", args: { path: "b.ts" } }),
			toolResult("Read", "content b"),
			assistantText("Done with both."),
		];
		const groups = findToolGroups(entries);
		expect(groups).toHaveLength(2);
	});

	it("detects mixed start", () => {
		const entries = [
			userMessage("edit this"),
			assistantMixed("I'll update it", {
				name: "Edit",
				args: { path: "x", content: "new" },
			}),
			toolResult("Edit", "OK"),
		];
		const groups = findToolGroups(entries);
		expect(groups).toHaveLength(1);
		expect(groups[0]!.mixedStart).toBe(true);
	});

	it("uses mixed entry as pre-context", () => {
		const entries = [
			userMessage("edit this"),
			assistantMixed("I'll update it", {
				name: "Edit",
				args: { path: "x", content: "new" },
			}),
			toolResult("Edit", "OK"),
		];
		const groups = findToolGroups(entries);
		expect(groups[0]!.preContext).toBe(entries[1]);
	});

	it("handles consecutive tool calls", () => {
		const entries = [
			userMessage("read everything"),
			assistantToolCall({ name: "Read", args: { path: "a.ts" } }),
			toolResult("Read", "a"),
			assistantToolCall({ name: "Read", args: { path: "b.ts" } }),
			toolResult("Read", "b"),
			assistantText("Here's what I found."),
		];
		const groups = findToolGroups(entries);
		// Consecutive tool calls should form one group
		expect(groups).toHaveLength(1);
		expect(groups[0]!.toolEntries).toHaveLength(4);
	});

	it("returns empty for entries with no tool calls", () => {
		const entries = [userMessage("hello"), assistantText("hi there")];
		const groups = findToolGroups(entries);
		expect(groups).toEqual([]);
	});

	it("has positive token estimates", () => {
		const entries = simpleConversation();
		const groups = findToolGroups(entries);
		expect(groups[0]!.tokenEstimate).toBeGreaterThan(0);
	});
});
