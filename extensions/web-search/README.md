# Web Search Extension

Provider-based web search with a user-configured fallback order.

## Status

Registers the `web_search` tool with SearXNG and DuckDuckGo providers. The
configured provider order determines fallback priority.

## Architecture

- `types.ts` defines the normalised provider contract and result payloads.
- `provider-registry.ts` resolves configured provider names in priority order.
- `runner.ts` selects compatible providers, tracks attempts, and handles
  fallback.
- `config.ts` defines the initial settings schema.

Providers must return either normalised result records or provider-generated
text. They must not invoke fallback themselves.

## Intended configuration

```json
{
  "web-search": {
    "providers": ["searxng", "duckduckgo", "brave"],
    "timeoutSeconds": 30,
    "searxng": {
      "url": "https://search.example.com",
      "authorization": "pass:searxng/auth"
    },
    "duckduckgo": {
      "render": "simple"
    },
    "brave": {
      "render": "simple"
    }
  }
}
```
