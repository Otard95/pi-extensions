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
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

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
		pattern: /^\s*cat\b/,
		tool: "read",
		description:
			"Use the Read tool instead of cat. It handles large files, line ranges, and images.",
	},
	{
		pattern: /^\s*less\b/,
		tool: "read",
		description: "Use the Read tool instead of less.",
	},
	{
		pattern: /^\s*more\b/,
		tool: "read",
		description: "Use the Read tool instead of more.",
	},
	{
		pattern: /^\s*head\b/,
		tool: "read",
		description: "Use the Read tool with offset/limit instead of head.",
	},
	{
		pattern: /^\s*tail\b/,
		tool: "read",
		description: "Use the Read tool with offset/limit instead of tail.",
	},
	{
		pattern: /^\s*(rg|ripgrep)\b/,
		tool: "grep",
		description: "Use the Grep tool instead of rg/ripgrep in bash.",
	},
	{
		pattern: /^\s*grep\b/,
		tool: "grep",
		description: "Use the Grep tool instead of grep in bash.",
	},
	{
		pattern: /^\s*bat\b/,
		tool: "read",
		description: "Use the Read tool instead of bat.",
	},
];

export default function guardsExtension(pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		if (!isToolCallEventType("bash", event)) return;

		const command: string = event.input.command || "";
		const activeTools = pi.getActiveTools();
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
	});
}
