import {
	createFindToolDefinition,
	createGrepToolDefinition,
	type ExtensionAPI,
	isToolCallEventType,
	type ToolCallEvent,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export function searchTimeout(timeout?: number): number {
	if (timeout === undefined || !Number.isFinite(timeout) || timeout <= 0) {
		return 2;
	}
	return Math.min(timeout, 10);
}

export function isSearchCommand(command: string): boolean {
	return /\b(grep|rg|ripgrep|find)\b/.test(command);
}

export function timeoutMessage(seconds: number): string {
	return `Search exceeded its ${seconds}s limit. Narrow the path or pattern before retrying.`;
}

export async function withSearchTimeout<T>(
	seconds: number,
	signal: AbortSignal | undefined,
	run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	const abort = () => controller.abort(signal?.reason);
	if (signal?.aborted) abort();
	else signal?.addEventListener("abort", abort, { once: true });
	let timedOut = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
			reject(new Error(timeoutMessage(seconds)));
		}, seconds * 1000);
	});
	try {
		const result = await Promise.race([run(controller.signal), expired]);
		if (timedOut) throw new Error(timeoutMessage(seconds));
		return result;
	} catch (error) {
		if (timedOut) throw new Error(timeoutMessage(seconds));
		throw error;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", abort);
	}
}

export const DIRECTORY_SEARCH_QUESTION =
	"Does this command search directory trees or discover files? " +
	"Count recursive content searches, directory traversal, and file discovery. " +
	"Exclude filtering piped output and reading specific files, including logs after a build or test. " +
	"A grep, rg, or find word in quoted text is not a search by itself.";

export function registerSearchTimeouts(
	pi: ExtensionAPI,
): (event: ToolCallEvent) => void {
	const limitedCalls = new Map<string, number>();
	pi.on("session_shutdown", () => limitedCalls.clear());

	pi.on("tool_result", (event) => {
		const seconds = limitedCalls.get(event.toolCallId);
		limitedCalls.delete(event.toolCallId);
		if (event.toolName !== "bash" || !event.isError || seconds === undefined)
			return;
		return {
			content: event.content.map((part) =>
				part.type === "text"
					? {
							...part,
							text: part.text.replace(
								/Command timed out after ([\d.]+) seconds/g,
								(_match, seconds: string) => timeoutMessage(Number(seconds)),
							),
						}
					: part,
			),
		};
	});

	registerSearchTool(pi, createGrepToolDefinition);
	registerSearchTool(pi, createFindToolDefinition);
	pi.on("tool_execution_end", (event) => {
		limitedCalls.delete(event.toolCallId);
	});

	return (event) => {
		if (!isToolCallEventType("bash", event)) return;
		event.input.timeout = searchTimeout(event.input.timeout);
		limitedCalls.set(event.toolCallId, event.input.timeout);
	};
}

function registerSearchTool<
	Schema extends ToolDefinition["parameters"] & { properties: object },
	Details,
>(
	pi: ExtensionAPI,
	createTool: (cwd: string) => ToolDefinition<Schema, Details>,
): void {
	const tool = createTool(".");
	pi.registerTool({
		...tool,
		parameters: {
			...tool.parameters,
			properties: {
				...tool.parameters.properties,
				timeout: {
					type: "number",
					description: "Timeout in seconds (default: 2, maximum: 10)",
				},
			},
		},
		execute(id, params, signal, onUpdate, ctx) {
			const timeout = (params as { timeout?: number }).timeout;
			return withSearchTimeout(searchTimeout(timeout), signal, (searchSignal) =>
				createTool(ctx.cwd).execute(id, params, searchSignal, onUpdate, ctx),
			);
		},
	});
}
