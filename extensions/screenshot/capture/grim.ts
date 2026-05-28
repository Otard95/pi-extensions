/**
 * Grim Capture Provider
 *
 * Uses `grim` directly for both full-screen and region capture.
 * Works on any wlroots-based Wayland compositor (Hyprland, Sway, River, etc.).
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptureProvider, CaptureResult, Rect } from "../types.js";
import { exec, isLinux, resolveBin } from "../utils.js";

// ── Binary Resolution ─────────────────────────────────────────────────────────

let compat: { ok: boolean; grim: string | null } | null = null;

async function checkCompat() {
	if (compat) return compat;

	if (!isLinux()) {
		compat = { ok: false, grim: null };
		return compat;
	}

	const grim = await resolveBin("grim");
	compat = { ok: !!grim, grim };
	return compat;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let counter = 0;

function tempPath(): string {
	return join(tmpdir(), `pi-screenshot-${Date.now()}-${counter++}.png`);
}

// ── Provider ──────────────────────────────────────────────────────────────────

export const grimCapture: CaptureProvider = {
	name: "grim",

	async isCompatible(): Promise<boolean> {
		return (await checkCompat()).ok;
	},

	async captureAll(): Promise<CaptureResult> {
		const { ok, grim } = await checkCompat();
		if (!ok || !grim) {
			throw new Error("Grim capture provider not compatible");
		}

		const path = tempPath();
		const result = await exec(grim, ["-t", "png", path]);
		if (result.code !== 0) {
			throw new Error(
				`grim capture failed (exit ${result.code}): ${result.stderr}`,
			);
		}

		return { path, format: "png" };
	},

	async captureRegion(rect: Rect): Promise<CaptureResult> {
		const { ok, grim } = await checkCompat();
		if (!ok || !grim) {
			throw new Error("Grim capture provider not compatible");
		}

		const geom = `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
		const path = tempPath();
		const result = await exec(grim, ["-g", geom, "-t", "png", path]);
		if (result.code !== 0) {
			throw new Error(
				`grim region capture failed (exit ${result.code}): ${result.stderr}`,
			);
		}

		return { path, format: "png" };
	},
};
