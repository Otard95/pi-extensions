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
    "rate-limit": {
      "brave": [
        {
          "count": 10,
          "window": { "m": 1 },
          "message": "Brave Search is limited to 10 requests each minute."
        }
      ]
    },
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

## Rate limits

Use `rate-limit.<provider>` to set one or more local limits for a provider.
Each request counts, even when the provider returns an error. The extension skips a
limited provider and tries the next provider. The optional `message` becomes the
skip reason.

Each rule requires a positive `count` and a `window` with `s`, `m`, or both.
The extension keeps the counters in memory. It clears them when pi reloads the
extension or starts a new session.
