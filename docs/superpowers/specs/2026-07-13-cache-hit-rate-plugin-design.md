# Cache Hit Rate Plugin — Design Spec

**Date:** 2026-07-13  
**Status:** Approved

---

## Problem

opencode shows no visibility into how effectively the LLM prompt cache is being used across a session. Users have no way to know whether their cache is working, how much context is being reused, or whether they are getting value from cache-aware prompting — without digging through raw JSONL logs.

---

## Goal

Build a global opencode plugin that:
1. Tracks per-session cache token usage (read, write, raw input, output) after every assistant turn.
2. Appends a JSONL record to a persistent stats file after each turn.
3. Displays live per-session cache stats in the sidebar right column of the TUI, styled to match the existing sidebar aesthetic.

---

## Architecture

The plugin is a single TypeScript file at:

```
~/.config/opencode/plugins/cache-hit-rate.ts
```

It is auto-discovered by opencode (files in `.config/opencode/plugins/` are loaded automatically — no `plugin:` config entry needed).

It exports two named symbols:

- **`server` (default export, `Plugin` type)** — runs in the opencode server process. Listens to `message.updated` events, extracts `tokens.cache.{ read, write }` from completed `AssistantMessage`s, and appends a JSONL record to `~/.config/opencode/cache-stats.jsonl`.

- **`tui` (named export, `TuiPlugin` type)** — runs in the TUI renderer process. Subscribes to `message.updated` via the TUI event bus, maintains a reactive per-session stats map (plain object updated in place, renderer notified via `requestRender()`), and registers a `sidebar_content` slot that renders the stats widget.

The two halves are **process-isolated** — each accumulates its own in-memory state from events independently. There is no IPC between them; the file is the durable store, the sidebar is the live display.

**Reference implementation:** `@rejacky/opencode-insights` (installed at `~/.cache/opencode/packages/@rejacky/opencode-insights@latest/`) provides a working pattern for the dual server+TUI structure, slot registration, reactive text rendering with `@opentui/core`, and the `message.updated` event shape.

---

## Data Model

### In-memory state (TUI side, per session)

```ts
type SessionStats = {
  cacheRead:  number   // cumulative tokens.cache.read
  cacheWrite: number   // cumulative tokens.cache.write
  inputRaw:   number   // cumulative tokens.input (non-cached residual)
  output:     number   // cumulative tokens.output
  turnCount:  number
}
```

Keyed by `sessionID`: `Map<string, SessionStats>`.

### Derived metrics

```
totalInput = cacheRead + cacheWrite + inputRaw
hitRate    = totalInput > 0 ? (cacheRead / totalInput * 100) : 0
```

**Hit rate definition:** Fraction of total input tokens served from cache rather than processed fresh. This is the standard Anthropic definition (`cache_read_input_tokens / total_input_tokens`).

### Provider compatibility

| Provider | cache.read | cache.write | Notes |
|---|---|---|---|
| Anthropic | Yes | Yes | Full support |
| OpenAI | Yes | Conditional | write only on some models |
| Google Vertex/Gemini | Yes | No | write always 0 |
| Amazon Bedrock | Yes | Yes | Full support |
| Groq / xAI / Mistral | Yes | No | write always 0 |
| Cohere | No | No | both always 0 |

When `cacheRead = 0` and `cacheWrite = 0`, the widget shows "No cache data" rather than a misleading 0% hit rate.

### JSONL record (server side, one line per completed assistant turn)

```json
{
  "ts": "2026-07-13T10:23:01.000Z",
  "sessionID": "ses_abc123",
  "providerID": "anthropic",
  "modelID": "claude-sonnet-4-6",
  "turn": 3,
  "cacheRead": 1240,
  "cacheWrite": 512,
  "inputRaw": 308,
  "output": 320,
  "totalInput": 2060,
  "hitRate": 60.2
}
```

Appended to: `~/.config/opencode/cache-stats.jsonl`

---

## Sidebar Widget

Registered in the `sidebar_content` slot. Renders as a compact plain-text block using `@opentui/core` `StyledText` with `textMuted` color, matching the existing sidebar aesthetic.

**When cache data is available:**

```
── Cache ─────────────────────
  Hit rate:    60.2%
  Read:      1,240 tok
  Written:     512 tok
  Raw input:   308 tok
  Output:      320 tok
  Turns:           3
```

**When no cache data yet (first turn not complete, or provider returns no cache tokens):**

Widget is hidden (height set to 0) until the first completed assistant turn with non-zero cache tokens. If a completed turn has zero cache tokens, shows:

```
── Cache ─────────────────────
  No cache data (turn 1)
  (provider may not support cache tokens)
```

Re-renders on every `message.updated` event where `info.role === "assistant"` and `info.time.completed` is set.

---

## File Layout

```
~/.config/opencode/
  plugins/
    cache-hit-rate.ts       ← the plugin (server + tui exports)
  cache-stats.jsonl         ← append-only stats log (created on first turn)
  docs/superpowers/
    specs/
      2026-07-13-cache-hit-rate-plugin-design.md
    plans/
      2026-07-13-cache-hit-rate-plugin.md
```

---

## Non-Goals

- No cost calculation (prices change per model/tier/region).
- No historical charts or cross-session aggregation UI.
- No configuration options in this version.
- No toast notifications.
- No modification of the existing `tui.json` or `opencode.json`.
