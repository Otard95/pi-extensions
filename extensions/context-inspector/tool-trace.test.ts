import { describe, expect, it } from "vitest";
import { providerToolNames } from "./tool-trace";

describe("providerToolNames", () => {
	it("reads Responses and Anthropic tool names without payload contents", () => {
		expect(
			providerToolNames({
				tools: [{ type: "function", name: "web_read", description: "private" }],
				input: "private prompt",
			}),
		).toEqual(["web_read"]);
	});

	it("reads Chat Completions function definitions", () => {
		expect(
			providerToolNames({ tools: [{ function: { name: "web_read" } }] }),
		).toEqual(["web_read"]);
	});

	it("reads namespaced definitions", () => {
		expect(
			providerToolNames({
				tools: [
					{
						name: "functions",
						tools: [{ name: "web_read" }, { name: "read" }],
					},
				],
			}),
		).toEqual(["functions.read", "functions.web_read"]);
	});

	it("reads Gemini function declarations", () => {
		expect(
			providerToolNames({
				tools: [{ functionDeclarations: [{ name: "web_read" }] }],
			}),
		).toEqual(["web_read"]);
	});

	it("distinguishes absent tool definitions from an empty selection", () => {
		expect(providerToolNames({})).toBeNull();
		expect(providerToolNames(null)).toBeNull();
		expect(providerToolNames({ tools: [] })).toEqual([]);
	});

	it("ignores unnamed built-ins and malformed definitions", () => {
		expect(
			providerToolNames({ tools: [null, "web_read", { type: "web_search" }] }),
		).toEqual([]);
	});
});
