import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toolRendering } from "../render";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: vi.fn((_color: string, text: string) => text),
};

function contentLines(name: string, lines: string[]): string[] {
	const content =
		name === "todo_start" || name === "todo_add"
			? lines.slice(1, -1).map((line) => line.slice(1))
			: lines;
	return content.map((line) => line.trimEnd());
}

function render(
	name: string,
	details: unknown,
	options: {
		expanded?: boolean;
		isPartial?: boolean;
		isError?: boolean;
		text?: string;
		width?: number;
	} = {},
) {
	const renderer = toolRendering(name).renderResult;
	if (!renderer) throw new Error("Missing result renderer");
	return contentLines(
		name,
		renderer(
			{
				details,
				content: [
					{ type: "text", text: options.text ?? "raw JSON must stay hidden" },
				],
			},
			{
				expanded: options.expanded ?? false,
				isPartial: options.isPartial ?? false,
			},
			theme as never,
			{ isError: options.isError ?? false } as never,
		).render(options.width ?? 100),
	);
}

function renderCall(name: string, isPartial: boolean) {
	const renderer = toolRendering(name).renderCall;
	if (!renderer) throw new Error("Missing call renderer");
	return contentLines(
		name,
		renderer({}, theme as never, { isPartial } as never).render(100),
	);
}

