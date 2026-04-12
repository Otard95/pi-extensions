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
