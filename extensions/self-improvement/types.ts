export type RuleState = "candidate" | "active" | "archived" | "retired";

export type Trigger =
	| { kind: "always" }
	| { kind: "cwd"; glob: string }
	| { kind: "touched-file"; glob: string };

export interface Rule {
	id: string;
	text: string;
	when: Trigger[];
	state: RuleState;
	scratchpad: string;
	citations: Citation[];
	createdAt: string;
	updatedAt: string;
	lastEvidenceAt?: string;
	lastReviewedAt?: string;
}

export interface Citation {
	id: string;
	sessionId: string;
	entryId: string;
	excerpts: string[];
}

export interface RuleStore {
	rules: Rule[];
}

export interface LocalState {
	loadedRuleIds: Set<string>;
}

export interface LoadedRuleEntryMetadata {
	ruleIds: string[];
}
