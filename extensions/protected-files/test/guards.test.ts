import { describe, expect, it } from "vitest";
import {
	checkBashGuard,
	checkReadGuard,
	matchesAny,
	normalizePattern,
	toRelative,
} from "../index";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readEvent(filePath: string) {
	return {
		type: "tool_call" as const,
		toolName: "read" as const,
		toolCallId: "test",
		input: { path: filePath },
	};
}

function bashEvent(command: string) {
	return {
		type: "tool_call" as const,
		toolName: "bash" as const,
		toolCallId: "test",
		input: { command },
	};
}

// For non-matching tool type tests
function writeEvent(filePath: string) {
	return {
		type: "tool_call" as const,
		toolName: "write" as const,
		toolCallId: "test",
		input: { path: filePath, content: "" },
	};
}

const CWD = "/home/user/project";

// ─── normalizePattern ─────────────────────────────────────────────────────────

describe("normalizePattern", () => {
	it("prepends **/ to bare patterns", () => {
		expect(normalizePattern("*.env")).toBe("**/*.env");
	});

	it("prepends **/ to dotfile patterns", () => {
		expect(normalizePattern(".secret*")).toBe("**/.secret*");
	});

	it("leaves patterns already starting with **/ unchanged", () => {
		expect(normalizePattern("**/*.pem")).toBe("**/*.pem");
	});

	it("leaves patterns starting with / unchanged", () => {
		expect(normalizePattern("/etc/secrets")).toBe("/etc/secrets");
	});

	it("prepends **/ to directory glob patterns", () => {
		expect(normalizePattern("secrets/**")).toBe("**/secrets/**");
	});
});

// ─── matchesAny ───────────────────────────────────────────────────────────────

describe("matchesAny", () => {
	it("returns undefined when pattern list is empty", () => {
		expect(matchesAny(".env", [])).toBeUndefined();
	});

	it("returns the matching pattern", () => {
		expect(matchesAny(".env", ["**/.env"])).toBe("**/.env");
	});

	it("returns undefined when no pattern matches", () => {
		expect(matchesAny("index.ts", ["**/.env"])).toBeUndefined();
	});

	it("returns the first matching pattern when multiple match", () => {
		expect(matchesAny(".env", ["**/*.ts", "**/.env", "**/*.env"])).toBe(
			"**/.env",
		);
	});

	it("matches dotfiles (dot: true)", () => {
		expect(matchesAny(".env", ["**/*.env"])).toBe("**/*.env");
	});

	it("matches nested dotfiles", () => {
		expect(matchesAny("config/.env", ["**/*.env"])).toBe("**/*.env");
	});

	it("matches deeply nested paths", () => {
		expect(matchesAny("a/b/c/.env", ["**/*.env"])).toBe("**/*.env");
	});

	it("matches files in a specific directory", () => {
		expect(matchesAny("secrets/key.pem", ["**/secrets/**"])).toBe(
			"**/secrets/**",
		);
	});

	it("does not match files outside the specific directory", () => {
		expect(matchesAny("other/key.pem", ["**/secrets/**"])).toBeUndefined();
	});
});

// ─── toRelative ───────────────────────────────────────────────────────────────

describe("toRelative", () => {
	it("returns relative path for file inside cwd", () => {
		expect(toRelative(`${CWD}/.env`, CWD)).toBe(".env");
	});

	it("returns relative path for nested file inside cwd", () => {
		expect(toRelative(`${CWD}/config/.env`, CWD)).toBe("config/.env");
	});

	it("resolves relative input path against cwd", () => {
		expect(toRelative(".env", CWD)).toBe(".env");
	});

	it("resolves nested relative input path", () => {
		expect(toRelative("config/.env", CWD)).toBe("config/.env");
	});

	it("returns absolute path when outside cwd", () => {
		expect(toRelative("/etc/secrets/key", CWD)).toBe("/etc/secrets/key");
	});
});

// ─── checkReadGuard ───────────────────────────────────────────────────────────

