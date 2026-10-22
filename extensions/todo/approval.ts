import {
	DynamicBorder,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Box,
	type Component,
	Container,
	SelectList,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { plain } from "./render";
import {
	type Addition,
	type Change,
	type Status,
	type Todo,
	TodoError,
} from "./state";

interface TaskRow {
	kind?: "added" | "context";
	id?: string;
	text: string;
	previous?: Status;
	current: Status;
}

export interface ApprovalPrompt {
	title: string;
	tasks: TaskRow[];
	reason: string;
}

export function additionPrompt(
	proposal: Addition,
	items: readonly Todo[],
): ApprovalPrompt {
	const anchor = items.findIndex(
		(item) => item.id === (proposal.before ?? proposal.after),
	);
	if (anchor < 0) throw new TodoError("The placement task no longer exists.");
	const insertion = anchor + (proposal.before === undefined ? 1 : 0);
	const above = items[insertion - 1];
	const below = items[insertion];
	const tasks: TaskRow[] = [];
	if (above)
		tasks.push({
			kind: "context",
			id: above.id,
			text: above.text,
			current: above.status,
		});
	tasks.push({ kind: "added", text: proposal.text, current: "pending" });
	if (below)
		tasks.push({
			kind: "context",
			id: below.id,
			text: below.text,
			current: below.status,
		});
	return { title: "Add task?", tasks, reason: proposal.reason };
}

export function switchPrompt(
	changes: Change[],
	reason: string,
): ApprovalPrompt {
	return { title: "Switch tasks?", tasks: changes, reason };
}

function statusText(status: Status): string {
	return status.replaceAll("_", " ");
}

export function plainPrompt(prompt: ApprovalPrompt): string {
	return [
		prompt.title,
		...prompt.tasks.map((task) => {
			if (task.kind === "added") return `+ ${plain(task.text)}`;
			if (task.kind === "context") return `  ${task.id} · ${plain(task.text)}`;
			return `${task.id ? `${task.id} · ` : ""}${plain(task.text)} · ${task.previous ? `${statusText(task.previous)} → ` : ""}${statusText(task.current)}`;
		}),
		`Reason: ${plain(prompt.reason)}`,
	].join("\n");
}

export class ApprovalDialog implements Component {
	private readonly choices: SelectList;

	constructor(
		private readonly prompt: ApprovalPrompt,
		private readonly theme: Theme,
		onChoice: (choice: string | undefined) => void,
		private readonly hints = "↑↓ navigate  enter select  esc cancel",
	) {
		this.choices = new SelectList(
			[
				{ value: "Decline", label: "Decline" },
				{ value: "Approve", label: "Approve" },
			],
			2,
			{
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => text,
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			},
			{
				truncatePrimary: ({ item, text, maxWidth }) =>
					theme.fg(
						item.value === "Approve" ? "success" : "error",
						truncateToWidth(text, maxWidth),
					),
			},
		);
		this.choices.onSelect = (item) => onChoice(item.value);
		this.choices.onCancel = () => onChoice(undefined);
	}

	handleInput(data: string): void {
		this.choices.handleInput(data);
	}

	invalidate(): void {
		this.choices.invalidate();
	}

	private taskRow(task: TaskRow, width: number): string {
		const th = this.theme;
		if (task.kind === "added")
			return th.fg("success", truncateToWidth(`+ ${plain(task.text)}`, width));
		if (task.kind === "context")
			return th.fg(
				"muted",
				truncateToWidth(
					`  ${plain(task.id ?? "")} · ${plain(task.text)}`,
					width,
				),
			);
		const status = (value: Status) =>
			th.fg(
				value === "in_progress"
					? "accent"
					: value === "done"
						? "success"
						: "muted",
				statusText(value),
			);
		const transition = task.previous
			? `${status(task.previous)} → ${status(task.current)}`
			: status(task.current);
		const prefix = task.id ? `${plain(task.id)} · ` : "";
		const available = width - visibleWidth(transition) - 3;
		if (available <= visibleWidth(prefix))
			return truncateToWidth(`${prefix}${transition}`, width);
		const taskText = truncateToWidth(`${prefix}${plain(task.text)}`, available);
		return `${taskText} · ${transition}`;
	}

	render(width: number): string[] {
		if (width < 4)
			return width > 0 ? [truncateToWidth(this.prompt.title, width)] : [];
		const th = this.theme;
		const container = new Container();
		container.addChild(new DynamicBorder((line) => th.fg("border", line)));
		container.addChild(new Spacer(1));
		const box = new Box(1, 0);
		box.addChild(new Text(th.fg("accent", th.bold(this.prompt.title)), 0, 0));
		for (const task of this.prompt.tasks) {
			box.addChild({
				render: (innerWidth) => [this.taskRow(task, innerWidth)],
				invalidate() {},
			});
		}
		box.addChild(new Text(`Reason: ${plain(this.prompt.reason)}`, 0, 0));
		box.addChild(new Spacer(1));
		box.addChild(this.choices);
		box.addChild(new Spacer(1));
		box.addChild(new Text(this.hints, 0, 0));
		container.addChild(box);
		container.addChild(new Spacer(1));
		container.addChild(new DynamicBorder((line) => th.fg("border", line)));
		return container.render(width);
	}
}

export async function selectApproval(
	ctx: ExtensionContext,
	prompt: ApprovalPrompt,
	signal?: AbortSignal,
): Promise<string | undefined> {
	if (signal?.aborted) return undefined;
	if (ctx.mode !== "tui") {
		return ctx.ui.select(plainPrompt(prompt), ["Decline", "Approve"], {
			signal,
		});
	}
	return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
		let settled = false;
		const cleanup = () => signal?.removeEventListener("abort", abort);
		const finish = (choice: string | undefined) => {
			if (settled) return;
			settled = true;
			cleanup();
			done(choice);
		};
		const abort = () => finish(undefined);
		const hints = `↑↓ navigate  ${keybindings.getKeys("tui.select.confirm").join("/") || "unbound"} select  ${keybindings.getKeys("tui.select.cancel").join("/") || "unbound"} cancel`;
		const dialog = new ApprovalDialog(prompt, theme, finish, hints);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) queueMicrotask(abort);
		return {
			render: (width) => dialog.render(width),
			invalidate: () => dialog.invalidate(),
			handleInput(data) {
				dialog.handleInput(data);
				tui.requestRender();
			},
			dispose() {
				settled = true;
				cleanup();
			},
		};
	});
}
