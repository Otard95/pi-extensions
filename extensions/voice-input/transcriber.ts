/**
 * Whisper Transcription
 *
 * Handles audio-to-text transcription using whisper-cpp
 */

import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { findWhisperModel, getRecommendedModelPath } from "./model-finder.js";
import type { VoiceInputSettings } from "./settings.js";

/**
 * Transcribe audio file to text using whisper-cpp
 *
 * @param audioFile - Path to 16kHz mono WAV file
 * @param settings - Voice input settings (for model path configuration)
 * @param ctx - Extension context (for UI notifications)
 * @returns Transcribed text, or empty string if no speech detected
 */
export async function transcribe(
	audioFile: string,
	settings: VoiceInputSettings,
	ctx: ExtensionContext,
): Promise<string> {
	// Priority: explicit modelPath > auto-discovery
	let modelPath = settings.modelPath;

	if (!modelPath) {
		// Auto-discover with optional custom search paths
		modelPath = await findWhisperModel(settings.modelSearchPaths);
	}

	if (!modelPath) {
		const recommended = getRecommendedModelPath();
		throw new Error(
			`Whisper model not found.\n\nOptions:\n` +
				`1. Download: whisper-cpp-download-ggml-model base.en\n` +
				`   (saves to ${recommended})\n` +
				`2. Or set in settings.json:\n` +
				`   "voiceInput": { "modelPath": "/path/to/model.bin" }`,
		);
	}

	ctx.ui.notify("🔄 Transcribing...", "info");

	// Output to temp file for clean parsing
	const outputBase = audioFile.replace(/\.[^.]+$/, ""); // Remove extension
	const transcriptFile = `${outputBase}.txt`;

	return new Promise((resolve, reject) => {
		// whisper-cpp with --output-txt writes clean transcription to file
		const whisper = spawn("whisper-cli", [
			"-m",
			modelPath,
			"-f",
			audioFile,
			"--no-timestamps",
			"--language",
			"en",
			"--output-txt",
			"--output-file",
			outputBase,
			"--no-prints",
		]);

		let stderr = "";

		whisper.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		whisper.on("error", (err) => {
			reject(new Error(`Failed to spawn whisper-cli: ${err.message}`));
		});

		whisper.on("close", async (code) => {
			if (code === 0) {
				try {
					// Read clean transcription from .txt file
					const transcription = await readFile(transcriptFile, "utf-8");
					// Clean up transcript file
					await unlink(transcriptFile).catch(() => {});
					resolve(transcription.trim());
				} catch (err) {
					reject(new Error(`Failed to read transcript: ${err}`));
				}
			} else {
				reject(new Error(`Whisper failed (${code}): ${stderr}`));
			}
		});
	});
}
