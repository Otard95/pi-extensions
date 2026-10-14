import domino from "@mixmark-io/domino";
import TurndownService from "turndown";

const ALWAYS_REMOVE = [
	"style",
	"script",
	"noscript",
	"svg",
	"canvas",
	"template",
	"iframe",
	"object",
	"embed",
];

const OPTIONAL_REMOVE: Record<string, { tags: string[]; default: boolean }> = {
	nav: { tags: ["nav"], default: false },
	header: { tags: ["header"], default: false },
	footer: { tags: ["footer"], default: true },
};

function remove(
	document: ReturnType<typeof domino.createDocument>,
	selectors: string[],
): void {
	for (const selector of selectors) {
		for (const node of Array.from(document.querySelectorAll(selector))) {
			node.remove();
		}
	}
}

export function extractTitle(html: string): string {
	const document = domino.createDocument(html);
	return document.querySelector("title")?.textContent?.trim() ?? "";
}

type StripSettings = {
	nav?: boolean;
	header?: boolean;
	footer?: boolean;
};

export function htmlToMarkdown(
	html: string,
	strip: StripSettings = {},
): string {
	const document = domino.createDocument(html);
	const optional = Object.entries(OPTIONAL_REMOVE).flatMap(([key, option]) => {
		const value = strip[key as keyof typeof strip];
		return (typeof value === "boolean" ? value : option.default)
			? option.tags
			: [];
	});

	remove(document, [
		...ALWAYS_REMOVE,
		...optional,
		"[hidden]",
		'[aria-hidden="true"]',
		"[inert]",
		'img[src^="data:"]',
		"img:not([src])",
		'img[src=""]',
	]);

	return new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
	}).turndown(document.querySelector("body")?.innerHTML ?? html);
}
