import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function providerToolNames(payload: unknown): string[] | null {
	const tools = record(payload)?.["tools"];
	if (!Array.isArray(tools)) return null;
	const names: string[] = [];
	const visit = (entries: unknown[], prefix = "") => {
		for (const entry of entries) {
			const tool = record(entry);
			if (!tool) continue;
			const name = tool["name"] ?? record(tool["function"])?.["name"];
			if (Array.isArray(tool["tools"])) {
				visit(
					tool["tools"],
					typeof name === "string" ? `${prefix}${name}.` : prefix,
				);
			} else if (Array.isArray(tool["functionDeclarations"])) {
				visit(tool["functionDeclarations"], prefix);
			} else if (typeof name === "string") {
				names.push(`${prefix}${name}`);
			}
		}
	};
	visit(tools);
	return names.sort();
}

export function registerToolTrace(pi: ExtensionAPI) {
	let path: string | undefined;
	let latest: unknown;
	const snapshot = () => ({
		registered: pi.getAllTools().map((tool) => {
			const metadata = tool as unknown as Record<string, unknown>;
			return { name: tool.name, exposure: metadata["exposure"] ?? null };
		}),
		active: pi.getActiveTools(),
	});
	const capture = (event: string, extra: Record<string, unknown> = {}) => {
		latest = { time: new Date().toISOString(), event, ...snapshot(), ...extra };
		if (path)
			appendFileSync(path, `${JSON.stringify(latest)}\n`, { mode: 0o600 });
	};

	pi.on("session_start", () => capture("session_start"));
	pi.on("before_agent_start", () => {
		if (path) capture("before_agent_start");
	});
	pi.on("before_provider_request", (event) => {
		if (path)
			capture("before_provider_request", {
				providerTools: providerToolNames(event.payload),
			});
	});

	pi.registerCommand("tool-trace", {
		description: "Trace registered, active, and provider tool names",
		handler: async (args, ctx) => {
			const action = args.trim();
			if (action === "on") {
				if (!path) {
					path = join(
						mkdtempSync(join(tmpdir(), "pi-tool-trace-")),
						"tools.jsonl",
					);
					if (latest)
						appendFileSync(path, `${JSON.stringify(latest)}\n`, {
							mode: 0o600,
						});
				}
				capture("enabled");
				ctx.ui.notify(`Tool trace: ${path}`, "info");
			} else if (action === "off") {
				ctx.ui.notify(
					path ? `Tool trace stopped: ${path}` : "Tool trace is off",
					"info",
				);
				path = undefined;
			} else if (action === "" || action === "status") {
				ctx.ui.notify(
					JSON.stringify({ path: path ?? null, ...snapshot() }, null, 2),
					"info",
				);
			} else {
				ctx.ui.notify("Use /tool-trace on, off, or status", "warning");
			}
		},
	});
}
