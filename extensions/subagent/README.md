# Subagent Extension

Delegate tasks to specialized agents running in isolated in-process sessions
via the pi SDK (`createAgentSession`).

## Installation

See the [main README](../../README.md) for installation instructions.

## Usage

The extension registers a `subagent` tool that accepts a recursive
**TaskGroup** structure:

```json
{
  "mode": "parallel" | "sequential",
  "tasks": [Task | TaskGroup, ...]
}
```

Each **Task** specifies an agent and what it should do:

```json
{
  "agent": "scout",
  "taskDescription": "Find all error handling patterns in src/",
  "name": "optional-label"
}
```

Tasks can be nested task groups, allowing mixed parallel and sequential
execution in a single tool call.

### Modes

- **parallel** — all tasks run concurrently (with a concurrency limit)
- **sequential** — tasks run in order; stops on first failure.
  Each task can use `{previous}` in its `taskDescription` to receive the
  output of the prior task.

### Task names

The optional `name` field labels a task's output. In parallel groups this
produces labeled sections:

```
[api-layer]
Found 12 routes...

[db-layer]
Found 8 models...
```

### Examples

**Single task:**
```json
{ "mode": "parallel", "tasks": [
  { "agent": "scout", "taskDescription": "Map the project structure" }
] }
```

**Parallel recon:**
```json
{ "mode": "parallel", "tasks": [
  { "agent": "scout", "name": "frontend", "taskDescription": "Summarize src/ui/" },
  { "agent": "scout", "name": "backend", "taskDescription": "Summarize src/server/" }
] }
```

**Sequential with handoff:**
```json
{ "mode": "sequential", "tasks": [
  { "agent": "scout", "taskDescription": "Find all usages of parseConfig()" },
  { "agent": "worker", "taskDescription": "Refactor to use loadConfig():\n{previous}" }
] }
```

**Nested groups (parallel recon → sequential review):**
```json
{ "mode": "sequential", "tasks": [
  { "mode": "parallel", "tasks": [
    { "agent": "scout", "name": "frontend", "taskDescription": "Summarize src/ui/" },
    { "agent": "scout", "name": "backend", "taskDescription": "Summarize src/server/" }
  ] },
  { "agent": "reviewer", "taskDescription": "Review for consistency:\n{previous}" }
] }
```

## Agents

Agent definitions are markdown files discovered from:
- **User agents** — `~/.pi/agent/agents/*.md`
- **Project agents** — `.pi/agents/*.md` in the project root

Both scopes are always searched. Each agent file uses YAML frontmatter:

```markdown
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
---

You are a scout. Quickly investigate a codebase...
```

| Field | Required | Description |
|---|---|---|
| `name` | yes | Agent identifier used in task definitions |
| `description` | yes | Shown in the tool description to help the LLM choose |
| `tools` | no | Comma-separated allowlist of tools (default: all) |
| `model` | no | Model to use (default: session default) |
| body | no | System prompt for the agent |

## Architecture

The extension is split into focused modules:

| File | Responsibility |
|---|---|
| `index.ts` | Extension registration, description builder, execute handler |
| `schema.ts` | TypeBox parameter schema, Task/TaskGroup/LiveTask types |
| `types.ts` | Shared types (SingleResult, UsageStats, SubagentDetails) |
| `executor.ts` | Recursive TaskGroup execution (parallel/sequential) |
| `runner.ts` | Single agent session lifecycle via `createAgentSession` |
| `format.ts` | Output extraction, message formatting, usage aggregation |
| `render.ts` | TUI rendering for tool call and result display |
| `agents.ts` | Agent discovery from filesystem |

### Execution model

1. Input `TaskGroup` is converted to a mutable `LiveTaskGroup` tree
2. `executeGroup` walks the tree recursively, mutating `LiveTask.state`
   and `LiveTask.result` in place
3. A `notify()` callback signals state changes so the caller can emit
   streaming updates
4. For sequential groups, `{previous}` is replaced with the output of
   the prior item before each task runs
5. Each leaf task gets an isolated `createAgentSession` with its own
   system prompt, tool allowlist, and model
