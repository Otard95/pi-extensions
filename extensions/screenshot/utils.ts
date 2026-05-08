/**
 * Screenshot Extension – shared utilities
 *
 * Binary resolution, OS detection, and geometry helpers.
 */

import { execFile } from "node:child_process";

// ── OS Detection ──────────────────────────────────────────────────────────────

export function isLinux(): boolean {
	return process.platform === "linux";
}

export function isMacOS(): boolean {
	return process.platform === "darwin";
}

export function isWindows(): boolean {
	return process.platform === "win32";
}

// ── Binary Resolution ─────────────────────────────────────────────────────────

const binCache = new Map<string, string | null>();

/**
 * Resolve a binary name to its full path via `which`.
 * Caches result (including misses) for the process lifetime.
 */
export async function resolveBin(name: string): Promise<string | null> {
	if (binCache.has(name)) return binCache.get(name) ?? null;

	const path = await resolveBinPlatform(name);
	binCache.set(name, path);
	return path;
}

function resolveBinPlatform(name: string): Promise<string | null> {
	// `which` works on Linux and macOS. Windows uses `where`.
	const cmd = isWindows() ? "where" : "which";

	return new Promise((resolve) => {
		execFile(cmd, [name], (err, stdout) => {
			if (err) {
				resolve(null);
				return;
			}
			// `which` returns the path on the first line
			const path = stdout.trim().split("\n")[0]?.trim();
			resolve(path || null);
		});
	});
}

// ── Exec Helper ───────────────────────────────────────────────────────────────

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

/**
 * Run a command and return stdout/stderr/code.
 * Rejects only on spawn failure, not on non-zero exit.
 */
export function exec(
	bin: string,
	args: string[],
	signal?: AbortSignal,
): Promise<ExecResult> {
	return new Promise((resolve, reject) => {
		const child = execFile(bin, args, { signal }, (err, stdout, stderr) => {
			// Spawn failure (binary not found, permission denied, etc.)
			if (err && child.exitCode === null && child.signalCode === null) {
				reject(err);
				return;
			}
			resolve({
				stdout: stdout ?? "",
				stderr: stderr ?? "",
				code: child.exitCode ?? (err ? 1 : 0),
			});
		});
	});
}
