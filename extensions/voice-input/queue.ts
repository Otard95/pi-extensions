/**
 * Transcription Queue
 *
 * Each recording is immediately handed off as an in-flight job. Jobs run in
 * parallel but results are consumed in enqueue order, so multi-recording
 * sessions are always pasted in the correct sequence.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { cleanupTranscript } from "./cleanup.js";
import type { VoiceInputSettings } from "./settings.js";
import { transcribe } from "./transcriber.js";

export type JobResult = {
	/** Audio file path — kept on error for debugging, deleted on success */
	file: string;
	raw: string;
	text: string;
	cleanupAttempted: boolean;
	cleanupModelId?: string;
	cleanupProvider?: string;
	cleanupSelection?: "override" | "auto";
	cleanupDurationMs?: number;
	cleanupChanged?: boolean;
	cleanupCharDiff?: number;
	/** Set when transcription or cleanup threw — text will be empty */
	error?: string;
};

async function runJob(
	file: string,
	settings: VoiceInputSettings,
	ctx: ExtensionContext,
): Promise<JobResult> {
	try {
		const raw = await transcribe(file, settings, ctx);
		const cleanup = await cleanupTranscript(raw, settings, ctx);
		return {
			file,
			raw,
			text: cleanup.text,
			cleanupAttempted: cleanup.attempted,
			cleanupModelId: cleanup.modelId,
			cleanupProvider: cleanup.provider,
			cleanupSelection: cleanup.selection,
			cleanupDurationMs: cleanup.durationMs,
			cleanupChanged: cleanup.changed,
			cleanupCharDiff: cleanup.charDiff,
			error: cleanup.error,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			file,
			raw: "",
			text: "",
			cleanupAttempted: false,
			error: message,
		};
	}
}

export class TranscriptionQueue {
	private jobs: Promise<JobResult>[] = [];

	enqueue(
		file: string,
		settings: VoiceInputSettings,
		ctx: ExtensionContext,
	): void {
		this.jobs.push(runJob(file, settings, ctx));
	}

	async next(): Promise<JobResult | null> {
		if (this.jobs.length === 0) return null;
		const result = await this.jobs[0];
		this.jobs.shift();
		return result ?? null;
	}

	get size(): number {
		return this.jobs.length;
	}
}
