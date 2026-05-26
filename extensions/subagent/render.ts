import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import {
	getMarkdownTheme,
	type ThemeColor,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import {
	aggregateUsage,
	formatUsageStats,
	getCompactSummaryLines,
	getFinalOutput,
	getMessageSummaryLines,
} from "./format";
import {
	collectLiveTasks,
	isTask,
	type LiveTask,
	type LiveTaskGroup,
	type Task,
	type TaskGroup,
} from "./schema";
import {
	COLLAPSED_ITEM_COUNT,
	type SingleResult,
	type SubagentDetails,
} from "./types";

function collectResults(tasks: LiveTask[]): SingleResult[] {
	const results: SingleResult[] = [];
	for (const t of tasks) {
		if (t.result) results.push(t.result);
	}
	return results;
}

// -- Theme helper type -------------------------------------------------------

interface Theme {
	fg: (color: ThemeColor, text: string) => string;
	bold: (text: string) => string;
}

// -- Shared rendering helpers ------------------------------------------------

function taskStateIcon(task: LiveTask, theme: Theme) {
	switch (task.state) {
		case "pending":
			return theme.fg("muted", "○");
		case "running":
			return theme.fg("warning", "⏳");
		case "done":
			return theme.fg("success", "✓");
		case "error":
			return theme.fg("error", "✗");
	}
}

function renderSummaryLines(lines: string[], theme: Theme, limit?: number) {
	const toShow = limit ? lines.slice(-limit) : lines;
	const skipped = limit && lines.length > limit ? lines.length - limit : 0;
	let text = "";
	if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
	for (const line of toShow) {
		text += `${theme.fg("dim", line)}\n`;
	}
	return text.trimEnd();
}

// -- renderCall --------------------------------------------------------------

function countLeafTasks(items: (Task | TaskGroup)[]): number {
	let n = 0;
	for (const item of items) {
		n += isTask(item) ? 1 : countLeafTasks(item.tasks);
	}
	return n;
}

function taskPreviews(
	items: (Task | TaskGroup)[],
	theme: Theme,
	max = 3,
): string[] {
	const lines: string[] = [];
	for (const item of items) {
		if (lines.length >= max) break;
		if (isTask(item)) {
			const preview =
				item.taskDescription.length > 40
					? `${item.taskDescription.slice(0, 40)}...`
					: item.taskDescription;
			lines.push(
				`  ${theme.fg("accent", item.agent)}${theme.fg("dim", ` ${preview}`)}`,
			);
		} else {
			const count = countLeafTasks(item.tasks);
			lines.push(
				`  ${theme.fg("muted", `[${item.mode} group: ${count} tasks]`)}`,
			);
		}
	}
	return lines;
}

export function renderCall(args: Record<string, unknown>, theme: Theme): Text {
	const mode = (args["mode"] as string) ?? "parallel";
	const tasks = args["tasks"] as (Task | TaskGroup)[] | undefined;
	const count = tasks ? countLeafTasks(tasks) : 0;

	let text =
		theme.fg("toolTitle", theme.bold("subagent ")) +
		theme.fg("accent", `${mode} (${count} task${count !== 1 ? "s" : ""})`);

	if (tasks && tasks.length > 0) {
		const previews = taskPreviews(tasks, theme);
		text += `\n${previews.join("\n")}`;
		const remaining = tasks.length - previews.length;
		if (remaining > 0)
			text += `\n  ${theme.fg("muted", `... +${remaining} more`)}`;
	}

	return new Text(text, 0, 0);
}

// -- renderResult ------------------------------------------------------------

function renderSingleTask(
	task: LiveTask,
	expanded: boolean,
	theme: Theme,
): Text | Container {
	const icon = taskStateIcon(task, theme);
	const r = task.result;
	const source = r?.agentSource ?? "unknown";
	const summaryLines = r ? getMessageSummaryLines(r.messages) : [];
	const finalOutput = r ? getFinalOutput(r.messages) : "";
	const mdTheme = getMarkdownTheme();

	if (expanded && r) {
		const container = new Container();
		let header = `${icon} ${theme.fg("toolTitle", theme.bold(task.agent))}${theme.fg("muted", ` (${source})`)}`;
		if (task.state === "error" && r.stopReason)
			header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
		container.addChild(new Text(header, 0, 0));
		if (task.state === "error" && r.errorMessage)
			container.addChild(
				new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0),
			);
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
		container.addChild(new Text(theme.fg("dim", task.taskDescription), 0, 0));
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("muted", "─── Activity ───"), 0, 0));
		if (summaryLines.length === 0 && !finalOutput) {
			container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
		} else {
			for (const line of summaryLines) {
				container.addChild(new Text(theme.fg("dim", line), 0, 0));
			}
			if (finalOutput) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("muted", "─── Result ───"), 0, 0));
				container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
			}
		}
		const usageStr = formatUsageStats(r.usage, r.model);
		if (usageStr) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
		}
		return container;
	}

	// Collapsed
	const compactLines = r ? getCompactSummaryLines(r.messages) : [];
	let text = `${icon} ${theme.fg("toolTitle", theme.bold(task.agent))}${theme.fg("muted", ` (${source})`)}`;
	if (task.state === "error" && r?.stopReason)
		text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
	if (task.state === "error" && r?.errorMessage)
		text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
	else if (task.state === "pending" || task.state === "running")
		text += `\n${theme.fg("muted", task.state === "pending" ? "(pending)" : "(running...)")}`;
	else if (compactLines.length === 0)
		text += `\n${theme.fg("muted", "(no output)")}`;
	else {
		text += `\n${renderSummaryLines(compactLines, theme, COLLAPSED_ITEM_COUNT)}`;
		if (compactLines.length > COLLAPSED_ITEM_COUNT)
			text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	}
	if (r) {
		const usageStr = formatUsageStats(r.usage, r.model);
		if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
	}
	return new Text(text, 0, 0);
}

