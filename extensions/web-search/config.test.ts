import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { WebSearchSettingsSchema } from "./config.js";

describe("WebSearchSettingsSchema", () => {
	it("accepts rate limits for named providers", () => {
		expect(
			Value.Check(WebSearchSettingsSchema, {
				"rate-limit": {
					brave: [{ count: 10, window: { m: 1 } }],
					duckduckgo: [
						{
							count: 1,
							window: { s: 30 },
							message: "Wait before another search.",
						},
					],
				},
			}),
		).toBe(true);
	});

	it("rejects an empty window", () => {
		expect(
			Value.Check(WebSearchSettingsSchema, {
				"rate-limit": { brave: [{ count: 1, window: {} }] },
			}),
		).toBe(false);
	});
});
