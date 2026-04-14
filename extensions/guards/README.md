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

### Glob Guard

Blocks `grep` and `find` tool calls that target overly broad directories (`/`, `/home`, `$HOME`, `/nix`, `/etc`, etc.) or use root-anchored glob patterns (`/**...`). Prevents accidentally searching the entire filesystem.
