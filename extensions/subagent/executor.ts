import type { AgentConfig } from "./agents";
import { getItemOutput } from "./format";
import { mapWithConcurrencyLimit, runSingleAgent } from "./runner";
import { isLiveTask, type LiveTask, type LiveTaskGroup } from "./schema";
import { MAX_CONCURRENCY, MAX_PARALLEL_TASKS } from "./types";

/** Count all leaf tasks in a LiveTaskGroup (recursively). */
function countTasks(group: LiveTaskGroup): number {
	let n = 0;
	for (const item of group.tasks) {
		n += isLiveTask(item) ? 1 : countTasks(item);
	}
	return n;
}

/**
 * Execute a LiveTaskGroup recursively, mutating task states in place.
 * Calls `notify()` whenever state changes so the caller can emit updates.
 */
export async function executeGroup(
	group: LiveTaskGroup,
	defaultCwd: string,
	agents: AgentConfig[],
	signal: AbortSignal | undefined,
	notify: () => void,
	toolSnippets: Record<string, string>,
	previous?: string,
): Promise<{ isError: boolean; errorMessage?: string }> {
	const totalTasks = countTasks(group);
	if (totalTasks > MAX_PARALLEL_TASKS) {
		return {
			isError: true,
			errorMessage: `Too many tasks (${totalTasks}). Max is ${MAX_PARALLEL_TASKS}.`,
		};
	}

	if (group.mode === "parallel") {
		return executeParallel(
			group,
			defaultCwd,
			agents,
			signal,
			notify,
			toolSnippets,
			previous,
		);
	}
	return executeSequential(
		group,
		defaultCwd,
		agents,
		signal,
		notify,
		toolSnippets,
		previous,
	);
}

// -- Parallel ----------------------------------------------------------------

async function executeParallel(
	group: LiveTaskGroup,
	defaultCwd: string,
	agents: AgentConfig[],
	signal: AbortSignal | undefined,
	notify: () => void,
	toolSnippets: Record<string, string>,
	previous?: string,
): Promise<{ isError: boolean }> {
	await mapWithConcurrencyLimit(group.tasks, MAX_CONCURRENCY, async (item) => {
		if (isLiveTask(item)) {
			applyPrevious(item, previous);
			await runSingleAgent(
				defaultCwd,
				agents,
				item,
				signal,
				notify,
				toolSnippets,
			);
		} else {
			await executeGroup(
				item,
				defaultCwd,
				agents,
				signal,
				notify,
				toolSnippets,
				previous,
			);
		}
	});

	const allTasks = collectAllTasks(group);
	const hasError = allTasks.some((t) => t.state === "error");
	return { isError: hasError };
}

// -- Sequential --------------------------------------------------------------

async function executeSequential(
	group: LiveTaskGroup,
	defaultCwd: string,
	agents: AgentConfig[],
	signal: AbortSignal | undefined,
	notify: () => void,
	toolSnippets: Record<string, string>,
	previous?: string,
): Promise<{ isError: boolean; errorMessage?: string }> {
	let prev = previous;

	for (const item of group.tasks) {
		if (isLiveTask(item)) {
			applyPrevious(item, prev);
			await runSingleAgent(
				defaultCwd,
				agents,
				item,
				signal,
				notify,
				toolSnippets,
			);

			if (item.state === "error") {
				const r = item.result;
				const errorMsg = r?.errorMessage || r?.stderr || "(no output)";
				return {
					isError: true,
					errorMessage: `Sequential stopped at ${item.agent}: ${errorMsg}`,
				};
			}
		} else {
			const nested = await executeGroup(
				item,
				defaultCwd,
				agents,
				signal,
				notify,
				toolSnippets,
				prev,
			);
			if (nested.isError) return nested;
		}

		prev = getItemOutput(item);
	}

	return { isError: false };
}

// -- Helpers -----------------------------------------------------------------

function applyPrevious(task: LiveTask, previous?: string) {
	if (previous && task.taskDescription.includes("{previous}")) {
		task.taskDescription = task.taskDescription.replace(
			/\{previous\}/g,
			previous,
		);
	}
}

function collectAllTasks(group: LiveTaskGroup): LiveTask[] {
	const tasks: LiveTask[] = [];
	for (const item of group.tasks) {
		if (isLiveTask(item)) tasks.push(item);
		else tasks.push(...collectAllTasks(item));
	}
	return tasks;
}
