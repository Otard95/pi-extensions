/**
 * Continue Extension
 *
 * Resume the agent after an abort or interruption without sending a user message.
 *
 * Usage:
 *   /continue        - resume the agent from where it left off
 *   /retry           - alias for /continue
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function continueExtension(pi: ExtensionAPI) {
	const resume = () => {
		pi.sendMessage(
			{
				customType: "continue",
				content: "Continue from where you left off.",
				display: false,
			},
			{ triggerTurn: true },
		);
	};

	pi.registerCommand("continue", {
		description: "Resume the agent after an abort/interruption",
		handler: async (_args, _ctx) => {
			resume();
		},
	});

	pi.registerCommand("retry", {
		description: "Alias for /continue",
		handler: async (_args, _ctx) => {
			resume();
		},
	});
}
