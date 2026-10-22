import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text } from "@earendil-works/pi-tui";
import type { Addition, Change, Switch, Todo } from "./state";

export function plain(text: string): string {
	return Array.from(text.replace(/\s+/g, " "))
		.filter((char) => {
			const code = char.codePointAt(0) ?? 0;
			return code >= 32 && (code < 127 || code > 159);
		})
		.join("");
}

interface Details {
	ok?: boolean;
	error?: string;
	items?: Todo[];
	changes?: Change[];
	decision?: string;
	feedback?: string | null;
	proposal?: Addition | Switch;
	item?: Todo;
}

const pending: Record<string, string> = {
	todo_start: "Starting list…",
	todo_update: "Updating tasks…",
	todo_add: "Waiting for approval…",
	todo_switch: "Waiting for switch approval…",
	todo_dismiss: "Dismissing list…",
};

function renderText(
	text: string,
	theme: Theme,
	background?: "toolPendingBg" | "toolSuccessBg" | "toolErrorBg",
) {
	const content = new Text(text, 0, 0);
	if (!background) return content;
	const box = new Box(1, 1, (line) => theme.bg(background, line));
	box.addChild(content);
	return box;
}

export function toolRendering(
	name: string,
): Pick<ToolDefinition, "renderShell" | "renderCall" | "renderResult"> {
	const hasBackground = name === "todo_start" || name === "todo_add";
	return {
		renderShell: "self",
		renderCall(_args, theme, context) {
			if (name === "todo_get" || !context.isPartial) return new Container();
			return renderText(
				theme.fg("muted", `Todos · ${pending[name] ?? name}`),
				theme,
				hasBackground ? "toolPendingBg" : undefined,
			);
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			if (isPartial) return new Container();
			const details = result.details as Details | undefined;
			if (context.isError || details?.ok === false) {
				const error =
					details?.error ??
					result.content
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("\n");
				return renderText(
					theme.fg("error", `Todos · ${plain(error || "Tool failed.")}`),
					theme,
					hasBackground ? "toolErrorBg" : undefined,
				);
			}
			if (name === "todo_get") return new Container();
			const lines: string[] = [];
			switch (name) {
				case "todo_start": {
					const count = details?.items?.length ?? 0;
					lines.push(
						theme.fg(
							"success",
							`Todos · Started list with ${count} ${count === 1 ? "task" : "tasks"}`,
						),
					);
					break;
				}
				case "todo_update":
					for (const change of details?.changes ?? []) {
						const done = change.current === "done";
						lines.push(
							theme.fg(
								done ? "success" : "accent",
								`${done ? "✓" : ">"} ${change.id} · ${plain(change.text)}`,
							),
						);
						if (expanded)
							lines.push(
								theme.fg(
									"dim",
									`  ${change.previous.replaceAll("_", " ")} → ${change.current.replaceAll("_", " ")}`,
								),
							);
					}
					break;
				case "todo_switch": {
					const approved = details?.decision === "approved";
					lines.push(
						theme.fg(
							approved ? "success" : "muted",
							`Todos · Switch ${approved ? "approved" : "declined"}`,
						),
					);
					if (approved) {
						for (const change of details?.changes ?? []) {
							const waiting = change.current === "pending";
							lines.push(
								theme.fg(
									waiting ? "muted" : "accent",
									`${waiting ? "·" : ">"} ${change.id} · ${plain(change.text)}`,
								),
							);
							if (expanded)
								lines.push(
									theme.fg(
										"dim",
										`  ${change.previous.replaceAll("_", " ")} → ${change.current.replaceAll("_", " ")}`,
									),
								);
						}
					}
					if (details?.feedback)
						lines.push(
							theme.fg("text", `Feedback: ${plain(details.feedback)}`),
						);
					if (expanded && details?.proposal)
						lines.push(
							theme.fg("dim", `Reason: ${plain(details.proposal.reason)}`),
						);
					break;
				}
				case "todo_add": {
					const proposal = details?.proposal;
					const addition =
						proposal && "text" in proposal ? proposal : undefined;
					const approved = details?.decision === "approved";
					const text =
						approved && details.item
							? `Added ${details.item.id} · ${plain(details.item.text)}`
							: `Addition declined · ${plain(addition?.text ?? "")}`;
					lines.push(
						theme.fg(approved ? "success" : "muted", `Todos · ${text}`),
					);
					if (details?.feedback)
						lines.push(
							theme.fg("text", `Feedback: ${plain(details.feedback)}`),
						);
					if (expanded && addition) {
						const proposal = addition;
						lines.push(
							theme.fg(
								"dim",
								`${proposal.before === undefined ? "After" : "Before"} ${plain(proposal.before ?? proposal.after ?? "")}`,
							),
						);
						lines.push(theme.fg("dim", `Reason: ${plain(proposal.reason)}`));
					}
					break;
				}
				case "todo_dismiss":
					lines.push(theme.fg("success", "Todos · Completed list dismissed"));
					break;
			}
			return lines.length
				? renderText(
						lines.join("\n"),
						theme,
						hasBackground
							? details?.decision === "declined"
								? "toolErrorBg"
								: "toolSuccessBg"
							: undefined,
					)
				: new Container();
		},
	};
}
