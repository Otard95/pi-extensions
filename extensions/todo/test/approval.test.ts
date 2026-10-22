import type { Component } from "@earendil-works/pi-tui";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ApprovalDialog,
	additionPrompt,
	plainPrompt,
	selectApproval,
	switchPrompt,
} from "../approval";
import type { Change, Todo } from "../state";

const changes: Change[] = [
	{
		id: "t3",
		text: "Complete the test list",
		previous: "in_progress",
		current: "pending",
	},
	{
		id: "t6",
		text: "Test backgrounds",
		previous: "pending",
		current: "in_progress",
	},
];
const prompt = switchPrompt(changes, "The final task must wait");
const items: Todo[] = [
	{ id: "t1", text: "First task", status: "done" },
	{ id: "t2", text: "Middle task", status: "in_progress" },
	{ id: "t3", text: "Last task", status: "pending" },
];
const theme = {
	fg: vi.fn((_color: string, text: string) => text),
	bg: vi.fn((_color: string, text: string) => text),
	bold: (text: string) => text,
};

function customHarness() {
	let component: (Component & { dispose?(): void }) | undefined;
	const done = vi.fn();
	const tui = { requestRender: vi.fn() };
	const ctx = { mode: "tui", ui: { custom: vi.fn(), select: vi.fn() } };
	ctx.ui.custom.mockImplementation(
		(factory) =>
			new Promise((resolve) => {
				done.mockImplementation(resolve);
				component = factory(tui, theme, getKeybindings(), done);
			}),
	);
	return {
		ctx,
		done,
		tui,
		get dialog() {
			if (!component) throw new Error("Dialog is not open");
			return component;
		},
	};
}

beforeEach(() => {
	theme.fg.mockClear();
	theme.bg.mockClear();
});

describe("approval prompt content", () => {
	it("keeps each switch transition on its task line in plain prompts", () => {
		const lines = plainPrompt(prompt).split("\n");
		expect(lines).toContain(
			"t3 · Complete the test list · in progress → pending",
		);
		expect(lines).toContain("t6 · Test backgrounds · pending → in progress");
		expect(lines).toContain("Reason: The final task must wait");
	});

	it.each([
		[
			{ before: "t2" },
			["  t1 · First task", "+ New task", "  t2 · Middle task"],
		],
		[{ after: "t2" }, ["  t2 · Middle task", "+ New task", "  t3 · Last task"]],
		[{ before: "t1" }, ["+ New task", "  t1 · First task"]],
		[{ after: "t3" }, ["  t3 · Last task", "+ New task"]],
	] as const)("shows a diff preview for %o", (placement, expected) => {
		const previous = structuredClone(items);
		const request = additionPrompt(
			{ text: "New task", reason: "Missing test", ...placement },
			items,
		);
		const lines = plainPrompt(request).split("\n");
		expect(lines.slice(1, -1)).toEqual(expected);
		expect(lines.at(-1)).toBe("Reason: Missing test");
		expect(
			request.tasks.find((task) => task.kind === "added")?.id,
		).toBeUndefined();
		expect(items).toEqual(previous);
	});

	it("rejects a missing placement task instead of showing the wrong preview", () => {
		expect(() =>
			additionPrompt(
				{ text: "New", reason: "Needed", after: "missing" },
				items,
			),
		).toThrow("placement task no longer exists");
	});
});

