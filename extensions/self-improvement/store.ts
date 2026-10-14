import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Rule, RuleState, RuleStore, Trigger } from "./types";

const STORE_FILE = "self-improvement/rules.json";

export function getStorePath(): string {
	return join(getAgentDir(), STORE_FILE);
}

export async function loadRuleStore(): Promise<RuleStore> {
	try {
		const text = await readFile(getStorePath(), "utf8");
		return parseRuleStore(JSON.parse(text));
	} catch (error) {
		if (isMissingFile(error)) return { rules: [] };
		throw error;
	}
}

export async function saveRuleStore(store: RuleStore): Promise<void> {
	const file = getStorePath();
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(store, null, "\t")}\n`, "utf8");
	await rename(temporary, file);
}

function isMissingFile(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}

function parseRuleStore(value: unknown): RuleStore {
	if (!isRecord(value) || !Array.isArray(value["rules"])) {
		throw new Error("The self-improvement rule store is invalid.");
	}
	return { rules: value["rules"].map(parseRule) };
}

function parseRule(value: unknown): Rule {
	if (!isRecord(value)) throw new Error("A self-improvement rule is invalid.");
	const { id, text, when, state, scratchpad, createdAt, updatedAt } = value;
	if (
		typeof id !== "string" ||
		typeof text !== "string" ||
		!Array.isArray(when) ||
		!isRuleState(state) ||
		typeof scratchpad !== "string" ||
		typeof createdAt !== "string" ||
		typeof updatedAt !== "string"
	) {
		throw new Error("A self-improvement rule is invalid.");
	}
	const rule: Rule = {
		id,
		text,
		when: when.map(parseTrigger),
		state,
		scratchpad,
		citations: Array.isArray(value["citations"])
			? value["citations"].map(parseCitation)
			: [],
		createdAt,
		updatedAt,
	};
	if (typeof value["lastEvidenceAt"] === "string") {
		rule.lastEvidenceAt = value["lastEvidenceAt"];
	}
	if (typeof value["lastReviewedAt"] === "string") {
		rule.lastReviewedAt = value["lastReviewedAt"];
	}
	return rule;
}

function parseCitation(value: unknown): Rule["citations"][number] {
	if (
		!isRecord(value) ||
		typeof value["id"] !== "string" ||
		typeof value["sessionId"] !== "string" ||
		typeof value["entryId"] !== "string" ||
		!Array.isArray(value["excerpts"]) ||
		!value["excerpts"].every((excerpt) => typeof excerpt === "string")
	) {
		throw new Error("A self-improvement citation is invalid.");
	}
	return {
		id: value["id"],
		sessionId: value["sessionId"],
		entryId: value["entryId"],
		excerpts: value["excerpts"],
	};
}

function parseTrigger(value: unknown): Trigger {
	if (!isRecord(value) || typeof value["kind"] !== "string") {
		throw new Error("A self-improvement rule trigger is invalid.");
	}
	if (value["kind"] === "always") return { kind: "always" };
	if (
		(value["kind"] === "cwd" || value["kind"] === "touched-file") &&
		typeof value["glob"] === "string"
	) {
		return { kind: value["kind"], glob: value["glob"] };
	}
	throw new Error("A self-improvement rule trigger is invalid.");
}

function isRuleState(value: unknown): value is RuleState {
	return (
		value === "candidate" ||
		value === "active" ||
		value === "archived" ||
		value === "retired"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
