import { type Static, Type } from "@sinclair/typebox";
import { loadSettings } from "../../utils/settings.js";

export type SnapshotFrequency = "turn" | "continuous";

const GitAwarenessSchema = Type.Object({
	snapshotFrequency: Type.Optional(
		Type.Union([Type.Literal("turn"), Type.Literal("continuous")]),
	),
});

type GitAwarenessSettings = Static<typeof GitAwarenessSchema>;

const DEFAULT: GitAwarenessSettings = {
	snapshotFrequency: "turn",
};

export function getSnapshotFrequency(): SnapshotFrequency {
	const settings = loadSettings<GitAwarenessSettings>(
		"git-awareness",
		GitAwarenessSchema,
	).unwrapOr(DEFAULT);

	return settings.snapshotFrequency ?? "turn";
}
