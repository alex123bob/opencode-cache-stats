# Design: Collapsible Agent Sections + Live Cache Stats Dashboard

**Date:** 2026-07-20
**Status:** Approved

---

## Overview

Two features are added to the `opencode-cache-stats` plugin:

1. **Collapsible agent sections in the TUI sidebar** — finished agents auto-collapse; any section can be manually toggled by clicking its header line.
2. **Live local web dashboard** — a `dashboard` command starts a local HTTP server serving a rich, auto-refreshing view of `cache-stats.jsonl`.

---

## Feature 1: Collapsible TUI Sidebar Sections

### Behaviour

- **Active agents** always render fully expanded (hit rate, read, written, raw input, output, turns).
- When an agent's idle timer fires (30 s after its last completed turn), its section **automatically collapses** to a single header line.
- The header line shows a `▶` (collapsed) or `▼` (expanded) arrow prefix.
- **Clicking the header line** toggles the section between collapsed and expanded.
- Collapsing an active agent is allowed (manual override).
- Re-expanding a finished agent is allowed.
- Collapse state is **in-memory only** — it resets when opencode restarts.

### Header format

```
▼ Main Agent (active) ────────
▶ Subagent 1 [done] ──────────   ← click to expand
▼ Subagent 2 (active) ────────
  Hit rate:  55.1%
  ...
```

### Implementation notes

- `AgentEntry` gains a `collapsed: boolean` field (default `false`).
- `renderAgentSection` respects `collapsed`: when true, renders only the header line.
- The TUI widget switches from a single `<text>` node to a `<box>` containing one clickable `<text>` node per agent, so that click events can be scoped per-agent.
- `markIdle` sets `collapsed: true` in addition to `isActive: false`.
- A click handler on each agent's header node calls `toggleCollapse(sessionID)` which flips `collapsed` and calls `bump()`.

### Files changed

- `src/shared.ts` — add `collapsed` to `AgentEntry`, update `renderAgentSection` signature
- `src/tui.ts` — switch to per-agent clickable nodes, add `toggleCollapse`, update `markIdle`

---

## Feature 2: Live Local Web Dashboard

### Invocation

```bash
npx opencode-cache-stats dashboard
# or
npx opencode-cache-stats dashboard --port 4321 --file ~/.config/opencode/cache-stats.jsonl
```

Default port: `4321`. Opens browser automatically (`open`/`xdg-open`). Prints URL to stdout.

### Architecture

```
bin/dashboard.js (CLI entry)
  └── src/dashboard/server.ts   — Node HTTP server + SSE endpoint
  └── src/dashboard/reader.ts   — JSONL parser + aggregator
  └── src/dashboard/ui/         — Single-page app (vanilla JS + CSS, no framework)
        index.html
        app.js
        style.css
```

The server:
- Serves the static SPA from `src/dashboard/ui/`.
- Exposes `GET /api/data` → full aggregated JSON snapshot.
- Exposes `GET /api/stream` → Server-Sent Events (SSE); emits a `data` event with the full snapshot whenever the JSONL file changes (via `fs.watch`).

No bundler required for the UI — vanilla JS with ES modules served directly.

### Data model (server → client)

```ts
type DashboardData = {
  sessions: SessionView[]
  global: GlobalStats
}

type SessionView = {
  sessionID:  string
  startedAt:  string        // ISO timestamp of first record
  agents:     AgentView[]
  totals:     SessionTotals
}

type AgentView = {
  sessionID:  string
  agentLabel: string
  parentID:   string | null
  turns:      TurnRecord[]  // chronological, raw per-turn values from JSONL
  cumulative: SessionTotals // running cumulative at last turn
}

type TurnRecord = {
  ts:         string
  turn:       number
  cacheRead:  number
  cacheWrite: number
  inputRaw:   number
  output:     number
  totalInput: number
  hitRate:    number        // per-turn rate
  // computed by reader:
  deltaRead:  number | null   // vs previous turn of same agent (null for turn 1)
  deltaWrite: number | null
  deltaRaw:   number | null
  deltaHitRate: number | null
}

type SessionTotals = {
  cacheRead:  number
  cacheWrite: number
  inputRaw:   number
  output:     number
  turnCount:  number
  hitRate:    number   // cumulative
}

type GlobalStats = {
  totalSessions:  number
  totalTurns:     number
  avgHitRate:     number
  totalCacheRead: number
  totalCacheWrite: number
  totalRawInput:  number
  totalOutput:    number
  dailySummaries: DailySummary[]   // for heatmap
}

type DailySummary = {
  date:       string   // YYYY-MM-DD
  hitRate:    number
  turnCount:  number
  sessionCount: number
}
```

