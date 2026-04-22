# btw

Ask a quick side question about the current session without polluting conversation history.

## Usage

```
/btw <question>
```

### Examples

```
/btw what file are we editing?
/btw what does this error mean?
/btw summarize what we've done so far
/btw why did we change that function?
```

## Behaviour

- **Ephemeral** — the question and answer are never written to session history
- **Context-aware** — passes recent session messages as background so the model knows what you're working on
- **Tool-less** — a separate one-shot call with no agent loop and no side effects
- **Cancellable** — press Esc during the spinner to abort
- **Scrollable** — answer renders in a full-height panel; ↑/↓ or k/j to scroll, q/Esc to dismiss

## Model selection

Tries fast/cheap models first, falling back to the current session model:

1. `claude-haiku-4-5` (Anthropic)
2. `gemini-2.5-flash` (Google)
3. `gpt-4.1-mini` (OpenAI)
4. `gpt-4o-mini` (OpenAI)
5. Current session model
