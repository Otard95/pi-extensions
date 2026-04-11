/**
 * Modes Extension
 *
 * Switch between custom modes defined as markdown files in ~/.pi/agent/modes/.
 * Each mode appends its content to the system prompt, optionally restricting
 * tools and setting a model.
 *
 * Mode files use frontmatter for metadata and the body as the system prompt addition:
 *
 * ```markdown
 * ---
 * name: plan
 * description: Read-only planning mode
 * tools: read, bash, grep, find, ls
 * model: claude-sonnet-4-5
 * ---
 *
 * You are in PLANNING MODE. Analyze the codebase and create a detailed plan...
 * ```
 *
 * Usage:
 *   /mode           - show mode selector (or clear mode)
 *   /mode plan      - switch to "plan" mode directly
 *   Ctrl+Shift+M    - cycle through modes
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { ModeManager } from "./manager.js";
import { loadModes, type ModeConfig } from "./modes.js";

export type { ModeConfig } from "./modes.js";

export default function modesExtension(pi: ExtensionAPI) {
	const mgr = new ModeManager(pi);

	// --- Commands ---

	pi.registerCommand("mode", {
		description: "Switch mode or clear active mode",
		getArgumentCompletions(prefix: string) {
			const modes = loadModes();
			const items = [
				{ value: "off", label: "off — clear active mode" },
				...modes.map((m) => ({
					value: m.name,
					label: `${m.name}${m.description ? ` — ${m.description}` : ""}`,
				})),
			];
			if (!prefix) return items;
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const modes = loadModes();

			if (modes.length === 0) {
				ctx.ui.notify(
					`No modes found. Create .md files in ${path.join(getAgentDir(), "modes")}/`,
					"warning",
				);
				return;
			}

			// Direct argument: /mode plan or /mode off
			if (args?.trim()) {
				const arg = args.trim().toLowerCase();
				if (arg === "off" || arg === "clear" || arg === "none") {
					mgr.deactivate(ctx);
					return;
				}
				const mode = modes.find((m) => m.name.toLowerCase() === arg);
				if (mode) {
					await mgr.activate(mode, ctx);
					return;
				}
				ctx.ui.notify(
					`Unknown mode: "${args.trim()}". Available: ${modes.map((m) => m.name).join(", ")}`,
					"warning",
				);
				return;
			}

			// Interactive selector
			const options = [
				...(mgr.activeMode ? ["✕  Clear mode"] : []),
				...modes.map((m) => {
					const active = mgr.activeMode?.name === m.name ? " ●" : "";
					const tools = m.tools ? ` [${m.tools.join(", ")}]` : "";
					const model = m.model ? ` (${m.model})` : "";
					return `${m.name}${active}  ${m.description || ""}${model}${tools}`;
				}),
			];

			const choice = await ctx.ui.select("Switch mode:", options);
			if (!choice) return;

			if (choice.startsWith("✕")) {
				mgr.deactivate(ctx);
				return;
			}

			const chosenName = choice.split(/\s/)[0];
			const mode = modes.find((m) => m.name === chosenName);
			if (mode) {
				await mgr.activate(mode, ctx);
			}
		},
	});

	// --- Keyboard shortcut: cycle modes ---

	pi.registerShortcut(Key.ctrlShift("m"), {
		description: "Cycle through modes",
		handler: async (ctx) => {
			const modes = loadModes();
			if (modes.length === 0) return;

			mgr.captureDefaults();

			if (!mgr.activeMode) {
				await mgr.activate(modes[0] as ModeConfig, ctx);
				return;
			}

			const currentIndex = modes.findIndex(
				(m) => m.name === mgr.activeMode?.name,
			);
			if (currentIndex === modes.length - 1) {
				mgr.deactivate(ctx);
				return;
			}

			const nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
			await mgr.activate(modes[nextIndex] as ModeConfig, ctx);
		},
	});

	// --- System prompt injection + mode switch context ---

	pi.on("before_agent_start", async (event) => {
		const currentName = mgr.activeMode?.name ?? null;
		const switched = mgr.previousModeName !== currentName;
		mgr.previousModeName = currentName;

		if (!switched && !mgr.activeMode) return;

		const ret: {
			systemPrompt?: string;
			message?: { customType: string; content: string; display: boolean };
		} = {};

		if (mgr.activeMode?.systemPrompt)
			ret.systemPrompt =
				event.systemPrompt + "\n\n" + mgr.activeMode.systemPrompt;

		if (switched)
			ret.message = {
				customType: "mode-switch",
				content: mgr.activeMode
					? `Mode switched to "${mgr.activeMode.name}". You now have different capabilities and constraints. Review the system prompt for your current role.`
					: `Mode cleared — default settings restored. You now have full tool access. Review the system prompt for your current role.`,
				display: false,
			};

		return ret;
	});

	// --- Restore state on session start ---

	pi.on("session_start", async (_event, ctx) => {
		mgr.restore(ctx);
	});
}
