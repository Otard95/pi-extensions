import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import todoExtension from "../index";
import { restore } from "../session";
import { emptyState, STATE_TYPE, start } from "../state";

function harness(session = SessionManager.inMemory()) {
	const pi = {
		on: vi.fn(),
		registerTool: vi.fn(),
		registerCommand: vi.fn(),
		appendEntry: vi.fn((type: string, data: unknown) =>
			session.appendCustomEntry(type, data),
		),
		sendMessage: vi.fn(),
	};
	const ctx = {
		hasUI: true,
		mode: "rpc",
		sessionManager: session,
		ui: {
			setWidget: vi.fn(),
			custom: vi.fn(),
			select: vi.fn().mockResolvedValue("Approve"),
			input: vi.fn().mockResolvedValue("User feedback"),
			confirm: vi.fn().mockResolvedValue(true),
			notify: vi.fn(),
		},
	};
	todoExtension(pi as never);
	function handler(name: string) {
		const callback = pi.on.mock.calls.find(([event]) => event === name)?.[1];
		if (!callback) throw new Error(`Missing handler: ${name}`);
		return callback;
	}
	async function emit(name: string, event: unknown = {}) {
		return handler(name)(event, ctx);
	}
	async function call(name: string, args: unknown = {}, signal?: AbortSignal) {
		const tool = pi.registerTool.mock.calls.find(
			([tool]) => tool.name === name,
		)?.[0];
		if (!tool) throw new Error(`Missing tool: ${name}`);
		const result = await tool.execute("call", args, signal, undefined, ctx);
		const patch = await emit("tool_result", {
			toolName: name,
			details: result.details,
			isError: false,
		});
		return {
			...result,
			isError: patch?.isError ?? false,
			payload: JSON.parse(result.content[0].text),
		};
	}
	async function command(args = "abandon") {
		const command = pi.registerCommand.mock.calls.find(
			([name]) => name === "todo",
		)?.[1];
		if (!command) throw new Error("Missing todo command");
		await command.handler(args, ctx);
	}
	return { pi, ctx, session, emit, call, command };
}

