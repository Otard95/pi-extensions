import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export interface GitState {
	head: string;
	status: string; // raw output of `git status --short --branch`
}

// Subcommands that write to the repository
const MUTATION_SUBCOMMANDS = new Set([
	"add",
	"am",
	"apply",
	"bisect",
	"branch",
	"cherry-pick",
	"clean",
	"checkout",
	"commit",
	"fetch",
	"merge",
	"mv",
	"pull",
	"push",
	"rebase",
	"reset",
	"restore",
	"revert",
	"rm",
	"stash",
	"switch",
	"tag",
]);

// Matches `git <subcommand>` anywhere in a compound shell command
const GIT_RE = /(?:^|[;&|]\s*|&&\s*|\|\|\s*)git\s+(\S+)/g;

export function isGitCommand(command: string): boolean {
	GIT_RE.lastIndex = 0;
	return GIT_RE.test(command);
}

export function isGitMutation(command: string): boolean {
	GIT_RE.lastIndex = 0;
	for (const match of command.matchAll(GIT_RE)) {
		const sub = (match[1] ?? "").replace(/^-+.*/, "");
		if (MUTATION_SUBCOMMANDS.has(sub)) return true;
	}
	return false;
}

export async function fetchGitState(
	pi: ExtensionAPI,
	signal?: AbortSignal,
): Promise<GitState | null> {
	const [head, status] = await Promise.all([
		pi.exec("git", ["rev-parse", "HEAD"], { signal, timeout: 5000 }),
		// --branch prepends a "## ..." header line with branch + upstream info
		pi.exec("git", ["status", "--short", "--branch"], {
			signal,
			timeout: 5000,
		}),
	]);

	// Non-zero exit means we're outside a git repo (or git isn't available)
	if (head.code !== 0 || status.code !== 0) return null;

	return {
		head: head.stdout.trim(),
		status: status.stdout.trimEnd(),
	};
}

export function formatGitState(state: GitState): string {
	return `HEAD: ${state.head.slice(0, 12)}\n${state.status}`;
}
