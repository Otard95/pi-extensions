/**
 * Settings Management
 *
 * Voice input configuration schema and loader
 */

import { type Static, Type } from "@sinclair/typebox";
import { loadSettings as loadSettingsUtil } from "../../utils/settings.js";

/**
 * Voice input settings schema
 */
export const VoiceInputSchema = Type.Object({
	/** Absolute path to whisper model file (skips auto-detection) */
	modelPath: Type.Optional(Type.String()),
	/** Additional directories to search for models (checked before defaults) */
	modelSearchPaths: Type.Optional(Type.Array(Type.String())),
	/** Post-transcription cleanup via LLM */
	cleanup: Type.Optional(
		Type.Object({
			/** Enable LLM cleanup of transcription */
			enabled: Type.Boolean({ default: true }),
			/** Model override (defaults to fast model picker) */
			model: Type.Optional(Type.String()),
		}),
	),
});

export type VoiceInputSettings = Static<typeof VoiceInputSchema>;

/**
 * Load voice input settings from settings.json
 *
 * Looks for "voiceInput" key in ~/.config/pi/settings.json or .pi/settings.json
 * Validates against VoiceInputSchema.
 */
export function loadSettings(): VoiceInputSettings {
	return loadSettingsUtil<VoiceInputSettings>(
		"voiceInput",
		VoiceInputSchema,
	).unwrapOr({});
}
