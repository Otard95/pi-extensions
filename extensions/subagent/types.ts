import type { Message } from "@mariozechner/pi-ai";
import type { LiveTaskGroup } from "./schema";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const COLLAPSED_ITEM_COUNT = 10;

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export const EMPTY_USAGE: UsageStats = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	contextTokens: 0,
	turns: 0,
};

export interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	startTime?: number;
	endTime?: number;
	durationMs?: number;
}

/** The details attached to the tool result — just the live state tree. */
export interface SubagentDetails {
	root: LiveTaskGroup;
}
