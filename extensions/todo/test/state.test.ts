import { describe, expect, it } from "vitest";
import {
	abandon,
	add,
	dismiss,
	emptyState,
	isSnapshot,
	start,
	summary,
	switchTask,
	unlock,
	update,
	validateAddition,
} from "../state";

const initial = () => start(emptyState(), ["Model", "Panel", "Tests"]);

describe("todo start", () => {
	it("assigns stable sequential IDs and pending statuses", () => {
		expect(initial().items).toEqual([
			{ id: "t1", text: "Model", status: "pending" },
			{ id: "t2", text: "Panel", status: "pending" },
			{ id: "t3", text: "Tests", status: "pending" },
		]);
	});

	it("accepts one initial in-progress position", () => {
		expect(start(emptyState(), ["A", "B"], 2).items[1]?.status).toBe(
			"in_progress",
		);
	});

	it("rejects replacement, blank tasks, and empty lists", () => {
		expect(() => start(initial(), ["Replacement"])).toThrow(
			"cannot be replaced",
		);
		expect(() => start(emptyState(), [])).toThrow("must not be empty");
		expect(() => start(emptyState(), ["  \n"])).toThrow("must not be blank");
	});

	it.each([0, -1, 4, 1.5, Number.NaN])("rejects position %s", (position) => {
		expect(() => start(emptyState(), ["A", "B"], position)).toThrow("1-based");
	});
});

describe("todo transitions", () => {
	it("starts one task, then completes it and starts the next atomically", () => {
		const state = update(initial(), { in_progress: "t1" }).snapshot;
		const result = update(unlock(state), { done: "t1", in_progress: "t2" });
		expect(result.changes).toEqual([
			{ id: "t1", text: "Model", previous: "in_progress", current: "done" },
			{ id: "t2", text: "Panel", previous: "pending", current: "in_progress" },
		]);
		expect(result.snapshot.items.map((item) => item.status)).toEqual([
			"done",
			"in_progress",
			"pending",
		]);
		expect(state.items[0]?.status).toBe("in_progress");
	});

	it("completes one task without starting another", () => {
		const state = start(emptyState(), ["A"], 1);
		expect(update(state, { done: "t1" }).snapshot.items[0]?.status).toBe(
			"done",
		);
	});

	it("rejects consecutive updates without changing state", () => {
		const state = update(initial(), { in_progress: "t1" }).snapshot;
		const before = structuredClone(state);
		expect(() => update(state, { done: "t1" })).toThrow("intervening tool");
		expect(state).toEqual(before);
	});

	it("requires a pending task to become in-progress before completion", () => {
		expect(() => update(initial(), { done: "t1" })).toThrow(
			"must be in_progress",
		);
	});

	it("rejects switching away from unfinished work", () => {
		const state = start(emptyState(), ["A", "B"], 1);
		expect(() => update(state, { in_progress: "t2" })).toThrow(
			"Complete the current",
		);
	});

	it("rejects empty calls, unknown IDs, repeated transitions, and conflicting IDs", () => {
		expect(() => update(initial(), {})).toThrow("Supply one");
		expect(() => update(initial(), { in_progress: "missing" })).toThrow(
			"Unknown task",
		);
		const state = start(emptyState(), ["A", "B"], 1);
		expect(() => update(state, { in_progress: "t1" })).toThrow(
			"must be pending",
		);
		expect(() => update(state, { done: "t1", in_progress: "t1" })).toThrow(
			"same task",
		);
	});

	it("rejects invalid handoffs without partially completing the current task", () => {
		const state = start(emptyState(), ["A", "B"], 1);
		expect(() =>
			update(state, { done: "t1", in_progress: "missing" }),
		).toThrow();
		expect(state.items[0]?.status).toBe("in_progress");
	});
});

