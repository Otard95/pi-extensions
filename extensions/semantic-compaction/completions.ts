import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { at } from "../../utils/array/at";
import { Result } from "../../utils/monad/result";
import { parseMode } from "./args";

const MODE_COMPLETION_OPTIONS = [
	{
		value: "tools",
		label: "tools",
		description: "Compress tool calls",
	},
];
const KEEP_KEYWORD = [
	{
		value: "keep",
		label: "keep",
		description: "Change how much to keep uncompressed",
	},
];
const KEEP_MODE_OPTIONS = [
	{
		value: "percent",
		label: "percent",
		description: "Keep some percent of the conversation uncompressed",
	},
	{
		value: "messages",
		label: "messages",
		description:
			"Keep some number of messages of the conversation uncompressed",
	},
	{
		value: "turns",
		label: "turns",
		description: "Keep some number of turns of the conversation uncompressed",
	},
];
export function completions(prefix: string): AutocompleteItem[] | null {
	const parts = prefix.split(/\s+/).filter(Boolean);

	const fixValue = (
		comp: AutocompleteItem[] | null,
	): AutocompleteItem[] | null => {
		return (
			comp?.map((c) => ({
				...c,
				value:
					`${parts.slice(0, parts.length - 1).join(" ")} ${c.value}`.trim(),
			})) ?? null
		);
	};

	switch (parts.length) {
		case 0:
			return null;
		case 1:
			return fixValue(
				filterCompletions(at(parts, 0), MODE_COMPLETION_OPTIONS, KEEP_KEYWORD),
			);
		case 2:
			if (parts[0] === "keep")
				return fixValue(filterCompletions(at(parts, 1), KEEP_MODE_OPTIONS));
			if (Result.try(() => parseMode(at(parts, 0))).isOk())
				return fixValue(filterCompletions(at(parts, 1), KEEP_KEYWORD));
			break;
		case 3:
			if (
				Result.try(() => parseMode(at(parts, 0))).isOk() &&
				parts[1] === "keep"
			)
				return fixValue(filterCompletions(at(parts, 2), KEEP_MODE_OPTIONS));
	}
	return null;
}

function filterCompletions(
	prefix: string,
	...completions: AutocompleteItem[][]
): AutocompleteItem[] | null {
	return completions.flat().filter((c) => c.value.startsWith(prefix));
}
