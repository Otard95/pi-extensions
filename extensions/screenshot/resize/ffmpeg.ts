/**
 * FFmpeg Resize Provider
 *
 * Uses `ffmpeg` to downscale images. Widely available as a fallback
 * when ImageMagick is not installed.
 */

import { rename, unlink } from "node:fs/promises";
import type { ResizeProvider } from "../types.js";
import { exec, resolveBin } from "../utils.js";

// ── Binary Resolution ─────────────────────────────────────────────────────────

let compat: { ok: boolean; bin: string | null } | null = null;

async function checkCompat() {
	if (compat) return compat;

	const bin = await resolveBin("ffmpeg");
	compat = { ok: !!bin, bin };
	return compat;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export const ffmpegResize: ResizeProvider = {
	name: "ffmpeg",

	async isCompatible(): Promise<boolean> {
		return (await checkCompat()).ok;
	},

	async resize(path: string, maxDimension: number): Promise<string> {
		const { ok, bin } = await checkCompat();
		if (!ok || !bin) {
			throw new Error("FFmpeg resize provider not compatible");
		}

		// Scale down to fit within maxDimension, preserving aspect ratio.
		// gte on width so equal dimensions still get handled (the other
		// axis uses -2 to auto-calculate proportionally).
		const filter =
			`scale='if(gte(iw,ih),min(iw,${maxDimension}),-2)':` +
			`'if(gt(ih,iw),min(ih,${maxDimension}),-2)'`;

		const outPath = `${path}.resized.png`;
		const result = await exec(bin, ["-y", "-i", path, "-vf", filter, outPath]);
		if (result.code !== 0) {
			throw new Error(
				`FFmpeg resize failed (exit ${result.code}): ${result.stderr}`,
			);
		}

		await unlink(path).catch(() => {});
		await rename(outPath, path);
		return path;
	},
};
