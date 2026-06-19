/**
 * ImageMagick Resize Provider
 *
 * Uses `magick` (v7) or `convert` (v6) to downscale images.
 */

import type { ResizeProvider } from "../types.js";
import { exec, resolveBin } from "../utils.js";

// ── Binary Resolution ─────────────────────────────────────────────────────────

let compat: { ok: boolean; bin: string | null } | null = null;

async function checkCompat() {
	if (compat) return compat;

	// v7 uses `magick`, v6 uses `convert`
	const magick = await resolveBin("magick");
	if (magick) {
		compat = { ok: true, bin: magick };
		return compat;
	}

	const convert = await resolveBin("convert");
	compat = { ok: !!convert, bin: convert };
	return compat;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export const imagemagickResize: ResizeProvider = {
	name: "imagemagick",

	async isCompatible(): Promise<boolean> {
		return (await checkCompat()).ok;
	},

	async resize(path: string, maxDimension: number): Promise<string> {
		const { ok, bin } = await checkCompat();
		if (!ok || !bin) {
			throw new Error("ImageMagick resize provider not compatible");
		}

		const constraint = `${maxDimension}x${maxDimension}>`;
		const result = await exec(bin, [path, "-resize", constraint, path]);
		if (result.code !== 0) {
			throw new Error(
				`ImageMagick resize failed (exit ${result.code}): ${result.stderr}`,
			);
		}

		return path;
	},
};
