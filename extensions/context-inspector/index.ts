/**
 * Context Inspector Extension
 *
 * Interactive panel for inspecting conversation context: system prompt,
 * session entries, messages, tool calls/results, compaction summaries, etc.
 *
 * Usage:
 *   /context         - open the context inspector panel
 *   Ctrl+Shift+I     - shortcut to open inspector
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { ContextInspector } from "./inspector.js";

export default function contextInspectorExtension(pi: ExtensionAPI) {
	const openInspector = async (ctx: ExtensionContext) => {
		if (!ctx.hasUI) {
			ctx.ui.notify("Context inspector requires interactive mode", "warning");
			return;
		}

		const systemPrompt = ctx.getSystemPrompt();
		const entries = ctx.sessionManager.getEntries();
		const branch = ctx.sessionManager.getBranch();
		const header = ctx.sessionManager.getHeader();
		const leafId = ctx.sessionManager.getLeafId();
		const sessionFile = ctx.sessionManager.getSessionFile();
		const sessionName = ctx.sessionManager.getSessionName();
		const usage = ctx.getContextUsage();

		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) => {
				const inspector = new ContextInspector({
					systemPrompt,
					entries,
					branch,
					header: header ?? {
						type: "session",
						version: 3,
						id: "?",
						timestamp: "",
						cwd: "",
					},
					leafId,
					sessionFile,
					sessionName,
					usage,
					theme,
					tui,
					onClose: () => done(undefined),
				});
				return inspector;
			},
			{ overlay: true, overlayOptions: { width: "80%" } },
		);
	};

	pi.registerCommand("context", {
		description: "Open the context inspector panel",
		handler: async (_args, ctx) => {
			await openInspector(ctx);
		},
	});

	pi.registerShortcut("ctrl+shift+i", {
		description: "Open context inspector",
		handler: async (ctx) => {
			await openInspector(ctx);
		},
	});
}
