# SearXNG Extension

Web search via a self-hosted [SearXNG](https://docs.searxng.org/) instance. Provides a `web_search` tool for the LLM and `/search` + `/searxng` commands for the user.

Based on [tomstiani's implementation](https://github.com/tomstiani/dotfiles/blob/main/.config/pi/extensions/searxng/index.ts).

## Installation

See the [main README](../../README.md) for installation instructions.

## Configuration

Set the SearXNG instance URL (priority order):

1. `SEARXNG_URL` environment variable
2. `searxng.url` in `settings.json`

Optional `Authorization` header (priority order):

1. `SEARXNG_AUTHORIZATION` environment variable
2. `searxng.authorization` in `settings.json`

Values starting with `pass:` are resolved via the `pass` password manager.

```json
{
  "searxng": {
    "url": "https://your-searxng-instance.example.com",
    "authorization": "Bearer sk-abc123"
  }
}
```

Using `pass`:

```json
{
  "searxng": {
    "url": "https://your-searxng-instance.example.com",
    "authorization": "pass:searxng/auth"
  }
}
```

## Usage

### Tool: `web_search`

Available to the LLM for searching the web.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Search query (required) |
| `max_results` | number | Results to return, 1–20 (default: 5) |

### Commands

| Command | Description |
|---------|-------------|
| `/search <query>` | Search and pass results to LLM |
| `/searxng` | Show current configuration |
