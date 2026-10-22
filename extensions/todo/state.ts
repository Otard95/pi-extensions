import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export type Status = "pending" | "in_progress" | "done";
export interface Todo {
	id: string;
	text: string;
	status: Status;
}
export interface Snapshot {
	version: 1;
	revision: number;
	phase: "empty" | "active" | "dismissed" | "abandoned";
	items: Todo[];
	nextId: number;
	updateReady: boolean;
	reason?: string;
}
export interface Update {
	done?: string;
	in_progress?: string;
}
export interface Switch {
	in_progress: string;
	reason: string;
}
export interface Addition {
	text: string;
	reason: string;
	before?: string;
	after?: string;
}
export interface Change {
	id: string;
	text: string;
	previous: Status;
	current: Status;
}

export const STATE_TYPE = "session-todo-state";
export const TRIAL_GUIDANCE =
	"If a todo restriction blocks valid work, stop and confer with the user. Do not bypass the restriction.";

const SnapshotSchema = Type.Object({
	version: Type.Literal(1),
	revision: Type.Integer({ minimum: 0 }),
	phase: Type.Union([
		Type.Literal("empty"),
		Type.Literal("active"),
		Type.Literal("dismissed"),
		Type.Literal("abandoned"),
	]),
	items: Type.Array(
		Type.Object({
			id: Type.String(),
			text: Type.String(),
			status: Type.Union([
				Type.Literal("pending"),
				Type.Literal("in_progress"),
				Type.Literal("done"),
			]),
		}),
	),
	nextId: Type.Integer({ minimum: 1 }),
	updateReady: Type.Boolean(),
	reason: Type.Optional(Type.String()),
});

export function isSnapshot(value: unknown): value is Snapshot {
	return Value.Check(SnapshotSchema, value);
}

export function emptyState(): Snapshot {
	return {
		version: 1,
		revision: 0,
		phase: "empty",
		items: [],
		nextId: 1,
		updateReady: true,
	};
}

export class TodoError extends Error {}

export function active(state: Snapshot): void {
	if (state.phase !== "active") throw new TodoError("No todo list is active.");
}

function nonblank(text: string, name: string): string {
	const result = text.trim();
	if (!result) throw new TodoError(`${name} must not be blank.`);
	return result;
}

export function start(
	state: Snapshot,
	items: string[],
	inProgress?: number,
): Snapshot {
	if (state.phase === "active") {
		throw new TodoError(
			"An active list cannot be replaced. Complete it before dismissal.",
		);
	}
	if (!items.length) throw new TodoError("The todo list must not be empty.");
	if (
		inProgress !== undefined &&
		(!Number.isInteger(inProgress) ||
			inProgress < 1 ||
			inProgress > items.length)
	) {
		throw new TodoError("in_progress must be a valid 1-based item position.");
	}
	return {
		...emptyState(),
		phase: "active",
		nextId: items.length + 1,
		items: items.map((text, index) => ({
			id: `t${index + 1}`,
			text: nonblank(text, "Task text"),
			status: index + 1 === inProgress ? "in_progress" : "pending",
		})),
	};
}

export function update(
	state: Snapshot,
	input: Update,
): { snapshot: Snapshot; changes: Change[] } {
	active(state);
	if (!input.done && !input.in_progress) {
		throw new TodoError("Supply one done ID, one in_progress ID, or both.");
	}
	if (input.done && input.done === input.in_progress) {
		throw new TodoError("The same task cannot become done and in_progress.");
	}
	if (!state.updateReady) {
		throw new TodoError(
			"An update needs a successful intervening tool call after the last update or approved switch. todo_get and declined requests do not count.",
		);
	}
	const changes: Change[] = [];
	for (const [id, status] of [
		[input.done, "done"],
		[input.in_progress, "in_progress"],
	] as const) {
		if (id === undefined) continue;
		const item = state.items.find((item) => item.id === id);
		if (!item) throw new TodoError(`Unknown task ID: ${id}.`);
		const required = status === "done" ? "in_progress" : "pending";
		if (item.status !== required) {
			throw new TodoError(
				`Task ${id} must be ${required} before it becomes ${status}.`,
			);
		}
		changes.push({
			id,
			text: item.text,
			previous: item.status,
			current: status,
		});
	}
	const items = state.items.map((item) => {
		const change = changes.find((change) => change.id === item.id);
		return change ? { ...item, status: change.current } : item;
	});
	if (items.filter((item) => item.status === "in_progress").length > 1) {
		throw new TodoError(
			"Complete the current in-progress task, or use todo_switch to request approval to switch tasks.",
		);
	}
	return { snapshot: { ...state, items, updateReady: false }, changes };
}

