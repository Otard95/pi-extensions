import { minimatch } from "minimatch";
import type { Rule, Trigger } from "./types";

export function matchesRule(rule: Rule, cwd: string): boolean {
	return rule.when.some((trigger) => matchesTrigger(trigger, cwd));
}

export function matchesTrigger(trigger: Trigger, cwd: string): boolean {
	switch (trigger.kind) {
		case "always":
			return true;
		case "cwd":
			return matchesGlob(cwd, trigger.glob);
		case "touched-file":
			return false;
	}
}

export function matchesTouchedFile(rule: Rule, path: string): boolean {
	return rule.when.some(
		(trigger) =>
			trigger.kind === "touched-file" && matchesGlob(path, trigger.glob),
	);
}

export function matchesGlob(value: string, glob: string): boolean {
	return minimatch(value, glob, { dot: true });
}