describe("todo tools", () => {
	it("registers six sequential tools with strict schemas", () => {
		const h = harness();
		expect(h.pi.registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
			"todo_start",
			"todo_update",
			"todo_add",
			"todo_switch",
			"todo_get",
			"todo_dismiss",
		]);
		for (const [tool] of h.pi.registerTool.mock.calls) {
			expect(tool.executionMode).toBe("sequential");
			expect(tool.parameters.additionalProperties).toBe(false);
		}
		const update = h.pi.registerTool.mock.calls.find(
			([tool]) => tool.name === "todo_update",
		)?.[0];
		expect(update.parameters.properties.done.type).toBe("string");
		expect(update.parameters.properties.in_progress.type).toBe("string");
	});

	it.each([
		"todo_add",
		"todo_switch",
	])("uses the styled terminal prompt for %s and returns written feedback", async (name) => {
		const h = harness();
		h.ctx.mode = "tui";
		const rendered: string[] = [];
		h.ctx.ui.custom.mockImplementation(
			(factory) =>
				new Promise((resolve) => {
					const theme = {
						fg: (_color: string, text: string) => text,
						bg: (_color: string, text: string) => text,
						bold: (text: string) => text,
					};
					const dialog = factory(
						{ requestRender: vi.fn() },
						theme,
						getKeybindings(),
						resolve,
					);
					rendered.push(...dialog.render(120));
					dialog.handleInput("\u001b[B");
					dialog.handleInput("\r");
				}),
		);
		await h.call("todo_start", { items: ["A", "B"], in_progress: 1 });
		const input =
			name === "todo_add"
				? { text: "C", reason: "Needed", after: "t2" }
				: { in_progress: "t2", reason: "Needed" };
		const result = await h.call(name, input);
		expect(result.payload.decision).toBe("approved");
		expect(result.payload.feedback).toBe("User feedback");
		expect(h.ctx.ui.custom).toHaveBeenCalledTimes(1);
		expect(h.ctx.ui.select).not.toHaveBeenCalled();
		expect(rendered.join("\n")).toContain("Reason: Needed");
		if (name === "todo_switch") {
			expect(
				rendered.some((line) =>
					line.includes("t1 · A · in progress → pending"),
				),
			).toBe(true);
			expect(result.payload.update_ready).toBe(false);
		} else expect(result.payload.item.status).toBe("pending");
	});

	it("returns assigned IDs and every status change", async () => {
		const h = harness();
		const started = await h.call("todo_start", {
			items: ["A", "B"],
			in_progress: 1,
		});
		expect(started.payload.items[0]).toEqual({
			id: "t1",
			text: "A",
			status: "in_progress",
		});
		const updated = await h.call("todo_update", {
			done: "t1",
			in_progress: "t2",
		});
		expect(updated.payload.changes).toHaveLength(2);
		expect(
			updated.details.snapshot.items.map(
				(item: { status: string }) => item.status,
			),
		).toEqual(["done", "in_progress"]);
		expect(updated.payload.items).toBeUndefined();
	});

	it("does not unlock on todo_get, failed tools, invalid updates, or user prompts", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B"] });
		await h.call("todo_update", { in_progress: "t1" });
		await h.call("todo_get");
		await h.emit("tool_result", { toolName: "bash", isError: true });
		await h.emit("before_agent_start");
		const result = await h.call("todo_update", { done: "t1" });
		expect(result.isError).toBe(true);
		expect(result.payload.unchanged).toBe(true);
		expect(result.payload.guidance).toContain("confer with the user");
		await h.emit("tool_result", { toolName: "read", isError: false });
		expect((await h.call("todo_update", { done: "t1" })).payload.ok).toBe(true);
	});

	it("does not let a failed transition consume a valid unlock", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B"], in_progress: 1 });
		expect((await h.call("todo_update", { done: "t2" })).isError).toBe(true);
		expect((await h.call("todo_update", { done: "t1" })).payload.ok).toBe(true);
	});

	it.each([
		"Approve",
		"Decline",
	])("returns optional feedback for %s", async (choice) => {
		const h = harness();
		h.ctx.ui.select.mockResolvedValue(choice);
		await h.call("todo_start", { items: ["A", "B"] });
		await h.call("todo_update", { in_progress: "t1" });
		const result = await h.call("todo_add", {
			text: "C",
			reason: "New requirement",
			before: "t2",
		});
		expect(result.payload.decision).toBe(
			choice === "Approve" ? "approved" : "declined",
		);
		expect(result.payload.feedback).toBe("User feedback");
		expect(h.ctx.ui.select.mock.calls[0]?.[0]).toContain(
			"  t1 · A\n+ C\n  t2 · B",
		);
		expect(h.ctx.ui.select.mock.calls[0]?.[0]).toContain("New requirement");
		if (choice === "Approve") {
			expect(result.payload.item).toEqual({
				id: "t3",
				text: "C",
				status: "pending",
			});
			expect(
				result.details.snapshot.items.map((item: { id: string }) => item.id),
			).toEqual(["t1", "t3", "t2"]);
		} else {
			expect(result.payload.item).toBeUndefined();
		}
		const updated = await h.call("todo_update", { done: "t1" });
		expect(updated.isError).toBe(choice !== "Approve");
	});

	it("treats a canceled selection as a decline without feedback", async () => {
		const h = harness();
		h.ctx.ui.select.mockResolvedValue(undefined);
		await h.call("todo_start", { items: ["A"] });
		const result = await h.call("todo_add", {
			text: "B",
			reason: "Needed",
			after: "t1",
		});
		expect(result.payload.decision).toBe("declined");
		expect(result.payload.feedback).toBeNull();
		expect(h.ctx.ui.input).not.toHaveBeenCalled();
	});

	it("rejects invalid additions before asking the user", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A"] });
		const result = await h.call("todo_add", {
			text: "B",
			reason: "Needed",
			after: "missing",
		});
		expect(result.isError).toBe(true);
		expect(h.ctx.ui.select).not.toHaveBeenCalled();
	});

	it("fails closed without UI and on abort", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A"] });
		h.ctx.hasUI = false;
		expect(
			(await h.call("todo_add", { text: "B", reason: "Needed", after: "t1" }))
				.isError,
		).toBe(true);
		expect(h.ctx.ui.select).not.toHaveBeenCalled();
		h.ctx.hasUI = true;
		const controller = new AbortController();
		h.ctx.ui.input.mockImplementation(async () => {
			controller.abort();
			return "";
		});
		expect(
			(
				await h.call(
					"todo_add",
					{ text: "B", reason: "Needed", after: "t1" },
					controller.signal,
				)
			).isError,
		).toBe(true);
		expect(restore(h.session.getBranch()).items).toHaveLength(1);
	});

	it("does not apply stale approval after a branch change", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A"] });
		h.ctx.ui.select.mockImplementation(async () => {
			h.session.resetLeaf();
			await h.emit("session_tree");
			return "Approve";
		});
		const result = await h.call("todo_add", {
			text: "B",
			reason: "Needed",
			after: "t1",
		});
		expect(result.isError).toBe(true);
		expect(result.payload.error).toContain("changed during approval");
		expect(restore(h.session.getBranch()).phase).toBe("empty");
	});

	it("rejects early dismissal and allows dismissal after completion", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A"], in_progress: 1 });
		expect((await h.call("todo_dismiss")).isError).toBe(true);
		await h.call("todo_update", { done: "t1" });
		expect((await h.call("todo_dismiss")).payload.phase).toBe("dismissed");
		expect(h.ctx.ui.setWidget.mock.calls.at(-1)?.[1]).toBeUndefined();
	});
});

