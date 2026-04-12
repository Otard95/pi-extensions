# Subagent Extension

Delegate tasks to isolated pi processes. Based on the subagent example from the [pi codebase](https://github.com/badlogic/pi-mono).

## Installation

See the [main README](../../README.md) for installation instructions.

## Usage

The extension registers a `subagent` tool with three modes:

- **Single** — Run one agent with a task
- **Parallel** — Run multiple agent/task pairs concurrently
- **Chain** — Run agent/task pairs sequentially, passing output forward via `{previous}` placeholder

Each subagent runs as a separate `pi` process with its own isolated context window.

## Agents

Agent definitions are discovered from:
- **User scope** — `~/.pi/agent/agents/`
- **Project scope** — `.pi/agents/` in the project root

Scope can be controlled via the `agentScope` parameter.