export function switchTask(
	state: Snapshot,
	input: Switch,
): { snapshot: Snapshot; changes: Change[]; proposal: Switch } {
	active(state);
	const reason = nonblank(input.reason, "Reason");
	const current = state.items.find((item) => item.status === "in_progress");
	if (!current) {
		throw new TodoError(
			"No task is in progress. Use todo_update to start a pending task.",
		);
	}
	const target = state.items.find((item) => item.id === input.in_progress);
	if (!target) throw new TodoError(`Unknown task ID: ${input.in_progress}.`);
	if (target.status !== "pending") {
		throw new TodoError(`Task ${target.id} must be pending before a switch.`);
	}
	const changes: Change[] = [
		{
			id: current.id,
			text: current.text,
			previous: "in_progress",
			current: "pending",
		},
		{
			id: target.id,
			text: target.text,
			previous: "pending",
			current: "in_progress",
		},
	];
	const items = state.items.map((item) => {
		const change = changes.find((change) => change.id === item.id);
		return change ? { ...item, status: change.current } : item;
	});
	return {
		snapshot: { ...state, items, updateReady: false },
		changes,
		proposal: { in_progress: input.in_progress, reason },
	};
}

export function validateAddition(state: Snapshot, input: Addition): Addition {
	active(state);
	const text = nonblank(input.text, "Task text");
	const reason = nonblank(input.reason, "Reason");
	if ((input.before !== undefined) === (input.after !== undefined)) {
		throw new TodoError("Supply exactly one before or after task ID.");
	}
	const anchor = input.before ?? input.after;
	if (!state.items.some((item) => item.id === anchor)) {
		throw new TodoError(`Unknown placement task ID: ${anchor}.`);
	}
	return { ...input, text, reason };
}

export function add(state: Snapshot, input: Addition): Snapshot {
	const addition = validateAddition(state, input);
	const items = [...state.items];
	const anchor = items.findIndex(
		(item) => item.id === (addition.before ?? addition.after),
	);
	items.splice(anchor + (addition.after === undefined ? 0 : 1), 0, {
		id: `t${state.nextId}`,
		text: addition.text,
		status: "pending",
	});
	return { ...state, items, nextId: state.nextId + 1, updateReady: true };
}

export function dismiss(state: Snapshot): Snapshot {
	active(state);
	if (state.items.some((item) => item.status !== "done")) {
		throw new TodoError(
			"Complete every task before dismissal. Only the user can use /todo abandon.",
		);
	}
	return { ...state, phase: "dismissed" };
}

export function abandon(state: Snapshot, reason?: string): Snapshot {
	active(state);
	return { ...state, phase: "abandoned", reason: reason?.trim() || undefined };
}

export function unlock(state: Snapshot): Snapshot {
	return state.phase === "active" && !state.updateReady
		? { ...state, updateReady: true }
		: state;
}

export function summary(state: Snapshot): string {
	if (state.phase === "abandoned") {
		return `Todo list abandoned by the user.${state.reason ? ` Reason: ${state.reason}` : ""}`;
	}
	if (state.phase !== "active") return "No active todo list.";
	const done = state.items.filter((item) => item.status === "done").length;
	const current = state.items.find((item) => item.status === "in_progress");
	const pending = state.items.filter(
		(item) => item.status === "pending",
	).length;
	const task = current
		? `${current.id}: ${current.text.replace(/\s+/g, " ").slice(0, 120)}`
		: "none";
	return `Todo state: ${done}/${state.items.length} done. In progress: ${task}. Pending: ${pending}. Use todo_get for the full list.`;
}
