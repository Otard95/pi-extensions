/**
 * Protected Files Extension
 *
 * Prevents the agent from reading files that match configured glob patterns.
 *
 * Guarded tools:
 * - read  — blocks any read of a matching path
 * - bash  — blocks any command that contains a token matching a pattern
 *           (strict: `echo ".env"` would be blocked too — acceptable tradeoff
 *            for "strict but safe")
 *
 * Configuration in settings.json:
 *
 *   {
 *     "protected-files": {
 *       "patterns": ["*.env", ".secret*", "secrets/**", "*.pem"]
 *     }
 *   }
 *
 * Patterns use minimatch glob syntax with `{ dot: true }`. Patterns not
 * already prefixed with `**\/` or `/` are automatically prepended with `**\/`
 * so that e.g. `*.env` matches `.env`, `config/.env`, `a/b/c/.env`, etc.
 */

import { existsSync, readFileSync } from "node:fs";
import path, { relative, resolve } from "node:path";
import {
	type ExtensionAPI,
	getAgentDir,
	isToolCallEventType,
	type ToolCallEvent,
} from "@mariozechner/pi-coding-agent";
import { minimatch } from "minimatch";

// ─── Settings ─────────────────────────────────────────────────────────────────

function loadSettings(): Record<string, unknown> {
	const settingsPath = path.join(getAgentDir(), "settings.json");
	if (!existsSync(settingsPath)) return {};
	try {
		const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));
		if (typeof raw === "object" && raw !== null && !Array.isArray(raw))
			return raw;
	} catch {}
	return {};
}

function getPatterns(): string[] {
	const settings = loadSettings();
	const section = settings["protected-files"];
	if (typeof section !== "object" || section === null || Array.isArray(section))
		return [];
	const patterns = (section as Record<string, unknown>)["patterns"];
	if (!Array.isArray(patterns)) return [];
	return patterns
		.filter((p): p is string => typeof p === "string" && p.length > 0)
		.map((p) => (p.startsWith("**/") || p.startsWith("/") ? p : `**/${p}`));
}

// ─── Matching ─────────────────────────────────────────────────────────────────

/**
 * Normalizes a user-supplied pattern. Patterns not already prefixed with
 * a globstar (`*\/`) or root `/` are prepended with `*\/` so that
 * e.g. `*.env` matches at any depth.
 */
export function normalizePattern(pattern: string): string {
	return pattern.startsWith("**/") || pattern.startsWith("/")
		? pattern
		: `**/${pattern}`;
}

/** Returns the first matching pattern, or undefined. */
export function matchesAny(
	filePath: string,
	patterns: string[],
): string | undefined {
	return patterns.find((p) => minimatch(filePath, p, { dot: true }));
}

/**
 * Resolves an input path against cwd and returns a cwd-relative form suitable
 * for glob matching. Falls back to the absolute path if outside cwd.
 */
export function toRelative(inputPath: string, cwd: string): string {
	const abs = resolve(cwd, inputPath);
	const rel = relative(cwd, abs);
	return rel.startsWith("..") ? abs : rel;
}

// ─── Guards ───────────────────────────────────────────────────────────────────

export type BlockResult = { block: true; reason: string } | undefined;

export function checkReadGuard(
	event: ToolCallEvent,
	cwd: string,
	patterns: string[],
): BlockResult {
	if (!isToolCallEventType("read", event)) return;

	const filePath = toRelative(event.input.path, cwd);
	const matched = matchesAny(filePath, patterns);
	if (!matched) return;

	return {
		block: true,
		reason:
			`Blocked: "${event.input.path}" matches protected file pattern "${matched}". ` +
			`Access to this file is not allowed. Do not attempt to read it via any other means.`,
	};
}

export function checkBashGuard(
	event: ToolCallEvent,
	cwd: string,
	patterns: string[],
): BlockResult {
	if (!isToolCallEventType("bash", event)) return;

	const command = event.input.command ?? "";

	// Split on whitespace and check every token. Strict: any mention of a
	// matching filename in the command string is blocked.
	const tokens = command.split(/\s+/).filter((t) => t.length > 0);

	for (const token of tokens) {
		// Skip flags, shell operators, and redirects
		if (token.startsWith("-")) continue;
		if (/^[|&;><(){}[\]$`!]/.test(token)) continue;

		const filePath = toRelative(token, cwd);
		const matched = matchesAny(filePath, patterns);
		if (!matched) continue;

		return {
			block: true,
			reason:
				`Blocked: bash command references "${token}" which matches protected file pattern "${matched}". ` +
				`Access to this file is not allowed. Do not attempt to read it via any other means.`,
		};
	}
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function protectedFilesExtension(pi: ExtensionAPI) {
	const patterns = getPatterns();
	if (patterns.length === 0) return;

	pi.on("tool_call", (event, ctx) => {
		return (
			checkReadGuard(event, ctx.cwd, patterns) ??
			checkBashGuard(event, ctx.cwd, patterns)
		);
	});
}
