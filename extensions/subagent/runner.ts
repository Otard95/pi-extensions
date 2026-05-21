import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRegistry,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { at } from "../../utils/array/at";
import type { AgentConfig } from "./agents";
import type { LiveTask } from "./schema";
import { EMPTY_USAGE, type SingleResult } from "./types";

// -- Model resolution --------------------------------------------------------

function resolveModelFromRegistry(
	modelStr: string,
	modelRegistry: ModelRegistry,
) {
	const available = modelRegistry.getAvailable();

	if (modelStr.includes("/")) {
		const slashIdx = modelStr.indexOf("/");
		const provider = modelStr.slice(0, slashIdx);
		const modelId = modelStr.slice(slashIdx + 1);
		const exact = modelRegistry.find(provider, modelId);
		if (exact) return exact;
	}

	const byId = available.find((m) => m.id === modelStr);
	if (byId) return byId;

	return available.find((m) => m.id.includes(modelStr));
}

// -- Concurrency utility -----------------------------------------------------

export async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(at(items, current), current);
		}
	});
	await Promise.all(workers);
	return results;
}

// -- System prompt -----------------------------------------------------------

const toolSnippets: Record<string, string> = {
	read: "Read file contents",
	bash: "Execute bash commands (ls, grep, find, etc.)",
	edit: "Make precise file edits with exact text replacement",
	write: "Create or overwrite files",
	grep: "Search file contents for patterns (respects .gitignore)",
	find: "Find files by glob pattern (respects .gitignore)",
	ls: "List directory contents",
};

function buildSubagentPrompt(agent: AgentConfig, cwd: string): string {
	const parts: string[] = [];

	if (agent.systemPrompt.trim()) {
		parts.push(agent.systemPrompt.trim());
	}

	if (agent.tools && agent.tools.length > 0) {
		const toolLines = agent.tools
			.map((name) => {
				const snippet = toolSnippets[name];
				return snippet ? `- ${name}: ${snippet}` : `- ${name}`;
			})
			.join("\n");
		parts.push(`Available tools:\n${toolLines}`);
	}

	parts.push(`Current working directory: ${cwd}`);

	return parts.join("\n\n");
}

// -- Single agent runner -----------------------------------------------------

/**
 * Run an agent for a LiveTask. Mutates `liveTask` in place
 * (state, result) and calls `notify()` on each state change.
 */
export async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	liveTask: LiveTask,
	signal: AbortSignal | undefined,
	notify: () => void,
): Promise<void> {
	const agent = agents.find((a) => a.name === liveTask.agent);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		liveTask.state = "error";
		liveTask.result = {
			agent: liveTask.agent,
			agentSource: "unknown",
			task: liveTask.taskDescription,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${liveTask.agent}". Available agents: ${available}.`,
			usage: { ...EMPTY_USAGE },
		};
		notify();
		return;
	}

	liveTask.state = "running";
	const startTime = Date.now();
	const result: SingleResult = {
		agent: liveTask.agent,
		agentSource: agent.source,
		task: liveTask.taskDescription,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { ...EMPTY_USAGE },
		model: agent.model,
		startTime,
	};
	liveTask.result = result;
	notify();

	const effectiveCwd = defaultCwd;
	const agentDir = getAgentDir() ?? "";
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const model = agent.model
		? resolveModelFromRegistry(agent.model, modelRegistry)
		: undefined;

	try {
		const loader = new DefaultResourceLoader({
			cwd: effectiveCwd,
			agentDir,
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
			systemPromptOverride: () => buildSubagentPrompt(agent, effectiveCwd),
		});
		await loader.reload();

		const { session } = await createAgentSession({
			cwd: effectiveCwd,
			agentDir,
			model,
			thinkingLevel: "off",
			tools: agent.tools,
			authStorage,
			modelRegistry,
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(),
		});

		const unsubscribe = session.subscribe((event) => {
			if (event.type === "message_end") {
				const msg = event.message as Message;
				result.messages.push(msg);

				if (msg.role === "assistant") {
					const am = msg as AssistantMessage;
					result.usage.turns++;
					if (am.usage) {
						result.usage.input += am.usage.input || 0;
						result.usage.output += am.usage.output || 0;
						result.usage.cacheRead += am.usage.cacheRead || 0;
						result.usage.cacheWrite += am.usage.cacheWrite || 0;
						result.usage.cost += am.usage.cost?.total || 0;
						result.usage.contextTokens = am.usage.totalTokens || 0;
					}
					if (!result.model && am.model) result.model = am.model;
					if (am.stopReason) result.stopReason = am.stopReason;
					if (am.errorMessage) result.errorMessage = am.errorMessage;
				}
				notify();
			}

			if (event.type === "tool_execution_end") notify();
		});

		// Abort handling
		if (signal?.aborted) {
			await session.abort();
			throw new Error("Subagent was aborted");
		}
		const abortHandler = signal ? () => session.abort() : undefined;
		if (signal && abortHandler)
			signal.addEventListener("abort", abortHandler, { once: true });

		try {
			await session.prompt(`Task: ${liveTask.taskDescription}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("abort")) throw new Error("Subagent was aborted");
			result.exitCode = 1;
			result.stderr = msg;
		} finally {
			if (signal && abortHandler)
				signal.removeEventListener("abort", abortHandler);
			unsubscribe();
			session.dispose();
		}

		if (result.stopReason === "error" || result.stopReason === "aborted") {
			result.exitCode = 1;
		}

		result.endTime = Date.now();
		result.durationMs = result.endTime - startTime;
		liveTask.state = result.exitCode === 0 ? "done" : "error";
		notify();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("abort")) throw err;
		result.exitCode = 1;
		result.stderr = msg;
		result.endTime = Date.now();
		result.durationMs = result.endTime - startTime;
		liveTask.state = "error";
		notify();
	}
}
