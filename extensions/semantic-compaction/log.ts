import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const LOG_DIRECTORY = "semantic-compaction";
const LOG_FILE = "failures.jsonl";

export interface CompactionLogContext {
	mode: "tools" | "turns";
	group?: number;
	sessionId?: string;
}

export async function logCompactionFailure(
	level: "warning" | "error",
	event: string,
	error: unknown,
	context: CompactionLogContext,
): Promise<void> {
	try {
		const directory = join(getAgentDir(), LOG_DIRECTORY);
		await mkdir(directory, { recursive: true });
		await appendFile(
			join(directory, LOG_FILE),
			`${JSON.stringify({
				timestamp: new Date().toISOString(),
				level,
				event,
				context,
				error: serializeError(error),
			})}\n`,
			"utf8",
		);
	} catch {
		// Logging must not stop compaction.
	}
}

function serializeError(error: unknown, seen = new WeakSet<object>()): unknown {
	if (error instanceof Error) {
		if (seen.has(error)) return "[Circular error]";
		seen.add(error);
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
			cause: error.cause ? serializeError(error.cause, seen) : undefined,
			properties: Object.fromEntries(
				Object.entries(error)
					.filter(([key]) => key !== "cause")
					.map(([key, value]) => [key, serializeError(value, seen)]),
			),
		};
	}
	if (typeof error === "object" && error !== null) {
		if (seen.has(error)) return "[Circular value]";
		seen.add(error);
		if (Array.isArray(error))
			return error.map((value) => serializeError(value, seen));
		return Object.fromEntries(
			Object.entries(error).map(([key, value]) => [
				key,
				serializeError(value, seen),
			]),
		);
	}
	if (typeof error === "bigint") return error.toString();
	if (error === undefined) return "undefined";
	return error;
}
