/**
 * Git Awareness Extension
 *
 * Keeps the agent from operating on a stale view of the repository by
 * detecting when git state has changed since the agent last knew about it
 * and blocking the first git mutation of a turn when that happens.
 *
 * The block reason includes the current git state so the agent can orient
 * itself before retrying the operation.
 *
 * Snapshot update strategy (configurable via settings.json):
 *
 *   snapshot_frequency = "turn" (default)
 *     The snapshot is updated at the end of each agent turn if git was
 *     touched during that turn. Only the first mutation per turn is checked;
 *     subsequent mutations are trusted because the agent caused them.
 *
 *   snapshot_frequency = "continuous"
 *     The snapshot is updated after every git command the agent runs (reads
 *     and mutations). Every mutation is checked, but false positives are
 *     avoided because the snapshot stays current throughout the turn.
 *
 * Configuration in settings.json:
 *
 *   {
 *     "git-awareness": {
 *       "snapshotFrequency": "turn"
 *     }
 *   }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import {
	fetchGitState,
	formatGitState,
	isGitCommand,
	isGitMutation,
} from "./git.js";
import { getSnapshotFrequency } from "./settings.js";
import { GitSnapshot } from "./snapshot.js";

export default async function gitAwarenessExtension(pi: ExtensionAPI) {
	const frequency = getSnapshotFrequency();
	const snapshot = new GitSnapshot();

	pi.on("session_start", async () => {
		await snapshot.initialize(pi);
	});

	pi.on("before_agent_start", async () => {
		snapshot.onTurnStart();
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command ?? "";
		if (!isGitMutation(command)) return;

		// In turn mode: only check the first mutation — subsequent ones were
		// caused by the agent itself so it already knows the resulting state.
		if (frequency === "turn" && snapshot.firstMutationHandled) return;

		snapshot.markFirstMutationHandled();
		snapshot.recordGitCommand();

		const state = await fetchGitState(pi, ctx.signal);
		if (!state) return; // not a git repo, or git unavailable

		if (!snapshot.isStale(state)) return;

		snapshot.update(state);

		return {
			block: true,
			reason: [
				"Git state has changed since your last update.",
				"Current state:",
				"",
				formatGitState(state),
				"",
				"Review the above before retrying your git operation.",
			].join("\n"),
		};
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash") return;

		const command = (event.input as { command?: string }).command ?? "";
		if (!isGitCommand(command)) return;

		snapshot.recordGitCommand();

		// In continuous mode keep the snapshot current after every git command
		// so that each subsequent mutation check sees the latest state.
		if (frequency === "continuous") {
			await snapshot.updateFromGit(pi, ctx.signal);
		}
	});

	// In turn mode, defer the snapshot update to agent_end so that all
	// agent-caused mutations within the turn are captured in one shot.
	pi.on("agent_end", async () => {
		if (frequency !== "turn") return;
		if (!snapshot.hadGitCommand) return;
		await snapshot.updateFromGit(pi);
	});
}
