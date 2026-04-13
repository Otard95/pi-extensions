# Pi Extensions

Personal pi extensions bundled as a pi package.

## What's Inside

This package bundles custom extensions for the [pi coding agent](https://github.com/badlogic/pi-mono):

- **[guards](extensions/guards/README.md)** — Blocks bash write commands when write/edit tools are disabled, nudges toward dedicated tools
- **[load-skill](extensions/load-skill/README.md)** — Registers a `load_skill` tool for the LLM to load skill content by name
- **[modes](extensions/modes/README.md)** — Custom modes defined as markdown files with `/mode` command and `Ctrl+}`/`Ctrl+{` cycling
- **[semantic-compaction](extensions/semantic-compaction/README.md)** — `/semantic-compact` command that summarizes tool call groups using Haiku
- **[subagent](extensions/subagent/README.md)** — Delegate tasks to isolated pi processes (single, parallel, chain modes)
- **[searxng](extensions/searxng/README.md)** — Web search via self-hosted SearXNG instance
- **[web-read](extensions/web-read/README.md)** — Fetch web pages as markdown with pagination and regex search

## Installation

Install via pi's package manager:

```bash
pi install git:github.com/Otard95/pi-extensions
```

Or add directly to your `settings.json`:

```json
{
  "packages": [
    "git:github.com/Otard95/pi-extensions"
  ]
}
```

### Selective Loading

Since this package bundles multiple extensions, you may want to enable only specific ones. Use the object form in settings:

```json
{
  "packages": [
    {
      "source": "git:github.com/Otard95/pi-extensions",
      "extensions": [
        "extensions/guards",
        "extensions/load-skill",
        "extensions/subagent"
      ]
    }
  ]
}
```

Or disable specific extensions using exclusion patterns:

```json
{
  "packages": [
    {
      "source": "git:github.com/Otard95/pi-extensions",
      "extensions": [
        "extensions/**/*.ts",
        "!extensions/semantic-compaction"
      ]
    }
  ]
}
```

You can also use `pi config` to manage enabled/disabled extensions interactively.

### Local Development

If you're developing locally, you can install from a local path:

```bash
pi install /absolute/path/to/pi-extensions
```

## Development

### Using Nix Flake

Enter the development environment:

```bash
nix develop
```

Or with direnv (recommended):

```bash
direnv allow
```

### Install Dependencies

```bash
npm install
```

The `devDependencies` provide TypeScript types for:
- `@mariozechner/pi-coding-agent` — Core extension APIs and hooks
- `@mariozechner/pi-ai` — AI provider types  
- `@mariozechner/pi-tui` — TUI component types
- `@sinclair/typebox` — Schema validation

### Type Checking

```bash
npm run check
```

Runs TypeScript type checking without emitting files.

### Structure

```
pi-extensions/
├── extensions/
│   ├── guards/
│   ├── load-skill/
│   ├── modes/
│   ├── semantic-compaction/
│   └── subagent/
├── utils/
│   └── **/*
├── package.json     # Pi package manifest
└── flake.nix        # Nix development environment
```

## References

- [Pi Coding Agent](https://github.com/badlogic/pi-mono) — Main repository
- [Pi Packages Documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- [Pi Extensions Documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
