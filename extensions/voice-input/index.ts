/**
 * Voice Input Extension
 *
 * Ctrl+. → Record & transcribe voice input
 */

import type { ChildProcess } from "node:child_process";
import { mkdtemp, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { createAudioRecorder } from "./audio-recorder.js";
import { findWhisperModel, getRecommendedModelPath } from "./model-finder.js";
import { loadSettings } from "./settings.js";
import { transcribe } from "./transcriber.js";

const audioRecorder = createAudioRecorder();
let recordingProcess: ChildProcess | null = null;
let recordingFile: string | null = null;

// ── Recording Functions ───────────────────────────────────────────────────────

async function startRecording(ctx: ExtensionContext): Promise<string> {
	const tempDir = await mkdtemp(join(tmpdir(), "voice-"));
	const audioFile = join(tempDir, "recording.wav");

	// Use platform-specific recorder
	recordingProcess = await audioRecorder.startRecording(audioFile);

	recordingProcess.on("error", (err) => {
		ctx.ui.notify(`❌ Recording error: ${err.message}`, "error");
		recordingProcess = null;
		recordingFile = null;
	});

	recordingFile = audioFile;
	ctx.ui.notify(`🎤 Recording to: ${audioFile}`, "info");
	ctx.ui.setStatus("voice-input", "🎤 Recording...");

	return audioFile;
}

async function stopRecording(): Promise<void> {
	if (!recordingProcess) {
		return;
	}

	const process = recordingProcess;
	recordingProcess = null;

	// Use platform-specific stop logic
	await audioRecorder.stopRecording(process);
}

// ── Extension Setup ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Main voice input shortcut - record & transcribe
	pi.registerShortcut("ctrl+.", {
		description: "Voice input (record & transcribe)",
		handler: async (ctx) => {
			// Toggle recording
			if (recordingProcess) {
				// Stop recording & transcribe
				ctx.ui.setStatus("voice-input", "🔄 Stopping...");
				await stopRecording();

				if (!recordingFile) {
					ctx.ui.setStatus("voice-input", undefined);
					ctx.ui.notify("❌ No recording file", "error");
					return;
				}

				const savedFile = recordingFile;
				ctx.ui.notify(`💾 Recording saved: ${savedFile}`, "info");

				try {
					const settings = loadSettings();
					const text = await transcribe(recordingFile, settings, ctx);
					recordingFile = null;

					ctx.ui.setStatus("voice-input", undefined);
					if (text) {
						// Success - clean up file
						await unlink(savedFile);
						ctx.ui.pasteToEditor(text);
						ctx.ui.notify("✅ Transcribed", "info");
					} else {
						// No speech - keep file for debugging
						ctx.ui.notify(
							`⚠️ No speech detected. Check: ${savedFile}`,
							"warning",
						);
					}
				} catch (err) {
					ctx.ui.setStatus("voice-input", undefined);
					ctx.ui.notify(
						`❌ Error: ${err}. Recording kept: ${savedFile}`,
						"error",
					);
					recordingFile = null;
				}
			} else {
				// Start recording
				try {
					await startRecording(ctx);
				} catch (err) {
					ctx.ui.notify(`❌ Recording failed: ${err}`, "error");
				}
			}
		},
	});

	// Debug command - transcribe existing file
	pi.registerCommand("transcribe-file", {
		description: "Transcribe an existing audio file (for debugging)",
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify("Usage: /transcribe-file <path-to-wav>", "warning");
				return;
			}

			const filePath = args.trim();
			ctx.ui.notify(`💾 Transcribing: ${filePath}`, "info");

			try {
				const settings = loadSettings();
				const text = await transcribe(filePath, settings, ctx);
				ctx.ui.setStatus("voice-input", undefined);

				if (text) {
					ctx.ui.pasteToEditor(text);
					ctx.ui.notify(`✅ Transcribed: "${text}"`, "info");
				} else {
					ctx.ui.notify("⚠️ No speech detected", "warning");
				}
			} catch (err) {
				ctx.ui.setStatus("voice-input", undefined);
				ctx.ui.notify(`❌ Error: ${err}`, "error");
			}
		},
	});

	// Configuration command - show current setup
	pi.registerCommand("voice-config", {
		description: "Show voice input configuration",
		handler: async (_args, ctx) => {
			const settings = loadSettings();
			const recommended = getRecommendedModelPath();

			let msg = "Voice Input Configuration:\n\n";

			// Model path
			if (settings.modelPath) {
				msg += `Model: ${settings.modelPath} (settings.json)\n`;
			} else {
				const discovered = await findWhisperModel(settings.modelSearchPaths);
				if (discovered) {
					msg += `Model: ${discovered} (auto-detected)\n`;
				} else {
					msg += `Model: Not found\n`;
					msg += `  Download to: ${recommended}\n`;
					msg += `  Command: whisper-cpp-download-ggml-model base.en\n`;
				}
			}

			// Custom search paths
			if (settings.modelSearchPaths?.length) {
				msg += `\nCustom search paths:\n`;
				for (const path of settings.modelSearchPaths) {
					msg += `  - ${path}\n`;
				}
			}

			msg += `\nRecommended install location: ${recommended}`;

			ctx.ui.notify(msg, "info");
		},
	});
}
