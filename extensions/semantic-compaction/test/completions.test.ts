import { describe, expect, it } from "vitest";
import { completions } from "../completions";

describe("completions", () => {
	it("offers both compaction modes", () => {
		expect(completions("")).toBeNull();
		expect(completions("t")).toContainEqual(
			expect.objectContaining({ value: "turns", label: "turns" }),
		);
	});

	it("offers keep after turns mode", () => {
		expect(completions("turns k")).toEqual([
			expect.objectContaining({ value: "turns keep", label: "keep" }),
		]);
	});
});
