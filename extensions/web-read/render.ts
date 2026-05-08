/**
 * Headless browser page rendering for JS-heavy sites.
 *
 * Uses playwright-core (no bundled browser) with a user-configured
 * browser path from settings.json. This avoids large downloads and
 * works on systems like NixOS where pre-built binaries won't run.
 */

import TurndownService from "turndown";
import { Result } from "../../utils/monad/result";
import { getSiteCache, writeSiteCache } from "./cache";
import { WEB_READ_SETTINGS, fetchedDomains } from "./fetch";
import type { Site } from "./site";

/** Lazy-loaded playwright-core module */
let pw: typeof import("playwright-core") | undefined;

async function getPlaywright(): Promise<
	Result<typeof import("playwright-core")>
> {
	if (pw) return Result.Ok(pw);
	return (await Result.fromPromise(import("playwright-core"))).mapErr(
		() =>
			new Error(
				"playwright-core is not installed. Install it with: npm install playwright-core",
			),
	);
}

function createTurndown(): TurndownService {
	return new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
	});
}

function extractTitle(html: string): string {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return match?.[1]?.trim() ?? "";
}

/**
 * Fetch a page using a headless browser, wait for JS to render,
 * convert to markdown, and write to cache.
 *
 * Errors if:
 * - The domain hasn't been attempted with a simple fetch first
 * - No browserPath is configured in settings
 */
export async function renderPage(
	url: URL,
	refresh: boolean,
): Promise<Result<Site>> {
	const domain = url.hostname;

	if (!fetchedDomains.has(domain)) {
		return Result.Err(
			new Error(
				`Domain '${domain}' has not been fetched with the default method yet. ` +
					"Try without render first — the page may not need JavaScript rendering. " +
					"Use render only when the simple fetch returns incomplete content.",
			),
		);
	}

	const browserPath = WEB_READ_SETTINGS.browserPath;
	if (!browserPath) {
		return Result.Err(
			new Error(
				"No browser configured for advanced rendering. " +
					'Set "browserPath" in settings.json under "web-read":\n\n' +
					"  {\n" +
					'    "web-read": {\n' +
					'      "browserPath": "/path/to/chromium"\n' +
					"    }\n" +
					"  }",
			),
		);
	}

	// Check rendered cache first (unless refresh requested)
	if (!refresh) {
		const cache = getSiteCache(url, true);
		if (cache.isErr()) return Result.Err(cache.unwrapErr());
		const cached = cache.unwrap();
		if (cached.isSome()) return Result.Ok(cached.unwrap());
	}

	const playwrightResult = await getPlaywright();
	if (playwrightResult.isErr()) return Result.Err(playwrightResult.unwrapErr());
	const { chromium } = playwrightResult.unwrap();

	let browser: import("playwright-core").Browser | undefined;

	try {
		browser = await chromium.launch({ executablePath: browserPath });
		const context = await browser.newContext();
		const page = await context.newPage();

		await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
		// Give JS time to render content after initial load
		await page.waitForTimeout(3_000);

		const html = await page.content();
		await browser.close();
		browser = undefined;

		const title = extractTitle(html);

		const td = createTurndown();
		td.remove([
			"style",
			"script",
			"noscript",
			"svg",
			"canvas",
			"template",
			"iframe",
			"object",
			"embed",
			"footer",
		]);
		const markdown = td.turndown(html);

		return writeSiteCache(url, title, markdown, true);
	} catch (err) {
		return Result.Err(
			new Error(
				`Advanced rendering failed: ${err instanceof Error ? err.message : String(err)}`,
			),
		);
	} finally {
		if (browser) await browser.close().catch(() => {});
	}
}
