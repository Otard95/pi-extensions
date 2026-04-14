/**
 * Guards Extension
 *
 * Prevents common tool misuse patterns:
 *
 * - Bash write guard: When write/edit tools are unavailable (e.g. read-only
 *   modes), blocks bash commands that attempt to write files via cat, tee,
 *   sed -i, etc. Prevents the model from bypassing tool restrictions.
 *
 * - Bash tool guard: Blocks bash commands that duplicate dedicated tools
 *   (cat → read, grep/rg → grep tool) to encourage proper tool usage.
 *
 * - Glob guard: Blocks grep/find from searching overly broad paths
 *   (/, /home, $HOME, /nix, etc.) or root-anchored glob patterns.
 */

import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
	ExtensionAPI,
	ToolCallEvent,
} from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

// Paths that are too broad to ever search recursively
const BLOCKED_PATHS = [
	"/",
	"/home",
	homedir(),
	"/nix",
	"/etc",
	"/usr",
	"/var",
	"/tmp",
	"/opt",
	"/run",
	"/sys",
	"/proc",
];

// Patterns that write to files via bash
const WRITE_PATTERNS: { pattern: RegExp; description: string }[] = [
	{ pattern: /\bcat\s*>/, description: "cat > (redirect to file)" },
	{ pattern: /\btee\s/, description: "tee (write to file)" },
	{ pattern: /\bsed\s+-i/, description: "sed -i (in-place edit)" },
	{ pattern: /\bawk\s+-i\s+inplace\b/, description: "awk inplace" },
	{ pattern: /\bperl\s+-[a-zA-Z]*i/, description: "perl -i (in-place edit)" },
	{ pattern: /\bdd\s+.*\bof=/, description: "dd of= (write to file)" },
	{
		pattern: />\s*(?!\/dev\/null\b)[^\s|&;]/,
		description: "> (redirect to file)",
	},
	{ pattern: /\bmv\s/, description: "mv (move/rename file)" },
	{ pattern: /\bcp\s/, description: "cp (copy file)" },
	{ pattern: /\bmkdir\s/, description: "mkdir (create directory)" },
	{ pattern: /\btouch\s/, description: "touch (create file)" },
	{ pattern: /\bchmod\s/, description: "chmod (change permissions)" },
	{ pattern: /\bchown\s/, description: "chown (change ownership)" },
	{ pattern: /\brm\s/, description: "rm (remove file)" },
	{ pattern: /\brmdir\s/, description: "rmdir (remove directory)" },
	{ pattern: /\bln\s/, description: "ln (create link)" },
	{ pattern: /\bpatch\s/, description: "patch (apply patch)" },
	{
		pattern:
			/\bgit\s+(add|commit|push|checkout|reset|rebase|merge|stash|cherry-pick|revert)\b/,
		description: "git write operation",
	},
];

// Patterns that duplicate dedicated tools
const TOOL_DUPLICATE_PATTERNS: {
	pattern: RegExp;
	tool: string;
	description: string;
}[] = [
	{
		// Matches file-reading commands at the start of a command
		pattern: /^\s*(cat|less|more|head|tail|bat)\b/,
		tool: "read",
		description:
			"Use the Read tool instead of cat/less/more/head/tail/bat. It handles large files, line ranges, and images.",
	},
	{
		// Matches file-reading commands after && or ; e.g. "cd dir && cat file.ts"
		pattern:
			/&&\s*(cat|less|more|head|tail|bat)\b|;\s*(cat|less|more|head|tail|bat)\b/,
		tool: "read",
		description:
			"Use the Read tool instead of cat/less/more/head/tail/bat. Do not use cd && cat to circumvent this.",
	},
	{
		// Matches grep/rg at the start of a command
		pattern: /^\s*(grep|rg|ripgrep)\b/,
		tool: "grep",
		description: "Use the Grep tool instead of grep/rg/ripgrep in bash.",
	},
	{
		// Matches grep/rg after && or ; e.g. "cd dir && grep ..."
		pattern: /&&\s*(grep|rg|ripgrep)\b|;\s*(grep|rg|ripgrep)\b/,
		tool: "grep",
		description:
			"Use the Grep tool instead of grep/rg in bash. Do not use cd && grep to circumvent this.",
	},
	{
		// Matches xargs grep/rg e.g. "find . | xargs grep ..."
		pattern: /\bxargs\s+(grep|rg|ripgrep)\b/,
		tool: "grep",
		description: "Use the Grep tool instead of xargs grep/rg in bash.",
	},
	{
		// Matches grep/rg in subshells e.g. "(cd dir && grep ...)"
		pattern: /\(\s*cd\b[^)]*\b(grep|rg|ripgrep)\b/,
		tool: "grep",
		description:
			"Use the Grep tool instead of grep/rg/ripgrep in bash subshells.",
	},
];

type BlockResult = { block: true; reason: string } | undefined;

function checkBashGuards(
	event: ToolCallEvent,
	activeTools: string[],
): BlockResult {
	if (!isToolCallEventType("bash", event)) return;

	const command: string = event.input.command || "";
	const hasWrite =
		activeTools.includes("write") || activeTools.includes("edit");

	// 1. Bash write guard: block file-writing commands when write/edit tools are unavailable
	if (!hasWrite) {
		for (const { pattern, description } of WRITE_PATTERNS) {
			if (pattern.test(command)) {
				return {
					block: true,
					reason:
						`Blocked: "${description}" — file modifications are not allowed in the current mode. ` +
						`The write and edit tools are disabled. Do not attempt to bypass this restriction ` +
						`through bash, sed, awk, or any other workaround. ` +
						`Inform the user if this action is needed so they can switch modes.`,
				};
			}
		}
	}

	// 2. Bash tool guard: nudge toward dedicated tools
	for (const { pattern, tool, description } of TOOL_DUPLICATE_PATTERNS) {
		if (pattern.test(command) && activeTools.includes(tool)) {
			return {
				block: true,
				reason: `Blocked: ${description}`,
			};
		}
	}
}

function checkGlobGuard(event: ToolCallEvent, cwd: string): BlockResult {
	if (
		!isToolCallEventType("grep", event) &&
		!isToolCallEventType("find", event)
	)
		return;

	const input = event.input as { path?: string; pattern?: string };

	if (input.path) {
		const resolved = resolve(cwd, input.path).replace(/\/+$/, "") || "/";

		if (BLOCKED_PATHS.includes(resolved)) {
			return {
				block: true,
				reason:
					`Blocked ${event.toolName}: path "${input.path}" resolves to "${resolved}" which is too broad. ` +
					`Use a more specific directory.`,
			};
		}
	}

	if (input.pattern && /^\/.*\*\*/.test(input.pattern)) {
		return {
			block: true,
			reason:
				`Blocked ${event.toolName}: pattern "${input.pattern}" searches from filesystem root. ` +
				`Use a relative pattern or set a specific path.`,
		};
	}
}

export default function guardsExtension(pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		return (
			checkBashGuards(event, pi.getActiveTools()) ??
			checkGlobGuard(event, ctx.cwd)
		);
	});
}