describe("todo chat rendering", () => {
	beforeEach(() => theme.bg.mockClear());

	it.each([
		["todo_start", { ok: true, items: [] }, "toolSuccessBg"],
		[
			"todo_add",
			{ ok: true, decision: "approved", item: { id: "t2", text: "New task" } },
			"toolSuccessBg",
		],
		[
			"todo_add",
			{ ok: true, decision: "declined", proposal: { text: "New task" } },
			"toolErrorBg",
		],
		["todo_start", { ok: false, error: "List exists" }, "toolErrorBg"],
		["todo_add", { ok: false, error: "Invalid placement" }, "toolErrorBg"],
	] as const)("uses the configured result background for %s", (name, details, color) => {
		render(name, details);
		expect(theme.bg.mock.calls.length).toBeGreaterThan(0);
		expect(theme.bg.mock.calls.every(([used]) => used === color)).toBe(true);
	});

	it.each([
		"todo_start",
		"todo_add",
	])("uses a pending background for %s", (name) => {
		renderCall(name, true);
		expect(
			theme.bg.mock.calls.every(([color]) => color === "toolPendingBg"),
		).toBe(true);
		expect(theme.bg.mock.calls.length).toBeGreaterThan(0);
	});

	it("hides todo_get calls and successful results, even when expanded", () => {
		expect(toolRendering("todo_get").renderShell).toBe("self");
		expect(renderCall("todo_get", true)).toEqual([]);
		expect(renderCall("todo_get", false)).toEqual([]);
		for (const expanded of [false, true]) {
			expect(
				render(
					"todo_get",
					{ ok: true, items: [{ id: "t1", text: "Hidden list" }] },
					{ expanded },
				),
			).toEqual([]);
		}
	});

	it("shows pending activity only until a result arrives", () => {
		expect(renderCall("todo_add", true).join("\n")).toBe(
			"Todos · Waiting for approval…",
		);
		expect(renderCall("todo_add", false)).toEqual([]);
		expect(render("todo_add", undefined, { isPartial: true })).toEqual([]);
	});

	it.each([
		1, 3,
	])("summarizes a new list with %s tasks without repeating the panel", (count) => {
		const items = Array.from({ length: count }, () => ({
			id: "t1",
			text: "Only in panel",
		}));
		const text = render("todo_start", { ok: true, items }).join("\n");
		expect(text).toBe(
			`Todos · Started list with ${count} ${count === 1 ? "task" : "tasks"}`,
		);
		expect(text).not.toContain("Only in panel");
	});

	it("renders both sides of a handoff and expands previous statuses", () => {
		const details = {
			ok: true,
			changes: [
				{
					id: "t1",
					text: "First task",
					previous: "in_progress",
					current: "done",
				},
				{
					id: "t2",
					text: "Second task",
					previous: "pending",
					current: "in_progress",
				},
			],
		};
		expect(render("todo_update", details)).toEqual([
			"✓ t1 · First task",
			"> t2 · Second task",
		]);
		expect(render("todo_update", details, { expanded: true })).toEqual([
			"✓ t1 · First task",
			"  in progress → done",
			"> t2 · Second task",
			"  pending → in progress",
		]);
	});

	it.each([
		"approved",
		"declined",
	])("shows %s addition feedback without JSON", (decision) => {
		const details = {
			ok: true,
			decision,
			feedback: "Please test restoration too",
			item:
				decision === "approved"
					? { id: "t4", text: "Test rendering" }
					: undefined,
			proposal: {
				text: "Test rendering",
				reason: "Requested by the user",
				before: "t3",
			},
		};
		const text = render("todo_add", details).join("\n");
		expect(text).toContain(
			decision === "approved" ? "Added t4" : "Addition declined",
		);
		expect(text).toContain("Feedback: Please test restoration too");
		expect(text).not.toContain("raw JSON");
		const expanded = render("todo_add", details, { expanded: true }).join("\n");
		expect(expanded).toContain("Before t3");
		expect(expanded).toContain("Reason: Requested by the user");
	});

	it("renders an approved switch without marking the old task done", () => {
		const details = {
			ok: true,
			decision: "approved",
			feedback: "Do B first",
			proposal: { in_progress: "t2", reason: "A depends on B" },
			changes: [
				{ id: "t1", text: "A", previous: "in_progress", current: "pending" },
				{ id: "t2", text: "B", previous: "pending", current: "in_progress" },
			],
		};
		expect(renderCall("todo_switch", true)).toEqual([
			"Todos · Waiting for switch approval…",
		]);
		expect(render("todo_switch", details)).toEqual([
			"Todos · Switch approved",
			"· t1 · A",
			"> t2 · B",
			"Feedback: Do B first",
		]);
		const expanded = render("todo_switch", details, { expanded: true }).join(
			"\n",
		);
		expect(expanded).toContain("in progress → pending");
		expect(expanded).toContain("pending → in progress");
		expect(expanded).toContain("Reason: A depends on B");
	});

	it("renders a declined switch and its feedback without status changes", () => {
		expect(
			render("todo_switch", {
				ok: true,
				decision: "declined",
				feedback: "Finish A first",
				changes: [],
			}),
		).toEqual(["Todos · Switch declined", "Feedback: Finish A first"]);
	});

	it("omits empty feedback and summarizes dismissal", () => {
		expect(
			render("todo_add", {
				ok: true,
				decision: "declined",
				feedback: null,
				proposal: { text: "New task" },
			}),
		).toEqual(["Todos · Addition declined · New task"]);
		expect(render("todo_dismiss", { ok: true })).toEqual([
			"Todos · Completed list dismissed",
		]);
	});

	it("keeps structured errors visible without repeating the full state", () => {
		const text = render("todo_update", {
			ok: false,
			error: "Complete the current task first.",
			items: [{ text: "Panel only" }],
		}).join("\n");
		expect(text).toBe("Todos · Complete the current task first.");
		expect(text).not.toContain("Panel only");
	});

	it("keeps framework errors visible, including errors from todo_get", () => {
		expect(
			render("todo_get", undefined, {
				isError: true,
				text: "Unexpected failure",
			}),
		).toEqual(["Todos · Unexpected failure"]);
	});

	it("wraps long text and removes control characters", () => {
		const lines = render(
			"todo_add",
			{
				ok: true,
				decision: "declined",
				feedback: `A long response ${String.fromCharCode(27)} with enough words to wrap`,
				proposal: { text: "New task" },
			},
			{ width: 12 },
		);
		expect(lines.every((line) => visibleWidth(line) <= 12)).toBe(true);
		expect(lines.join(" ")).not.toContain(String.fromCharCode(27));
	});
});
