import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { emptyState, isSnapshot, type Snapshot, STATE_TYPE } from "./state";

function snapshotFrom(value: unknown): unknown {
	return value !== null && typeof value === "object" && "snapshot" in value
		? value.snapshot
		: undefined;
}

export function restore(entries: readonly SessionEntry[]): Snapshot {
	let state = emptyState();
	for (const entry of entries) {
		let candidate: unknown;
		if (entry.type === "custom" && entry.customType === STATE_TYPE) {
			candidate = snapshotFrom(entry.data);
		} else if (
			entry.type === "custom_message" &&
			entry.customType === STATE_TYPE
		) {
			candidate = snapshotFrom(entry.details);
		}
		if (isSnapshot(candidate) && candidate.revision >= state.revision) {
			state = structuredClone(candidate);
		}
	}
	return state;
}
