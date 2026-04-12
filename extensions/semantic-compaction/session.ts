import type {
	SessionEntry,
	SessionManager,
	SessionMessageEntry,
} from "@mariozechner/pi-coding-agent";
import { at } from "../../utils/array/at";
import { stripToolCalls, type ToolCompaction } from "./analysis";

/** Append a rebuilt entry to a new session using public SessionManager methods.
 *  Each append method generates a new ID and sets parentId to the current leaf,
 *  so entries are appended in sequence forming a linear chain. */
function appendEntryToSession(sm: SessionManager, entry: SessionEntry): void {
	switch (entry.type) {
		case "message": {
			const msg = entry.message;
			if (msg.role === "branchSummary") {
				// BranchSummaryMessage wrapped in a message entry —
				// preserve as custom message (same as the branch_summary entry case)
				sm.appendCustomMessageEntry("branch-summary", msg.summary, false);
			} else if (msg.role === "compactionSummary") {
				// CompactionSummaryMessage wrapped in a message entry —
				// use the dedicated compaction append method
				sm.appendCompaction(msg.summary, "", msg.tokensBefore);
			} else {
				sm.appendMessage(msg);
			}
			break;
		}
		case "thinking_level_change":
			sm.appendThinkingLevelChange(entry.thinkingLevel);
			break;
		case "model_change":
			sm.appendModelChange(entry.provider, entry.modelId);
			break;
		case "compaction":
			sm.appendCompaction(
				entry.summary,
				entry.firstKeptEntryId,
				entry.tokensBefore,
				entry.details,
				entry.fromHook,
			);
			break;
		case "branch_summary":
			// Branch summaries reference specific entry IDs that won't exist in the new session.
			// Append as a custom message to preserve the summary text.
			sm.appendCustomMessageEntry("branch-summary", entry.summary, false);
			break;
		case "custom":
			sm.appendCustomEntry(entry.customType, entry.data);
			break;
		case "custom_message":
			sm.appendCustomMessageEntry(
				entry.customType,
				entry.content,
				entry.display,
				entry.details,
			);
			break;
		case "label":
			// Labels reference target entry IDs that won't exist in the new session. Skip.
			break;
		case "session_info":
			sm.appendSessionInfo(entry.name ?? "");
			break;
	}
}

/** Populate a new session with rebuilt entries. */
export async function populateSession(
	sm: SessionManager,
	entries: SessionEntry[],
): Promise<void> {
	for (const entry of entries) {
		appendEntryToSession(sm, entry);
	}
}

// --- Rebuild ---

/** Find a compaction that starts with this entry ID. */
function findCompactionByStartId(
	entryId: string,
	compactions: ToolCompaction[],
): ToolCompaction | null {
	for (const comp of compactions) {
		if (comp.startId === entryId) return comp;
	}
	return null;
}

/** Rebuild entries, replacing compacted tool groups with custom messages. */
export function rebuildEntries(
	originalEntries: SessionEntry[],
	compactions: ToolCompaction[],
): SessionEntry[] {
	const result: SessionEntry[] = [];

	let i = 0;
	while (i < originalEntries.length) {
		const entry = at(originalEntries, i);
		const comp = findCompactionByStartId(entry.id, compactions);
		if (!comp) {
			result.push(entry);
			i++;
			continue;
		}

		if (comp.mixedStart) {
			const mixedEntry = at(comp.toolEntries, 0) as SessionMessageEntry;
			result.push(stripToolCalls(mixedEntry));
		}

		result.push({
			type: "custom_message",
			id: `comp${comp.startId.slice(0, 4)}`,
			parentId: entry.parentId,
			timestamp: new Date().toISOString(),
			customType: "tool-compaction",
			content: comp.compacted,
			display: true,
		} as SessionEntry);

		i = originalEntries.findIndex((e) => e.id === comp.endId) + 1;
	}

	return result;
}
