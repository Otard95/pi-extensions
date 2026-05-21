import { describe, expect, it } from "vitest";
import {
	buildSessionName,
	normalizeWhitespace,
	sanitizeModelTitle,
	sentenceCase,
	truncate,
} from "../index";

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

describe("buildSessionName", () => {
	it("returns the task directly", () => {
		expect(buildSessionName("Fix auth")).toBe("Fix auth");
	});

	it("truncates long tasks", () => {
		const longTask = "A".repeat(100);
		const result = buildSessionName(longTask);
		expect(result.length).toBeLessThanOrEqual(72);
	});
});
