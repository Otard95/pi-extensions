import { appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const WEB_SEARCH_DEBUG_LOG = join(tmpdir(), "pi-web-search-debug.log");

export async function writeWebSearchDebugLog(
	event: string,
	details: Record<string, unknown>,
): Promise<void> {
	if (process.env["VITEST"]) return;
	try {
		await appendFile(
			WEB_SEARCH_DEBUG_LOG,
			`${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`,
			"utf8",
		);
	} catch (error) {
		console.warn(
			`Unable to write web search debug log: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}