describe("checkReadGuard", () => {
	const patterns = ["**/*.env", "**/secrets/**"];

	it("blocks a matching file path", () => {
		const result = checkReadGuard(readEvent(".env"), CWD, patterns);
		expect(result).toMatchObject({ block: true });
	});

	it("blocks a nested matching file path", () => {
		const result = checkReadGuard(readEvent("config/.env"), CWD, patterns);
		expect(result).toMatchObject({ block: true });
	});

	it("blocks a file inside a protected directory", () => {
		const result = checkReadGuard(
			readEvent("secrets/db-password"),
			CWD,
			patterns,
		);
		expect(result).toMatchObject({ block: true });
	});

	it("allows a non-matching file", () => {
		const result = checkReadGuard(readEvent("src/index.ts"), CWD, patterns);
		expect(result).toBeUndefined();
	});

	it("includes the matched pattern in the reason", () => {
		const result = checkReadGuard(readEvent(".env"), CWD, patterns);
		expect(result?.reason).toContain("**/*.env");
	});

	it("includes the input path in the reason", () => {
		const result = checkReadGuard(readEvent(".env"), CWD, patterns);
		expect(result?.reason).toContain(".env");
	});

	it("ignores non-read events", () => {
		const result = checkReadGuard(writeEvent(".env"), CWD, patterns);
		expect(result).toBeUndefined();
	});

	it("returns undefined when patterns list is empty", () => {
		const result = checkReadGuard(readEvent(".env"), CWD, []);
		expect(result).toBeUndefined();
	});

	it("resolves absolute input path correctly", () => {
		const result = checkReadGuard(readEvent(`${CWD}/.env`), CWD, patterns);
		expect(result).toMatchObject({ block: true });
	});
});

// ─── checkBashGuard ───────────────────────────────────────────────────────────

describe("checkBashGuard", () => {
	const patterns = ["**/*.env", "**/secrets/**"];

	it("blocks a command that references a matching file", () => {
		const result = checkBashGuard(bashEvent("cat .env"), CWD, patterns);
		expect(result).toMatchObject({ block: true });
	});

	it("blocks when matching file is not the first token", () => {
		const result = checkBashGuard(bashEvent("less config/.env"), CWD, patterns);
		expect(result).toMatchObject({ block: true });
	});

	it("blocks when matching token appears after flags", () => {
		const result = checkBashGuard(bashEvent("head -n 10 .env"), CWD, patterns);
		expect(result).toMatchObject({ block: true });
	});

	it("blocks a file inside a protected directory", () => {
		const result = checkBashGuard(
			bashEvent("cat secrets/db-password"),
			CWD,
			patterns,
		);
		expect(result).toMatchObject({ block: true });
	});

	it("allows a command with no matching tokens", () => {
		const result = checkBashGuard(bashEvent("ls src/"), CWD, patterns);
		expect(result).toBeUndefined();
	});

	it("skips flag tokens (starting with -)", () => {
		const result = checkBashGuard(bashEvent("ls -la src/"), CWD, patterns);
		expect(result).toBeUndefined();
	});

	it("skips shell operator tokens", () => {
		const result = checkBashGuard(bashEvent("echo hello | cat"), CWD, patterns);
		expect(result).toBeUndefined();
	});

	it("includes the matched token in the reason", () => {
		const result = checkBashGuard(bashEvent("cat .env"), CWD, patterns);
		expect(result?.reason).toContain(".env");
	});

	it("includes the matched pattern in the reason", () => {
		const result = checkBashGuard(bashEvent("cat .env"), CWD, patterns);
		expect(result?.reason).toContain("**/*.env");
	});

	it("ignores non-bash events", () => {
		const result = checkBashGuard(readEvent(".env"), CWD, patterns);
		expect(result).toBeUndefined();
	});

	it("returns undefined when patterns list is empty", () => {
		const result = checkBashGuard(bashEvent("cat .env"), CWD, []);
		expect(result).toBeUndefined();
	});
});
