import { type ExtensionAPI, keyHint } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { fetchPage, normalizeUrl } from "./fetch";
import { renderPage } from "./render";

const WebReadParams = Type.Object({
	url: Type.String({ description: "The URL to fetch" }),
	offset: Type.Optional(
		Type.Number({ description: "Line to start reading from (1-indexed)" }),
	),
	limit: Type.Optional(
		Type.Number({
			description: "Max lines to return (default: 50)",
			maximum: 1000,
		}),
	),
	pattern: Type.Optional(
		Type.String({ description: "Regex pattern to search for in the page" }),
	),
	context: Type.Optional(
		Type.Number({
			description: "Number of context lines around each match (default: 0)",
		}),
	),
	refresh: Type.Optional(
		Type.Boolean({ description: "Bypass cache and re-fetch the page" }),
	),
	render: Type.Optional(
		StringEnum(["simple", "advanced"] as const, {
			description:
				"Rendering method: 'simple' (default) uses plain fetch, " +
				"'advanced' uses a headless browser for JS-heavy pages. " +
				"'advanced' only works after 'simple' has been attempted on the same domain.",
		}),
	),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_read",
		label: "Web Read",
		description: [
			"Fetch a web page and read its content as markdown.",
			"Use offset/limit to paginate, pattern to search, or combine them.",
		].join("\n"),
		parameters: WebReadParams,
		renderCall(args, theme, _context) {
			const normalized = normalizeUrl(args.url ?? "");
			const clean = normalized.isOk()
				? normalized.unwrap().host + normalized.unwrap().pathname
				: (args.url ?? "...").replace(/^https?:\/\//, "");
			const url = clean.length > 50 ? `${clean.slice(0, 47)}...` : clean;
			let text = theme.fg("toolTitle", theme.bold("web_read "));
			text += theme.fg("accent", url);

			const parts: string[] = [];
			if (args.offset) parts.push(`offset=${args.offset}`);
			if (args.limit) parts.push(`limit=${args.limit}`);
			if (args.pattern) parts.push(`/${args.pattern}/`);
			if (args.context) parts.push(`context=${args.context}`);
			if (args.refresh) parts.push("refresh");
			if (args.render) parts.push(`render=${args.render}`);
			if (parts.length > 0) {
				text += theme.fg("dim", ` (${parts.join(", ")})`);
			}

			return new Text(text, 0, 0);
		},
		execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
			const {
				url,
				offset,
				limit = 50,
				pattern,
				context: contextLines = 0,
				refresh = false,
				render,
			} = params;

			let regexp: RegExp | undefined;
			if (pattern) {
				try {
					regexp = new RegExp(pattern);
				} catch (err) {
					return {
						content: [{ type: "text", text: `'pattern' is invalid: ${err}` }],
						isError: true,
						details: {},
					};
				}
			}

			// Normalize URL for the renderer path
			const normalizedUrl = normalizeUrl(url);

			// Fetch page: use playwright renderer or simple fetch
			const fetchResult =
				render === "advanced" && normalizedUrl.isOk()
					? await renderPage(normalizedUrl.unwrap(), refresh)
					: await fetchPage(url, refresh);

			const site = fetchResult.map((s) =>
				s
					.filter(regexp)
					.context(contextLines)
					.offset(offset)
					.limit(limit)
					.render(),
			);

			if (site.isErr()) {
				return {
					content: [{ type: "text", text: site.unwrapErr().message }],
					isError: true,
					details: {},
				};
			}

			return {
				content: [{ type: "text", text: site.unwrap() }],
				details: {},
			};
		},
		renderResult(result, options, theme, context) {
			const text =
				(context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const output =
				result.content
					.filter((c) => c.type === "text")
					.map((c) => ("text" in c ? c.text : ""))
					.join("\n") || "";
			const lines = output.split("\n");
			const maxLines = options.expanded ? lines.length : 10;
			const displayLines = lines.slice(0, maxLines);
			const remaining = lines.length - maxLines;

			let rendered = displayLines
				.map((l) => theme.fg("toolOutput", l))
				.join("\n");

			if (remaining > 0) {
				rendered += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
			}

			text.setText(`\n${rendered}`);
			return text;
		},
	});
}
