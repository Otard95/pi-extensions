import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import type { ToolCompaction, ToolGroup } from "./analysis";

// --- Pi process helpers ---

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName)) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

async function writeTempFile(name: string, content: string): Promise<string> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-compact-"));
	const filePath = path.join(dir, name);
	await fs.promises.writeFile(filePath, content, {
		encoding: "utf-8",
		mode: 0o600,
	});
	return filePath;
}

async function cleanupTempFile(filePath: string): Promise<void> {
	try {
		await fs.promises.unlink(filePath);
	} catch {
		/* ignore */
	}
	try {
		await fs.promises.rmdir(path.dirname(filePath));
	} catch {
		/* ignore */
	}
}

/** Call Haiku to summarize a tool group. */
export async function callCompactionAgent(
	group: ToolGroup,
	signal?: AbortSignal,
): Promise<string> {
	const userMessage = buildCompactionPrompt(group);

	const userMessageFile = await writeTempFile("user.md", userMessage);

	try {
		const args = [
			"--model",
			"claude-haiku-4-5",
			"--no-tools",
			"--no-session",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--system-prompt",
			COMPACTION_SYSTEM_PROMPT,
			"-p",
			`@${userMessageFile}`,
		];

		const invocation = getPiInvocation(args);

		const result = await new Promise<string>((resolve, reject) => {
			const proc = spawn(invocation.command, invocation.args, {
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";

			proc.stdout.on("data", (data) => {
				stdout += data.toString();
			});
			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (code === 0) {
					resolve(stdout.trim());
				} else {
					reject(
						new Error(`Compaction agent exited with code ${code}: ${stderr}`),
					);
				}
			});

			proc.on("error", (err) => reject(err));

			if (signal) {
				const kill = () => {
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) kill();
				else signal.addEventListener("abort", kill, { once: true });
			}
		});

		return result;
	} finally {
		await cleanupTempFile(userMessageFile);
	}
}

/** Compact a tool group by calling Haiku to summarize the tool calls. */
export async function compactToolGroup(
	group: ToolGroup,
	signal?: AbortSignal,
): Promise<ToolCompaction> {
	const compacted = await callCompactionAgent(group, signal);
	return { ...group, compacted };
}

/** Placeholder compaction: summarises tool calls as name + line count. */
export function compactToolGroupTest(group: ToolGroup): ToolCompaction {
	const lines: string[] = [];

	for (const entry of group.toolEntries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;

		if (msg.role === "assistant") {
			for (const block of msg.content) {
				if (block.type === "toolCall") {
					const argsPreview = formatToolArgs(block.name, block.arguments);
					lines.push(argsPreview);
				}
			}
		} else if (msg.role === "toolResult") {
			const text = msg.content
				.filter((c) => c.type === "text")
				.map((c) => (c as { type: "text"; text: string }).text)
				.join("");
			const lineCount = text.split("\n").length;
			const suffix = msg.isError ? " [ERROR]" : "";
			lines.push(`  ${lineCount} lines${suffix}`);
		}
	}

	return { ...group, compacted: lines.join("\n") };
}

// --- Prompt construction ---

export const COMPACTION_SYSTEM_PROMPT = `You are a compaction agent. Your job is to summarize tool calls from an AI assistant conversation.

You will receive a message with three XML sections:
- <preceding_message> — context for WHY the tools were called. Do NOT summarize this.
- <tool_calls> — the tool calls and their results. You SHOULD summarize this.
- <following_message> — what the assistant concluded. Do NOT summarize this.

Your output should ONLY contain the summarized tool calls. No preamble, no explanation, no XML tags.

Use this format for each tool call:

[tool] <call signature>
<condensed content>

Example:

[tool] read(/home/user/config.json)
Database host: localhost:5432, pool size: 10, retry: 3. Auth uses JWT with 24h expiry.

[tool] bash(grep -r "TODO" src/)
5 matches: src/api.ts:12, src/auth.ts:45, src/db.ts:3, src/util.ts:88, src/main.ts:201

Guidelines:
- Focus on information relevant to the surrounding conversation context.
- Preserve specific values, paths, names, and findings the assistant used.
- For errors, note what failed and why.
- Omit boilerplate, verbose output, and redundant details.
- The condensed content should be the actual distilled information, not a description of it.`;

/** Build the user message for the compaction agent. */
export function buildCompactionPrompt(group: ToolGroup): string {
	const sections: string[] = [];

	// Pre-context
	sections.push("<preceding_message>");
	sections.push(
		group.preContext ? formatEntryForPrompt(group.preContext) : "(none)",
	);
	sections.push("</preceding_message>");

	// Tool calls
	sections.push("");
	sections.push("<tool_calls>");
	for (const entry of group.toolEntries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;

		if (msg.role === "assistant") {
			for (const block of msg.content) {
				if (block.type === "toolCall") {
					sections.push(
						`[call] ${formatToolArgs(block.name, block.arguments)}`,
					);
				}
			}
		} else if (msg.role === "toolResult") {
			const text = msg.content
				.filter((c) => c.type === "text")
				.map((c) => (c as { type: "text"; text: string }).text)
				.join("");
			const errLabel = msg.isError ? " [ERROR]" : "";
			sections.push(`[result]${errLabel} ${text}`);
		}
	}
	sections.push("</tool_calls>");

	// Post-context
	sections.push("");
	sections.push("<following_message>");
	sections.push(
		group.postContext ? formatEntryForPrompt(group.postContext) : "(none)",
	);
	sections.push("</following_message>");

	return sections.join("\n");
}

/** Format a session entry as readable text for the prompt. */
function formatEntryForPrompt(entry: SessionEntry): string {
	if (entry.type === "message") {
		const msg = entry.message;
		if (msg.role === "user") {
			if (typeof msg.content === "string") return msg.content;
			return msg.content
				.filter((c) => c.type === "text")
				.map((c) => (c as { type: "text"; text: string }).text)
				.join("\n");
		} else if (msg.role === "assistant") {
			const parts: string[] = [];
			for (const block of msg.content) {
				if (block.type === "thinking") {
					parts.push(`[thinking] ${block.thinking}`);
				} else if (block.type === "text") {
					parts.push(block.text);
				}
				// Skip toolCall blocks - not relevant for context
			}
			return parts.join("\n");
		}
	} else if (entry.type === "custom_message") {
		return typeof entry.content === "string"
			? entry.content
			: JSON.stringify(entry.content);
	}
	return "";
}

function formatToolArgs(name: string, args: Record<string, unknown>): string {
	switch (name) {
		case "bash":
			return `bash(${truncate(String(args["command"] ?? ""), 60)})`;
		case "read":
			return `read(${args["path"]})`;
		case "write":
			return `write(${args["path"]})`;
		case "edit":
			return `edit(${args["path"]})`;
		case "find":
			return `find(${args["pattern"]}, ${args["path"]})`;
		case "grep":
			return `grep(${truncate(String(args["pattern"] ?? ""), 40)}, ${args["path"]})`;
		case "ls":
			return `ls(${args["path"]})`;
		default:
			return `${name}(${truncate(JSON.stringify(args), 60)})`;
	}
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen - 3)}...`;
}
