import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Site, SiteMatches } from "../site";

const TEST_URL = new URL("https://example.com/docs/getting-started");
const TEST_PATH = join(
	homedir(),
	".cache/pi/web/example.com/docs-getting-started.md",
);
const TEST_TITLE = "Getting Started — Example";
const CACHED = "~/.cache/pi/web/example.com/docs-getting-started.md";

function makeSite(content: string): Site {
	return new Site(TEST_URL, TEST_PATH, TEST_TITLE, content);
}

function header(...extra: string[]): string {
	return [
		`Source: ${TEST_URL}`,
		`Cached: ${CACHED}`,
		`Title: ${TEST_TITLE}`,
		"",
		...extra,
	].join("\n");
}

function matchHeader(...extra: string[]): string {
	return [
		`Source: ${TEST_URL}`,
		`Cached: ${CACHED}`,
		`Title: ${TEST_TITLE}`,
		"",
		...extra,
	].join("\n");
}

// --- Site ---

describe("Site", () => {
	describe("render", () => {
		it("renders with header and line numbers", () => {
			expect(makeSite("test").render()).toEqual(header("1: test"));
		});

		it("renders multiple lines", () => {
			expect(makeSite("aaa\nbbb\nccc").render()).toEqual(
				header("1: aaa", "2: bbb", "3: ccc"),
			);
		});
	});

	describe("limit", () => {
		it("limits the number of lines rendered", () => {
			expect(makeSite("aaa\nbbb\nccc").limit(2).render()).toEqual(
				header(
					"1: aaa",
					"2: bbb",
					"",
					"[Showing lines 1-2 of 3. 1 more lines available. Use offset=3 to continue.]",
				),
			);
		});
	});

	describe("offset", () => {
		it("starts rendering from the given line", () => {
			expect(makeSite("aaa\nbbb\nccc").offset(1).limit(2).render()).toEqual(
				header("2: bbb", "3: ccc"),
			);
		});
	});

	describe("offset + limit", () => {
		it("renders a window of lines", () => {
			expect(
				makeSite("aaa\nbbb\nccc\nddd\neee").offset(1).limit(2).render(),
			).toEqual(
				header(
					"2: bbb",
					"3: ccc",
					"",
					"[Showing lines 2-3 of 5. 2 more lines available. Use offset=4 to continue.]",
				),
			);
		});
	});

	describe("filter", () => {
		it("returns Site when no pattern given", () => {
			const site = makeSite("aaa");
			expect(site.filter()).toBe(site);
		});

		it("returns SiteMatches when pattern given", () => {
			expect(makeSite("aaa").filter(/aaa/)).toBeInstanceOf(SiteMatches);
		});
	});
});

// --- SiteMatches ---

describe("SiteMatches", () => {
	describe("filter", () => {
		it("finds a single match", () => {
			expect(makeSite("aaa\nbbb\nccc").filter(/bbb/).render()).toEqual(
				matchHeader("1 matches", "", "> 2: bbb"),
			);
		});

		it("finds multiple matches", () => {
			expect(makeSite("aaa\nbbb\nccc\nbbb").filter(/bbb/).render()).toEqual(
				matchHeader("2 matches", "", "> 2: bbb", "---", "> 4: bbb"),
			);
		});

		it("returns 0 matches for no hits", () => {
			expect(makeSite("aaa\nbbb\nccc").filter(/zzz/).render()).toEqual(
				matchHeader("0 matches", "", ""),
			);
		});
	});

	describe("context", () => {
		it("includes surrounding lines", () => {
			expect(
				makeSite("aaa\nbbb\nccc\nddd\neee").context(1).filter(/ccc/).render(),
			).toEqual(
				matchHeader("1 matches", "", "  2: bbb", "> 3: ccc", "  4: ddd"),
			);
		});

		it("merges overlapping context ranges", () => {
			expect(
				makeSite("aaa\nbbb\nccc\nddd\neee")
					.context(1)
					.filter(/bbb|ddd/)
					.render(),
			).toEqual(
				matchHeader(
					"1 matches",
					"",
					"  1: aaa",
					"> 2: bbb",
					"  3: ccc",
					"> 4: ddd",
					"  5: eee",
				),
			);
		});

		it("separates non-overlapping ranges", () => {
			expect(
				makeSite("aaa\nbbb\nccc\nddd\neee\nfff\nggg")
					.context(1)
					.filter(/aaa|ggg/)
					.render(),
			).toEqual(
				matchHeader(
					"2 matches",
					"",
					"> 1: aaa",
					"  2: bbb",
					"---",
					"  6: fff",
					"> 7: ggg",
				),
			);
		});

		it("clamps context to start of content", () => {
			expect(
				makeSite("aaa\nbbb\nccc").context(5).filter(/aaa/).render(),
			).toEqual(
				matchHeader("1 matches", "", "> 1: aaa", "  2: bbb", "  3: ccc"),
			);
		});

		it("clamps context to end of content", () => {
			expect(
				makeSite("aaa\nbbb\nccc").context(5).filter(/ccc/).render(),
			).toEqual(
				matchHeader("1 matches", "", "  1: aaa", "  2: bbb", "> 3: ccc"),
			);
		});

		it("can be set on SiteMatches after filter", () => {
			const matches = makeSite("aaa\nbbb\nccc\nddd\neee").filter(/ccc/);
			expect(matches).toBeInstanceOf(SiteMatches);
			expect((matches as SiteMatches).context(1).render()).toEqual(
				matchHeader("1 matches", "", "  2: bbb", "> 3: ccc", "  4: ddd"),
			);
		});
	});

	describe("limit", () => {
		it("limits the number of match groups rendered", () => {
			expect(
				makeSite("aaa\nbbb\nccc\nddd\neee")
					.filter(/aaa|ccc|eee/)
					.limit(2)
					.render(),
			).toEqual(
				matchHeader(
					"3 matches",
					"",
					"> 1: aaa",
					"---",
					"> 3: ccc",
					"",
					"[Showing 2 of 3 match groups. Increase limit to see more.]",
				),
			);
		});
	});

	describe("offset warning", () => {
		it("warns when offset was set before filter", () => {
			expect(makeSite("aaa\nbbb").offset(1).filter(/bbb/).render()).toEqual(
				matchHeader(
					"⚠️ 'offset' was ignored because 'pattern' was specified",
					"",
					"1 matches",
					"",
					"> 2: bbb",
				),
			);
		});

		it("does not warn when no offset was set", () => {
			const out = makeSite("aaa\nbbb").filter(/bbb/).render();
			expect(out).not.toContain("⚠️");
		});
	});

	describe("does not mutate original site", () => {
		it("filtering does not affect site render", () => {
			const site = makeSite("aaa\nbbb\nccc");
			site.filter(/bbb/);
			expect(site.render()).toEqual(header("1: aaa", "2: bbb", "3: ccc"));
		});
	});
});
