/**
 * Shared settings management utility
 *
 * Provides type-safe loading of extension settings from settings.json
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Result } from "./monad/result.js";

/**
 * Load typed settings from settings.json
 *
 * Reads `~/.config/pi/settings.json` or `.pi/settings.json` and extracts
 * the specified key. Optionally validates against a TypeBox schema.
 *
 * @param key - Top-level key in settings.json (e.g., "voiceInput", "searxng")
 * @param schema - Optional TypeBox schema for validation
 * @returns Result with parsed settings or error
 *
 * @example
 * ```ts
 * import { Type, type Static } from "@sinclair/typebox";
 *
 * const VoiceInputSchema = Type.Object({
 *   modelPath: Type.Optional(Type.String()),
 *   modelSearchPaths: Type.Optional(Type.Array(Type.String())),
 * });
 *
 * type VoiceInputSettings = Static<typeof VoiceInputSchema>;
 *
 * // With default fallback
 * const settings = loadSettings<VoiceInputSettings>("voiceInput", VoiceInputSchema)
 *   .unwrapOr({});
 *
 * // Or handle errors explicitly
 * const result = loadSettings<VoiceInputSettings>("voiceInput", VoiceInputSchema);
 * if (result.isErr()) {
 *   console.error("Settings error:", result.unwrapErr());
 * }
 * ```
 */
export function loadSettings<T extends Record<string, unknown>>(
	key: string,
	schema?: TSchema,
): Result<T, Error> {
	return Result.try(() => {
		const settingsPath = join(getAgentDir(), "settings.json");

		// Return empty if file doesn't exist (not an error)
		if (!existsSync(settingsPath)) {
			return {} as T;
		}

		// Parse settings.json
		const raw = readFileSync(settingsPath, "utf-8");
		const parsed = JSON.parse(raw);

		// Validate root is an object
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new Error("settings.json root must be an object");
		}

		// Extract key
		const value = parsed[key];

		// Key doesn't exist (not an error - return empty)
		if (value === undefined) {
			return {} as T;
		}

		// Validate value is an object
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			throw new Error(`settings.json["${key}"] must be an object`);
		}

		// Optional schema validation
		if (schema) {
			if (!Value.Check(schema, value)) {
				const errors = [...Value.Errors(schema, value)]
					.map((e) => `${e.path}: ${e.message}`)
					.join(", ");
				throw new Error(`settings.json["${key}"] validation failed: ${errors}`);
			}
		}

		return value as T;
	});
}
