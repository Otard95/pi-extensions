import { describe, expect, it, vi } from "vitest";

const { compactTools } = vi.hoisted(() => ({ compactTools: vi.fn() }));

vi.mock("../compaction", () => ({ compactTools }));

import semanticCompaction from "../index";

describe("semantic compact command", () => {
	it("restores the selected model in the compacted session", async () => {
		compactTools.mockResolvedValue({ rebuilt: [], stats: "done" });
		const registerCommand = vi.fn();
		semanticCompaction({ registerCommand, on: vi.fn() } as never);
		const command = registerCommand.mock.calls[0]?.[1];
		if (!command)
			throw new Error("semantic-compact command was not registered");
		const appendModelChange = vi.fn();
		const setModel = vi.fn();
		const model = { provider: "openai", id: "gpt-5" };
		const newSession = vi.fn(async ({ setup, withSession }) => {
			const freshPi = { on: vi.fn(), registerCommand: vi.fn(), setModel };
			semanticCompaction(freshPi as never);
			const sessionStart = freshPi.on.mock.calls.find(
				([event]) => event === "session_start",
			)?.[1];
			if (!sessionStart)
				throw new Error("session_start handler was not registered");
			await sessionStart(
				{ reason: "new" },
				{ modelRegistry: { find: vi.fn().mockReturnValue(model) } },
			);
			await setup({ appendModelChange });
			await withSession({ ui: { notify: vi.fn() } });
			return { cancelled: false };
		});

		await command.handler("", {
			model,
			sessionManager: {
				getBranch: vi.fn().mockReturnValue([{}]),
				getSessionFile: vi.fn().mockReturnValue("parent.jsonl"),
			},
			newSession,
			ui: { notify: vi.fn() },
		});

		expect(setModel).toHaveBeenCalledWith(model);
		expect(appendModelChange).toHaveBeenCalledWith("openai", "gpt-5");
	});
});
