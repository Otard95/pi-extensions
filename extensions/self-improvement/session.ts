import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { LoadedRuleEntryMetadata, LocalState } from "./types";

export const RULE_ENTRY_TYPE = "self-improvement-rule";
export const REVIEW_MARKER_TYPE = "self-improvement-review";

export function createLocalState(entries: SessionEntry[]): LocalState {
	const state: LocalState = { loadedRuleIds: new Set() };

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "custom" || message.customType !== RULE_ENTRY_TYPE)
			continue;
		const metadata = parseLoadedRuleMetadata(message.details);
		for (const ruleId of metadata?.ruleIds ?? []) {
			state.loadedRuleIds.add(ruleId);
		}
	}

	return state;
}

export function latestUserEntryId(entries: SessionEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type === "message" && entry.message.role === "user")
			return entry.id;
	}
}

export function hasReviewMarker(
	entries: SessionEntry[],
	userEntryId: string,
): boolean {
	return entries.some(
		(entry) =>
			entry.type === "custom" &&
			entry.customType === REVIEW_MARKER_TYPE &&
			isRecord(entry.data) &&
			entry.data["userEntryId"] === userEntryId,
	);
}

export function getTouchedFilePath(
	toolName: string,
	args: unknown,
): string | undefined {
	if (toolName !== "read" && toolName !== "write" && toolName !== "edit")
		return;
	if (!isRecord(args) || typeof args["path"] !== "string") return;
	return args["path"];
}

export function parseLoadedRuleMetadata(
	value: unknown,
): LoadedRuleEntryMetadata | undefined {
	if (!isRecord(value) || !Array.isArray(value["ruleIds"])) return;
	if (!value["ruleIds"].every((id) => typeof id === "string")) return;
	return { ruleIds: value["ruleIds"] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
