/**
 * Settings Management
 *
 * Loads voice input configuration from settings.json
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

export interface VoiceInputSettings {
	/** Absolute path to whisper model file (skips auto-detection) */
	modelPath?: string;
	/** Additional directories to search for models (checked before defaults) */
	modelSearchPaths?: string[];
}

/**
 * Load voice input settings from settings.json
 *
 * Looks for "voiceInput" key in ~/.config/pi/settings.json or .pi/settings.json
 */
export function loadSettings(): VoiceInputSettings {
	const settingsPath = join(getAgentDir(), "settings.json");
	if (!existsSync(settingsPath)) return {};

	try {
		const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
		if (typeof raw !== "object" || raw === null || Array.isArray(raw))
			return {};

		const voiceInput = raw["voiceInput"];
		if (
			typeof voiceInput === "object" &&
			voiceInput !== null &&
			!Array.isArray(voiceInput)
		) {
			return voiceInput as VoiceInputSettings;
		}
	} catch {
		// Ignore parse errors
	}

	return {};
}
