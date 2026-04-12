# Load Skill Extension

Registers a `load_skill` tool that gives the LLM an explicit way to load skill instructions by name, instead of relying on it remembering the correct file path with the Read tool.

## Installation

See the [main README](../../README.md) for installation instructions.

## Usage

The extension exposes a single tool to the LLM:

### `load_skill`

| Parameter | Required | Description                                      |
|-----------|----------|--------------------------------------------------|
| `name`    | Yes      | Skill name, as listed in `available_skills`.     |

The tool looks up the named skill from registered commands, reads its markdown file, strips frontmatter, and returns the body wrapped in a `<skill>` tag with the skill's location and base directory for resolving relative paths.

### Example Tool Call

```json
{
  "name": "load_skill",
  "parameters": { "name": "git-commit-practices" }
}
```

## Behavior

- **Skill lookup** — Finds the skill by matching `skill:<name>` in registered commands.
- **Error handling** — If the skill is not found, returns an error listing all available skills. If the file cannot be read, returns the underlying error message.
- **Relative paths** — The response includes the skill's base directory so the LLM can resolve any relative paths referenced in the skill instructions.
- **Result rendering** — Shows the first 10 lines of loaded content by default; expand to see the full output.

## System Prompt

A short prompt snippet is injected so the LLM knows the tool exists:

> Use this to get specialized instructions when a skill matches the task
