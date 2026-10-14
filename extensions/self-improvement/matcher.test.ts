import { describe, expect, it } from "vitest";
import { matchesRule, matchesTouchedFile } from "./matcher";
import type { Rule } from "./types";

function rule(when: Rule["when"]): Rule {
	return {
		id: "rule",
		text: "Use the rule.",
		when,
		state: "active",
		scratchpad: "",
		citations: [],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

describe("matchesRule", () => {
	it("matches when an always trigger matches", () => {
		expect(matchesRule(rule([{ kind: "always" }]), "/work/project")).toBe(true);
	});

	it("does not load touched-file rules before a matching tool call", () => {
		expect(
			matchesRule(
				rule([{ kind: "touched-file", glob: "src/**/*.ts" }]),
				"/work/project",
			),
		).toBe(false);
	});
});

describe("matchesTouchedFile", () => {
	it("matches a touched-file glob", () => {
		expect(
			matchesTouchedFile(
				rule([{ kind: "touched-file", glob: "src/**/*.ts" }]),
				"src/main.ts",
			),
		).toBe(true);
	});
});
