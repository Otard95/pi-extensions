/**
 * Guards Extension
 *
 * Uses TypeSafe AI to prevent tool misuse and policy violations:
 *
 * - read_duplicate: bash read commands (cat, grep, find) when dedicated tools exist
 * - write_duplicate: bash file-content writes (sed -i, >, tee) when write/edit tools exist
 * - write_in_readonly: any file mutation when write/edit tools are disabled
 * Search calls use time limits instead of broad-path approval prompts.
 *
 * Each rule has an optional warn or ask threshold and a block threshold.
 * Duplicate checks warn the model. Prohibition checks ask the user.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	isToolCallEventType,
	type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "@sinclair/typebox";
import { type JsonValue, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import { resolveValue } from "../../utils/secret/index.js";
import { loadSettings } from "../../utils/settings.js";
import {
	DIRECTORY_SEARCH_QUESTION,
	isSearchCommand,
	registerSearchTimeouts,
} from "./search-timeout.js";

// Trigger patterns for specific commands
const TRIGGER_PATTERNS = {
	read: [
		{ pattern: /\bcat\b/, name: "cat" },
		{ pattern: /\bless\b/, name: "less" },
		{ pattern: /\bmore\b/, name: "more" },
		{ pattern: /\bhead\b/, name: "head" },
		{ pattern: /\btail\b/, name: "tail" },
		{ pattern: /\bbat\b/, name: "bat" },
	],
	grep: [
		{ pattern: /\bgrep\b/, name: "grep" },
		{ pattern: /\brg\b/, name: "rg" },
		{ pattern: /\bripgrep\b/, name: "ripgrep" },
	],
	find: [{ pattern: /\bfind\b/, name: "find" }],
	writeContent: [
		{ pattern: /\bsed\s+-i/, name: "sed -i" },
		{ pattern: /\bperl\s+-[a-zA-Z]*i/, name: "perl -i" },
		{ pattern: /\bawk\s+-i\s+inplace\b/, name: "awk -i inplace" },
		{ pattern: /\btee\b/, name: "tee" },
		{ pattern: /\bdd\s+.*\bof=/, name: "dd of=" },
		{ pattern: />\s*(?!\/dev\/null\b)/, name: ">" },
		{ pattern: /<</, name: "<<" },
		{ pattern: />>/, name: ">>" },
	],
	writeMutation: [
		{ pattern: /\bmv\b/, name: "mv" },
		{ pattern: /\bcp\b/, name: "cp" },
		{ pattern: /\brm\b/, name: "rm" },
		{ pattern: /\brmdir\b/, name: "rmdir" },
		{ pattern: /\bmkdir\b/, name: "mkdir" },
		{ pattern: /\bchmod\b/, name: "chmod" },
		{ pattern: /\bchown\b/, name: "chown" },
		{ pattern: /\bln\b/, name: "ln" },
		{ pattern: /\btouch\b/, name: "touch" },
		{ pattern: /\bpatch\b/, name: "patch" },
		{ pattern: /\bsed\s+-i/, name: "sed -i" },
		{ pattern: /\bperl\s+-[a-zA-Z]*i/, name: "perl -i" },
		{ pattern: /\bawk\s+-i\s+inplace\b/, name: "awk -i inplace" },
		{ pattern: /\btee\b/, name: "tee" },
		{ pattern: /\bdd\s+.*\bof=/, name: "dd of=" },
		{ pattern: />\s*(?!\/dev\/null\b)/, name: ">" },
		{ pattern: /<</, name: "<<" },
		{ pattern: />>/, name: ">>" },
		{
			pattern:
				/\bgit\s+(add|commit|push|checkout|reset|rebase|merge|stash|cherry-pick|revert)\b/,
			name: "git write",
		},
	],
};

// Settings schema
const RuleSettingsSchema = Type.Partial(
	Type.Object({
		block: Type.Number(),
		warn: Type.Number(),
		ask: Type.Number(),
		fail_mode: Type.Union([Type.Literal("closed"), Type.Literal("open")]),
	}),
);

const GuardsSettingsSchema = Type.Object({
	typesafe: Type.Optional(
		Type.Object({
			token: Type.Optional(Type.String()),
			model: Type.Optional(Type.String()),
			rules: Type.Optional(
				Type.Partial(
					Type.Object({
						read_duplicate: RuleSettingsSchema,
						write_duplicate: RuleSettingsSchema,
						write_in_readonly: RuleSettingsSchema,
						unnecessary_cwd_path: RuleSettingsSchema,
					}),
				),
			),
		}),
	),
});

type GuardsSettingsInput = Static<typeof GuardsSettingsSchema>;

type GuardsSettings = {
	typesafe: {
		token?: string;
		model: string;
		rules: {
			read_duplicate: {
				block: number;
				warn?: number;
				fail_mode: "closed" | "open";
			};
			write_duplicate: {
				block: number;
				warn?: number;
				fail_mode: "closed" | "open";
			};
			write_in_readonly: {
				block: number;
				ask: number;
				fail_mode: "closed" | "open";
			};
			unnecessary_cwd_path: {
				warn: number;
				fail_mode: "closed" | "open";
			};
		};
	};
};

const DEFAULT_SETTINGS: GuardsSettings = {
	typesafe: {
		model: "jev-latest",
		rules: {
			read_duplicate: { warn: 0.5, block: 0.85, fail_mode: "open" },
			write_duplicate: { warn: 0.5, block: 0.97, fail_mode: "open" },
			write_in_readonly: { block: 0.8, ask: 0.2, fail_mode: "closed" },
			unnecessary_cwd_path: { warn: 0.5, fail_mode: "open" },
		},
	},
};

function getSettings(): GuardsSettings {
	const input = loadSettings<GuardsSettingsInput>(
		"guards",
		GuardsSettingsSchema,
	).unwrapOr({});
	const typesafe = input.typesafe ?? {};
	const rules = typesafe.rules ?? {};

	return {
		typesafe: {
			token: typesafe.token,
			model: typesafe.model ?? DEFAULT_SETTINGS.typesafe.model,
			rules: {
				read_duplicate: {
					...DEFAULT_SETTINGS.typesafe.rules.read_duplicate,
					...rules.read_duplicate,
				},
				write_duplicate: {
					...DEFAULT_SETTINGS.typesafe.rules.write_duplicate,
					...rules.write_duplicate,
				},
				write_in_readonly: {
					...DEFAULT_SETTINGS.typesafe.rules.write_in_readonly,
					...rules.write_in_readonly,
				},
				unnecessary_cwd_path: {
					...DEFAULT_SETTINGS.typesafe.rules.unnecessary_cwd_path,
					...rules.unnecessary_cwd_path,
				},
			},
		},
	};
}

type RuleId =
	| "read_duplicate"
	| "write_duplicate"
	| "write_in_readonly"
	| "unnecessary_cwd_path";

interface AvailableTool {
	name: string;
	description: string;
	parameters: JsonValue;
	promptGuidelines?: string[];
}

interface ApplicableRule {
	id: RuleId;
	question: string;
	availableTools?: AvailableTool[];
}

let resolvedToken: string | undefined;
let tokenResolved = false;

async function getToken(
	token: string | undefined,
): Promise<string | undefined> {
	if (tokenResolved) return resolvedToken;
	if (!token) return undefined;

	resolvedToken = await resolveValue(token);
	tokenResolved = true;
	return resolvedToken;
}

interface TelemetryRecord {
	ts: string;
	command: string;
	cwd: string;
	activeTools: string[];
	triggers: TriggerResult[];
	questions: Array<{ id: RuleId; noul: number }>;
	directorySearch?: number;
	searchTimeout?: number;
	decision: "block" | "ask" | "warn" | "allow";
	decidedBy?: { id: RuleId; noul: number };
	thresholds: GuardsSettings["typesafe"]["rules"];
	userAnswer?: boolean;
}

interface TriggerResult {
	category:
		| "read"
		| "grep"
		| "find"
		| "writeContent"
		| "writeMutation"
		| "cwdPath";
	commands: string[];
}

function scanTriggers(command: string, cwd: string): TriggerResult[] {
	const results: TriggerResult[] = [];

	for (const [category, patterns] of Object.entries(TRIGGER_PATTERNS)) {
		const matched = patterns
			.filter((p) => p.pattern.test(command))
			.map((p) => p.name);
		if (matched.length > 0) {
			results.push({
				category: category as TriggerResult["category"],
				commands: matched,
			});
		}
	}

	if (command.includes(cwd)) {
		results.push({ category: "cwdPath", commands: [cwd] });
	}

	return results;
}

function buildApplicableRules(
	triggers: TriggerResult[],
	activeTools: string[],
	allTools: AvailableTool[],
): ApplicableRule[] {
	const categories = new Set(triggers.map((trigger) => trigger.category));
	const hasWrite = activeTools.includes("write");
	const hasEdit = activeTools.includes("edit");
	const hasRead = activeTools.includes("read");
	const hasGrep = activeTools.includes("grep");
	const hasFind = activeTools.includes("find");

	const rules: ApplicableRule[] = [];

	// read_duplicate: read-like commands when read/grep/find tools are active
	if (
		(categories.has("read") && hasRead) ||
		(categories.has("grep") && hasGrep) ||
		(categories.has("find") && hasFind)
	) {
		const relevantTools = allTools.filter(
			(t) => t.name === "read" || t.name === "grep" || t.name === "find",
		);
		if (relevantTools.length > 0) {
			rules.push({
				id: "read_duplicate",
				question:
					"Should the agent have used one of the listed tools instead of this bash command?",
				availableTools: relevantTools,
			});
		}
	}

	// write_duplicate: content-writing commands when write/edit tools are active
	if (categories.has("writeContent") && (hasWrite || hasEdit)) {
		const relevantTools = allTools.filter(
			(t) => t.name === "write" || t.name === "edit",
		);
		if (relevantTools.length > 0) {
			rules.push({
				id: "write_duplicate",
				question:
					"Should the agent have used one of the listed tools instead of this bash command?",
				availableTools: relevantTools,
			});
		}
	}

	// write_in_readonly: any mutation when write/edit are disabled
	if (categories.has("writeMutation") && !hasWrite && !hasEdit) {
		rules.push({
			id: "write_in_readonly",
			question:
				"The write and edit tools are disabled in this mode. Does this command modify files to work around that restriction, rather than a change genuinely required and only doable via bash?",
		});
	}

	if (categories.has("cwdPath")) {
		rules.push({
			id: "unnecessary_cwd_path",
			question:
				"The command already runs in `cwd`. Does it unnecessarily repeat `cwd` in a cd command or full path when removing it or using a relative path preserves behavior?",
		});
	}

	return rules;
}

async function callTypeSafe(
	command: string,
	cwd: string,
	rules: ApplicableRule[],
	thresholds: GuardsSettings["typesafe"]["rules"],
	model: string,
	token: string | undefined,
): Promise<{ nouls: Map<RuleId, number>; directorySearch?: number }> {
	const classifySearch = isSearchCommand(command);
	if (rules.length === 0 && !classifySearch) return { nouls: new Map() };
	const questions: Record<string, ReturnType<typeof noul>> = {};

	for (const rule of rules) {
		questions[rule.id] = noul(
			rule.availableTools
				? {
						question: rule.question,
						availableTools: rule.availableTools as unknown as JsonValue,
					}
				: rule.question,
		);
	}

	if (classifySearch)
		questions["directory_search"] = noul(DIRECTORY_SEARCH_QUESTION);

	try {
		const client = new TypeSafeClient({ apiKey: await getToken(token) });
		const response = await client.systemOne({
			model,
			state: { command, cwd },
			questions,
		});

		const results = new Map<RuleId, number>();
		for (const rule of rules) {
			const answer = response.answers[rule.id];
			if (answer && "noul" in answer) {
				results.set(rule.id, answer.noul);
			}
		}
		const searchAnswer = response.answers["directory_search"];
		return {
			nouls: results,
			directorySearch:
				searchAnswer && "noul" in searchAnswer ? searchAnswer.noul : undefined,
		};
	} catch (_error) {
		const results = new Map<RuleId, number>();
		for (const rule of rules) {
			results.set(
				rule.id,
				thresholds[rule.id].fail_mode === "closed" ? 0.99 : 0.0,
			);
		}
		return { nouls: results };
	}
}

type RuleDecision = "block" | "ask" | "warn" | "allow";

function applyBands(
	noul: number,
	intervene: number,
	block: number,
	intervention: "ask" | "warn",
): RuleDecision {
	if (noul >= block) return "block";
	if (noul >= intervene) return intervention;
	return "allow";
}

function getRuleTriggers(ruleId: RuleId, triggers: TriggerResult[]): string[] {
	const categories: Record<RuleId, TriggerResult["category"][]> = {
		read_duplicate: ["read", "grep", "find"],
		write_duplicate: ["writeContent"],
		write_in_readonly: ["writeMutation"],
		unnecessary_cwd_path: ["cwdPath"],
	};

	return triggers
		.filter((trigger) => categories[ruleId].includes(trigger.category))
		.flatMap((trigger) => trigger.commands);
}

function decideOverall(
	nouls: Map<RuleId, number>,
	thresholds: GuardsSettings["typesafe"]["rules"],
): {
	decision: RuleDecision;
	decidedBy?: { id: RuleId; noul: number };
} {
	const priority: Record<RuleDecision, number> = {
		allow: 0,
		warn: 1,
		ask: 2,
		block: 3,
	};
	let decision: RuleDecision = "allow";
	let decidedBy: { id: RuleId; noul: number } | undefined;

	for (const [id, noulValue] of nouls) {
		const rule = thresholds[id];
		let result: RuleDecision;

		if (id === "unnecessary_cwd_path") {
			result = noulValue >= (rule as { warn: number }).warn ? "warn" : "allow";
		} else {
			const standardRule = rule as {
				block: number;
				warn?: number;
				ask?: number;
			};
			const isDuplicate = id === "read_duplicate" || id === "write_duplicate";
			const intervention = isDuplicate ? "warn" : "ask";
			const threshold = isDuplicate
				? (standardRule.warn ?? standardRule.block)
				: (standardRule.ask ?? standardRule.block);
			result = applyBands(
				noulValue,
				threshold,
				standardRule.block,
				intervention,
			);
		}

		if (priority[result] > priority[decision]) {
			decision = result;
			decidedBy = { id, noul: noulValue };
		}
	}

	return { decision, decidedBy };
}

async function logTelemetry(record: TelemetryRecord): Promise<void> {
	try {
		const logDir = getAgentDir();
		await mkdir(logDir, { recursive: true });
		const logPath = join(logDir, "guards-tuning.jsonl");
		await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf-8");
	} catch {
		// Silent fail — don't break the flow
	}
}

async function checkTypeSafeGuards(
	event: ToolCallEvent,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	limitSearch: (event: ToolCallEvent) => void,
): Promise<{ block: true; reason: string } | undefined> {
	if (!isToolCallEventType("bash", event)) return;

	const command: string = event.input.command || "";
	const triggers = scanTriggers(command, ctx.cwd);
	if (triggers.length === 0) return; // No triggers, allow (common fast path)

	const activeTools = pi.getActiveTools();
	const allTools = pi
		.getAllTools()
		.filter((t) => activeTools.includes(t.name))
		.map((t) => ({
			name: t.name,
			description: t.description,
			parameters: JSON.parse(JSON.stringify(t.parameters)) as JsonValue,
			...(t.promptGuidelines ? { promptGuidelines: t.promptGuidelines } : {}),
		}));

	const rules = buildApplicableRules(triggers, activeTools, allTools);
	if (rules.length === 0 && !isSearchCommand(command)) return;

	const settings = getSettings();
	if (!settings.typesafe.token && !process.env["TYPESAFE_API_KEY"]) {
		if (rules.length === 0) return;
		return {
			block: true,
			reason:
				"Blocked: TypeSafe is not configured. Set guards.typesafe.token in settings.json or TYPESAFE_API_KEY.",
		};
	}

	const { nouls, directorySearch } = await callTypeSafe(
		command,
		ctx.cwd,
		rules,
		settings.typesafe.rules,
		settings.typesafe.model,
		settings.typesafe.token,
	);

	if (
		directorySearch !== undefined &&
		directorySearch >= 0.8 &&
		directorySearch <= 1
	) {
		limitSearch(event);
	}

	const searchTelemetry = {
		directorySearch,
		searchTimeout:
			directorySearch !== undefined &&
			directorySearch >= 0.8 &&
			directorySearch <= 1
				? event.input.timeout
				: undefined,
	};
	const { decision, decidedBy } = decideOverall(nouls, settings.typesafe.rules);

	let userAnswer: boolean | undefined;

	if (decision === "warn" && decidedBy) {
		const isCwdPathWarning = decidedBy.id === "unnecessary_cwd_path";
		const advice = isCwdPathWarning
			? `Use a relative path when it fits the task. Your current cwd is: ${ctx.cwd}.`
			: "Use a dedicated tool when it fits the task.";
		pi.sendMessage({
			customType: "guards-warning",
			content:
				`Guard warning: ${decidedBy.id} scored ${(decidedBy.noul * 100).toFixed(0)}%. ` +
				`The command will run. ${advice}`,
			display: false,
		});
	}

	if (decision === "ask" && decidedBy) {
		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Blocked: cannot ask for confirmation (rule: ${decidedBy.id})`,
			};
		}

		const matchedTriggers = getRuleTriggers(decidedBy.id, triggers);
		const confirmed = await ctx.ui.confirm(
			"Command flagged",
			`This bash command may violate a mode restriction.\n\nRule: ${decidedBy.id}\nTrigger: ${matchedTriggers.join(", ")}\nConfidence: ${(decidedBy.noul * 100).toFixed(0)}%\n\nCommand:\n${command}\n\nProceed anyway?`,
		);
		userAnswer = confirmed;
		if (!confirmed) {
			await logTelemetry({
				ts: new Date().toISOString(),
				command,
				cwd: ctx.cwd,
				activeTools,
				triggers,
				questions: Array.from(nouls.entries()).map(([id, noul]) => ({
					id,
					noul,
				})),
				decision: "block",
				decidedBy,
				thresholds: settings.typesafe.rules,
				userAnswer,
				...searchTelemetry,
			});
			return {
				block: true,
				reason: `Blocked by user after confirmation (rule: ${decidedBy.id})`,
			};
		}
	}

	await logTelemetry({
		ts: new Date().toISOString(),
		command,
		cwd: ctx.cwd,
		activeTools,
		triggers,
		questions: Array.from(nouls.entries()).map(([id, noul]) => ({ id, noul })),
		decision: decision === "ask" && userAnswer === true ? "allow" : decision,
		decidedBy,
		thresholds: settings.typesafe.rules,
		userAnswer,
		...searchTelemetry,
	});

	if (decision === "block" && decidedBy) {
		return {
			block: true,
			reason: `Blocked: ${decidedBy.id} (confidence: ${(decidedBy.noul * 100).toFixed(0)}%)`,
		};
	}

	return undefined; // allow
}

export default function guardsExtension(pi: ExtensionAPI) {
	const limitSearch = registerSearchTimeouts(pi);
	pi.on("tool_call", async (event, ctx) => {
		return await checkTypeSafeGuards(event, ctx, pi, limitSearch);
	});
}
