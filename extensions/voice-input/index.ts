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
import { cleanupTranscript } from "./cleanup.js";
import { findWhisperModel, getRecommendedModelPath } from "./model-finder.js";
import { loadSettings } from "./settings.js";
import { transcribe } from "./transcriber.js";

const audioRecorder = createAudioRecorder();

/** Transcription event history for debugging */
interface TranscriptionEvent {
	timestamp: number;
	raw: string;
	cleaned: string;
	cleanupAttempted: boolean;
	cleanupModelId?: string;
	cleanupProvider?: string;
	cleanupSelection?: "override" | "auto";
	cleanupDurationMs?: number;
	cleanupChanged?: boolean;
	cleanupCharDiff?: number;
	cleanupError?: string;
}

const transcriptionHistory: TranscriptionEvent[] = [];
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
					const rawText = await transcribe(recordingFile, settings, ctx);
					recordingFile = null;

					// TODO: Implement streaming - transcribe → cleanup could stream
					// Currently sequential: audio → whisper → wait → LLM cleanup → wait → insert
					// Ideal: audio → whisper (streaming) → LLM cleanup (streaming) → insert chunks

					// Clean up transcript with LLM (uses conversation context)
					ctx.ui.setStatus("voice-input", "🔄 Cleaning up transcription...");
					const cleanup = await cleanupTranscript(rawText, settings, ctx);
					const text = cleanup.text;

					// Store event for debugging
					transcriptionHistory.push({
						timestamp: Date.now(),
						raw: rawText,
						cleaned: text,
						cleanupAttempted: cleanup.attempted,
						cleanupModelId: cleanup.modelId,
						cleanupProvider: cleanup.provider,
						cleanupSelection: cleanup.selection,
						cleanupDurationMs: cleanup.durationMs,
						cleanupChanged: cleanup.changed,
						cleanupCharDiff: cleanup.charDiff,
						cleanupError: cleanup.error,
					});
					// Keep only last 10 events
					if (transcriptionHistory.length > 10) {
						transcriptionHistory.shift();
					}

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
				const rawText = await transcribe(filePath, settings, ctx);

				// Clean up transcript
				ctx.ui.setStatus("voice-input", "🔄 Cleaning up transcription...");
				const cleanup = await cleanupTranscript(rawText, settings, ctx);
				const text = cleanup.text;

				// Store event for debugging
				transcriptionHistory.push({
					timestamp: Date.now(),
					raw: rawText,
					cleaned: text,
					cleanupAttempted: cleanup.attempted,
					cleanupModelId: cleanup.modelId,
					cleanupProvider: cleanup.provider,
					cleanupSelection: cleanup.selection,
					cleanupDurationMs: cleanup.durationMs,
					cleanupChanged: cleanup.changed,
					cleanupCharDiff: cleanup.charDiff,
					cleanupError: cleanup.error,
				});
				// Keep only last 10 events
				if (transcriptionHistory.length > 10) {
					transcriptionHistory.shift();
				}

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

	// Debug command - show transcription history
	pi.registerCommand("voice-debug", {
		description: "Show transcription history (raw vs cleaned)",
		handler: async (_args, ctx) => {
			if (transcriptionHistory.length === 0) {
				ctx.ui.notify("No transcription history yet", "info");
				return;
			}

			let msg = `Transcription History (${transcriptionHistory.length} events):\n\n`;

			transcriptionHistory.forEach((event, i) => {
				const time = new Date(event.timestamp).toLocaleTimeString();
				const cleanup = event.cleanupAttempted ? "attempted" : "skipped";

				msg += `[${i + 1}] ${time}\n`;
				msg += `  Cleanup: ${cleanup}\n`;
				if (event.cleanupModelId) msg += `  Model: ${event.cleanupModelId}\n`;
				if (event.cleanupProvider)
					msg += `  Provider: ${event.cleanupProvider}\n`;
				if (event.cleanupSelection)
					msg += `  Selection: ${event.cleanupSelection}\n`;
				if (event.cleanupDurationMs !== undefined)
					msg += `  Duration: ${event.cleanupDurationMs}ms\n`;
				if (event.cleanupChanged !== undefined)
					msg += `  Changed: ${event.cleanupChanged ? "YES" : "NO"}\n`;
				if (event.cleanupCharDiff !== undefined)
					msg += `  Char diff: ${event.cleanupCharDiff}\n`;
				if (event.cleanupError) msg += `  Error: ${event.cleanupError}\n`;
				msg += `  Raw: ${event.raw}\n`;
				msg += `  Cleaned: ${event.cleaned}\n`;
				msg += `\n`;
			});

			ctx.ui.notify(msg, "info");
		},
	});

	// Temporary auth debug command - inspect what getApiKeyAndHeaders returns per provider
	pi.registerCommand("auth-debug", {
		description: "Show auth status for all available models (debug)",
		handler: async (_args, ctx) => {
			const available = ctx.modelRegistry.getAvailable();
			let msg = `Auth debug (${available.length} available models):\n\n`;

			for (const model of available) {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				msg += `${model.provider}/${model.id}\n`;
				msg += `  ok:      ${auth.ok}\n`;
				msg += `  apiKey:  ${auth.ok && auth.apiKey ? `${auth.apiKey.slice(0, 8)}...` : "(none)"}\n`;
				msg += `  headers: ${auth.ok && auth.headers && Object.keys(auth.headers).length > 0 ? JSON.stringify(Object.keys(auth.headers)) : "(none)"}\n`;
				msg += "\n";
			}

			ctx.ui.notify(msg, "info");
		},
	});
}
