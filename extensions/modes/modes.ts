/**
 * Mode discovery — reads markdown files from ~/.pi/agent/modes/
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";

export interface ModeConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	filePath: string;
}

export function loadModes(): ModeConfig[] {
	const modesDir = path.join(getAgentDir(), "modes");
	if (!fs.existsSync(modesDir)) return [];

	const modes: ModeConfig[] = [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(modesDir, { withFileTypes: true });
	} catch {
		return [];
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(modesDir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } =
			parseFrontmatter<Record<string, string>>(content);
		const name = frontmatter["name"] || entry.name.replace(/\.md$/, "");
		const description = frontmatter["description"] || "";

		const tools =
			frontmatter["tools"]
				?.split(",")
				.map((t: string) => t.trim())
				.filter(Boolean) ?? [];

		modes.push({
			name,
			description,
			tools: tools,
			model: frontmatter["model"],
			systemPrompt: body.trim(),
			filePath,
		});
	}

	return modes.sort((a, b) => a.name.localeCompare(b.name));
}
