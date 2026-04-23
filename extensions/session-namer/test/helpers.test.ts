import { describe, expect, it } from "vitest";
import {
	buildSessionName,
	heuristicTask,
	normalizeWhitespace,
	sanitizeModelTitle,
	sentenceCase,
	truncate,
} from "../index.js";

describe("normalizeWhitespace", () => {
	it("collapses multiple spaces", () => {
		expect(normalizeWhitespace("  hello   world  ")).toBe("hello world");
	});

	it("collapses newlines and tabs", () => {
		expect(normalizeWhitespace("hello\n\tworld")).toBe("hello world");
	});

	it("returns empty string for whitespace-only input", () => {
		expect(normalizeWhitespace("   ")).toBe("");
	});
});

describe("sentenceCase", () => {
	it("capitalizes the first character", () => {
		expect(sentenceCase("fix the bug")).toBe("Fix the bug");
	});

	it("preserves already capitalized text", () => {
		expect(sentenceCase("Fix the bug")).toBe("Fix the bug");
	});

	it("returns empty string for empty input", () => {
		expect(sentenceCase("")).toBe("");
	});
});

describe("truncate", () => {
	it("returns text unchanged if within limit", () => {
		expect(truncate("short", 10)).toBe("short");
	});

	it("truncates and adds ellipsis", () => {
		const result = truncate("this is a long string", 10);
		expect(result.length).toBeLessThanOrEqual(10);
		expect(result).toMatch(/…$/);
	});

	it("handles exact length", () => {
		expect(truncate("exact", 5)).toBe("exact");
	});
});

describe("sanitizeModelTitle", () => {
	it("strips surrounding quotes", () => {
		expect(sanitizeModelTitle('"Fix auth redirect"')).toBe("Fix auth redirect");
	});

	it("strips backtick quotes", () => {
		expect(sanitizeModelTitle("`Fix auth redirect`")).toBe("Fix auth redirect");
	});

	it("strips trailing punctuation", () => {
		expect(sanitizeModelTitle("Fix auth redirect.")).toBe("Fix auth redirect");
	});

	it("returns null for empty input", () => {
		expect(sanitizeModelTitle("")).toBeNull();
	});

	it("returns null for whitespace-only input", () => {
		expect(sanitizeModelTitle("   ")).toBeNull();
	});

	it("normalizes whitespace", () => {
		expect(sanitizeModelTitle("  Fix   auth  redirect  ")).toBe(
			"Fix auth redirect",
		);
	});
});

describe("heuristicTask", () => {
	it("extracts first sentence", () => {
		expect(heuristicTask("Fix the login bug. Also check the tests.")).toBe(
			"Fix the login bug",
		);
	});

	it("caps at 8 words", () => {
		const result = heuristicTask(
			"one two three four five six seven eight nine ten",
		);
		expect(result.split(" ").length).toBeLessThanOrEqual(8);
	});

	it("returns default for empty input", () => {
		expect(heuristicTask("")).toBe("General work");
	});

	it("strips trailing punctuation", () => {
		expect(heuristicTask("Fix the bug!")).toBe("Fix the bug");
	});

	it("takes first line of multiline input", () => {
		expect(heuristicTask("Fix the bug\nAlso check tests")).toBe("Fix the bug");
	});

	it("sentence-cases the result", () => {
		expect(heuristicTask("fix the bug")).toBe("Fix the bug");
	});

	it("returns default for whitespace-only input", () => {
		expect(heuristicTask("   ")).toBe("General work");
	});
});

describe("buildSessionName", () => {
	it("formats as repo: task", () => {
		expect(buildSessionName("/home/user/my-repo", "Fix auth")).toBe(
			"my-repo: Fix auth",
		);
	});

	it("uses 'session' for empty cwd", () => {
		expect(buildSessionName("", "Fix auth")).toBe("session: Fix auth");
	});

	it("falls back to default task", () => {
		expect(buildSessionName("/home/user/repo", "")).toBe("repo: General work");
	});

	it("truncates long tasks", () => {
		const longTask = "A".repeat(100);
		const result = buildSessionName("/repo", longTask);
		expect(result.length).toBeLessThanOrEqual(72);
	});
});
