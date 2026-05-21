import { Type } from "@sinclair/typebox";
import type { SingleResult } from "./types";

const Mode = Type.Union(
	[Type.Literal("parallel"), Type.Literal("sequential")],
	{
		description:
			"Execution mode: parallel runs all tasks concurrently, sequential runs them in order (stopping on failure)",
	},
);

const Task = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	taskDescription: Type.String({ description: "What the agent should do" }),
	name: Type.Optional(
		Type.String({
			description:
				"Optional short label for this task. Used to identify output in parallel results.",
		}),
	),
});

// Nested group (max 1 level of nesting — contains only leaf tasks)
const NestedTaskGroup = Type.Object({
	mode: Mode,
	tasks: Type.Array(Task, {
		description: "List of tasks in this nested group.",
	}),
});

export const SubagentParams = Type.Object({
	mode: Mode,
	tasks: Type.Array(Type.Union([Task, NestedTaskGroup]), {
		description:
			"List of tasks or nested task groups. Each task specifies an agent and description. Nested groups allow mixing parallel and sequential execution.",
	}),
});

// -- Runtime types -----------------------------------------------------------

export interface Task {
	agent: string;
	taskDescription: string;
	name?: string;
}

export interface TaskGroup {
	mode: "parallel" | "sequential";
	tasks: (Task | TaskGroup)[];
}

export function isTask(item: Task | TaskGroup): item is Task {
	return "agent" in item && "taskDescription" in item;
}

/** A Task with mutable execution state. */
export interface LiveTask {
	agent: string;
	taskDescription: string;
	name?: string;
	state: "pending" | "running" | "done" | "error";
	result?: SingleResult;
}

/** A TaskGroup with LiveTasks — the mutable state tree. */
export interface LiveTaskGroup {
	mode: "parallel" | "sequential";
	tasks: (LiveTask | LiveTaskGroup)[];
}

export function isLiveTask(item: LiveTask | LiveTaskGroup): item is LiveTask {
	return "agent" in item && "taskDescription" in item;
}

/** Convert a static TaskGroup into a mutable LiveTaskGroup. */
export function toLive(group: TaskGroup): LiveTaskGroup {
	return {
		mode: group.mode,
		tasks: group.tasks.map((item) =>
			isTask(item)
				? {
						agent: item.agent,
						taskDescription: item.taskDescription,
						name: item.name,
						state: "pending" as const,
					}
				: toLive(item),
		),
	};
}

/** Collect all LiveTasks from a LiveTaskGroup (flattened). */
export function collectLiveTasks(group: LiveTaskGroup): LiveTask[] {
	const tasks: LiveTask[] = [];
	for (const item of group.tasks) {
		if (isLiveTask(item)) tasks.push(item);
		else tasks.push(...collectLiveTasks(item));
	}
	return tasks;
}

/** Collect all agent names referenced in a task group (recursively). */
export function collectAgentNames(group: TaskGroup): Set<string> {
	const names = new Set<string>();
	for (const item of group.tasks) {
		if (isTask(item)) names.add(item.agent);
		else for (const name of collectAgentNames(item)) names.add(name);
	}
	return names;
}
