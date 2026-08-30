import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AssistantMessage,
	InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import {
	discoverAndLoadExtensions,
	ExtensionRunner,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

const extensionPath = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"index.ts",
);

function assistantMessage(markdown: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: markdown }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

async function createHarness(cwd: string) {
	const sessionManager = SessionManager.inMemory(cwd);
	const loaded = await discoverAndLoadExtensions(
		[extensionPath],
		cwd,
		join(cwd, ".agent"),
	);
	expect(loaded.errors).toEqual([]);

	const sentMessages: Array<{
		message: { customType: string; content: unknown; display: boolean };
		options?: { deliverAs?: "steer" | "followUp" | "nextTurn" };
	}> = [];
	loaded.runtime.sendMessage = (message, options) => {
		sentMessages.push({ message, options });
	};

	const modelRuntime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	const runner = new ExtensionRunner(
		loaded.extensions,
		loaded.runtime,
		cwd,
		sessionManager,
		new ModelRegistry(modelRuntime),
	);

	const notifications: Array<{
		message: string;
		type?: "info" | "warning" | "error";
	}> = [];
	runner.setUIContext({
		...runner.getUIContext(),
		notify: (message, type) => notifications.push({ message, type }),
	});

	return { notifications, runner, sentMessages, sessionManager };
}

describe("save-md", () => {
	it("saves the latest assistant response as Markdown", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));
		try {
			const { notifications, runner, sentMessages, sessionManager } =
				await createHarness(cwd);
			const markdown =
				"# Design\n\n- Preserve **Markdown**\n\n```ts\nconst ready = true;\n```";
			sessionManager.appendMessage(assistantMessage(markdown));

			const command = runner.getCommand("save-md");
			expect(command, "/save-md should be registered").toBeTruthy();
			await command!.handler("design", runner.createCommandContext());

			const path = join(cwd, "design.md");
			expect(await readFile(path, "utf8")).toBe(`${markdown}\n`);
			expect(notifications).toEqual([
				{ message: `Saved Markdown to ${path}`, type: "info" },
			]);
			expect(sentMessages).toEqual([
				{
					message: {
						customType: "save-md",
						content: `Saved Markdown to ${path}`,
						display: true,
					},
					options: { deliverAs: "nextTurn" },
				},
			]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("does not rewrite the assistant's Markdown", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));
		try {
			const { runner, sessionManager } = await createHarness(cwd);
			const markdown = "Paragraph with deliberate trailing space  \n\n";
			sessionManager.appendMessage(assistantMessage(markdown));

			const command = runner.getCommand("save-md");
			expect(command).toBeTruthy();
			await command!.handler("verbatim.md", runner.createCommandContext());

			expect(await readFile(join(cwd, "verbatim.md"), "utf8")).toBe(markdown);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("warns when missing a name", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));
		try {
			const { notifications, runner, sessionManager } =
				await createHarness(cwd);
			sessionManager.appendMessage(assistantMessage("# Unsaved"));

			const command = runner.getCommand("save-md");
			expect(command).toBeTruthy();
			await command!.handler("   ", runner.createCommandContext());

			expect(await readdir(cwd)).toEqual([]);
			expect(notifications).toEqual([
				{ message: "Usage: /save-md name", type: "warning" },
			]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("refuses to overwrite an existing file", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));
		try {
			const path = join(cwd, "design.md");
			await writeFile(path, "existing content\n", "utf8");
			const { notifications, runner, sessionManager } =
				await createHarness(cwd);
			sessionManager.appendMessage(assistantMessage("# Replacement"));

			const command = runner.getCommand("save-md");
			expect(command).toBeTruthy();
			await command!.handler("design", runner.createCommandContext());

			expect(await readFile(path, "utf8")).toBe("existing content\n");
			expect(notifications).toEqual([
				{ message: `File already exists: ${path}`, type: "error" },
			]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("saves the latest response on the active branch", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));
		try {
			const { runner, sessionManager } = await createHarness(cwd);
			const activeAssistantId = sessionManager.appendMessage(
				assistantMessage("# Active branch"),
			);
			sessionManager.appendMessage(assistantMessage("# Abandoned branch"));
			sessionManager.branch(activeAssistantId);

			const command = runner.getCommand("save-md");
			expect(command).toBeTruthy();
			await command!.handler("branch", runner.createCommandContext());

			expect(await readFile(join(cwd, "branch.md"), "utf8")).toBe(
				"# Active branch\n",
			);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("warns when the latest response has no Markdown text", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));
		try {
			const { notifications, runner, sessionManager } =
				await createHarness(cwd);
			sessionManager.appendMessage(assistantMessage("   "));

			const command = runner.getCommand("save-md");
			expect(command).toBeTruthy();
			await command!.handler("answer", runner.createCommandContext());

			expect(await readdir(cwd)).toEqual([]);
			expect(notifications).toEqual([
				{
					message: "The latest assistant response has no Markdown text",
					type: "warning",
				},
			]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("warns when there is no assistant response to save", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));
		try {
			const { notifications, runner } = await createHarness(cwd);

			const command = runner.getCommand("save-md");
			expect(command).toBeTruthy();
			await command!.handler("answer", runner.createCommandContext());

			expect(await readdir(cwd)).toEqual([]);
			expect(notifications).toEqual([
				{ message: "No assistant response to save", type: "warning" },
			]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
