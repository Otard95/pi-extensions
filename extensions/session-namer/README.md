# Session Namer Extension

Automatically gives new sessions a short, useful display name after the first complete turn.

## Installation

See the [main README](../../README.md) for installation instructions.

## Behavior

- Triggers after the first agent turn completes (user prompt + assistant response)
- Uses a cheap out-of-band model to generate a short title
- Falls back to heuristic naming if no model is available or the call fails
- Runs lazily in the background so the turn is not delayed
- Never auto-renames after the first successful name
- Manual `/name` always takes priority

## Command

### `/name-auto`

Generates and sets a session name from the latest user message in the current session.

Use this when:
- you want to rename an existing session automatically
- the auto-generated name was skipped or not ideal
- you want the built-in `/name <name>` for manual names, but still want an AI-assisted option

## Naming Format

Session names are formatted as:

```text
<repo>: <task>
```

Examples:

- `pi: Improve pi setup`
- `frontend-monorepo: Fix auth redirect loop`
- `portfolio: Review staged changes`

## Model Selection

Uses the shared `pickModel` utility. Preferred models in order:

1. `google/gemini-2.5-flash`
2. `anthropic/claude-haiku-4-5`
3. `openai/gpt-5-mini`
4. `openai-codex/gpt-5-mini`
5. `openai/gpt-4.1-mini`
6. `openai/gpt-4o-mini`

Falls back to the current session model if none are available.