function renderMulti(
	root: LiveTaskGroup,
	expanded: boolean,
	theme: Theme,
): Text | Container {
	const allTasks = collectLiveTasks(root);
	const running = allTasks.filter((t) => t.state === "running").length;
	const done = allTasks.filter(
		(t) => t.state === "done" || t.state === "error",
	).length;
	const failed = allTasks.filter((t) => t.state === "error").length;
	const isRunning = running > 0 || allTasks.some((t) => t.state === "pending");
	const mdTheme = getMarkdownTheme();

	const icon = isRunning
		? theme.fg("warning", "⏳")
		: failed > 0
			? theme.fg("warning", "◐")
			: theme.fg("success", "✓");

	const modeLabel = `${root.mode} `;
	const status = isRunning
		? `${done}/${allTasks.length} done, ${running} running`
		: `${done - failed}/${allTasks.length} tasks`;

	// Expanded (not while running)
	if (expanded && !isRunning) {
		const container = new Container();
		container.addChild(
			new Text(
				`${icon} ${theme.fg("toolTitle", theme.bold(modeLabel))}${theme.fg("accent", status)}`,
				0,
				0,
			),
		);

		for (const task of allTasks) {
			const tIcon = taskStateIcon(task, theme);
			const r = task.result;
			const summaryLines = r ? getMessageSummaryLines(r.messages) : [];
			const finalOutput = r ? getFinalOutput(r.messages) : "";

			container.addChild(new Spacer(1));
			container.addChild(
				new Text(
					`${theme.fg("muted", "─── ") + theme.fg("accent", task.agent)} ${tIcon}`,
					0,
					0,
				),
			);
			container.addChild(
				new Text(
					theme.fg("muted", "Task: ") + theme.fg("dim", task.taskDescription),
					0,
					0,
				),
			);
			for (const line of summaryLines) {
				container.addChild(new Text(theme.fg("dim", line), 0, 0));
			}
			if (finalOutput) {
				container.addChild(new Spacer(1));
				container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
			}
			if (r) {
				const taskUsage = formatUsageStats(r.usage, r.model);
				if (taskUsage)
					container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
			}
		}

		const usageStr = formatUsageStats(aggregateUsage(collectResults(allTasks)));
		if (usageStr) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
		}
		return container;
	}

	// Collapsed / running
	let text = `${icon} ${theme.fg("toolTitle", theme.bold(modeLabel))}${theme.fg("accent", status)}`;
	for (const task of allTasks) {
		const tIcon = taskStateIcon(task, theme);
		const compactLines = task.result
			? getCompactSummaryLines(task.result.messages)
			: [];
		text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", task.agent)} ${tIcon}`;
		if (task.state === "pending" || task.state === "running")
			text += `\n${theme.fg("muted", task.state === "pending" ? "(pending)" : "(running...)")}`;
		else if (compactLines.length === 0)
			text += `\n${theme.fg("muted", "(no output)")}`;
		else text += `\n${renderSummaryLines(compactLines, theme, 5)}`;
	}
	if (!isRunning) {
		const usageStr = formatUsageStats(aggregateUsage(collectResults(allTasks)));
		if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
	}
	if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
	return new Text(text, 0, 0);
}

export function renderResult(
	result: AgentToolResult<SubagentDetails>,
	expanded: boolean,
	theme: Theme,
): Text | Container {
	const details = result.details as SubagentDetails | undefined;
	if (!details?.root) {
		const text = result.content[0];
		return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
	}

	const allTasks = collectLiveTasks(details.root);
	const firstTask = allTasks[0];
	if (allTasks.length === 1 && firstTask) {
		return renderSingleTask(firstTask, expanded, theme);
	}

	return renderMulti(details.root, expanded, theme);
}
