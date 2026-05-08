/**
 * Grimblast Capture Provider
 *
 * Uses `grimblast` for full-screen capture and `grim -g` for region capture.
 * Works on any wlroots-based Wayland compositor (Hyprland, Sway, River, etc.).
 *
 * `grim` is resolved from grimblast's nix wrapper PATH as a fallback
 * when it isn't directly on PATH.
 */

import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptureProvider, CaptureResult, Rect } from "../types.js";
import { exec, isLinux, resolveBin } from "../utils.js";

// ── Binary Resolution ─────────────────────────────────────────────────────────

interface CachedCompat {
	ok: boolean;
	grimblast: string | null;
	grim: string | null;
}

let compat: CachedCompat | null = null;

/**
 * Try to extract grim's nix store path from grimblast's wrapper script.
 * Grimblast on NixOS prepends grim's store path to PATH in the wrapper.
 */
async function resolveGrimFromWrapper(
	grimblastPath: string,
): Promise<string | null> {
	try {
		const content = await readFile(grimblastPath, "utf-8");
		const match = content.match(/\/nix\/store\/[a-z0-9]+-grim-[^/]+\/bin/);
		if (match?.[0]) {
			return `${match[0]}/grim`;
		}
	} catch {
		// Wrapper not readable — fine, degrade
	}
	return null;
}

async function checkCompat(): Promise<CachedCompat> {
	if (compat) return compat;

	if (!isLinux()) {
		compat = { ok: false, grimblast: null, grim: null };
		return compat;
	}

	const grimblast = await resolveBin("grimblast");
	if (!grimblast) {
		compat = { ok: false, grimblast: null, grim: null };
		return compat;
	}

	// Try PATH first, then extract from grimblast wrapper
	let grim = await resolveBin("grim");
	if (!grim) {
		grim = await resolveGrimFromWrapper(grimblast);
	}

	compat = { ok: true, grimblast, grim };
	return compat;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let counter = 0;

function tempPath(): string {
	return join(tmpdir(), `pi-screenshot-${Date.now()}-${counter++}.png`);
}

// ── Provider ──────────────────────────────────────────────────────────────────

export const grimblastCapture: CaptureProvider = {
	name: "grimblast",

	async isCompatible(): Promise<boolean> {
		return (await checkCompat()).ok;
	},

	async captureAll(): Promise<CaptureResult> {
		const { ok, grimblast } = await checkCompat();
		if (!ok || !grimblast) {
			throw new Error("Grimblast capture provider not compatible");
		}

		const path = tempPath();
		const result = await exec(grimblast, ["save", "screen", path]);
		if (result.code !== 0) {
			throw new Error(
				`grimblast save screen failed (exit ${result.code}): ${result.stderr}`,
			);
		}

		return { path, format: "png" };
	},

	async captureRegion(rect: Rect): Promise<CaptureResult> {
		const { ok, grimblast, grim } = await checkCompat();
		if (!ok || !grimblast) {
			throw new Error("Grimblast capture provider not compatible");
		}

		const geom = `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
		const path = tempPath();

		if (grim) {
			// Direct grim call with geometry — cleanest path
			const result = await exec(grim, ["-g", geom, "-t", "png", path]);
			if (result.code !== 0) {
				throw new Error(
					`grim region capture failed (exit ${result.code}): ${result.stderr}`,
				);
			}
		} else {
			// Fallback: run grim through grimblast's env
			// grimblast doesn't expose arbitrary region, so we shell through its PATH
			const result = await exec("bash", [
				"-c",
				`source <(head -60 "${grimblast}") 2>/dev/null; grim -g '${geom}' -t png '${path}'`,
			]);
			if (result.code !== 0) {
				throw new Error(
					`grim region capture (via grimblast env) failed (exit ${result.code}): ${result.stderr}`,
				);
			}
		}

		return { path, format: "png" };
	},
};