describe("todo switches", () => {
	it.each([
		true,
		false,
	])("switches atomically and consumes update permission when ready=%s", (updateReady) => {
		const state = { ...start(emptyState(), ["A", "B", "C"], 1), updateReady };
		const previous = structuredClone(state);
		const result = switchTask(state, {
			in_progress: "t2",
			reason: "  A must wait for B  ",
		});
		expect(result.changes).toEqual([
			{ id: "t1", text: "A", previous: "in_progress", current: "pending" },
			{ id: "t2", text: "B", previous: "pending", current: "in_progress" },
		]);
		expect(result.snapshot.items.map((item) => item.status)).toEqual([
			"pending",
			"in_progress",
			"pending",
		]);
		expect(result.snapshot.updateReady).toBe(false);
		expect(result.proposal.reason).toBe("A must wait for B");
		expect(isSnapshot(result.snapshot)).toBe(true);
		expect(state).toEqual(previous);
		expect(() => update(result.snapshot, { done: "t2" })).toThrow(
			"intervening tool",
		);
	});

	it("rejects inactive lists, missing current tasks, and blank reasons", () => {
		expect(() =>
			switchTask(emptyState(), { in_progress: "t2", reason: "Needed" }),
		).toThrow("No todo list");
		expect(() =>
			switchTask(initial(), { in_progress: "t2", reason: "Needed" }),
		).toThrow("No task is in progress");
		expect(() =>
			switchTask(start(emptyState(), ["A", "B"], 1), {
				in_progress: "t2",
				reason: " ",
			}),
		).toThrow("Reason must not be blank");
	});

	it("rejects unknown, current, and completed targets without mutation", () => {
		const state = update(start(emptyState(), ["A", "B", "C"], 1), {
			done: "t1",
			in_progress: "t2",
		}).snapshot;
		const previous = structuredClone(state);
		for (const in_progress of ["missing", "t1", "t2"]) {
			expect(() =>
				switchTask(state, { in_progress, reason: "Needed" }),
			).toThrow();
		}
		expect(state).toEqual(previous);
	});
});

describe("todo additions", () => {
	it.each([
		[{ before: "t1" }, ["t4", "t1", "t2", "t3"]],
		[{ after: "t2" }, ["t1", "t2", "t4", "t3"]],
		[{ after: "t3" }, ["t1", "t2", "t3", "t4"]],
	] as const)("inserts at the requested position: %o", (placement, ids) => {
		const state = add(initial(), {
			text: "New",
			reason: "Missing test",
			...placement,
		});
		expect(state.items.map((item) => item.id)).toEqual(ids);
		expect(state.items.find((item) => item.id === "t4")?.status).toBe(
			"pending",
		);
		expect(state.nextId).toBe(5);
	});

	it("unlocks updates without changing existing statuses", () => {
		const state = update(initial(), { in_progress: "t1" }).snapshot;
		const next = add(state, { text: "New", reason: "Needed", after: "t1" });
		expect(next.updateReady).toBe(true);
		expect(next.items.find((item) => item.id === "t1")?.status).toBe(
			"in_progress",
		);
		expect(
			add(next, { text: "Another", reason: "Needed", before: "t4" }).items[1]
				?.id,
		).toBe("t5");
	});

	it("requires one valid placement, task text, and a reason", () => {
		const base = { text: "New", reason: "Needed" };
		for (const input of [
			base,
			{ ...base, before: "t1", after: "t2" },
			{ ...base, after: "unknown" },
			{ ...base, text: " ", after: "t1" },
			{ ...base, reason: " ", after: "t1" },
		]) {
			expect(() => validateAddition(initial(), input)).toThrow();
		}
	});
});

describe("todo dismissal and abandonment", () => {
	it("dismisses only completed active lists", () => {
		expect(() => dismiss(initial())).toThrow("Complete every task");
		const state = update(start(emptyState(), ["A"], 1), {
			done: "t1",
		}).snapshot;
		expect(dismiss(state).phase).toBe("dismissed");
		expect(start(dismiss(state), ["Next"]).phase).toBe("active");
	});

	it("abandons without marking unfinished tasks done", () => {
		const state = abandon(initial(), "  Scope changed  ");
		expect(state.phase).toBe("abandoned");
		expect(state.items.every((item) => item.status === "pending")).toBe(true);
		expect(state.reason).toBe("Scope changed");
		expect(summary(state)).toContain("abandoned by the user");
		expect(start(state, ["New plan"]).phase).toBe("active");
	});

	it.each([
		"get",
		"update",
		"add",
		"dismiss",
		"abandon",
	])("preserves valid snapshots after %s", (operation) => {
		const state = initial();
		const snapshots = {
			get: state,
			update: update(state, { in_progress: "t1" }).snapshot,
			add: add(state, { text: "New", reason: "Needed", after: "t1" }),
			dismiss: dismiss(
				update(start(emptyState(), ["A"], 1), { done: "t1" }).snapshot,
			),
			abandon: abandon(state),
		};
		expect(isSnapshot(snapshots[operation as keyof typeof snapshots])).toBe(
			true,
		);
		expect(isSnapshot({ version: 2 })).toBe(false);
	});

	it("rejects active-only operations without an active list", () => {
		expect(() => update(emptyState(), { in_progress: "t1" })).toThrow(
			"No todo list",
		);
		expect(() => dismiss(emptyState())).toThrow("No todo list");
		expect(() => abandon(emptyState())).toThrow("No todo list");
	});
});
