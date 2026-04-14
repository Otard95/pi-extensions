# Modes Extension

Switch between custom behavioral modes that modify the system prompt, restrict available tools, and optionally change the active model. Modes are defined as markdown files with frontmatter metadata.

## Installation

See the [main README](../../README.md) for installation instructions.

## Defining Modes

Create markdown files in `~/.pi/agent/modes/`. Each file defines one mode.

### Mode File Format

```markdown
---
name: plan
description: Read-only planning mode
tools: read, bash, grep, find, ls
model: claude-sonnet-4-5
---

You are in PLANNING MODE. Analyze the codebase and create a detailed plan.
Do not make any changes — only read, search, and reason.
```

### Frontmatter Fields

| Field         | Required | Description                                                  |
|---------------|----------|--------------------------------------------------------------|
| `name`        | No       | Mode name. Defaults to the filename (without `.md`).         |
| `description` | No       | Short description shown in the mode selector.                |
| `tools`       | No       | Comma-separated list of allowed tools. Omit to keep all.     |
| `model`       | No       | Model ID to switch to when the mode is activated.            |

The markdown body (after frontmatter) is appended to the system prompt when the mode is active.

## Usage

### Commands

| Command         | Description                              |
|-----------------|------------------------------------------|
| `/mode`         | Open an interactive mode selector.       |
| `/mode <name>`  | Switch directly to the named mode.       |
| `/mode off`     | Clear the active mode (also `clear`, `none`). |

### Keyboard Shortcuts

| Shortcut         | Action                     |
|------------------|----------------------------|
| `Ctrl+}` (`Ctrl+Shift+]`) | Cycle forward through modes  |
| `Ctrl+{` (`Ctrl+Shift+[`) | Cycle backward through modes |

Cycling order follows alphabetical mode name sorting. Cycling past the last mode (or before the first) clears the active mode.

> **Note:** These shortcuts require Kitty keyboard protocol support. Terminals like Kitty, Ghostty, WezTerm, and foot support this natively. For tmux, enable `set -g extended-keys on` and `set -g extended-keys-format csi-u`. The `/mode` command works in all terminals regardless.

### Custom Keybindings

Both shortcuts can be remapped in `~/.pi/agent/keybindings.json`:

```json
{
  "ext.modes.cycle": "ctrl+}",
  "ext.modes.cycleReverse": "ctrl+{"
}
```

## Behavior

### System Prompt

When a mode is active, its markdown body is appended to the end of the system prompt. When the mode is cleared, the original system prompt is restored.

### Tool Restriction

If a mode specifies `tools`, only those tools are available to the LLM while the mode is active. When the mode is deactivated, the full default tool set is restored.

### Model Switching

If a mode specifies `model`, the extension switches to that model on activation. The model is **not** restored when the mode is deactivated or when resuming a session — this is intentional, as the user may have manually changed models in the meantime.

### Mode Switch Context

When a mode is activated or deactivated, a hidden context message is injected into the conversation so the LLM is aware of the change. This message is not displayed in the UI.

### Session Behavior

Modes are session-ephemeral — they reset when starting a new session or resuming an existing one. Use `/mode` or the keyboard shortcuts to reactivate.
