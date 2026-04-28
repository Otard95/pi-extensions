/**
 * Whisper Model Path Resolution
 *
 * Platform-specific model search paths
 */
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Get platform-specific model search paths
 *
 * Priority order:
 * 1. User-specific data directory (recommended install location)
 * 2. System-wide data directory
 * 3. Current working directory (for development/testing)
 */
function getModelSearchPaths(): string[] {
	const home = homedir();
	const os = platform();

	const modelNames = [
		"ggml-base.en.bin",
		"ggml-base.bin",
		"ggml-tiny.en.bin",
		"ggml-tiny.bin",
		"ggml-small.en.bin",
		"ggml-small.bin",
		"ggml-medium.en.bin",
		"ggml-medium.bin",
	];

	let searchDirs: string[] = [];

	switch (os) {
		case "darwin": // macOS
			searchDirs = [
				join(home, "Library/Application Support/whisper"),
				"/Library/Application Support/whisper",
				"/usr/local/share/whisper",
			];
			break;

		case "win32": // Windows
			// APPDATA and LOCALAPPDATA are typically set on Windows
			searchDirs = [
				join(
					process.env["LOCALAPPDATA"] || join(home, "AppData", "Local"),
					"whisper",
				),
				join(
					process.env["APPDATA"] || join(home, "AppData", "Roaming"),
					"whisper",
				),
				join(process.env["PROGRAMDATA"] || "C:\\ProgramData", "whisper"),
			];
			break;

		default: // Linux and others
			searchDirs = [
				join(home, ".local/share/whisper"), // XDG Base Directory
				"/usr/local/share/whisper",
				"/usr/share/whisper",
			];
			break;
	}

	// Add current directory as fallback (for development)
	searchDirs.push("./models");
	searchDirs.push(".");

	// Generate full paths: dir + model combinations
	const paths: string[] = [];
	for (const dir of searchDirs) {
		for (const model of modelNames) {
			paths.push(join(dir, model));
		}
	}

	return paths;
}

/**
 * Find first available Whisper model
 *
 * @param customPaths - Optional custom search paths to check first
 * @returns Path to first readable model file, or undefined if none found
 */
export async function findWhisperModel(
	customPaths?: string[],
): Promise<string | undefined> {
	// Custom paths get priority
	const candidates = [...(customPaths || []), ...getModelSearchPaths()];

	for (const path of candidates) {
		try {
			await access(path, constants.R_OK);
			return path;
		} catch {
			// Try next path
		}
	}

	return undefined;
}

/**
 * Get recommended model install location for current platform
 */
export function getRecommendedModelPath(): string {
	const home = homedir();
	const os = platform();

	switch (os) {
		case "darwin":
			return join(home, "Library/Application Support/whisper");
		case "win32":
			return join(
				process.env["LOCALAPPDATA"] || join(home, "AppData", "Local"),
				"whisper",
			);
		default:
			return join(home, ".local/share/whisper");
	}
}
