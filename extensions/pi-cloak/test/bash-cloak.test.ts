import { describe, expect, it } from "vitest";
import { applyPatterns, applyRules, collectRules, loadState } from "../index";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Rule = Parameters<typeof collectRules>[1][number];
type Pattern = Parameters<typeof applyPatterns>[1][number];
type Config = Parameters<typeof applyPatterns>[2];

const CWD = "/home/user/project";

const DEFAULT_CONFIG: Config = {
	enabled: true,
	cloakCharacter: "*",
	cloakLength: null,
	tryAllPatterns: true,
};

// *.env rule: context-dependent pattern matches the full assignment line
const envRule: Rule = {
	filePatterns: ["*.env"],
	fileRegexes: [/^[^/]*\.env$/],
	bashRegexes: [/[^/]*\.env/],
	patterns: [{ source: "API_KEY=.*", regex: /API_KEY=.*/g }],
};

// *.json rule: context-dependent pattern matches the key-value pair in JSON
const jsonRule: Rule = {
	filePatterns: ["*.json"],
	fileRegexes: [/^[^/]*\.json$/],
	bashRegexes: [/[^/]*\.json/],
	patterns: [{ source: '"k":\\s*"[^"]*"', regex: /"k":\s*"[^"]*"/g }],
};

// Global (value-intrinsic) pattern: matches the secret word regardless of context
const secretPattern: Pattern = {
	source: "supersecret\\w*",
	regex: /supersecret\w*/g,
};

// ─── collectRules ─────────────────────────────────────────────────────────────

describe("collectRules", () => {
	it("returns empty array when rules list is empty", () => {
		expect(collectRules("cat .env", [], "bash", CWD)).toHaveLength(0);
	});

	it("returns empty array when no rule matches the bash subject", () => {
		expect(collectRules("ls src/", [envRule], "bash", CWD)).toHaveLength(0);
	});

	it("returns matching rule when read subject path matches filePattern", () => {
		expect(collectRules(".env", [envRule], "read", CWD)).toContain(envRule);
	});

	it("does not return rule when bash subject matches no filePattern", () => {
		expect(collectRules("cat .env", [jsonRule], "bash", CWD)).toHaveLength(0);
	});

	it("uses bashRegexes (unanchored) for bash type", () => {
		// bashRegexes allow the pattern to match anywhere in the command string
		expect(
			collectRules("cat .env | grep KEY", [envRule], "bash", CWD),
		).toContain(envRule);
	});

	it("bash: matches when filename appears after a path separator in command", () => {
		expect(collectRules("cat src/.env", [envRule], "bash", CWD)).toContain(
			envRule,
		);
	});

	it("read: stays precise — does not match a path with .env as substring", () => {
		// anchored fileRegexes must not fire on "config.environment" just because it has ".env"
		expect(
			collectRules("config.environment", [envRule], "read", CWD),
		).toHaveLength(0);
	});

	it("read: resolves absolute path to match rule", () => {
		expect(collectRules(`${CWD}/.env`, [envRule], "read", CWD)).toContain(
			envRule,
		);
	});
});

// ─── applyPatterns ────────────────────────────────────────────────────────────

describe("applyPatterns", () => {
	it("returns rawText unchanged when patterns list is empty", () => {
		const text = "API_KEY=supersecret123";
		expect(applyPatterns(text, [], DEFAULT_CONFIG)).toBe(text);
	});

	it("returns the original reference when no pattern matches", () => {
		const text = "nothing sensitive here";
		expect(applyPatterns(text, [secretPattern], DEFAULT_CONFIG)).toBe(text);
	});

	it("masks text matching a pattern", () => {
		expect(
			applyPatterns("supersecret123", [secretPattern], DEFAULT_CONFIG),
		).not.toContain("supersecret123");
	});

	it("masks across multiple lines", () => {
		const result = applyPatterns(
			"foo\nsupersecret123\nbar",
			[secretPattern],
			DEFAULT_CONFIG,
		);
		expect(result).not.toContain("supersecret123");
		expect(result).toContain("foo");
		expect(result).toContain("bar");
	});

	it("preserves LF line endings when input is unchanged", () => {
		const text = "a\nb\nc";
		expect(applyPatterns(text, [secretPattern], DEFAULT_CONFIG)).toBe(text);
	});

	it("preserves CRLF line endings when masking", () => {
		const result = applyPatterns(
			"foo\r\nsupersecret\r\nbar",
			[secretPattern],
			DEFAULT_CONFIG,
		);
		expect(result).toContain("\r\n");
	});
});

// ─── applyRules ───────────────────────────────────────────────────────────────

describe("applyRules", () => {
	it("returns rawText unchanged when rules list is empty", () => {
		const text = "API_KEY=supersecret123";
		expect(applyRules(text, [], DEFAULT_CONFIG)).toBe(text);
	});

	it("masks text when a rule pattern matches", () => {
		expect(
			applyRules("API_KEY=supersecret123", [envRule], DEFAULT_CONFIG),
		).not.toContain("API_KEY=supersecret123");
	});

	it("returns rawText unchanged when rule patterns do not match", () => {
		const text = "nothing sensitive here";
		expect(applyRules(text, [envRule], DEFAULT_CONFIG)).toBe(text);
	});

	it("flattens and applies patterns from multiple rules", () => {
		const result = applyRules(
			'API_KEY=supersecret123\n"k": "supersecret456"',
			[envRule, jsonRule],
			DEFAULT_CONFIG,
		);
		expect(result).not.toContain("supersecret123");
		expect(result).not.toContain("supersecret456");
	});
});

// ─── read path (replaces cloakText) ──────────────────────────────────────────

describe("read path via collectRules + applyRules", () => {
	it("masks text when path matches a rule", () => {
		const rules = collectRules(".env", [envRule], "read", CWD);
		expect(
			applyRules("API_KEY=supersecret123", rules, DEFAULT_CONFIG),
		).not.toContain("supersecret123");
	});

	it("returns text unchanged when path matches no rule", () => {
		const rules = collectRules("README.md", [envRule], "read", CWD);
		const text = "API_KEY=supersecret123";
		expect(applyRules(text, rules, DEFAULT_CONFIG)).toBe(text);
	});

	it("works with absolute path as subject", () => {
		const rules = collectRules(`${CWD}/.env`, [envRule], "read", CWD);
		expect(
			applyRules("API_KEY=supersecret123", rules, DEFAULT_CONFIG),
		).not.toContain("supersecret123");
	});
});

// ─── loadState ────────────────────────────────────────────────────────────────

describe("loadState", () => {
	it("returns a state with a globalPatterns array", () => {
		expect(Array.isArray(loadState().globalPatterns)).toBe(true);
	});

	it("globalPatterns defaults to empty array when config file is absent", () => {
		// No cloak.json in the test environment — error path must still provide the field
		const state = loadState();
		expect(state).toHaveProperty("globalPatterns");
		expect(state.globalPatterns).toHaveLength(0);
	});
});

// ─── Two-pass bash scenarios ──────────────────────────────────────────────────

describe("bash two-pass masking scenarios", () => {
	it("cat .env: pass 1 masks context-dependent secret", () => {
		const rules = collectRules("cat .env", [envRule, jsonRule], "bash", CWD);
		const result = applyRules(
			"API_KEY=supersecret123\nFOO=bar",
			rules,
			DEFAULT_CONFIG,
		);
		expect(result).not.toContain("supersecret123");
		expect(result).toContain("FOO=bar");
	});

	it("jq '.k' secret.json: pass 1 misses transformed output", () => {
		// Rule fires (*.json matches command) but jq stripped the key — pattern won't match bare value
		const rules = collectRules("jq '.k' secret.json", [jsonRule], "bash", CWD);
		expect(applyRules('"supersecretvalue"', rules, DEFAULT_CONFIG)).toBe(
			'"supersecretvalue"',
		);
	});

	it("jq '.k' secret.json: pass 2 masks value-intrinsic secret", () => {
		expect(
			applyPatterns('"supersecretvalue"', [secretPattern], DEFAULT_CONFIG),
		).not.toContain("supersecretvalue");
	});

	it("rg SECRET .: pass 1 is no-op when no filename token matches", () => {
		expect(
			collectRules("rg SECRET .", [envRule, jsonRule], "bash", CWD),
		).toHaveLength(0);
	});

	it("rg SECRET .: pass 2 masks via globalPatterns", () => {
		expect(
			applyPatterns("found: supersecretvalue", [secretPattern], DEFAULT_CONFIG),
		).not.toContain("supersecretvalue");
	});

	it("unrelated command: rule fires but output has no secrets — no false positive", () => {
		// *.env matches "grep something .env" via unanchored bashRegexes, but output is clean
		const rules = collectRules("grep something .env", [envRule], "bash", CWD);
		const text = "nothing sensitive here\nFOO=bar";
		expect(applyRules(text, rules, DEFAULT_CONFIG)).toBe(text);
	});

	it("cat $FILE: documented miss — shell variable not expanded, output unchanged", () => {
		const rules = collectRules("cat $FILE", [envRule], "bash", CWD);
		expect(rules).toHaveLength(0);
		const output = "API_KEY=supersecret123";
		expect(applyRules(output, rules, DEFAULT_CONFIG)).toBe(output);
	});

	it("cat .env | grep KEY: bashRegexes (unanchored) fire despite trailing pipe", () => {
		// anchored fileRegexes would fail here; unanchored bashRegexes must match mid-string
		const rules = collectRules("cat .env | grep KEY", [envRule], "bash", CWD);
		expect(rules).toContain(envRule);
	});
});
