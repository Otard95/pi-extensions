import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
	createLocalState,
	getTouchedFilePath,
	RULE_ENTRY_TYPE,
} from "./session";

describe("createLocalState", () => {
	it("restores loaded rule IDs from session entries", () => {
		const entries = [
			{
				type: "message",
				message: {
					role: "custom",
					customType: RULE_ENTRY_TYPE,
					details: { ruleIds: ["first", "second"] },
				},
			},
		] as unknown as SessionEntry[];

		expect(createLocalState(entries).loadedRuleIds).toEqual(
			new Set(["first", "second"]),
		);
	});
});

describe("getTouchedFilePath", () => {
	it("gets paths for read, write, and edit only", () => {
		expect(getTouchedFilePath("read", { path: "src/read.ts" })).toBe(
			"src/read.ts",
		);
		expect(getTouchedFilePath("write", { path: "src/write.ts" })).toBe(
			"src/write.ts",
		);
		expect(getTouchedFilePath("edit", { path: "src/edit.ts" })).toBe(
			"src/edit.ts",
		);
		expect(getTouchedFilePath("bash", { path: "src/bash.ts" })).toBeUndefined();
	});
});