### Dashboard UI — 5 views (tabs)

**Global KPI strip** (always visible):
- Avg hit rate, total cache read, total cache written, total raw input, total sessions, total turns

**Left sidebar — session list:**
- Sorted newest-first
- Live badge on the session with the most recent timestamp
- Hit rate badge (green/orange/red thresholds: ≥65% green, 40–64% orange, <40% red)
- Agent count badge

**Tab 1 — Turn Timeline** (default):
- Bar chart: hit rate per turn, color-coded by agent (Main=blue, Subagent N=purple/green/etc.)
- Per-turn table: turn#, agent tag, stacked token composition bar (read=green, write=yellow, raw=red), read tokens, raw tokens, per-turn hit rate pill (colored by threshold)

**Tab 2 — Turn Deltas:**
- Same table structure but shows Δread, Δwrite, Δraw, Δhit-rate vs previous turn of the same agent
- Turn 1 of each agent shows "Cold start" in the interpretation column
- Interpretation column: plain-English label derived from delta pattern (e.g. "Cache warming ↑", "Context shift ↓", "Stable")

**Tab 3 — Hit Rate Trend:**
- Line chart: cumulative session hit rate over time (one point per session, x=date)
- Red dots for sessions below 40% hit rate

**Tab 4 — Token Composition:**
- Horizontal bar chart: read vs write vs raw for the selected session
- Write/Read ratio and "reads per written token" metric
- Per-agent breakdown

**Tab 5 — Cross-session Heatmap:**
- GitHub-style contribution heatmap: one cell per day, last 30 days
- Cell color encodes daily avg hit rate (grey=no data, light green=low, dark green=high, red=<40%)
- Hover tooltip shows date, hit rate, session count, turn count

### Filtering

- Time range pills: All time / Today / Last 7 days / Last 30 days
- Model filter: All models / per model-ID (derived from JSONL records)
- Agent filter: All agents / Main only / Subagents only

Filters apply to all tabs simultaneously. Active session (live) is always highlighted regardless of filter.

### Live update

- On JSONL file change, server re-reads and re-aggregates the file, then pushes a full snapshot via SSE.
- Client replaces data in-place (no full page reload). Charts and tables re-render.
- SSE reconnects automatically on disconnect (standard EventSource behaviour).

### CLI flags

| Flag | Default | Description |
|---|---|---|
| `--port` | `4321` | HTTP port |
| `--file` | `~/.config/opencode/cache-stats.jsonl` | Path to JSONL |
| `--no-open` | false | Don't auto-open browser |

### Files added

- `bin/dashboard.js` — CLI entry point (registered in `package.json` `bin`)
- `src/dashboard/server.ts` — HTTP server, SSE, static file serving
- `src/dashboard/reader.ts` — JSONL parser, aggregator, delta computation
- `src/dashboard/ui/index.html` — SPA shell
- `src/dashboard/ui/app.js` — Vanilla JS: SSE client, tab routing, chart rendering
- `src/dashboard/ui/style.css` — Dark theme styles

### Dependencies added

- None — uses only Node built-ins (`http`, `fs`, `path`, `url`). Charts are rendered with plain SVG/Canvas in vanilla JS. No React, no D3, no bundler.

---

## Out of scope

- Persistent collapse state across opencode restarts
- Authentication on the dashboard
- Export to CSV/PNG
- Real-time agent name editing

---

## Thresholds reference

| Hit rate | Colour | Meaning |
|---|---|---|
| ≥ 65% | Green | Cache well-warmed |
| 40–64% | Orange | Partially warm |
| < 40% | Red | Cold cache / large new context |
