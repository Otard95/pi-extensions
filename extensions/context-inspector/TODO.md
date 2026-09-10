# TODO: Generic Event Viewer

The context inspector TUI currently shows a fixed set of event types. It should
be made generic enough to display any and all session events — including custom
tool call arguments and details that are currently invisible in the TUI.

## Motivation

`spawn_agent` tool results show `details: {}` in the TUI, hiding the full agent
config (role, model, tools) that was used. This information is in the tool call
arguments but not surfaced anywhere. A generic event viewer would make this
visible without needing per-tool special casing.

More broadly, any extension that emits custom events or appends custom entries
should be inspectable without the context inspector needing to know about them
ahead of time.

### Example: spawn_agent tool call (from session file)

The TUI showed `details: {}` for this entry, but the full session entry was:

```json
{
  "type": "message",
  "id": "0984adba",
  "parentId": "3001b2e5",
  "timestamp": "2026-06-04T11:59:36.562Z",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "toolCall",
        "id": "toolu_01TvTaYmWAkZFTQsv4h2p6ka",
        "name": "spawn_agent",
        "arguments": {
          "name": "docs-writer",
          "role": "You are a technical documentation writer for an engineering team. You write clear, well-structured documentation in Markdown for an Astro/Starlight docs site. \n\nThe docs site lives at ~/dev/smb/docs and uses Starlight (Astro). Content goes in ~/dev/smb/docs/src/content/docs/. The actively maintained section is `tech/` — that's where new docs should go.\n\nYou will receive findings from two explorer agents (docs-explorer and gql-explorer) who have thoroughly analyzed the existing docs site and the GraphQL monorepo. Wait for both to report in before writing — then draft the documentation pages we've agreed to create:\n\n1. `tech/architecture/graphql.md`\n2. `tech/onboarding/graphql.md`\n3. `tech/adrs/` — 2–3 ADRs",
          "model": "claude-sonnet-4-5",
          "tools": ["read", "write", "edit", "bash", "find", "ls"]
        }
      }
    ],
    "model": "claude-sonnet-4-6",
    "usage": {
      "input": 3,
      "output": 846,
      "cacheRead": 0,
      "cacheWrite": 22478,
      "totalTokens": 23327,
      "cost": { "total": 0.097 }
    },
    "stopReason": "toolUse"
  }
}
```

None of the `arguments` (role, model, tools) were visible in the TUI — only the
tool result `"Agent 'docs-writer' spawned."` was shown. This made it impossible
to see what role the agent was given without digging into the session file.

## What to do

- Make the inspector able to render any `SessionEntry` / `AgentMessage` type,
  not just the ones it explicitly handles today
- For unknown types: fall back to a generic JSON tree view
- Tool call arguments should be shown in full (not just the result summary)
- Consider a search/filter by event type or content
