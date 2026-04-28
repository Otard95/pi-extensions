/**
 * Audio Recording Abstraction
 *
 * Platform-specific audio recording implementations
 */
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { platform } from "node:os";

export interface AudioRecorder {
	/** Start recording to the specified file path */
	startRecording(outputPath: string): Promise<ChildProcess>;

	/** Stop the recording process gracefully */
	stopRecording(process: ChildProcess): Promise<void>;

	/** Get platform-specific troubleshooting help */
	getTroubleshootingHelp(): string;
}

/**
 * Linux recorder using PulseAudio/PipeWire via ffmpeg
 */
class LinuxRecorder implements AudioRecorder {
	async startRecording(outputPath: string): Promise<ChildProcess> {
		return spawn("ffmpeg", [
			"-f",
			"pulse", // PulseAudio/PipeWire
			"-i",
			"default",
			"-ar",
			"16000", // 16kHz
			"-ac",
			"1", // mono
			"-c:a",
			"pcm_s16le", // 16-bit PCM
			"-y", // overwrite
			outputPath,
		]);
	}

	async stopRecording(process: ChildProcess): Promise<void> {
		return new Promise((resolve) => {
			process.on("close", () => resolve());

			// Send 'q' to ffmpeg for graceful quit
			process.stdin?.write("q");
			process.stdin?.end();

			// Fallback: kill after 1s
			setTimeout(() => {
				if (!process.killed) {
					process.kill("SIGTERM");
				}
			}, 1000);
		});
	}

	getTroubleshootingHelp(): string {
		return `Test microphone:
  ffmpeg -f pulse -i default -t 5 test.wav
  
Check sources:
  pactl list sources`;
	}
}

/**
 * macOS recorder using AVFoundation via ffmpeg
 */
class MacOSRecorder implements AudioRecorder {
	async startRecording(outputPath: string): Promise<ChildProcess> {
		return spawn("ffmpeg", [
			"-f",
			"avfoundation", // macOS CoreAudio
			"-i",
			":0", // default audio input device
			"-ar",
			"16000", // 16kHz
			"-ac",
			"1", // mono
			"-c:a",
			"pcm_s16le", // 16-bit PCM
			"-y", // overwrite
			outputPath,
		]);
	}

	async stopRecording(process: ChildProcess): Promise<void> {
		return new Promise((resolve) => {
			process.on("close", () => resolve());

			// Send 'q' to ffmpeg for graceful quit
			process.stdin?.write("q");
			process.stdin?.end();

			// Fallback: kill after 1s
			setTimeout(() => {
				if (!process.killed) {
					process.kill("SIGTERM");
				}
			}, 1000);
		});
	}

	getTroubleshootingHelp(): string {
		return `Test microphone:
  ffmpeg -f avfoundation -i :0 -t 5 test.wav
  
List audio devices:
  ffmpeg -f avfoundation -list_devices true -i ""`;
	}
}

/**
 * Windows recorder using DirectShow via ffmpeg
 */
class WindowsRecorder implements AudioRecorder {
	async startRecording(outputPath: string): Promise<ChildProcess> {
		return spawn("ffmpeg", [
			"-f",
			"dshow", // DirectShow
			"-i",
			"audio=", // default audio device (will use system default)
			"-ar",
			"16000", // 16kHz
			"-ac",
			"1", // mono
			"-c:a",
			"pcm_s16le", // 16-bit PCM
			"-y", // overwrite
			outputPath,
		]);
	}

	async stopRecording(process: ChildProcess): Promise<void> {
		return new Promise((resolve) => {
			process.on("close", () => resolve());

			// Send 'q' to ffmpeg for graceful quit
			process.stdin?.write("q");
			process.stdin?.end();

			// Fallback: kill after 1s
			setTimeout(() => {
				if (!process.killed) {
					process.kill("SIGTERM");
				}
			}, 1000);
		});
	}

	getTroubleshootingHelp(): string {
		return `Test microphone:
  ffmpeg -f dshow -i audio= -t 5 test.wav
  
List audio devices:
  ffmpeg -f dshow -list_devices true -i dummy`;
	}
}

/**
 * Factory function - returns platform-specific recorder
 */
export function createAudioRecorder(): AudioRecorder {
	const os = platform();

	switch (os) {
		case "darwin":
			return new MacOSRecorder();
		case "win32":
			return new WindowsRecorder();
		default:
			return new LinuxRecorder();
	}
}
