# Web Read Extension

Registers a `web_read` tool that fetches web pages and returns content as markdown. Supports pagination, regex search, and caching.

## Installation

See the [main README](../../README.md) for installation instructions.

## Usage

Fetches full page (from internet or cache), converts to markdown, then filters output:

- Use `offset`/`limit` to paginate through content
- Use `pattern` to search with regex, `context` for surrounding lines
- Results are cached — use `refresh` to re-fetch

### Parameters

| Parameter | Required | Description                                        |
|-----------|----------|----------------------------------------------------|
| `url`     | Yes      | URL to fetch                                       |
| `offset`  | No       | Line to start reading from (1-indexed)             |
| `limit`   | No       | Max lines to return (default: 50, max: 1000)       |
| `pattern` | No       | Regex pattern to search for in the page            |
| `context` | No       | Number of context lines around each match (default: 0) |
| `refresh` | No       | Bypass cache and re-fetch the page                 |
| `render`  | No       | `"simple"` (default) or `"advanced"` (headless browser for JS-heavy pages) |

## JavaScript Rendering

Some sites load content via JavaScript after the initial page load. The default `fetch` approach only sees the server-rendered HTML, so these pages may return incomplete content.

Set `render: "advanced"` to use a headless Chromium browser that executes JavaScript and waits for the page to finish loading before extracting content.

**Safety guard:** To prevent unnecessary browser overhead, `render: "advanced"` will error if the domain hasn't been fetched with the simple method first. Always try a normal fetch first — many sites work fine without JS rendering.

### Configuration

Advanced rendering uses `playwright-core` (no bundled browser) with your system's Chromium. Configure the browser path in `settings.json`:

```json
{
  "web-read": {
    "browserPath": "/path/to/chromium"
  }
}
```

Common paths:
- NixOS: `$(which chromium)` or check your system packages
- Linux: `/usr/bin/chromium` or `/usr/bin/google-chrome-stable`
- macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

## HTML Filtering

Elements that never produce useful markdown are always stripped before conversion:
`style`, `script`, `noscript`, `svg`, `canvas`, `template`, `iframe`, `object`, `embed`.

### Optional stripping

Some structural elements can be toggled via `settings.json`:

```json
{
  "web-read": {
    "strip": {
      "nav": false,
      "header": false,
      "footer": true
    }
  }
}
```

| Key      | Strips        | Default | Notes                                        |
|----------|---------------|---------|----------------------------------------------|
| `nav`    | `<nav>`       | `false` | Useful on docs sites (TOCs, sidebars)        |
| `header` | `<header>`    | `false` | Often wraps nav                              |
| `footer` | `<footer>`    | `true`  | Usually boilerplate (copyright, legal, etc.) |
