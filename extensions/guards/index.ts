/**
 * Guards Extension
 *
 * Uses TypeSafe AI to prevent tool misuse and policy violations:
 *
 * - read_duplicate: bash read commands (cat, grep, find) when dedicated tools exist
 * - write_duplicate: bash file-content writes (sed -i, >, tee) when write/edit tools exist
 * - write_in_readonly: any file mutation when write/edit tools are disabled
 * - broad_search: grep/find searching overly broad paths (/, /home, /nix, etc.)
 *
 * Each rule has an optional warn or ask threshold and a block threshold.
 * Duplicate checks warn the model. Prohibition checks ask the user.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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

// Deterministic broadness block (fast path, no request needed)
const BLOCKED_PATHS = [
	"/",
	"/home",
	homedir(),
	"/nix",
	"/nix/store",
	"/etc",
	"/usr",
	"/var",
	"/tmp",
	"/opt",
	"/run",
	"/sys",
	"/proc",
];

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
						broad_search: RuleSettingsSchema,
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
			broad_search: {
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
			broad_search: { block: 0.8, ask: 0.2, fail_mode: "closed" },
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
				broad_search: {
					...DEFAULT_SETTINGS.typesafe.rules.broad_search,
					...rules.broad_search,
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
	| "broad_search"
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

	// broad_search: find/grep present
	if (categories.has("grep") || categories.has("find")) {
		rules.push({
			id: "broad_search",
			question:
				"Given the working directory, does this command search or traverse an overly broad location (entire home dir, filesystem root, or a system dir)?",
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
): Promise<Map<RuleId, number>> {
	if (rules.length === 0) return new Map();

	const client = new TypeSafeClient({ apiKey: await getToken(token) });
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

	try {
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
		return results;
	} catch (_error) {
		const results = new Map<RuleId, number>();
		for (const rule of rules) {
			results.set(
				rule.id,
				thresholds[rule.id].fail_mode === "closed" ? 0.99 : 0.0,
			);
		}
		return results;
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
	if (rules.length === 0) return; // No applicable rules

	const settings = getSettings();
	if (!settings.typesafe.token && !process.env["TYPESAFE_API_KEY"]) {
		return {
			block: true,
			reason:
				"Blocked: TypeSafe is not configured. Set guards.typesafe.token in settings.json or TYPESAFE_API_KEY.",
		};
	}

	const nouls = await callTypeSafe(
		command,
		ctx.cwd,
		rules,
		settings.typesafe.rules,
		settings.typesafe.model,
		settings.typesafe.token,
	);

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

		const confirmed = await ctx.ui.confirm(
			"Command flagged",
			`This bash command may violate a mode restriction.\n\nRule: ${decidedBy.id}\nConfidence: ${(decidedBy.noul * 100).toFixed(0)}%\n\nProceed anyway?`,
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
	});

	if (decision === "block" && decidedBy) {
		return {
			block: true,
			reason: `Blocked: ${decidedBy.id} (confidence: ${(decidedBy.noul * 100).toFixed(0)}%)`,
		};
	}

	return undefined; // allow
}

// Deterministic path guard (fast, free check for unambiguous cases)
function checkDeterministicPathGuard(
	event: ToolCallEvent,
	cwd: string,
): { block: true; reason: string } | undefined {
	if (
		!isToolCallEventType("grep", event) &&
		!isToolCallEventType("find", event)
	)
		return;

	const input = event.input as { path?: string; pattern?: string };

	if (input.path) {
		const resolved = resolve(cwd, input.path).replace(/\/+$/, "") || "/";
		if (BLOCKED_PATHS.includes(resolved)) {
			return {
				block: true,
				reason: `Blocked: path "${input.path}" resolves to "${resolved}" which is too broad. Use a more specific directory.`,
			};
		}
	}

	if (input.pattern && /^\/.*\*\*/.test(input.pattern)) {
		return {
			block: true,
			reason: `Blocked: pattern "${input.pattern}" searches from filesystem root. Use a relative pattern or set a specific path.`,
		};
	}
}

export default function guardsExtension(pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		// Fast deterministic checks first
		const pathBlock = checkDeterministicPathGuard(event, ctx.cwd);
		if (pathBlock) return pathBlock;

		// TypeSafe-powered checks
		return await checkTypeSafeGuards(event, ctx, pi);
	});
}
