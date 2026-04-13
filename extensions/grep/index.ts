/**
 * Grep Extension
 *
 * Pi ships a built-in `grep` tool (part of readOnlyTools) but does not
 * include it in the default coding tool-set.  This extension activates it
 * on every session so the LLM always has it available, and the guards
 * extension can block raw `grep`/`rg` bash calls in its favour.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function grepExtension(pi: ExtensionAPI) {
	function ensureGrepActive(): void {
		try {
			const current = pi.getActiveTools();
			if (!current.includes("grep")) {
				pi.setActiveTools([...current, "grep"]);
			}
		} catch {
			// API not yet initialised — will be picked up on the next event
		}
	}

	// Fires on startup, /reload, /new, /resume, /fork
	pi.on("session_start", () => {
		ensureGrepActive();
	});
}
