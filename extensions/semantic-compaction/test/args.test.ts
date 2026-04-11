import { describe, expect, it } from "vitest";
import { parseArgs, parseMode, SemanticCompactKeepMode } from "../args";

describe("parseMode", () => {
	it.each(["tool", "tools"])("parses '%s' as tools mode", (input) => {
		expect(parseMode(input)).toBe("tools");
	});

	it.each(["turn", "turns"])("parses '%s' as turns mode", (input) => {
		expect(parseMode(input)).toBe("turns");
	});

	it("throws on unrecognized mode", () => {
		expect(() => parseMode("invalid")).toThrow("Unrecognized mode");
	});
});

describe("parseArgs", () => {
	it("returns defaults for empty string", () => {
		const result = parseArgs("");
		expect(result).toEqual({
			mode: "tools",
			threshold: 500,
			keep: {
				type: SemanticCompactKeepMode.Percent,
				value: 20,
			},
		});
	});

	it("parses mode only", () => {
		const result = parseArgs("turns");
		expect(result.mode).toBe("turns");
		// keep should still be default
		expect(result.keep.type).toBe(SemanticCompactKeepMode.Percent);
		expect(result.keep.value).toBe(20);
	});

	it("parses mode with keep percent shorthand", () => {
		const result = parseArgs("tools keep 50%");
		expect(result.mode).toBe("tools");
		expect(result.keep).toEqual({
			type: SemanticCompactKeepMode.Percent,
			value: 50,
		});
	});

	it("parses keep without mode (defaults to tools)", () => {
		const result = parseArgs("keep 30%");
		expect(result.mode).toBe("tools");
		expect(result.keep).toEqual({
			type: SemanticCompactKeepMode.Percent,
			value: 30,
		});
	});

	it("parses keep with messages mode", () => {
		const result = parseArgs("keep messages 10");
		expect(result.keep).toEqual({
			type: SemanticCompactKeepMode.Messages,
			value: 10,
		});
	});

	it("parses keep with turns mode", () => {
		const result = parseArgs("keep turns 3");
		expect(result.keep).toEqual({
			type: SemanticCompactKeepMode.Turns,
			value: 3,
		});
	});

	it("parses keep with message aliases", () => {
		for (const alias of ["m", "msg", "msgs", "message", "messages"]) {
			const result = parseArgs(`keep ${alias} 5`);
			expect(result.keep.type).toBe(SemanticCompactKeepMode.Messages);
			expect(result.keep.value).toBe(5);
		}
	});

	it("parses keep with percent aliases", () => {
		for (const alias of ["p", "perc", "percent"]) {
			const result = parseArgs(`keep ${alias} 25`);
			expect(result.keep.type).toBe(SemanticCompactKeepMode.Percent);
			expect(result.keep.value).toBe(25);
		}
	});

	it("'%' alias for keep mode 'percent' should not be treated as the percent value itself", () => {
		expect(() => parseArgs("keep % 25")).not.toThrow();
		expect(parseArgs("keep % 25").keep).toEqual({
			type: SemanticCompactKeepMode.Percent,
			value: 25,
		});

		expect(parseArgs("keep 50%").keep).toEqual({
			type: SemanticCompactKeepMode.Percent,
			value: 50,
		});
	});

	it("parses keep with turn aliases", () => {
		for (const alias of ["t", "turn", "turns"]) {
			const result = parseArgs(`keep ${alias} 4`);
			expect(result.keep.type).toBe(SemanticCompactKeepMode.Turns);
			expect(result.keep.value).toBe(4);
		}
	});

	it("uses default value when keep mode has no value", () => {
		const result = parseArgs("keep messages");
		expect(result.keep).toEqual({
			type: SemanticCompactKeepMode.Messages,
			value: 50,
		});
	});

	it("uses default value for turns when no value given", () => {
		const result = parseArgs("keep turns");
		expect(result.keep).toEqual({
			type: SemanticCompactKeepMode.Turns,
			value: 2,
		});
	});

	it("throws on invalid percent value", () => {
		expect(() => parseArgs("keep percent 150")).toThrow(
			"Percentages must be an integer between 0 and 100",
		);
	});

	it("throws on negative percent", () => {
		expect(() => parseArgs("keep percent -5")).toThrow(
			"Percentages must be an integer between 0 and 100",
		);
	});

	it("throws on extra arguments", () => {
		expect(() => parseArgs("tools keep turns 3 extra")).toThrow(
			"Unable to parse arguments",
		);
	});

	it("throws on unrecognized keep mode", () => {
		expect(() => parseArgs("keep invalid")).toThrow("not a recognized mode");
	});

	it("parses full args: mode + keep", () => {
		const result = parseArgs("turns keep messages 20");
		expect(result).toEqual({
			mode: "turns",
			threshold: 500,
			keep: {
				type: SemanticCompactKeepMode.Messages,
				value: 20,
			},
		});
	});
});