describe("approved task switches", () => {
	it.each([
		true,
		false,
	])("can request a switch when update_ready=%s and consumes permission", async (ready) => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B"] });
		await h.call("todo_update", { in_progress: "t1" });
		if (ready)
			await h.emit("tool_result", { toolName: "read", isError: false });
		const result = await h.call("todo_switch", {
			in_progress: "t2",
			reason: "A depends on B",
		});
		expect(result.payload.decision).toBe("approved");
		expect(result.payload.feedback).toBe("User feedback");
		expect(result.payload.changes).toEqual([
			{ id: "t1", text: "A", previous: "in_progress", current: "pending" },
			{ id: "t2", text: "B", previous: "pending", current: "in_progress" },
		]);
		expect(result.payload.update_ready).toBe(false);
		const prompt = h.ctx.ui.select.mock.calls[0]?.[0];
		expect(prompt).toContain("t1 · A · in progress → pending");
		expect(prompt).toContain("t2 · B · pending → in progress");
		expect(prompt).toContain("Reason: A depends on B");
		expect((await h.call("todo_update", { done: "t2" })).isError).toBe(true);
		await h.emit("tool_result", { toolName: "read", isError: false });
		expect((await h.call("todo_update", { done: "t2" })).payload.ok).toBe(true);
	});

	it.each([
		true,
		false,
	])("decline preserves state and update_ready=%s", async (ready) => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B"] });
		await h.call("todo_update", { in_progress: "t1" });
		if (ready)
			await h.emit("tool_result", { toolName: "read", isError: false });
		const previous = restore(h.session.getBranch());
		h.ctx.ui.select.mockResolvedValue("Decline");
		const result = await h.call("todo_switch", {
			in_progress: "t2",
			reason: "Needed",
		});
		expect(result.payload.decision).toBe("declined");
		expect(result.payload.feedback).toBe("User feedback");
		expect(result.payload.changes).toEqual([]);
		expect(result.payload.update_ready).toBe(ready);
		expect(restore(h.session.getBranch())).toEqual(previous);
	});

	it("treats a canceled selection as decline and empty feedback as optional", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B"], in_progress: 1 });
		h.ctx.ui.select.mockResolvedValue(undefined);
		const canceled = await h.call("todo_switch", {
			in_progress: "t2",
			reason: "Needed",
		});
		expect(canceled.payload.decision).toBe("declined");
		expect(canceled.payload.feedback).toBeNull();
		expect(h.ctx.ui.input).not.toHaveBeenCalled();
		h.ctx.ui.select.mockResolvedValue("Approve");
		h.ctx.ui.input.mockResolvedValue(undefined);
		const approved = await h.call("todo_switch", {
			in_progress: "t2",
			reason: "Needed",
		});
		expect(approved.payload.decision).toBe("approved");
		expect(approved.payload.feedback).toBeNull();
	});

	it.each([
		{ in_progress: "missing", reason: "Needed" },
		{ in_progress: "t1", reason: "Needed" },
		{ in_progress: "t2", reason: " " },
	])("rejects invalid switch %o before prompting", async (input) => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B"], in_progress: 1 });
		const previous = restore(h.session.getBranch());
		expect((await h.call("todo_switch", input)).isError).toBe(true);
		expect(h.ctx.ui.select).not.toHaveBeenCalled();
		expect(restore(h.session.getBranch())).toEqual(previous);
	});

	it("rejects switches without UI or with no current task", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B"] });
		expect(
			(await h.call("todo_switch", { in_progress: "t2", reason: "Needed" }))
				.isError,
		).toBe(true);
		await h.call("todo_update", { in_progress: "t1" });
		h.ctx.hasUI = false;
		expect(
			(await h.call("todo_switch", { in_progress: "t2", reason: "Needed" }))
				.isError,
		).toBe(true);
		expect(h.ctx.ui.select).not.toHaveBeenCalled();
		expect((await h.call("todo_get")).payload.update_ready).toBe(false);
	});

	it.each([
		"before prompt",
		"during feedback",
	])("does not switch on abort %s", async (when) => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B"], in_progress: 1 });
		const previous = restore(h.session.getBranch());
		const controller = new AbortController();
		if (when === "before prompt") controller.abort();
		else
			h.ctx.ui.input.mockImplementation(async () => {
				controller.abort();
				return "";
			});
		expect(
			(
				await h.call(
					"todo_switch",
					{ in_progress: "t2", reason: "Needed" },
					controller.signal,
				)
			).isError,
		).toBe(true);
		if (when === "before prompt")
			expect(h.ctx.ui.select).not.toHaveBeenCalled();
		expect(restore(h.session.getBranch())).toEqual(previous);
	});

	it("does not apply stale switch approval after a branch change", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B"], in_progress: 1 });
		h.ctx.ui.select.mockImplementation(async () => {
			h.session.resetLeaf();
			await h.emit("session_tree");
			return "Approve";
		});
		const result = await h.call("todo_switch", {
			in_progress: "t2",
			reason: "Needed",
		});
		expect(result.isError).toBe(true);
		expect(result.payload.error).toContain("changed during approval");
		expect(restore(h.session.getBranch()).phase).toBe("empty");
	});

	it("restores both switched statuses and the lock on reload and branch navigation", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B"], in_progress: 1 });
		const originalLeaf = h.session.getLeafId();
		if (!originalLeaf) throw new Error("Missing leaf");
		await h.call("todo_switch", { in_progress: "t2", reason: "Needed" });
		const loaded = harness(h.session);
		await loaded.emit("session_start");
		const restored = await loaded.call("todo_get");
		expect(
			restored.payload.items.map((item: { status: string }) => item.status),
		).toEqual(["pending", "in_progress"]);
		expect(restored.payload.update_ready).toBe(false);
		h.session.branch(originalLeaf);
		await loaded.emit("session_tree");
		const original = await loaded.call("todo_get");
		expect(
			original.payload.items.map((item: { status: string }) => item.status),
		).toEqual(["in_progress", "pending"]);
		expect(original.payload.update_ready).toBe(true);
	});
});

