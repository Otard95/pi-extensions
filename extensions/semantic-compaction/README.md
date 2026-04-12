# Semantic Compaction Extension

Registers a `/semantic-compact` command that summarizes tool call groups using Haiku, creating a new compacted session with reduced token usage.

## Installation

See the [main README](../../README.md) for installation instructions.

## Usage

```
/semantic-compact [<mode>] [keep (<keep_mode> | <number>%) [<keep_value>]]
```

### Mode

| Mode    | Description                                              |
|---------|----------------------------------------------------------|
| `tools` | (default) Compact only tool call groups                  |
| `turns` | Compact full turns (user message to next user message). **Not yet implemented.** |

### Keep

Preserve recent conversation history uncompressed.

| Keep Mode  | Description                              | Example                          |
|------------|------------------------------------------|----------------------------------|
| `percent`  | (default) Keep a percentage of messages  | `/semantic-compact keep 25%`     |
| `messages` | Keep a set number of messages            | `/semantic-compact keep messages 10` |
| `turns`    | Keep a set number of turns               | `/semantic-compact keep turns 3` |

Messages = user messages or assistant messages with text content (not thinking, tools, etc.).
Turns = entries from one user message up to (but not including) the next.

### Examples

```
/semantic-compact                      # Compact tool groups, keep nothing
/semantic-compact keep 30%             # Keep latest 30% of messages
/semantic-compact tools keep messages 5 # Compact tools, keep last 5 messages
```

## Behavior

- **Parallel compaction** — All qualifying tool groups are summarized in parallel using Haiku.
- **Threshold** — Only tool groups above a token estimate threshold are compacted.
- **Confirmation** — Prompts before running, showing how many groups will be compacted.
- **New session** — Creates a new session with the compacted entries, linking back to the parent session.
- **Progress** — Shows status updates as groups are compacted.
- **Partial failure** — If some groups fail, they are left as-is and a warning is shown. Only fails completely if all groups fail.
- **Token savings** — Reports entry count and token savings after completion.
