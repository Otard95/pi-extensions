# Guards Extension

Use this extension to check bash commands that can bypass a mode rule or duplicate a tool.

## Setup

Add a TypeSafe token to the Pi settings file. The token can use a `pass:` reference.

```json
{
  "guards": {
    "typesafe": {
      "token": "pass:typesafe/api-key"
    }
  }
}
```

The TypeSafe SDK uses `TYPESAFE_API_KEY` when `token` is not set.

## Checks

The extension scans a bash command for listed commands. It sends one TypeSafe request when one or more checks apply. The request contains all applicable questions.

| Check | Trigger commands | Condition | Action |
| --- | --- | --- | --- |
| `read_duplicate` | `cat`, `less`, `more`, `head`, `tail`, `bat`, `grep`, `rg`, `ripgrep`, `find` | The matching read, grep, or find tool is active. | Warn the model or block the command. |
| `write_duplicate` | `sed -i`, `perl -i`, `awk -i inplace`, `tee`, `dd of=`, redirects, and heredocs | The write or edit tool is active. | Warn the model or block the command. |
| `write_in_readonly` | File writes, moves, copies, removals, permission changes, links, and Git write commands | The write and edit tools are inactive. | Ask the user or block the command. |
| `unnecessary_cwd_path` | The command repeats the current working directory. | Always. | Warn the model only. |

The duplicate checks receive the active tool names, descriptions, parameter schemas, and prompt guidelines. This lets the model decide if a tool fits the task.

## Thresholds

Each Noul answer is a value from 0 to 1. Higher values mean the check found a problem.

- `block`: Block the command at or above this value.
- `warn`: Warn the model, but allow the command. Use this for duplicate checks.
- `ask`: Ask the user before the command runs. Use this for mode rules.
- `fail_mode`: Set `open` to allow the command after a TypeSafe error. Set `closed` to block it.

The default duplicate rules warn at `0.5` and fail open. The read rule blocks at `0.85`. The write rule blocks at `0.97`. The current-directory rule only warns at `0.5`.

```json
{
  "guards": {
    "typesafe": {
      "model": "jev-latest",
      "rules": {
        "read_duplicate": { "warn": 0.5, "block": 0.85, "fail_mode": "open" },
        "write_duplicate": { "warn": 0.5, "block": 0.97, "fail_mode": "open" },
        "write_in_readonly": { "ask": 0.2, "block": 0.8, "fail_mode": "closed" },
        "unnecessary_cwd_path": { "warn": 0.5, "fail_mode": "open" }
      }
    }
  }
}
```

If a check has no `warn` value, it allows below `block`. If a check has no `ask` value, it allows below `block`.

## Search time limits

Searches use time limits instead of broad-path blocks or approval prompts. Direct `grep` and `find` tools always use these limits.

For bash commands that contain `grep`, `rg`, `ripgrep`, or `find`, Jev answers one additional question in the existing guard request:

> Does this command search directory trees or discover files?

The question excludes filtering piped output, reading specific files, and search words inside quoted text. This includes log filters after builds or tests.

The extension applies a search time limit only when the answer is at least `0.8`. A lower, missing, invalid, or failed answer preserves the original timeout.

- No timeout: use 2 seconds.
- A positive timeout up to 10 seconds: keep it.
- A timeout above 10 seconds: clamp it to 10 seconds.
- An invalid timeout: use 2 seconds.

The direct tools accept an optional `timeout` in seconds. Bash uses its existing `timeout` parameter. The time limit applies to the whole bash command, including pipelines and other commands in the same call.

When a search times out, the tool reports: `Search exceeded its {N}s limit. Narrow the path or pattern before retrying.`

Direct tool limits do not call TypeSafe. Bash classification shares one request with other guard questions. It never asks for approval or blocks a command. Other guard checks still apply. Old `broad_search` settings no longer affect searches.

## Tuning log

The extension appends JSONL records to `guards-tuning.jsonl` in the Pi agent directory. Each record contains:

- The command and current directory.
- Active tools.
- Exact trigger commands.
- Noul values and active thresholds.
- The decision and rule that caused it.
- The user answer for an `ask` check.
- The directory-search probability and applied search timeout, when present.

Use the records to tune the thresholds for each rule.
