import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { additionPrompt, selectApproval, switchPrompt } from "./approval";
import { plain, toolRendering } from "./render";
import { restore } from "./session";
import {
	abandon,
	active,
	add,
	dismiss,
	emptyState,
	isSnapshot,
	type Snapshot,
	STATE_TYPE,
	start,
	summary,
	switchTask,
	TodoError,
	TRIAL_GUIDANCE,
	unlock,
	update,
	validateAddition,
} from "./state";

const TOOL_NAMES = new Set([
	"todo_start",
	"todo_update",
	"todo_add",
	"todo_switch",
	"todo_get",
	"todo_dismiss",
]);
const id = (description: string) => Type.String({ minLength: 1, description });
const noArgs = Type.Object({}, { additionalProperties: false });

export default function todoExtension(pi: ExtensionAPI) {
	let state = emptyState();
	let generation = 0;
	const reminders = new Map<number, { content: string; snapshot: Snapshot }>();
	const seenUsers = new Set<number>();

	function render(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		if (state.phase !== "active") {
			ctx.ui.setWidget(STATE_TYPE, undefined);
			return;
		}
		const snapshot = state;
		ctx.ui.setWidget(
			STATE_TYPE,
			(_tui, theme) => ({
				invalidate() {},
				render(width) {
					if (width < 1) return [];
					const done = snapshot.items.filter(
						(item) => item.status === "done",
					).length;
					const lines = [
						theme.fg(
							"accent",
							theme.bold(`TODO  ${done}/${snapshot.items.length} complete`),
						),
					];
					for (const item of snapshot.items) {
						const marker =
							item.status === "done"
								? "✓"
								: item.status === "in_progress"
									? ">"
									: "·";
						const color =
							item.status === "done"
								? "dim"
								: item.status === "in_progress"
									? "accent"
									: "text";
						lines.push(
							theme.fg(color, `${marker} ${item.id}  ${plain(item.text)}`),
						);
					}
					return lines.flatMap((line) => wrapTextWithAnsi(line, width));
				},
			}),
			{ placement: "aboveEditor" },
		);
	}

	function commit(next: Snapshot, ctx: ExtensionContext) {
		if (next === state) return;
		state = { ...next, revision: state.revision + 1 };
		pi.appendEntry(STATE_TYPE, { snapshot: structuredClone(state) });
		render(ctx);
	}

	function recover(ctx: ExtensionContext) {
		generation++;
		state = restore(ctx.sessionManager.getBranch());
		reminders.clear();
		seenUsers.clear();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "user") {
				seenUsers.add(entry.message.timestamp);
			}
			if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
			if (!entry.data || typeof entry.data !== "object") continue;
			const data = entry.data as {
				userTimestamp?: number;
				content?: string;
				snapshot?: Snapshot;
			};
			if (
				data.userTimestamp !== undefined &&
				data.content !== undefined &&
				isSnapshot(data.snapshot)
			) {
				reminders.set(data.userTimestamp, {
					content: data.content,
					snapshot: data.snapshot,
				});
			}
		}
		render(ctx);
	}

	pi.on("session_start", (_event, ctx) => recover(ctx));
	pi.on("session_tree", (_event, ctx) => recover(ctx));

	pi.on("before_agent_start", () => ({
		message: {
			customType: STATE_TYPE,
			content: summary(state),
			display: false,
			details: { snapshot: structuredClone(state) },
		},
	}));

	// Steering bypasses before_agent_start. Persist its reminder without queuing another agent turn.
	pi.on("context", (event) => {
		const messages: AgentMessage[] = [];
		for (let index = 0; index < event.messages.length; index++) {
			const message = event.messages[index];
			if (!message) continue;
			messages.push(message);
			if (message.role !== "user") continue;
			let hasReminder = false;
			for (
				let nextIndex = index + 1;
				nextIndex < event.messages.length;
				nextIndex++
			) {
				const next = event.messages[nextIndex];
				if (next?.role !== "custom") break;
				if (next.customType === STATE_TYPE) hasReminder = true;
			}
			const unseen = !seenUsers.has(message.timestamp);
			seenUsers.add(message.timestamp);
			if (hasReminder) continue;
			let reminder = reminders.get(message.timestamp);
			if (!reminder && unseen) {
				reminder = {
					content: summary(state),
					snapshot: structuredClone(state),
				};
				reminders.set(message.timestamp, reminder);
				pi.appendEntry(STATE_TYPE, {
					...reminder,
					userTimestamp: message.timestamp,
				});
			}
			if (reminder) {
				messages.push({
					role: "custom",
					customType: STATE_TYPE,
					content: reminder.content,
					display: false,
					details: { snapshot: reminder.snapshot },
					timestamp: message.timestamp,
				});
			}
		}
		return { messages };
	});

	pi.on("tool_result", (event, ctx) => {
		if (TOOL_NAMES.has(event.toolName)) {
			const details = event.details as { ok?: boolean } | undefined;
			if (details?.ok === false) return { isError: true };
			return;
		}
		if (!event.isError) commit(unlock(state), ctx);
	});

	function result(payload: Record<string, unknown>) {
		return {
			content: [
				{ type: "text" as const, text: JSON.stringify(payload, null, 2) },
			],
			details: { ...payload, snapshot: structuredClone(state) },
		};
	}

	async function run(
		action: () => Record<string, unknown> | Promise<Record<string, unknown>>,
	) {
		try {
			return result({ ok: true, ...(await action()) });
		} catch (error) {
			if (!(error instanceof TodoError)) throw error;
			return result({
				ok: false,
				error: error.message,
				unchanged: true,
				guidance: TRIAL_GUIDANCE,
				phase: state.phase,
				items: state.items,
				update_ready: state.updateReady,
			});
		}
	}

	pi.registerTool({
		name: "todo_start",
		...toolRendering("todo_start"),
		label: "Start todos",
		executionMode: "sequential",
		description: `Create the full ordered session todo list. An active list cannot be replaced. IDs are assigned automatically. ${TRIAL_GUIDANCE}`,
		promptSnippet: "Start an ordered session todo list",
		parameters: Type.Object(
			{
				items: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
				in_progress: Type.Optional(
					Type.Integer({
						minimum: 1,
						description:
							"Optional 1-based position of the initial in-progress task",
					}),
				),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			return run(() => {
				commit(start(state, params.items ?? [], params.in_progress), ctx);
				return { phase: state.phase, items: state.items };
			});
		},
	});

	pi.registerTool({
		name: "todo_update",
		...toolRendering("todo_update"),
		label: "Update todos",
		executionMode: "sequential",
		description: `Complete at most one in-progress task and/or start at most one pending task. Only one task can be in progress. After an update or approved switch, another update needs a successful intervening tool call. todo_get, failures, and declined requests do not count. Approved additions count. Use todo_switch to request approval to switch unfinished tasks. Returns every changed task with previous and current status. ${TRIAL_GUIDANCE}`,
		promptSnippet: "Complete the current todo and/or start the next todo",
		parameters: Type.Object(
			{
				done: Type.Optional(
					id("ID of the current in-progress task to complete"),
				),
				in_progress: Type.Optional(id("ID of one pending task to start")),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			return run(() => {
				const next = update(state, params);
				commit(next.snapshot, ctx);
				return {
					changes: next.changes,
					summary: summary(state),
					update_ready: state.updateReady,
				};
			});
		},
	});

	pi.registerTool({
		name: "todo_add",
		...toolRendering("todo_add"),
		label: "Propose todo",
		executionMode: "sequential",
		description: `Ask the user to approve one new pending task. Supply a reason and exactly one before or after task ID. Returns the decision and optional user feedback. Only approval changes the list and unlocks todo_update. ${TRIAL_GUIDANCE}`,
		promptSnippet: "Request approval to add a todo at a specific position",
		parameters: Type.Object(
			{
				text: Type.String({ minLength: 1 }),
				reason: Type.String({
					minLength: 1,
					description:
						"Why this addition is needed and what changes in the plan",
				}),
				before: Type.Optional(id("Insert before this task")),
				after: Type.Optional(id("Insert after this task")),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, signal, _onUpdate, ctx) {
			return run(async () => {
				const proposal = validateAddition(state, {
					...params,
					text: params.text ?? "",
					reason: params.reason ?? "",
				});
				if (!ctx.hasUI)
					throw new TodoError(
						"User approval requires an interactive session. No task was added.",
					);
				const previous = state;
				const epoch = generation;
				const choice = await selectApproval(
					ctx,
					additionPrompt(proposal, state.items),
					signal,
				);
				const feedback =
					choice === undefined
						? undefined
						: await ctx.ui.input(
								`${choice}: optional feedback`,
								"Enter to skip",
								{ signal },
							);
				if (signal?.aborted) throw new TodoError("The addition was canceled.");
				if (generation !== epoch || state !== previous)
					throw new TodoError(
						"The todo state changed during approval. Submit a new proposal.",
					);
				const decision = choice === "Approve" ? "approved" : "declined";
				if (decision === "approved") commit(add(state, proposal), ctx);
				const item =
					decision === "approved"
						? state.items.find((item) => item.id === `t${previous.nextId}`)
						: undefined;
				return {
					decision,
					feedback: feedback?.trim() || null,
					proposal,
					...(item ? { item } : {}),
					summary: summary(state),
				};
			});
		},
	});

	pi.registerTool({
		name: "todo_switch",
		...toolRendering("todo_switch"),
		label: "Switch todo",
		executionMode: "sequential",
		description: `Request user approval to switch from the current in-progress task to one pending task. Supply its ID and a reason. Approval returns the current task to pending and starts the requested task atomically. Decline changes nothing. Both decisions allow optional feedback. An approved switch consumes update permission and does not unlock todo_update. ${TRIAL_GUIDANCE}`,
		promptSnippet: "Request approval to switch unfinished tasks",
		parameters: Type.Object(
			{
				in_progress: id(
					"ID of the pending task to start instead of the current task",
				),
				reason: Type.String({
					minLength: 1,
					description:
						"Why the current task must wait and the requested task must start",
				}),
			},
			{ additionalProperties: false },
		),
		async execute(_callId, params, signal, _onUpdate, ctx) {
			return run(async () => {
				const next = switchTask(state, {
					in_progress: params.in_progress ?? "",
					reason: params.reason ?? "",
				});
				if (!ctx.hasUI)
					throw new TodoError(
						"User approval requires an interactive session. No task was switched.",
					);
				if (signal?.aborted) throw new TodoError("The switch was canceled.");
				const previous = state;
				const epoch = generation;
				const choice = await selectApproval(
					ctx,
					switchPrompt(next.changes, next.proposal.reason),
					signal,
				);
				const feedback =
					choice === undefined
						? undefined
						: await ctx.ui.input(
								`${choice}: optional feedback`,
								"Enter to skip",
								{ signal },
							);
				if (signal?.aborted) throw new TodoError("The switch was canceled.");
				if (generation !== epoch || state !== previous)
					throw new TodoError(
						"The todo state changed during approval. Submit a new proposal.",
					);
				const decision = choice === "Approve" ? "approved" : "declined";
				if (decision === "approved") commit(next.snapshot, ctx);
				return {
					decision,
					feedback: feedback?.trim() || null,
					proposal: next.proposal,
					changes: decision === "approved" ? next.changes : [],
					summary: summary(state),
					update_ready: state.updateReady,
				};
			});
		},
	});

	pi.registerTool({
		name: "todo_get",
		...toolRendering("todo_get"),
		label: "Get todos",
		executionMode: "sequential",
		description:
			"Get the full ordered session todo list with IDs and statuses. This tool does not unlock todo_update.",
		promptSnippet: "Read the full session todo list",
		parameters: noArgs,
		async execute() {
			return result({
				ok: true,
				phase: state.phase,
				items: state.items,
				update_ready: state.updateReady,
			});
		},
	});

	pi.registerTool({
		name: "todo_dismiss",
		...toolRendering("todo_dismiss"),
		label: "Dismiss todos",
		executionMode: "sequential",
		description: `Dismiss the active list only when every task is done. The user-only /todo abandon command is the escape hatch. ${TRIAL_GUIDANCE}`,
		promptSnippet: "Dismiss a completed session todo list",
		parameters: noArgs,
		async execute(_callId, _params, _signal, _onUpdate, ctx) {
			return run(() => {
				commit(dismiss(state), ctx);
				return {
					phase: state.phase,
					message: "The completed todo list is dismissed.",
				};
			});
		},
	});

	pi.registerCommand("todo", {
		description:
			"Use /todo abandon to dismiss unfinished todos with confirmation",
		getArgumentCompletions(prefix) {
			return "abandon".startsWith(prefix)
				? [{ value: "abandon", label: "abandon" }]
				: null;
		},
		async handler(args, ctx) {
			if (args.trim() !== "abandon") {
				ctx.ui.notify("Use /todo abandon to dismiss unfinished todos.", "info");
				return;
			}
			if (!ctx.hasUI) return;
			try {
				active(state);
				const previous = state;
				const epoch = generation;
				const unfinished = state.items.filter((item) => item.status !== "done");
				const confirmed = await ctx.ui.confirm(
					"Abandon the todo list?",
					unfinished
						.map((item) => `${item.id}: ${plain(item.text)}`)
						.join("\n") || "Every task is done.",
				);
				if (!confirmed) return;
				const reason = await ctx.ui.input(
					"Optional reason for abandonment",
					"Enter to skip",
				);
				if (generation !== epoch || state !== previous)
					throw new TodoError(
						"The todo state changed. Run /todo abandon again.",
					);
				commit(abandon(state, reason), ctx);
				pi.sendMessage({
					customType: STATE_TYPE,
					content: summary(state),
					display: false,
					details: { snapshot: structuredClone(state) },
				});
				ctx.ui.notify(
					"Todo list abandoned. Unfinished tasks remain unfinished.",
					"info",
				);
			} catch (error) {
				if (!(error instanceof TodoError)) throw error;
				ctx.ui.notify(error.message, "warning");
			}
		},
	});
}