describe("todo session state", () => {
	it("restores the latest snapshot and update lock on reload", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A"] });
		await h.call("todo_update", { in_progress: "t1" });
		const loaded = harness(h.session);
		await loaded.emit("session_start");
		expect((await loaded.call("todo_get")).payload.items[0].status).toBe(
			"in_progress",
		);
		expect((await loaded.call("todo_update", { done: "t1" })).isError).toBe(
			true,
		);
	});

	it("uses only the current branch and clears state before the first snapshot", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A"] });
		const leaf = h.session.getLeafId();
		if (!leaf) throw new Error("Missing leaf");
		await h.call("todo_update", { in_progress: "t1" });
		h.session.branch(leaf);
		await h.emit("session_tree");
		expect((await h.call("todo_get")).payload.items[0].status).toBe("pending");
		h.session.resetLeaf();
		await h.emit("session_tree");
		expect((await h.call("todo_get")).payload.phase).toBe("empty");
	});

	it("puts the full snapshot in metadata and only a compact reminder in content", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B", "C"], in_progress: 1 });
		const result = await h.emit("before_agent_start");
		expect(result.message.display).toBe(false);
		expect(result.message.content).toContain("0/3 done");
		expect(result.message.details.snapshot.items).toHaveLength(3);
		expect(result.message.content).not.toContain('"items"');
		h.session.appendCustomMessageEntry(
			STATE_TYPE,
			result.message.content,
			false,
			result.message.details,
		);
		expect(restore(h.session.getBranch()).items).toHaveLength(3);
	});

	it("does not duplicate normal prompt reminders", async () => {
		const h = harness();
		const user = { role: "user" as const, content: "Hello", timestamp: 10 };
		const reminder = (await h.emit("before_agent_start")).message;
		const result = await h.emit("context", {
			messages: [user, { ...reminder, role: "custom", timestamp: 11 }],
		});
		expect(result.messages).toHaveLength(2);
		expect(h.pi.appendEntry).not.toHaveBeenCalled();
	});

	it("finds normal reminders after messages from other extensions", async () => {
		const h = harness();
		const user = { role: "user" as const, content: "Hello", timestamp: 10 };
		const reminder = (await h.emit("before_agent_start")).message;
		const other = {
			role: "custom",
			customType: "other",
			content: "Other state",
			display: false,
			timestamp: 11,
		};
		const input = {
			messages: [user, other, { ...reminder, role: "custom", timestamp: 12 }],
		};
		expect((await h.emit("context", input)).messages).toHaveLength(3);
		expect(h.pi.appendEntry).not.toHaveBeenCalled();
	});

	it("does not create current-state reminders for historical user messages", async () => {
		const session = SessionManager.inMemory();
		const user = {
			role: "user" as const,
			content: "Old request",
			timestamp: 1,
		};
		session.appendMessage(user);
		const h = harness(session);
		await h.emit("session_start");
		await h.call("todo_start", { items: ["New plan"] });
		expect((await h.emit("context", { messages: [user] })).messages).toEqual([
			user,
		]);
	});

	it("restores state from hidden message metadata without mutation entries", async () => {
		const session = SessionManager.inMemory();
		const snapshot = { ...start(emptyState(), ["A", "B"], 2), revision: 7 };
		session.appendCustomMessageEntry(STATE_TYPE, "Compact state", false, {
			snapshot,
		});
		const h = harness(session);
		await h.emit("session_start");
		expect((await h.call("todo_get")).payload.items).toEqual(snapshot.items);
	});

	it("keeps snapshots across compaction and uses increasing revisions for new lists", async () => {
		const h = harness();
		const first = await h.call("todo_start", { items: ["A"], in_progress: 1 });
		await h.call("todo_update", { done: "t1" });
		await h.call("todo_dismiss");
		const second = await h.call("todo_start", { items: ["B"] });
		expect(second.details.snapshot.revision).toBeGreaterThan(
			first.details.snapshot.revision,
		);
		const leaf = h.session.getLeafId();
		if (!leaf) throw new Error("Missing leaf");
		h.session.appendCompaction("Summary", leaf, 1000);
		const loaded = harness(h.session);
		await loaded.emit("session_start");
		expect((await loaded.call("todo_get")).payload.items[0].text).toBe("B");
	});

	it("adds a hidden steering reminder, persists it, and restores it after reload", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B"], in_progress: 1 });
		const user = {
			role: "user" as const,
			content: "Change direction",
			timestamp: 20,
		};
		h.session.appendMessage(user);
		const input: { messages: AgentMessage[] } = { messages: [user] };
		const result = await h.emit("context", input);
		expect(result.messages[1].customType).toBe(STATE_TYPE);
		expect(result.messages[1].details.snapshot.items).toHaveLength(2);
		expect(result.messages[1].display).toBe(false);
		expect(h.pi.sendMessage).not.toHaveBeenCalled();
		const loaded = harness(h.session);
		await loaded.emit("session_start");
		expect((await loaded.emit("context", input)).messages).toEqual(
			result.messages,
		);
	});

	it("keeps the full panel and wraps long tasks at narrow widths", async () => {
		const h = harness();
		const tasks = [
			"A long task that wraps across multiple lines",
			"Second task",
			"Third task",
		];
		await h.call("todo_start", { items: tasks, in_progress: 1 });
		const widget = h.ctx.ui.setWidget.mock.calls.at(-1)?.[1];
		const theme = {
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		};
		const component = widget({}, theme);
		const lines: string[] = component.render(16);
		expect(lines.every((line) => visibleWidth(line) <= 16)).toBe(true);
		expect(lines.join(" ")).toContain("Third task");
		expect(lines.join(" ")).toContain("> t1");
		expect(component.render(0)).toEqual([]);
	});

	it("ignores older snapshots and malformed metadata", () => {
		const session = SessionManager.inMemory();
		const newest = { ...start(emptyState(), ["New"]), revision: 3 };
		session.appendCustomEntry(STATE_TYPE, { snapshot: newest });
		session.appendCustomMessageEntry(STATE_TYPE, "Old", false, {
			snapshot: { ...emptyState(), revision: 1 },
		});
		session.appendCustomEntry(STATE_TYPE, { snapshot: { version: 99 } });
		expect(restore(session.getBranch())).toEqual(newest);
	});
});

describe("user-only abandonment", () => {
	it("confirms, records the reason, and tells the agent without completing tasks", async () => {
		const h = harness();
		await h.call("todo_start", { items: ["A", "B"], in_progress: 1 });
		await h.command();
		expect(h.ctx.ui.confirm.mock.calls[0]?.[1]).toContain("t2: B");
		const state = restore(h.session.getBranch());
		expect(state.phase).toBe("abandoned");
		expect(state.reason).toBe("User feedback");
		expect(state.items.map((item) => item.status)).toEqual([
			"in_progress",
			"pending",
		]);
		expect(h.pi.sendMessage.mock.calls[0]?.[0].content).toContain(
			"abandoned by the user",
		);
		expect(
			(await h.call("todo_start", { items: ["New plan"] })).payload.ok,
		).toBe(true);
	});

	it("keeps the list when confirmation is declined", async () => {
		const h = harness();
		h.ctx.ui.confirm.mockResolvedValue(false);
		await h.call("todo_start", { items: ["A"] });
		await h.command();
		expect(restore(h.session.getBranch()).phase).toBe("active");
		expect(h.ctx.ui.input).not.toHaveBeenCalled();
	});
});
