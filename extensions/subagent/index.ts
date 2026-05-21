/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Uses the pi SDK (createAgentSession) to run each subagent
 * in an isolated in-process session.
 *
 * Input is a recursive TaskGroup structure supporting nested
 * parallel and sequential execution. Execution state is tracked
 * in a mutable LiveTaskGroup tree.
 */

import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type AgentConfig, discoverAgents } from "./agents";
import { executeGroup } from "./executor";
import { collectFinalOutput } from "./format";
import { renderCall, renderResult } from "./render";
import {
	collectLiveTasks,
	SubagentParams,
	type Task,
	type TaskGroup,
	toLive,
} from "./schema";
import type { SubagentDetails } from "./types";

function buildDescription(agents: AgentConfig[]): string {
	const lines = [
		"Spawn a separate agent session with its own context window, system prompt, and model.",
		"Each agent is a pre-configured persona. Use when a task needs a specialized role, a different model, or isolated context.",
		"NOT for parallelizing your own tool calls — use your tools directly for that.",
		"",
		"Input is a task group with a mode (parallel or sequential) and a list of tasks.",
		"Each task specifies an agent name and a description of what it should do.",
		"Tasks can be nested task groups, allowing mixed parallel/sequential execution.",
	];

	if (agents.length > 0) {
		lines.push("", "Available agents:");
		for (const a of agents) {
			const model = a.model ? ` [${a.model}]` : "";
			lines.push(`- ${a.name}${model}: ${a.description}`);
		}
	}

	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	const userAgents = discoverAgents(process.cwd(), "user").agents;

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: buildDescription(userAgents),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const mode = params["mode"] as "parallel" | "sequential";
			const tasks = params["tasks"] as (Task | TaskGroup)[] | undefined;
			const discovery = discoverAgents(ctx.cwd, "both");
			const agents = discovery.agents;

			if (!tasks || tasks.length === 0) {
				const available =
					agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `No tasks provided. Available agents: ${available}`,
						},
					],
					details: { root: { mode, tasks: [] } } satisfies SubagentDetails,
				};
			}

			// Build the mutable state tree
			const group: TaskGroup = { mode, tasks };
			const root = toLive(group);
			const details: SubagentDetails = { root };

			// notify reads the current tree state and emits an update
			const notify = () => {
				if (!onUpdate) return;
				const allTasks = collectLiveTasks(root);
				const done = allTasks.filter(
					(t) => t.state === "done" || t.state === "error",
				).length;
				const running = allTasks.filter((t) => t.state === "running").length;
				const summary =
					running > 0
						? `${done}/${allTasks.length} done, ${running} running...`
						: `${done}/${allTasks.length} done`;

				onUpdate({
					content: [{ type: "text", text: summary }],
					details,
				});
			};

			const { isError, errorMessage } = await executeGroup(
				root,
				ctx.cwd,
				agents,
				signal,
				notify,
			);

			const finalText = collectFinalOutput(root);

			const toolResult = {
				content: [
					{
						type: "text" as const,
						text: isError
							? errorMessage || finalText || "(failed)"
							: finalText || "(no output)",
					},
				],
				details,
				...(isError ? { isError: true } : {}),
			};

			// Debug: write full return value to file
			writeFileSync(
				"/tmp/subagent-debug.json",
				JSON.stringify(toolResult, null, 2),
			);

			return toolResult;
		},

		renderCall(args, theme, _context) {
			return renderCall(args, theme);
		},

		renderResult(result, { expanded }, theme, _context) {
			// biome-ignore lint/suspicious/noExplicitAny: renderResult handles the details typing internally
			return renderResult(result as any, expanded, theme);
		},
	});
}
