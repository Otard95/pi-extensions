# Guards Extension

Intercepts bash tool calls to prevent common misuse patterns.

## Installation

See the [main README](../../README.md) for installation instructions.

## Guards

### Bash Write Guard

When write/edit tools are unavailable (e.g. read-only modes), blocks bash commands that write files — `cat >`, `tee`, `sed -i`, `mv`, `rm`, `git commit`, etc. Prevents LLM from bypassing tool restrictions through bash.

### Bash Tool Guard

Blocks bash commands that duplicate dedicated tools, nudging LLM toward proper tool usage:

| Bash command          | Redirected to |
|-----------------------|---------------|
| `cat`, `less`, `more`, `head`, `tail`, `bat` | Read tool |
| `grep`, `rg`         | Grep tool     |

Only blocks when the corresponding dedicated tool is available.
