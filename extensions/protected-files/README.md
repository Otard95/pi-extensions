# Protected Files Extension

Prevents the agent from reading files that match configured glob patterns.

## Installation

See the [main README](../../README.md) for installation instructions.

## Configuration

Add a `"protected-files"` section to `settings.json` in your pi agent config directory:

```json
{
  "protected-files": {
    "patterns": ["*.env", ".secret*", "secrets/**", "*.pem", "*.key"]
  }
}
```

### Pattern syntax

Patterns use [minimatch](https://github.com/isaacs/minimatch) glob syntax with dotfile matching enabled (`{ dot: true }`).

Patterns that don't already start with `**/` or `/` are automatically prepended with `**/`, so:

| Config pattern | Effective pattern | Matches |
|----------------|-------------------|---------|
| `*.env`        | `**/*.env`        | `.env`, `config/.env`, `a/b/.env`, `foo.env` |
| `.secret*`     | `**/.secret*`     | `.secrets`, `config/.secret_key` |
| `secrets/**`   | `secrets/**`      | `secrets/key.pem`, `secrets/db/password` |
| `**/*.pem`     | `**/*.pem`        | unchanged — already absolute glob |

## Protected tools

### `read` tool

Any read of a path matching a pattern is blocked. The agent is instructed not to attempt access via other means.

### `bash` tool

Any bash command containing a token that matches a pattern is blocked. This is intentionally strict — even benign mentions like `echo ".env"` will be blocked. This is an acceptable tradeoff for secret protection.

Tokens that are flags (`-f`, `--flag`) or shell operators (`|`, `&&`, `>`, etc.) are skipped.