describe("styled approval dialog", () => {
	it("colors only the added task green in the insertion preview", () => {
		const request = additionPrompt(
			{ text: "New task", reason: "Needed", after: "t2" },
			items,
		);
		const dialog = new ApprovalDialog(request, theme as never, vi.fn());
		const lines = dialog.render(100).map((line) => line.trim());
		expect(lines.slice(3, 6)).toEqual([
			"t2 · Middle task",
			"+ New task",
			"t3 · Last task",
		]);
		expect(theme.fg).toHaveBeenCalledWith("success", "+ New task");
		expect(theme.fg).toHaveBeenCalledWith("muted", "  t2 · Middle task");
		expect(theme.fg).toHaveBeenCalledWith("muted", "  t3 · Last task");
		expect(theme.bg).not.toHaveBeenCalled();
	});

	it("keeps the standard bordered layout and colors only statuses and choices", () => {
		const dialog = new ApprovalDialog(prompt, theme as never, vi.fn());
		const lines = dialog.render(100).map((line) => line.trim());
		expect(lines).toContain(
			"t3 · Complete the test list · in progress → pending",
		);
		expect(lines).toContain("t6 · Test backgrounds · pending → in progress");
		expect(lines[0]).toBe("─".repeat(100));
		expect(lines.at(-1)).toBe("─".repeat(100));
		expect(lines.slice(2, 6)).toEqual([
			"Switch tasks?",
			"t3 · Complete the test list · in progress → pending",
			"t6 · Test backgrounds · pending → in progress",
			"Reason: The final task must wait",
		]);
		expect(theme.fg).toHaveBeenCalledWith("accent", "in progress");
		expect(theme.fg).toHaveBeenCalledWith("muted", "pending");
		expect(theme.fg).toHaveBeenCalledWith("error", "Decline");
		expect(theme.fg).toHaveBeenCalledWith("success", "Approve");
		expect(theme.bg).not.toHaveBeenCalled();
		dialog.handleInput("\u001b[B");
		dialog.render(100);
		expect(theme.bg).not.toHaveBeenCalled();
	});

	it("defaults to decline and supports approval and cancellation", () => {
		const decline = vi.fn();
		new ApprovalDialog(prompt, theme as never, decline).handleInput("\r");
		expect(decline).toHaveBeenCalledWith("Decline");
		const approve = vi.fn();
		const dialog = new ApprovalDialog(prompt, theme as never, approve);
		dialog.handleInput("\u001b[B");
		dialog.handleInput("\r");
		expect(approve).toHaveBeenCalledWith("Approve");
		const cancel = vi.fn();
		new ApprovalDialog(prompt, theme as never, cancel).handleInput("\u001b");
		expect(cancel).toHaveBeenCalledWith(undefined);
	});

	it("truncates long task text without moving transitions to another line", () => {
		const long = switchPrompt(
			changes.map((change) => ({
				...change,
				text: "A long task title ".repeat(20),
			})),
			"Needed",
		);
		const dialog = new ApprovalDialog(long, theme as never, vi.fn());
		const rows = dialog
			.render(64)
			.filter(
				(line) =>
					line.includes("in progress → pending") ||
					line.includes("pending → in progress"),
			);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toContain("t3");
		expect(rows[0]).toContain("in progress → pending");
		expect(rows[1]).toContain("t6");
		expect(rows[1]).toContain("pending → in progress");
	});

	it.each([
		0, 1, 3, 4, 10, 20, 64, 100,
	])("fits a terminal width of %s", (width) => {
		const addition = additionPrompt(
			{
				text: "New task with a long name ".repeat(10),
				reason: "Needed",
				after: "t2",
			},
			items,
		);
		for (const request of [prompt, addition]) {
			const dialog = new ApprovalDialog(request, theme as never, vi.fn());
			expect(
				dialog.render(width).every((line) => visibleWidth(line) <= width),
			).toBe(true);
		}
	});

	it("rebuilds styles after invalidation without losing the selected choice", () => {
		const done = vi.fn();
		const dialog = new ApprovalDialog(prompt, theme as never, done);
		dialog.handleInput("\u001b[B");
		dialog.render(100);
		theme.fg.mockClear();
		dialog.invalidate();
		dialog.render(100);
		expect(theme.fg).toHaveBeenCalledWith("accent", "in progress");
		expect(theme.fg).toHaveBeenCalledWith("success", "Approve");
		expect(theme.bg).not.toHaveBeenCalled();
		dialog.handleInput("\r");
		expect(done).toHaveBeenCalledWith("Approve");
	});
});

describe("approval selection", () => {
	it("uses a plain selector in RPC mode", async () => {
		const ctx = {
			mode: "rpc",
			ui: { select: vi.fn().mockResolvedValue("Approve"), custom: vi.fn() },
		};
		expect(await selectApproval(ctx as never, prompt)).toBe("Approve");
		expect(ctx.ui.select).toHaveBeenCalledWith(
			plainPrompt(prompt),
			["Decline", "Approve"],
			{ signal: undefined },
		);
		expect(ctx.ui.custom).not.toHaveBeenCalled();
	});

	it("uses custom terminal UI and requests a render on input", async () => {
		const h = customHarness();
		const pending = selectApproval(h.ctx as never, prompt);
		h.dialog.handleInput?.("\u001b[B");
		h.dialog.handleInput?.("\r");
		expect(await pending).toBe("Approve");
		expect(h.tui.requestRender).toHaveBeenCalled();
		expect(h.ctx.ui.select).not.toHaveBeenCalled();
	});

	it("does not open a dialog for an aborted request", async () => {
		const h = customHarness();
		const controller = new AbortController();
		controller.abort();
		expect(
			await selectApproval(h.ctx as never, prompt, controller.signal),
		).toBeUndefined();
		expect(h.ctx.ui.custom).not.toHaveBeenCalled();
	});

	it("closes on abort and removes the listener", async () => {
		const h = customHarness();
		const controller = new AbortController();
		const removed = vi.spyOn(controller.signal, "removeEventListener");
		const pending = selectApproval(h.ctx as never, prompt, controller.signal);
		controller.abort();
		expect(await pending).toBeUndefined();
		expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
		h.dialog.handleInput?.("\r");
		expect(h.done).toHaveBeenCalledTimes(1);
	});

	it("removes the abort listener when the UI disposes the component", () => {
		const h = customHarness();
		const controller = new AbortController();
		const removed = vi.spyOn(controller.signal, "removeEventListener");
		void selectApproval(h.ctx as never, prompt, controller.signal);
		h.dialog.dispose?.();
		controller.abort();
		expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
		expect(h.done).not.toHaveBeenCalled();
	});
});
