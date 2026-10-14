/**
 * Fetch a URL, convert HTML to markdown via turndown, and cache the result.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Option } from "../../utils/monad/option";
import { Result } from "../../utils/monad/result";
import { loadSettings } from "../../utils/settings.js";
import { getSiteCache, writeSiteCache } from "./cache";
import { extractTitle, htmlToMarkdown } from "./html";
import type { Site } from "./site";

/**
 * Tracks hostnames that have been attempted with a simple fetch.
 * Used by the playwright renderer to enforce "try simple first" policy.
 */
export const fetchedDomains = new Set<string>();

const WebReadSchema = Type.Object({
	strip: Type.Optional(
		Type.Object({
			nav: Type.Optional(Type.Boolean()),
			header: Type.Optional(Type.Boolean()),
			footer: Type.Optional(Type.Boolean()),
		}),
	),
	browserPath: Type.Optional(
		Type.String({
			description:
				"Path to a Chromium-based browser executable for advanced rendering",
		}),
	),
});

type WebReadSettings = Static<typeof WebReadSchema>;

// Load and cache settings once at module load
export const WEB_READ_SETTINGS = loadSettings<WebReadSettings>(
	"web-read",
	WebReadSchema,
).unwrapOr({});

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

	fetchedDomains.add(url.hostname);

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
	const markdown = htmlToMarkdown(html, WEB_READ_SETTINGS.strip);

	return writeSiteCache(url, title, markdown);
}

export function normalizeUrl(rawUrl: string): Result<URL> {
	if (!rawUrl.startsWith("http")) rawUrl = `https://${rawUrl}`;
	if (!rawUrl.startsWith("https://"))
		Result.Err(new Error("Only https urls are supported"));
	return Result.try(() => new URL(rawUrl)).map(
		(url) => new URL(url.origin + url.pathname),
	);
}
