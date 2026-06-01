import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { fetchGitState, type GitState } from "./git.js";

export class GitSnapshot {
	private lastKnownHash: string | null = null;

	// Per-turn flags
	private hadGitCommandThisTurn = false;
	// Prevents re-checking after the first mutation is handled in a turn.
	// Only used in 'turn' mode — in 'continuous' mode every mutation is checked
	// because the snapshot is kept current after each command.
	private firstMutationHandledThisTurn = false;

	async initialize(pi: ExtensionAPI): Promise<void> {
		const state = await fetchGitState(pi);
		if (state) this.lastKnownHash = this.hash(state);
	}

	onTurnStart(): void {
		this.hadGitCommandThisTurn = false;
		this.firstMutationHandledThisTurn = false;
	}

	private hash(state: GitState): string {
		return createHash("sha1")
			.update(`${state.head}\n${state.status}`)
			.digest("hex");
	}

	isStale(state: GitState): boolean {
		// No snapshot yet — treat as fresh to avoid spurious blocks on first turn
		if (this.lastKnownHash === null) return false;
		return this.hash(state) !== this.lastKnownHash;
	}

	update(state: GitState): void {
		this.lastKnownHash = this.hash(state);
	}

	async updateFromGit(pi: ExtensionAPI, signal?: AbortSignal): Promise<void> {
		const state = await fetchGitState(pi, signal);
		if (state) this.update(state);
	}

	recordGitCommand(): void {
		this.hadGitCommandThisTurn = true;
	}

	markFirstMutationHandled(): void {
		this.firstMutationHandledThisTurn = true;
	}

	get hadGitCommand(): boolean {
		return this.hadGitCommandThisTurn;
	}

	get firstMutationHandled(): boolean {
		return this.firstMutationHandledThisTurn;
	}
}
