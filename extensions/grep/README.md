# Grep Extension

Activates pi's built-in `grep` tool in the default coding tool-set.

Pi ships a `grep` tool backed by ripgrep, but only includes it in `readOnlyTools` — it is not active in the standard coding session. This extension adds it on every `session_start` so the LLM always has it available without switching modes.

Pairs with the `guards` extension: once `grep` is active, the guards extension blocks raw `grep`/`rg`/`ripgrep` calls in bash and directs the LLM to use this tool instead.

## Installation

See the [main README](../../README.md) for installation instructions.

## Usage

The extension exposes no commands or tools of its own. It simply ensures the built-in `grep` tool is active. The tool is then callable by the LLM:

### `grep`

| Parameter     | Required | Default | Description                                                   |
|---------------|----------|---------|---------------------------------------------------------------|
| `pattern`     | Yes      | —       | Search pattern (regex or literal string)                      |
| `path`        | No       | cwd     | File or directory to search                                   |
| `glob`        | No       | —       | Glob filter, e.g. `*.ts` or `**/*.spec.ts`                    |
| `ignoreCase`  | No       | false   | Case-insensitive search                                       |
| `literal`     | No       | false   | Treat pattern as a literal string instead of a regex          |
| `context`     | No       | 0       | Lines to show before and after each match                     |
| `limit`       | No       | 100     | Maximum number of matches to return                           |

### Example Tool Call

```json
{
  "name": "grep",
  "parameters": {
    "pattern": "TODO",
    "glob": "**/*.ts",
    "limit": 50
  }
}
```

## Behavior

- **Respects `.gitignore`** — ripgrep's ignore rules apply, so `node_modules`, `dist`, and other gitignored paths are excluded automatically.
- **Hidden files included** — the built-in tool passes `--hidden` to ripgrep, so dotfiles and hidden directories are searched.
- **Output capped** — results are truncated at 100 matches or 50 KB, whichever comes first.
- **Idempotent** — if `grep` is already active (e.g. from a mode that explicitly lists it), the extension is a no-op.
