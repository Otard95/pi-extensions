/**
 * load-skill extension
 *
 * Registers a `load_skill` tool so the LLM has an explicit, semantically clear
 * way to load skill content, rather than relying on it remembering to use the
 * Read tool with the correct path.
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { stripFrontmatter } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "load_skill",
		label: "Load Skill",
		description:
			"Load the full instructions for a named skill. Use this to get specialized instructions when a skill matches the task.",
		promptSnippet:
			"Use this to get specialized instructions when a skill matches the task",
		parameters: Type.Object({
			name: Type.String({
				description: "The skill name to load, as listed in available_skills",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const commands = pi.getCommands();
			const skillCommand = commands.find(
				(c) => c.source === "skill" && c.name === `skill:${params.name}`,
			);

			if (!skillCommand) {
				const available = commands
					.filter((c) => c.source === "skill")
					.map((c) => c.name.slice(6)) // strip "skill:" prefix
					.join(", ");
				return {
					content: [
						{
							type: "text",
							text: `Skill "${params.name}" not found. Available: ${available || "none"}`,
						},
					],
					isError: true,
					details: {},
				};
			}

			const filePath = skillCommand.sourceInfo.path;
			const baseDir = skillCommand.sourceInfo.baseDir ?? dirname(filePath);

			try {
				const raw = readFileSync(filePath, "utf-8");
				const body = stripFrontmatter(raw).trim();
				const wrapped = `<skill name="${params.name}" location="${filePath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
				return {
					content: [{ type: "text", text: wrapped }],
					details: { name: params.name, path: filePath },
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `Failed to read skill "${params.name}": ${err}`,
						},
					],
					isError: true,
					details: {},
				};
			}
		},
	});
}
