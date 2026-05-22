/**
 * Read Line Numbers Extension
 *
 * Adds line numbers to the output of the built-in `read` tool so the LLM can
 * reliably reference specific lines in follow-up edits or comments.
 *
 * ## Why
 *
 * Without line numbers in the tool output the model has to count lines itself,
 * which it does poorly — especially across truncated or offset reads. When
 * trained on data where `read` output included numbers, the model would
 * reference list-item ordinals as if they were line numbers, producing
 * systematically wrong references (e.g. "Line 2: …" pointing to item 2 of a
 * numbered list on line 9).
 *
 * ## How
 *
 * Hooks into the `tool_result` event and post-processes every text block
 * returned by the `read` tool. Line numbers start at `offset` (or 1 when no
 * offset was requested) and are right-padded to a consistent width so the
 * content column stays aligned.
 *
 * Edge cases handled:
 * - **Images** — ImageContent blocks are passed through unchanged.
 * - **Error results** — left unchanged; the text is an error message, not
 *   file content.
 * - **Pure metadata** — when the first line of a file exceeds the byte limit
 *   the read tool returns a single bracketed message with no real content.
 *   This is left as-is.
 * - **Trailing continuation notices** — the read tool appends notices like
 *   `[Showing lines X–Y of Z. Use offset=N to continue.]` separated from the
 *   content by a blank line. These are detected and excluded from numbering,
 *   then re-attached verbatim.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isReadToolResult } from "@mariozechner/pi-coding-agent";
import { last } from "../../utils/array/last";

const metadataRx = /^\[.*\]$/;

/**
 * Add 1-indexed line numbers to a text block returned by the read tool.
 *
 * @param text      The raw text from a TextContent block.
 * @param startLine The line number of the first line in the block (from
 *                  `offset`, defaulting to 1).
 * @returns         The text with each content line prefixed by its number.
 */
function addLineNumbers(text: string, startLine: number): string {
	// Pure metadata message — the entire content is a bracketed notice with no
	// real file lines (e.g. "[Line 1 is 120KB, exceeds 50KB limit. Use bash…]").
	if (metadataRx.test(text.trim())) {
		return text;
	}

	let metadataLines: string[] = [];
	const lines = text.split("\n");
	if (metadataRx.test(last(lines) ?? "")) {
		metadataLines = lines.splice(lines.length - 2, 2);
	}

	const lastLineNum = startLine + lines.length - 1;
	// Pad all numbers to the same width so the content column is aligned.
	const width = String(lastLineNum).length;

	const numbered = lines.map((line, i) => {
		const lineNum = String(startLine + i).padStart(width, " ");
		return `${lineNum}: ${line}`;
	});

	numbered.push(...metadataLines);
	return numbered.join("\n");
}

export default function readLineNumbersExtension(pi: ExtensionAPI) {
	pi.on("tool_result", (event) => {
		if (!isReadToolResult(event)) return;
		// Don't touch error results — the text is a diagnostic message, not
		// file content.
		if (event.isError) return;

		const offset = event.input["offset"];
		const startLine = typeof offset === "number" ? offset : 1;

		const newContent = event.content.map((block) => {
			if (block.type !== "text") return block;
			return {
				type: "text" as const,
				text: addLineNumbers(block.text, startLine),
			};
		});

		return { content: newContent };
	});
}
