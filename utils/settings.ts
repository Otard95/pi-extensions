import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Result } from "./monad/result.js";

interface LoadJsonConfigOptions {
	key?: string;
	schema?: TSchema;
}

/**
 * Load typed configuration from a JSON file in the pi config directory.
 *
 * @param filename - File name relative to the pi config dir (e.g., "settings.json", "cloak.json")
 * @param options.key - Optional top-level key to extract before validation
 * @param options.schema - Optional TypeBox schema for validation
 *
 * @example
 * ```ts
 * // Load an entire config file
 * const config = loadJsonConfig<CloakConfig>("cloak.json", {
 *   schema: CloakConfigSchema,
 * }).unwrapOr(defaults);
 *
 * // Load a key from settings.json
 * const settings = loadJsonConfig<VoiceInputSettings>("settings.json", {
 *   key: "voiceInput",
 *   schema: VoiceInputSchema,
 * }).unwrapOr({});
 * ```
 */
export function loadJsonConfig<T>(
	filename: string,
	options?: LoadJsonConfigOptions,
): Result<T, Error> {
	return Result.try(() => {
		const filePath = join(getAgentDir(), filename);

		if (!existsSync(filePath)) {
			throw new Error(`Config file not found: ${filePath}`);
		}

		const raw = readFileSync(filePath, "utf-8");
		let value: unknown = JSON.parse(raw);

		if (options?.key) {
			if (
				typeof value !== "object" ||
				value === null ||
				Array.isArray(value)
			) {
				throw new Error(`${filename} root must be an object`);
			}

			const extracted = (value as Record<string, unknown>)[options.key];
			if (extracted === undefined) {
				throw new Error(
					`Key "${options.key}" not found in ${filename}`,
				);
			}

			value = extracted;
		}

		if (options?.schema) {
			if (!Value.Check(options.schema, value)) {
				const context = options.key
					? `${filename}["${options.key}"]`
					: filename;
				const errors = [...Value.Errors(options.schema, value)]
					.map((e) => `${e.path}: ${e.message}`)
					.join(", ");
				throw new Error(`${context} validation failed: ${errors}`);
			}
		}

		return value as T;
	});
}

/**
 * Load typed settings from a key in settings.json.
 *
 * Convenience wrapper around {@link loadJsonConfig}.
 *
 * @param key - Top-level key in settings.json (e.g., "voiceInput", "searxng")
 * @param schema - Optional TypeBox schema for validation
 */
export function loadSettings<T extends Record<string, unknown>>(
	key: string,
	schema?: TSchema,
): Result<T, Error> {
	return loadJsonConfig<T>("settings.json", { key, schema });
}
