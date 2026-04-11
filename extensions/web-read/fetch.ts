/**
 * Fetch a URL, convert HTML to markdown via turndown, and cache the result.
 */
import TurndownService from "turndown";
import { Option } from "../../utils/monad/option";
import { Result } from "../../utils/monad/result";
import { getSiteCache, writeSiteCache } from "./cache";
import type { Site } from "./site";

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
});
const fetchOpts: RequestInit = {
	headers: {
		Accept: "text/html,application/xhtml+xml,*/*",
	},
};

/**
 * Fetch a page, convert to markdown, and write to cache.
 * Returns cache metadata or an error.
 */
export async function fetchPage(
	rawUrl: string,
	refresh: boolean,
): Promise<Result<Site>> {
	const urlResult = normalizeUrl(rawUrl);
	if (urlResult.isErr()) return Result.Err(urlResult.unwrapErr());
	const url = urlResult.unwrap();

	const cache = !refresh ? getSiteCache(url) : Result.Ok(Option.None<Site>());
	if (cache.isErr()) return Result.Err(cache.unwrapErr());

	const cached = cache.unwrap();
	if (cached.isSome()) return Result.Ok(cached.unwrap());

	const response = await Result.fromPromise(fetch(url, fetchOpts));

	const text = await response
		.mapErr(
			(err) =>
				new Error(
					`Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
				),
		)
		.flatMap((r) =>
			r.ok
				? Result.Ok(r)
				: Result.Err(
						new Error(`HTTP ${r.status} ${r.statusText}: ${url.href}`),
					),
		)
		.mapPromise((r) => r.text());

	if (text.isErr()) return Result.Err(text.unwrapErr());
	const html = text.unwrap();

	// Convert to markdown
	const title = extractTitle(html);
	const markdown = turndown.turndown(html);

	return writeSiteCache(url, title, markdown);
}

function normalizeUrl(rawUrl: string): Result<URL> {
	if (!rawUrl.startsWith("http")) rawUrl = `https://${rawUrl}`;
	if (!rawUrl.startsWith("https://"))
		Result.Err(new Error("Only https urls are supported"));
	return Result.try(() => new URL(rawUrl)).map(
		(url) => new URL(url.origin + url.pathname),
	);
}

/**
 * Extract a title from HTML.
 */
function extractTitle(html: string): string {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return match?.[1]?.trim() ?? "";
}
