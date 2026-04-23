/**
 * Read and search cached markdown files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import { Option } from "../../utils/monad/option";
import { Result } from "../../utils/monad/result";
import { Site } from "./site";

const CACHE_DIR = join(process.env["HOME"] ?? "/tmp", ".cache", "pi", "web");

function getCachePath(url: URL): string {
	const hash = `${url.hostname}/${url.pathname.replaceAll(/[/+%;]+/g, "-")}`;
	return join(CACHE_DIR, `${hash}.md`);
}

/**
 * Read a slice of the cached markdown file.
 */
export function getSiteCache(url: URL): Result<Option<Site>> {
	const path = getCachePath(url);
	if (!existsSync(path)) return Result.Ok(Option.None());

	return Result.try(() => readFileSync(path, "utf-8"))
		.mapErr(
			(e) => new Error(`Failed to read cache file '${path}': ${e.message}`),
		)
		.map((c) => parseFrontmatter<{ url: string; title: string }>(c))
		.map(({ body, frontmatter }) =>
			Option.Some(
				new Site(new URL(frontmatter["url"]), path, frontmatter["title"], body),
			),
		);
}

export function writeSiteCache(
	url: URL,
	title: string,
	content: string,
): Result<Site> {
	const path = getCachePath(url);
	const frontmatter = [
		"---",
		`title: ${JSON.stringify(title)}`,
		`url: ${JSON.stringify(url.href)}`,
		"---",
	].join("\n");

	return Result.try(() => {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${frontmatter}\n\n${content}`, "utf-8");
	}).map(() => new Site(url, path, title, content));
}
