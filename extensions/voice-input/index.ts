/**
 * Voice Input Extension
 *
 * Ctrl+.  → Record & transcribe voice input
 * Alt+.   → Toggle cleanup agent on/off (configurable via "ext.voiceInput.toggleCleanup" in keybindings.json)
 *
 * Recordings are serial (one at a time), but transcription+cleanup jobs run in
 * parallel and are consumed in order via TranscriptionQueue.
 */

import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { KeyId } from "@mariozechner/pi-tui";
import { createAudioRecorder } from "./audio-recorder.js";
import { findWhisperModel, getRecommendedModelPath } from "./model-finder.js";
import { type JobResult, TranscriptionQueue } from "./queue.js";
import { loadSettings, type VoiceInputSettings } from "./settings.js";

const audioRecorder = createAudioRecorder();
const queue = new TranscriptionQueue();

/**
 * Runtime cleanup toggle. null = follow settings, otherwise overrides
 * settings.cleanup.enabled for the duration of the session.
 */
let cleanupEnabledOverride: boolean | null = null;

/** Guarded so only one consumer loop runs at a time. */
let consuming = false;

let recordingProcess: ChildProcess | null = null;
let recordingFile: string | null = null;

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadKeybindings(): Record<string, string | string[]> {
	const kbPath = join(getAgentDir(), "keybindings.json");
	if (!existsSync(kbPath)) return {};
	try {
		const raw = JSON.parse(readFileSync(kbPath, "utf-8"));
		if (typeof raw === "object" && raw !== null && !Array.isArray(raw))
			return raw;
	} catch {}
	return {};
}

function applyCleanupOverride(
	settings: VoiceInputSettings,
): VoiceInputSettings {
	if (cleanupEnabledOverride === null) return settings;
	return {
		...settings,
		cleanup: { ...settings.cleanup, enabled: cleanupEnabledOverride },
	};
}

// ── Recording ─────────────────────────────────────────────────────────────────

async function startRecording(ctx: ExtensionContext): Promise<void> {
	const tempDir = await mkdtemp(join(tmpdir(), "voice-"));
	const audioFile = join(tempDir, "recording.wav");

	recordingProcess = await audioRecorder.startRecording(audioFile);

	recordingProcess.on("error", (err) => {
		ctx.ui.notify(`❌ Recording error: ${err.message}`, "error");
		recordingProcess = null;
		recordingFile = null;
	});

	recordingFile = audioFile;
	ctx.ui.notify(`🎤 Recording to: ${audioFile}`, "info");
	ctx.ui.setStatus("voice-input", "🎤 Recording...");
}

async function stopRecording(): Promise<void> {
	if (!recordingProcess) return;
	const process = recordingProcess;
	recordingProcess = null;
	await audioRecorder.stopRecording(process);
}

// ── Queue consumer ────────────────────────────────────────────────────────────

function pushHistory(result: JobResult): void {
	transcriptionHistory.push({
		timestamp: Date.now(),
		raw: result.raw,
		cleaned: result.text,
		cleanupAttempted: result.cleanupAttempted,
		cleanupModelId: result.cleanupModelId,
		cleanupProvider: result.cleanupProvider,
		cleanupSelection: result.cleanupSelection,
		cleanupDurationMs: result.cleanupDurationMs,
		cleanupChanged: result.cleanupChanged,
		cleanupCharDiff: result.cleanupCharDiff,
		cleanupError: result.error,
	});
	if (transcriptionHistory.length > 10) transcriptionHistory.shift();
}

async function consumeQueue(ctx: ExtensionContext): Promise<void> {
	if (consuming) return;
	consuming = true;

	let result: JobResult | null;
	while ((result = await queue.next()) !== null) {
		pushHistory(result);

		if (result.error === "empty transcript") {
			await unlink(result.file).catch(() => {});
			continue;
		}

		if (result.error && !result.text) {
			ctx.ui.notify(
				`❌ Transcription failed: ${result.error}. Recording kept: ${result.file}`,
				"error",
			);
			continue;
		}

		if (result.text) {
			await unlink(result.file).catch(() => {});
			ctx.ui.pasteToEditor(result.text);
			ctx.ui.notify("✅ Transcribed", "info");
		} else {
			ctx.ui.notify(`⚠️ No speech detected. Check: ${result.file}`, "warning");
		}
	}

	ctx.ui.setStatus("voice-input", undefined);
	consuming = false;
}

// ── Extension Setup ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerShortcut("ctrl+.", {
		description: "Voice input (record & transcribe)",
		handler: async (ctx) => {
			if (recordingProcess) {
				ctx.ui.setStatus("voice-input", "🔄 Stopping...");
				await stopRecording();

				if (!recordingFile) {
					ctx.ui.setStatus("voice-input", undefined);
					ctx.ui.notify("❌ No recording file", "error");
					return;
				}

				const file = recordingFile;
				recordingFile = null;

				const settings = applyCleanupOverride(loadSettings());
				queue.enqueue(file, settings, ctx);
				ctx.ui.setStatus(
					"voice-input",
					`🔄 Transcribing... (${queue.size} queued)`,
				);
				consumeQueue(ctx);
			} else {
				try {
					await startRecording(ctx);
				} catch (err) {
					ctx.ui.notify(`❌ Recording failed: ${err}`, "error");
				}
			}
		},
	});

	// Keybind to toggle cleanup on/off at runtime.
	// Override the default via "ext.voiceInput.toggleCleanup" in keybindings.json.
	const userBindings = loadKeybindings();
	const toggleCleanupKey = (userBindings["ext.voiceInput.toggleCleanup"] ??
		"alt+.") as KeyId;

	pi.registerShortcut(toggleCleanupKey, {
		description: "Toggle voice input cleanup agent on/off",
		handler: (ctx) => {
			const settings = loadSettings();
			const current =
				cleanupEnabledOverride ?? settings.cleanup?.enabled ?? true;
			cleanupEnabledOverride = !current;
			ctx.ui.notify(
				`🧹 Cleanup ${cleanupEnabledOverride ? "enabled" : "disabled"}`,
				"info",
			);
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

			const file = args.trim();
			ctx.ui.notify(`💾 Transcribing: ${file}`, "info");

			const settings = applyCleanupOverride(loadSettings());
			queue.enqueue(file, settings, ctx);
			ctx.ui.setStatus(
				"voice-input",
				`🔄 Transcribing... (${queue.size} queued)`,
			);
			consumeQueue(ctx);
		},
	});

	// Configuration command - show current setup
	pi.registerCommand("voice-config", {
		description: "Show voice input configuration",
		handler: async (_args, ctx) => {
			const settings = loadSettings();
			const recommended = getRecommendedModelPath();

			let msg = "Voice Input Configuration:\n\n";

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

			if (settings.modelSearchPaths?.length) {
				msg += `\nCustom search paths:\n`;
				for (const path of settings.modelSearchPaths) {
					msg += `  - ${path}\n`;
				}
			}

			msg += `\nRecommended install location: ${recommended}`;
			msg += `\nCleanup: ${cleanupEnabledOverride !== null ? `${cleanupEnabledOverride} (runtime override)` : `${settings.cleanup?.enabled ?? true} (from settings)`}`;

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
