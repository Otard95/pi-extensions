# Filesystem Tools Extension

Activates pi's built-in `grep`, `find`, and `ls` tools in the default coding tool-set.

## Why

Pi ships these tools as part of `readOnlyTools` but does not include them in the default coding session, which only activates `read`, `bash`, `edit`, and `write`. Since `bash` can run `rg`, `find`, and `ls` directly, the dedicated tools are redundant from a pure capability standpoint — but they are meaningfully better for LLM use:

**Bounded output.** Each tool caps its results and signals when output was truncated:

| Tool | Cap |
|------|-----|
| `grep` | 100 matches or 50KB |
| `find` | 1000 results or 50KB |
| `ls` | 500 entries or 50KB |

Raw bash output has no such limits. On a large codebase, an unbounded `rg` or `find` call can fill the entire context window.

**Respects `.gitignore`.** All three tools run through ripgrep's ignore logic, so `node_modules`, `dist`, and other gitignored paths are excluded automatically. Bash equivalents do not do this unless explicit filters are added every time.

**Fine-grained mode control.** Dedicated tools can be toggled per mode independently of bash. This is what allows the `guards` extension to block raw bash `grep`/`rg` calls while keeping bash available for everything else.

## Interaction with guards

The `guards` extension blocks bash `grep`/`rg` calls only when the `grep` tool is active. Without this extension, that guard has no effect in coding mode because `grep` is never in the active tool-set.

## Installation

See the [main README](../../README.md) for installation instructions.

## Usage

The extension activates three built-in tools with no additional configuration:

### `grep`

Search file contents by regex or literal pattern.

| Parameter    | Required | Default | Description                                        |
|--------------|----------|---------|----------------------------------------------------|
| `pattern`    | Yes      | —       | Search pattern (regex or literal string)           |
| `path`       | No       | cwd     | File or directory to search                        |
| `glob`       | No       | —       | Glob filter, e.g. `*.ts` or `**/*.spec.ts`         |
| `ignoreCase` | No       | false   | Case-insensitive search                            |
| `literal`    | No       | false   | Treat pattern as a literal string                  |
| `context`    | No       | 0       | Lines to show before and after each match          |
| `limit`      | No       | 100     | Maximum number of matches                          |

### `find`

Search for files by glob pattern.

| Parameter | Required | Default | Description                                              |
|-----------|----------|---------|----------------------------------------------------------|
| `pattern` | Yes      | —       | Glob pattern, e.g. `*.ts`, `**/*.spec.ts`                |
| `path`    | No       | cwd     | Directory to search                                      |
| `limit`   | No       | 1000    | Maximum number of results                                |

### `ls`

List directory contents.

| Parameter | Required | Default | Description                        |
|-----------|----------|---------|------------------------------------|
| `path`    | No       | cwd     | Directory to list                  |
| `limit`   | No       | 500     | Maximum number of entries          |
