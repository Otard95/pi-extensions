/**
 * Filesystem Tools Extension
 *
 * Activates pi's built-in grep, find, and ls tools in the default coding
 * tool-set.
 *
 * ## Why
 *
 * These tools exist in pi as part of `readOnlyTools` but are not included in
 * the default coding session, which only activates `read`, `bash`, `edit`, and
 * `write`. Since `bash` can run `rg`, `find`, and `ls` directly, the dedicated
 * tools are redundant from a pure capability standpoint — but they are
 * meaningfully better for LLM use for three reasons:
 *
 * 1. **Bounded output.** Each tool caps its output (grep: 100 matches / 50KB,
 *    find: 1000 results / 50KB, ls: 500 entries / 50KB) and tells the LLM when
 *    results were truncated. Raw bash output has no such limits and can fill the
 *    context window on large codebases.
 *
 * 2. **Respects .gitignore.** All three tools run through ripgrep's ignore
 *    logic, so node_modules, dist, and other gitignored paths are excluded
 *    automatically. Bash equivalents do not do this unless you add explicit
 *    filters every time.
 *
 * 3. **Fine-grained control.** Dedicated tools can be toggled per mode
 *    independently of bash. This is what allows the guards extension to block
 *    raw bash grep/rg usage while keeping bash available for everything else.
 *
 * ## Interaction with guards
 *
 * The guards extension blocks bash grep/rg calls only when the grep tool is
 * active. Without this extension, that guard has no effect in coding mode
 * because grep is never in the active tool-set.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const TOOLS_TO_ACTIVATE = ["grep", "find", "ls"] as const;

export default function filesystemToolsExtension(pi: ExtensionAPI) {
	function ensureToolsActive(): void {
		try {
			const current = pi.getActiveTools();
			const missing = TOOLS_TO_ACTIVATE.filter((t) => !current.includes(t));
			if (missing.length > 0) {
				pi.setActiveTools([...current, ...missing]);
			}
		} catch {
			// API not yet initialised — will be picked up on the next event
		}
	}

	// Fires on startup, /reload, /new, /resume, /fork
	pi.on("session_start", () => {
		ensureToolsActive();
	});
}
