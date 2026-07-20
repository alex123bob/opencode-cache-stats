# Live Cache Stats Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npx opencode-cache-stats dashboard` — a live local web dashboard that reads `cache-stats.jsonl`, serves a dark-themed SPA with 5 analytics views, auto-refreshes via SSE when the file changes, and auto-increments port on conflict.

**Architecture:** Node HTTP server (`src/dashboard/server.ts`) serves a vanilla-JS SPA from `src/dashboard/ui/`. A reader module (`src/dashboard/reader.ts`) parses and aggregates the JSONL into a typed snapshot. SSE pushes full snapshots on file change. No bundler, no framework, no extra dependencies — Node built-ins only.

**Tech Stack:** TypeScript (server), Vanilla JS ES modules (UI), Node `http`/`fs`/`path`/`url` built-ins, SVG for charts

---

## File Map

| File | Responsibility |
|---|---|
| `src/dashboard/reader.ts` | Parse JSONL, compute per-turn deltas, aggregate session/global stats |
| `src/dashboard/server.ts` | HTTP server, static file serving, `/api/data`, `/api/stream` SSE, port auto-increment, `fs.watch` |
| `src/dashboard/ui/index.html` | SPA shell — loads `app.js` and `style.css` |
| `src/dashboard/ui/style.css` | Dark theme, all component styles |
| `src/dashboard/ui/app.js` | SSE client, tab routing, rendering all 5 views |
| `bin/dashboard.js` | CLI entry: parse args, resolve file path, call server, open browser |
| `package.json` | Add `bin.dashboard` entry, add `dashboard` script |

---

## Task 1: Reader — JSONL parser and aggregator

**Files:**
- Create: `src/dashboard/reader.ts`

- [ ] **Step 1: Create the file with all types**

```ts
// src/dashboard/reader.ts
import { readFileSync } from "node:fs"

// ── Types ────────────────────────────────────────────────────────────────────

export type TurnRecord = {
  ts:           string
  turn:         number
  cacheRead:    number
  cacheWrite:   number
  inputRaw:     number
  output:       number
  totalInput:   number
  hitRate:      number        // per-turn rate from JSONL
  // computed:
  deltaRead:    number | null  // null for first turn of this agent
  deltaWrite:   number | null
  deltaRaw:     number | null
  deltaHitRate: number | null
}

export type SessionTotals = {
  cacheRead:  number
  cacheWrite: number
  inputRaw:   number
  output:     number
  turnCount:  number
  hitRate:    number   // cumulative
}

export type AgentView = {
  agentLabel: string
  parentID:   string | null
  turns:      TurnRecord[]
  cumulative: SessionTotals
}

export type SessionView = {
  sessionID: string
  startedAt: string
  agents:    AgentView[]
  totals:    SessionTotals
}

export type DailySummary = {
  date:         string   // YYYY-MM-DD
  hitRate:      number
  turnCount:    number
  sessionCount: number
}

export type GlobalStats = {
  totalSessions:   number
  totalTurns:      number
  avgHitRate:      number
  totalCacheRead:  number
  totalCacheWrite: number
  totalRawInput:   number
  totalOutput:     number
  dailySummaries:  DailySummary[]
}

export type DashboardData = {
  sessions: SessionView[]
  global:   GlobalStats
}
```

- [ ] **Step 2: Add the `readAndAggregate` function**

Append to `src/dashboard/reader.ts`:

```ts
// ── Parser ───────────────────────────────────────────────────────────────────

export function readAndAggregate(filePath: string): DashboardData {
  let lines: string[]
  try {
    lines = readFileSync(filePath, "utf8").split("\n").filter(l => l.trim())
  } catch {
    return { sessions: [], global: emptyGlobal() }
  }

  // sessionID → agentLabel → TurnRecord[]
  const rawTurns = new Map<string, Map<string, TurnRecord[]>>()
  // sessionID → startedAt (earliest ts)
  const sessionStart = new Map<string, string>()

  for (const line of lines) {
    let rec: any
    try { rec = JSON.parse(line) } catch { continue }

    const sid   = rec.sessionID as string
    const label = rec.agentLabel as string
    if (!sid || !label) continue

    if (!rawTurns.has(sid)) rawTurns.set(sid, new Map())
    const agentMap = rawTurns.get(sid)!
    if (!agentMap.has(label)) agentMap.set(label, [])

    const prev    = agentMap.get(label)!
    const prevRec = prev.length > 0 ? prev[prev.length - 1] : null

    const turn: TurnRecord = {
      ts:           rec.ts,
      turn:         rec.turn,
      cacheRead:    rec.cacheRead  ?? 0,
      cacheWrite:   rec.cacheWrite ?? 0,
      inputRaw:     rec.inputRaw   ?? 0,
      output:       rec.output     ?? 0,
      totalInput:   rec.totalInput ?? 0,
      hitRate:      rec.hitRate    ?? 0,
      deltaRead:    prevRec ? rec.cacheRead  - prevRec.cacheRead  : null,
      deltaWrite:   prevRec ? rec.cacheWrite - prevRec.cacheWrite : null,
      deltaRaw:     prevRec ? rec.inputRaw   - prevRec.inputRaw   : null,
      deltaHitRate: prevRec ? rec.hitRate    - prevRec.hitRate    : null,
    }
    prev.push(turn)

    // track earliest ts per session
    if (!sessionStart.has(sid) || rec.ts < sessionStart.get(sid)!) {
      sessionStart.set(sid, rec.ts)
    }
  }

  // Build SessionView[]
  const sessions: SessionView[] = []
  for (const [sessionID, agentMap] of rawTurns) {
    const agents: AgentView[] = []
    for (const [agentLabel, turns] of agentMap) {
      const cumulative = computeCumulative(turns)
      agents.push({ agentLabel, parentID: null, turns, cumulative })
    }
    const totals = mergeAgentTotals(agents.map(a => a.cumulative))
    sessions.push({
      sessionID,
      startedAt: sessionStart.get(sessionID) ?? "",
      agents,
      totals,
    })
  }

  // Sort newest first
  sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt))

  const global = computeGlobal(sessions)
  return { sessions, global }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeCumulative(turns: TurnRecord[]): SessionTotals {
  const last = turns[turns.length - 1]
  const totalRead  = turns.reduce((s, t) => s + t.cacheRead,  0)
  const totalWrite = turns.reduce((s, t) => s + t.cacheWrite, 0)
  const totalRaw   = turns.reduce((s, t) => s + t.inputRaw,   0)
  const totalOut   = turns.reduce((s, t) => s + t.output,     0)
  const totalIn    = totalRead + totalWrite + totalRaw
  return {
    cacheRead:  totalRead,
    cacheWrite: totalWrite,
    inputRaw:   totalRaw,
    output:     totalOut,
    turnCount:  last?.turn ?? turns.length,
    hitRate:    totalIn > 0 ? Math.round((totalRead / totalIn) * 1000) / 10 : 0,
  }
}

function mergeAgentTotals(totals: SessionTotals[]): SessionTotals {
  const r = totals.reduce((acc, t) => ({
    cacheRead:  acc.cacheRead  + t.cacheRead,
    cacheWrite: acc.cacheWrite + t.cacheWrite,
    inputRaw:   acc.inputRaw   + t.inputRaw,
    output:     acc.output     + t.output,
    turnCount:  acc.turnCount  + t.turnCount,
    hitRate:    0,
  }), { cacheRead: 0, cacheWrite: 0, inputRaw: 0, output: 0, turnCount: 0, hitRate: 0 })
  const totalIn = r.cacheRead + r.cacheWrite + r.inputRaw
  r.hitRate = totalIn > 0 ? Math.round((r.cacheRead / totalIn) * 1000) / 10 : 0
  return r
}

function computeGlobal(sessions: SessionView[]): GlobalStats {
  const totalCacheRead  = sessions.reduce((s, x) => s + x.totals.cacheRead,  0)
  const totalCacheWrite = sessions.reduce((s, x) => s + x.totals.cacheWrite, 0)
  const totalRawInput   = sessions.reduce((s, x) => s + x.totals.inputRaw,   0)
  const totalOutput     = sessions.reduce((s, x) => s + x.totals.output,     0)
  const totalTurns      = sessions.reduce((s, x) => s + x.totals.turnCount,  0)
  const totalIn         = totalCacheRead + totalCacheWrite + totalRawInput
  const avgHitRate      = totalIn > 0 ? Math.round((totalCacheRead / totalIn) * 1000) / 10 : 0

  // Daily summaries
  const dailyMap = new Map<string, { hitRateSum: number; turns: number; sessions: number }>()
  for (const session of sessions) {
    const date = session.startedAt.slice(0, 10)
    if (!dailyMap.has(date)) dailyMap.set(date, { hitRateSum: 0, turns: 0, sessions: 0 })
    const d = dailyMap.get(date)!
    d.hitRateSum += session.totals.hitRate
    d.turns      += session.totals.turnCount
    d.sessions   += 1
  }
  const dailySummaries: DailySummary[] = Array.from(dailyMap.entries())
    .map(([date, d]) => ({
      date,
      hitRate:      Math.round((d.hitRateSum / d.sessions) * 10) / 10,
      turnCount:    d.turns,
      sessionCount: d.sessions,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    totalSessions: sessions.length,
    totalTurns,
    avgHitRate,
    totalCacheRead,
    totalCacheWrite,
    totalRawInput,
    totalOutput,
    dailySummaries,
  }
}

function emptyGlobal(): GlobalStats {
  return {
    totalSessions: 0, totalTurns: 0, avgHitRate: 0,
    totalCacheRead: 0, totalCacheWrite: 0, totalRawInput: 0,
    totalOutput: 0, dailySummaries: [],
  }
}
```

- [ ] **Step 3: Build to verify**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/reader.ts
git commit -m "feat(dashboard): JSONL reader and aggregator"
```

---

## Task 2: HTTP server with SSE and port auto-increment

**Files:**
- Create: `src/dashboard/server.ts`

- [ ] **Step 1: Create server.ts**

```ts
// src/dashboard/server.ts
import { createServer, IncomingMessage, ServerResponse } from "node:http"
import { readFileSync, watch }                            from "node:fs"
import { join, extname }                                  from "node:path"
import { fileURLToPath }                                  from "node:url"
import { readAndAggregate }                               from "./reader.js"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js":   "text/javascript",
  ".css":  "text/css",
  ".json": "application/json",
}

export type ServerOptions = {
  jsonlPath:    string
  preferredPort: number
  autoOpen:     boolean
}

export async function startDashboardServer(opts: ServerOptions): Promise<{ url: string }> {
  const port = await findFreePort(opts.preferredPort)
  const data = () => JSON.stringify(readAndAggregate(opts.jsonlPath))

  // SSE clients
  const clients = new Set<ServerResponse>()

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/"

    // SSE stream
    if (url === "/api/stream") {
      res.writeHead(200, {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "Access-Control-Allow-Origin": "*",
      })
      res.write(`data: ${data()}\n\n`)
      clients.add(res)
      req.on("close", () => clients.delete(res))
      return
    }

    // JSON snapshot
    if (url === "/api/data") {
      const body = data()
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(body)
      return
    }

    // Static SPA files
    const uiDir  = join(__dirname, "ui")
    const filePath = url === "/" ? join(uiDir, "index.html") : join(uiDir, url.replace(/^\//, ""))
    try {
      const content = readFileSync(filePath)
      const ext     = extname(filePath)
      res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" })
      res.end(content)
    } catch {
      res.writeHead(404)
      res.end("Not found")
    }
  })

  await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve))

  // Watch JSONL for changes and push to SSE clients
  try {
    watch(opts.jsonlPath, () => {
      const snapshot = `data: ${data()}\n\n`
      for (const client of clients) {
        try { client.write(snapshot) } catch { clients.delete(client) }
      }
    })
  } catch {
    // file may not exist yet — that's fine, dashboard still works
  }

  const url = `http://localhost:${port}`
  return { url }
}

// ── Port helpers ─────────────────────────────────────────────────────────────

async function findFreePort(start: number, maxTries = 10): Promise<number> {
  for (let i = 0; i < maxTries; i++) {
    const port = start + i
    if (i > 0) console.log(`  Port ${start + i - 1} in use, trying ${port}...`)
    if (await isPortFree(port)) return port
  }
  throw new Error(`No free port found in range ${start}–${start + maxTries - 1}`)
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = createServer()
    s.listen(port, "127.0.0.1", () => { s.close(); resolve(true) })
    s.on("error", () => resolve(false))
  })
}
```

- [ ] **Step 2: Build to verify**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/server.ts
git commit -m "feat(dashboard): HTTP server with SSE and port auto-increment"
```

---

## Task 3: CLI entry point

**Files:**
- Create: `bin/dashboard.js`
- Modify: `package.json`

- [ ] **Step 1: Create `bin/dashboard.js`**

```js
#!/usr/bin/env node
// bin/dashboard.js
import { startDashboardServer } from "../dist/dashboard/server.js"
import { homedir }              from "node:os"
import { join }                 from "node:path"
import { execSync }             from "node:child_process"

const args = process.argv.slice(2)

function getFlag(name, fallback) {
  const idx = args.indexOf(name)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback
}

const port     = parseInt(getFlag("--port", "4321"), 10)
const file     = getFlag("--file", join(homedir(), ".config", "opencode", "cache-stats.jsonl"))
const noOpen   = args.includes("--no-open")

startDashboardServer({ jsonlPath: file, preferredPort: port, autoOpen: !noOpen })
  .then(({ url }) => {
    console.log(`\n  Cache stats dashboard running at ${url}`)
    console.log(`  Watching ${file}`)
    console.log(`  Press Ctrl+C to stop.\n`)
    if (!noOpen) {
      try {
        const cmd = process.platform === "darwin" ? "open"
                  : process.platform === "win32"  ? "start"
                  : "xdg-open"
        execSync(`${cmd} ${url}`)
      } catch { /* ignore */ }
    }
  })
  .catch(err => {
    console.error("Error starting dashboard:", err.message)
    process.exit(1)
  })
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x bin/dashboard.js
```

- [ ] **Step 3: Register in `package.json`**

Add a `"bin"` field and a convenience `"scripts"` entry to `package.json`:

```json
{
  "bin": {
    "opencode-cache-stats": "bin/dashboard.js"
  },
  "scripts": {
    "dashboard": "node bin/dashboard.js"
  }
}
```

> Note: if `package.json` already has a `"bin"` field, merge rather than replace.

- [ ] **Step 4: Build and test the CLI**

```bash
npm run build && node bin/dashboard.js --no-open --port 9999
```

Expected output:
```
  Cache stats dashboard running at http://localhost:9999
  Watching ~/.config/opencode/cache-stats.jsonl
  Press Ctrl+C to stop.
```

Ctrl+C to stop.

- [ ] **Step 5: Commit**

```bash
git add bin/dashboard.js package.json
git commit -m "feat(dashboard): CLI entry point with --port, --file, --no-open flags"
```

---

## Task 4: SPA shell and CSS

**Files:**
- Create: `src/dashboard/ui/index.html`
- Create: `src/dashboard/ui/style.css`

- [ ] **Step 1: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>opencode cache stats</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="page-header">
    <h1>opencode cache stats</h1>
    <div class="header-right">
      <span class="file-path" id="filePath"></span>
      <div class="live-badge" id="liveBadge"><div class="live-dot"></div> LIVE</div>
    </div>
  </header>

  <div class="toolbar" id="toolbar">
    <div class="filter-group" id="timeFilter">
      <button class="pill active" data-value="all">All time</button>
      <button class="pill" data-value="today">Today</button>
      <button class="pill" data-value="7d">Last 7 days</button>
      <button class="pill" data-value="30d">Last 30 days</button>
    </div>
    <div class="sep">|</div>
    <div class="filter-group" id="agentFilter">
      <button class="pill active" data-value="all">All agents</button>
      <button class="pill" data-value="main">Main only</button>
      <button class="pill" data-value="sub">Subagents only</button>
    </div>
  </div>

  <div class="layout">
    <aside class="sidebar" id="sessionList"></aside>
    <main class="main">
      <div class="kpi-row" id="kpiRow"></div>
      <div class="tabs" id="tabs">
        <button class="tab active" data-tab="timeline">Turn Timeline</button>
        <button class="tab" data-tab="deltas">Turn Deltas</button>
        <button class="tab" data-tab="trend">Hit Rate Trend</button>
        <button class="tab" data-tab="composition">Token Composition</button>
        <button class="tab" data-tab="heatmap">Cross-session</button>
      </div>
      <div id="tabContent"></div>
    </main>
  </div>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `style.css`**

```css
/* style.css */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:       #0f172a;
  --surface:  #1e293b;
  --border:   #334155;
  --muted:    #64748b;
  --text:     #e2e8f0;
  --subtext:  #94a3b8;
  --green:    #34d399;
  --blue:     #60a5fa;
  --yellow:   #fbbf24;
  --red:      #f87171;
  --purple:   #a78bfa;
  --orange:   #fb923c;
}

body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; }

/* Header */
.page-header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; }
.page-header h1 { font-size: 15px; font-weight: 600; }
.header-right { display: flex; align-items: center; gap: 12px; }
.file-path { font-size: 12px; color: var(--muted); font-family: monospace; }
.live-badge { background: #022c22; color: var(--green); font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 12px; border: 1px solid var(--green); display: flex; align-items: center; gap: 5px; }
.live-dot { width: 7px; height: 7px; background: var(--green); border-radius: 50%; animation: pulse 1.5s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

/* Toolbar */
.toolbar { background: var(--surface); border-bottom: 1px solid var(--border); padding: 8px 24px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.filter-group { display: flex; gap: 4px; }
.pill { background: var(--border); border: 1px solid #475569; border-radius: 20px; padding: 3px 12px; font-size: 12px; color: var(--subtext); cursor: pointer; transition: background .15s; }
.pill:hover { background: #475569; }
.pill.active { background: #1d4ed8; border-color: var(--blue); color: #bfdbfe; }
.sep { color: #475569; }

/* Layout */
.layout { display: grid; grid-template-columns: 220px 1fr; height: calc(100vh - 90px); overflow: hidden; }
.sidebar { background: var(--surface); border-right: 1px solid var(--border); overflow-y: auto; padding: 12px; }
.main { padding: 20px 24px; overflow-y: auto; }

/* Session list */
.sidebar-title { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 8px; padding: 0 6px; }
.session-item { padding: 8px 10px; border-radius: 6px; cursor: pointer; margin-bottom: 3px; border: 1px solid transparent; }
.session-item:hover { background: var(--border); }
.session-item.active { background: #1e3a5f; border-color: var(--blue); }
.session-item.live { border-color: var(--green); background: #022c22; }
.session-date { font-size: 11px; color: var(--muted); }
.session-id { font-size: 12px; font-weight: 500; color: #cbd5e1; font-family: monospace; }
.session-badges { display: flex; gap: 6px; margin-top: 3px; flex-wrap: wrap; }
.badge { font-size: 10px; padding: 1px 6px; border-radius: 10px; font-weight: 600; display: inline-block; }
.badge-green  { background: #064e3b; color: var(--green); }
.badge-orange { background: #451a03; color: var(--orange); }
.badge-red    { background: #450a0a; color: var(--red); }
.badge-blue   { background: #1e3a5f; color: var(--blue); }
.badge-live   { background: #022c22; color: var(--green); border: 1px solid var(--green); }

/* KPI row */
.kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }
.kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
.kpi-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
.kpi-value { font-size: 22px; font-weight: 700; }
.kpi-sub   { font-size: 11px; color: var(--muted); margin-top: 3px; }
.kpi-green  .kpi-value { color: var(--green); }
.kpi-blue   .kpi-value { color: var(--blue); }
.kpi-yellow .kpi-value { color: var(--yellow); }
.kpi-pink   .kpi-value { color: #f472b6; }
.kpi-purple .kpi-value { color: var(--purple); }

/* Tabs */
.tabs { display: flex; gap: 2px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
.tab { padding: 8px 16px; font-size: 13px; color: var(--muted); cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .15s; }
.tab:hover { color: var(--subtext); }
.tab.active { color: var(--blue); border-bottom-color: var(--blue); }

/* Chart box */
.chart-box { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.chart-title { font-size: 13px; font-weight: 600; color: var(--subtext); margin-bottom: 4px; }
.chart-hint  { font-size: 11px; color: var(--muted); margin-bottom: 10px; }
.annotation  { font-size: 11px; color: var(--muted); font-style: italic; margin-top: 8px; }

/* Bar chart */
.bar-chart { display: flex; align-items: flex-end; gap: 3px; height: 90px; }
.bar { flex: 1; border-radius: 3px 3px 0 0; min-height: 2px; cursor: pointer; transition: opacity .15s; }
.bar:hover { opacity: .75; }

/* Token composition bar */
.token-bar { height: 10px; border-radius: 3px; display: flex; overflow: hidden; width: 100%; }
.tb-read  { background: var(--green); }
.tb-write { background: var(--yellow); }
.tb-raw   { background: var(--red); }

/* Rate pill */
.rate-pill { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; display: inline-block; }
.rate-high   { background: #064e3b; color: var(--green); }
.rate-mid    { background: #451a03; color: var(--orange); }
.rate-low    { background: #450a0a; color: var(--red); }

/* Delta */
.delta-pos { color: var(--green); }
.delta-neg { color: var(--red); }
.delta-neu { color: var(--muted); }

/* Table */
.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table th { text-align: left; padding: 6px 10px; font-size: 11px; font-weight: 600; color: var(--muted); border-bottom: 1px solid var(--border); }
.data-table td { padding: 6px 10px; border-bottom: 1px solid #1e293b; }
.data-table tr:hover td { background: var(--surface); }

/* Agent tag */
.agent-tag { font-size: 10px; padding: 2px 7px; border-radius: 10px; font-weight: 600; display: inline-block; }
.agent-main { background: #1e3a5f; color: var(--blue); }
.agent-sub0 { background: #2d1b69; color: var(--purple); }
.agent-sub1 { background: #1a2e1a; color: #4ade80; }
.agent-sub2 { background: #3b1f1f; color: var(--orange); }

/* SVG line chart */
.line-chart svg { width: 100%; height: 100px; }

/* Heatmap */
.heatmap-grid { display: flex; gap: 3px; flex-wrap: wrap; margin-top: 8px; }
.hm-cell { width: 18px; height: 18px; border-radius: 2px; cursor: pointer; transition: opacity .15s; }
.hm-cell:hover { opacity: .75; }
.hm-none   { background: var(--border); }
.hm-low    { background: #064e3b; }
.hm-mid    { background: #047857; }
.hm-high   { background: #065f46; }
.hm-cold   { background: #450a0a; }

/* Legend */
.legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
.legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--subtext); }
.legend-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }

/* Horizontal bar */
.hbar-label { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-bottom: 4px; }
.hbar-track { border-radius: 4px; height: 14px; width: 100%; overflow: hidden; margin-bottom: 10px; }
.hbar-fill  { height: 100%; border-radius: 4px; }
```

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/ui/index.html src/dashboard/ui/style.css
git commit -m "feat(dashboard): SPA shell and dark theme CSS"
```

---

## Task 5: App JS — state, SSE, tab routing

**Files:**
- Create: `src/dashboard/ui/app.js`

This task builds the full SPA logic. The file is organized into sections: state, SSE, rendering helpers, and the 5 tab renderers.

- [ ] **Step 1: Create `app.js` — state and SSE client**

```js
// src/dashboard/ui/app.js

// ── State ────────────────────────────────────────────────────────────────────
let data        = null        // DashboardData
let activeSessionID = null    // string | null
let activeTab   = "timeline"
let timeFilter  = "all"
let agentFilter = "all"

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setupFilters()
  setupTabs()
  connectSSE()
})

function connectSSE() {
  const es = new EventSource("/api/stream")
  es.onmessage = e => {
    data = JSON.parse(e.data)
    if (!activeSessionID && data.sessions.length > 0) {
      activeSessionID = data.sessions[0].sessionID
    }
    render()
  }
  es.onerror = () => setTimeout(connectSSE, 3000)
}
```

- [ ] **Step 2: Append filter and tab wiring**

```js
// ── Filters ───────────────────────────────────────────────────────────────────
let modelFilter = "all"

function setupFilters() {
  document.getElementById("timeFilter").addEventListener("click", e => {
    const btn = e.target.closest(".pill")
    if (!btn) return
    timeFilter = btn.dataset.value
    document.querySelectorAll("#timeFilter .pill").forEach(p => p.classList.toggle("active", p === btn))
    render()
  })
  document.getElementById("agentFilter").addEventListener("click", e => {
    const btn = e.target.closest(".pill")
    if (!btn) return
    agentFilter = btn.dataset.value
    document.querySelectorAll("#agentFilter .pill").forEach(p => p.classList.toggle("active", p === btn))
    render()
  })
}

// Call this after data loads to populate model filter pills dynamically
function renderModelFilter() {
  const toolbar = document.getElementById("toolbar")
  // Remove existing model filter group if present
  const existing = document.getElementById("modelFilter")
  if (existing) existing.remove()

  const models = [...new Set(
    data.sessions.flatMap(s => s.agents.flatMap(a => a.turns.map(t => t.modelID ?? "unknown")))
  )].filter(Boolean)

  if (models.length <= 1) return   // no point showing filter with only one model

  const group = document.createElement("div")
  group.className = "filter-group"
  group.id = "modelFilter"
  group.innerHTML = [
    `<button class="pill ${modelFilter === "all" ? "active" : ""}" data-value="all">All models</button>`,
    ...models.map(m => `<button class="pill ${modelFilter === m ? "active" : ""}" data-value="${m}">${m}</button>`)
  ].join("")
  group.addEventListener("click", e => {
    const btn = e.target.closest(".pill")
    if (!btn) return
    modelFilter = btn.dataset.value
    group.querySelectorAll(".pill").forEach(p => p.classList.toggle("active", p === btn))
    render()
  })

  // Insert a sep + the group
  const sep = document.createElement("div")
  sep.className = "sep"
  sep.textContent = "|"
  toolbar.appendChild(sep)
  toolbar.appendChild(group)
}
```

Also add `modelID` to `TurnRecord` in `src/dashboard/reader.ts` — it is already present on the JSONL record. Update the `TurnRecord` type:

```ts
export type TurnRecord = {
  ts:           string
  turn:         number
  modelID:      string   // ← add this line
  cacheRead:    number
  // ... rest unchanged
}
```

And in `readAndAggregate`, set it from the raw record:

```ts
const turn: TurnRecord = {
  ts:           rec.ts,
  turn:         rec.turn,
  modelID:      rec.modelID ?? "unknown",   // ← add this line
  // ... rest unchanged
}
```

Finally, add model filtering to `filterSessions`:

```js
function filterSessions(sessions) {
  const now = Date.now()
  const cutoff = { all: 0, today: 86400000, "7d": 604800000, "30d": 2592000000 }[timeFilter] ?? 0
  return sessions.filter(s => {
    if (cutoff > 0 && now - new Date(s.startedAt).getTime() > cutoff) return false
    if (modelFilter !== "all") {
      const hasModel = s.agents.some(a => a.turns.some(t => t.modelID === modelFilter))
      if (!hasModel) return false
    }
    return true
  })
}
```

Call `renderModelFilter()` at the end of `render()` (after `renderSessionList`, `renderKPIs`, `renderTabContent`).

function setupTabs() {
  document.getElementById("tabs").addEventListener("click", e => {
    const btn = e.target.closest(".tab")
    if (!btn) return
    activeTab = btn.dataset.tab
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === btn))
    renderTabContent()
  })
}

// ── Filter helpers ────────────────────────────────────────────────────────────
function filterSessions(sessions) {
  const now = Date.now()
  const cutoff = { all: 0, today: 86400000, "7d": 604800000, "30d": 2592000000 }[timeFilter] ?? 0
  return sessions.filter(s => {
    if (cutoff > 0 && now - new Date(s.startedAt).getTime() > cutoff) return false
    return true
  })
}

function filterAgents(agents) {
  if (agentFilter === "main") return agents.filter(a => a.parentID === null && a.agentLabel === "Main Agent")
  if (agentFilter === "sub")  return agents.filter(a => a.agentLabel !== "Main Agent")
  return agents
}
```

- [ ] **Step 3: Append main render function and session sidebar**

```js
// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  if (!data) return
  renderSessionList()
  renderKPIs()
  renderTabContent()
}

function renderSessionList() {
  const sessions = filterSessions(data.sessions)
  const newestTS = data.sessions[0]?.startedAt ?? ""
  const el = document.getElementById("sessionList")
  el.innerHTML = `<div class="sidebar-title">Sessions</div>`
  for (const s of sessions) {
    const isLive   = s.startedAt === newestTS
    const isActive = s.sessionID === activeSessionID
    const hr       = s.totals.hitRate
    const badgeClass = hr >= 65 ? "badge-green" : hr >= 40 ? "badge-orange" : "badge-red"
    const agentCount = s.agents.length
    const div = document.createElement("div")
    div.className = `session-item${isActive ? " active" : ""}${isLive ? " live" : ""}`
    div.innerHTML = `
      <div class="session-date">${fmtDate(s.startedAt)}</div>
      <div class="session-id">${s.sessionID.slice(0, 12)}</div>
      <div class="session-badges">
        ${isLive ? `<span class="badge badge-live">● LIVE</span>` : ""}
        <span class="badge ${badgeClass}">${hr.toFixed(1)}%</span>
        <span class="badge badge-blue">${agentCount} agent${agentCount !== 1 ? "s" : ""}</span>
      </div>`
    div.addEventListener("click", () => { activeSessionID = s.sessionID; render() })
    el.appendChild(div)
  }
}

function renderKPIs() {
  const sessions = filterSessions(data.sessions)
  const g = data.global
  // Recompute global from filtered sessions
  const totalRead  = sessions.reduce((s, x) => s + x.totals.cacheRead,  0)
  const totalWrite = sessions.reduce((s, x) => s + x.totals.cacheWrite, 0)
  const totalRaw   = sessions.reduce((s, x) => s + x.totals.inputRaw,   0)
  const totalIn    = totalRead + totalWrite + totalRaw
  const avgHit     = totalIn > 0 ? (totalRead / totalIn * 100).toFixed(1) : "0.0"
  const totalTurns = sessions.reduce((s, x) => s + x.totals.turnCount, 0)

  document.getElementById("kpiRow").innerHTML = `
    ${kpi("Avg hit rate",    avgHit + "%",        "across filtered sessions", "kpi-green")}
    ${kpi("Cache read",      fmt(totalRead),       "tokens from cache",        "kpi-blue")}
    ${kpi("Cache written",   fmt(totalWrite),      "tokens seeded to cache",   "kpi-yellow")}
    ${kpi("Raw input",       fmt(totalRaw),        "uncached input tokens",    "kpi-pink")}
    ${kpi("Sessions · Turns", sessions.length + " · " + totalTurns, "filtered", "kpi-purple")}
  `
}

function kpi(label, value, sub, cls) {
  return `<div class="kpi ${cls}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`
}

function renderTabContent() {
  if (!data || !activeSessionID) return
  const session = data.sessions.find(s => s.sessionID === activeSessionID)
  if (!session) return
  const agents = filterAgents(session.agents)
  const el = document.getElementById("tabContent")
  switch (activeTab) {
    case "timeline":    el.innerHTML = renderTimeline(agents);    break
    case "deltas":      el.innerHTML = renderDeltas(agents);      break
    case "trend":       el.innerHTML = renderTrend();             break
    case "composition": el.innerHTML = renderComposition(session, agents); break
    case "heatmap":     el.innerHTML = renderHeatmap();           break
  }
}
```

- [ ] **Step 4: Append Tab 1 — Turn Timeline**

```js
// ── Tab 1: Turn Timeline ──────────────────────────────────────────────────────
function renderTimeline(agents) {
  const agentColors = ["#3b82f6","#a78bfa","#4ade80","#fb923c","#f472b6"]
  // Flatten all turns across agents with agent index for coloring
  const allTurns = agents.flatMap((a, i) => a.turns.map(t => ({ ...t, agentLabel: a.agentLabel, colorIdx: i })))
  allTurns.sort((a, b) => a.ts.localeCompare(b.ts))

  const maxHit = Math.max(...allTurns.map(t => t.hitRate), 1)

  const bars = allTurns.map(t => {
    const h = Math.max(4, (t.hitRate / maxHit) * 90)
    const color = agentColors[t.colorIdx % agentColors.length]
    return `<div class="bar" style="background:${color};height:${h}px" title="${t.agentLabel} T${t.turn}: ${t.hitRate.toFixed(1)}%"></div>`
  }).join("")

  const agentLegend = agents.map((a, i) =>
    `<div class="legend-item"><div class="legend-dot" style="background:${agentColors[i % agentColors.length]}"></div>${a.agentLabel}</div>`
  ).join("")

  const rows = allTurns.map(t => {
    const totalIn = t.totalInput || 1
    const readPct  = (t.cacheRead  / totalIn * 100).toFixed(0)
    const writePct = (t.cacheWrite / totalIn * 100).toFixed(0)
    const rawPct   = Math.max(0, 100 - +readPct - +writePct)
    const rateCls  = t.hitRate >= 65 ? "rate-high" : t.hitRate >= 40 ? "rate-mid" : "rate-low"
    const tagIdx   = agents.findIndex(a => a.agentLabel === t.agentLabel)
    const tagCls   = tagIdx === 0 ? "agent-main" : `agent-sub${(tagIdx - 1) % 3}`
    return `<tr>
      <td>${t.turn}</td>
      <td><span class="agent-tag ${tagCls}">${t.agentLabel.replace("Subagent ", "Sub ")}</span></td>
      <td><div class="token-bar"><div class="tb-read" style="width:${readPct}%"></div><div class="tb-write" style="width:${writePct}%"></div><div class="tb-raw" style="width:${rawPct}%"></div></div></td>
      <td style="color:#34d399;font-family:monospace">${fmt(t.cacheRead)}</td>
      <td style="color:#f87171;font-family:monospace">${fmt(t.inputRaw)}</td>
      <td><span class="rate-pill ${rateCls}">${t.hitRate.toFixed(1)}%</span></td>
    </tr>`
  }).join("")

  return `
    <div class="chart-box">
      <div class="chart-title">Hit rate per turn</div>
      <div class="chart-hint">Each bar = one completed response. Color = agent.</div>
      <div class="bar-chart">${bars}</div>
      <div class="legend">${agentLegend}</div>
      <div class="annotation">First turn is always lower (cold cache). Rate climbs as cache warms.</div>
    </div>
    <div class="chart-box">
      <div class="chart-title">Per-turn breakdown</div>
      <div class="chart-hint">Token bar: <span style="color:#34d399">■ read</span> <span style="color:#fbbf24">■ write</span> <span style="color:#f87171">■ raw</span></div>
      <table class="data-table">
        <thead><tr><th>#</th><th>Agent</th><th>Tokens</th><th>Read</th><th>Raw in</th><th>Hit rate</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}
```

- [ ] **Step 5: Append Tab 2 — Turn Deltas**

```js
// ── Tab 2: Turn Deltas ────────────────────────────────────────────────────────
function renderDeltas(agents) {
  const agentColors = ["#3b82f6","#a78bfa","#4ade80","#fb923c","#f472b6"]

  function interpretDelta(t) {
    if (t.deltaHitRate === null) return `<span style="color:var(--muted)">Cold start</span>`
    if (t.deltaHitRate > 10)  return `<span class="delta-pos">Cache warming ↑</span>`
    if (t.deltaHitRate > 0)   return `<span class="delta-pos">Improving ↑</span>`
    if (t.deltaHitRate < -10) return `<span class="delta-neg">Context shift ↓</span>`
    if (t.deltaHitRate < 0)   return `<span class="delta-neg">Slight drop ↓</span>`
    return `<span class="delta-neu">Stable</span>`
  }

  function fmtDelta(v) {
    if (v === null) return `<span class="delta-neu">—</span>`
    const sign = v > 0 ? "+" : ""
    const cls  = v > 0 ? "delta-pos" : v < 0 ? "delta-neg" : "delta-neu"
    return `<span class="${cls}">${sign}${fmt(Math.round(v))}</span>`
  }

  function fmtDeltaRate(v) {
    if (v === null) return `<span class="delta-neu">—</span>`
    const sign = v > 0 ? "+" : ""
    const cls  = v > 0 ? "delta-pos" : v < 0 ? "delta-neg" : "delta-neu"
    return `<span class="${cls}">${sign}${v.toFixed(1)}%</span>`
  }

  const rows = agents.flatMap((a, i) => {
    const tagCls = i === 0 ? "agent-main" : `agent-sub${(i - 1) % 3}`
    return a.turns.map(t => `<tr>
      <td>${t.turn}</td>
      <td><span class="agent-tag ${tagCls}">${a.agentLabel.replace("Subagent ", "Sub ")}</span></td>
      <td>${fmtDelta(t.deltaRead)}</td>
      <td>${fmtDelta(t.deltaWrite)}</td>
      <td>${fmtDelta(t.deltaRaw)}</td>
      <td>${fmtDeltaRate(t.deltaHitRate)}</td>
      <td>${interpretDelta(t)}</td>
    </tr>`)
  }).join("")

  return `
    <div class="chart-box">
      <div class="chart-title">Turn-over-turn deltas</div>
      <div class="chart-hint">Change vs previous turn of the same agent. Null (—) = first turn of that agent.</div>
      <table class="data-table">
        <thead><tr><th>#</th><th>Agent</th><th>Δ read</th><th>Δ write</th><th>Δ raw in</th><th>Δ hit rate</th><th>Interpretation</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}
```

- [ ] **Step 6: Append Tab 3 — Hit Rate Trend**

```js
// ── Tab 3: Hit Rate Trend ─────────────────────────────────────────────────────
function renderTrend() {
  const sessions = filterSessions(data.sessions).slice().reverse()   // oldest → newest
  if (sessions.length === 0) return `<div class="chart-box"><div class="chart-hint">No sessions to display.</div></div>`

  const rates = sessions.map(s => s.totals.hitRate)
  const maxR  = Math.max(...rates, 1)
  const W = 500, H = 100, PAD = 20
  const xStep = sessions.length > 1 ? (W - PAD * 2) / (sessions.length - 1) : 0

  const points = sessions.map((s, i) => {
    const x = PAD + i * xStep
    const y = H - PAD - ((s.totals.hitRate / maxR) * (H - PAD * 2))
    return { x, y, session: s }
  })

  const polyline = points.map(p => `${p.x},${p.y}`).join(" ")
  const dots = points.map(p => {
    const isLow = p.session.totals.hitRate < 40
    return `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${isLow ? "#f87171" : "#3b82f6"}" title="${p.session.sessionID}: ${p.session.totals.hitRate.toFixed(1)}%"/>`
  }).join("")

  const rows = sessions.slice().reverse().map(s => {
    const rateCls = s.totals.hitRate >= 65 ? "rate-high" : s.totals.hitRate >= 40 ? "rate-mid" : "rate-low"
    return `<tr>
      <td>${fmtDate(s.startedAt)}</td>
      <td style="font-family:monospace">${s.sessionID.slice(0,12)}</td>
      <td>${s.agents.length}</td>
      <td>${s.totals.turnCount}</td>
      <td><span class="rate-pill ${rateCls}">${s.totals.hitRate.toFixed(1)}%</span></td>
    </tr>`
  }).join("")

  return `
    <div class="chart-box">
      <div class="chart-title">Hit rate over time</div>
      <div class="chart-hint">One point per session. <span style="color:#f87171">Red</span> = below 40%.</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px">
        <polyline points="${polyline}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round"/>
        ${dots}
        <text x="2" y="${PAD}" fill="#475569" font-size="9">${maxR.toFixed(0)}%</text>
        <text x="2" y="${H - 4}" fill="#475569" font-size="9">0%</text>
      </svg>
      <div class="annotation">Red dots indicate sessions with cold cache or large new context.</div>
    </div>
    <div class="chart-box">
      <div class="chart-title">Session table</div>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Session</th><th>Agents</th><th>Turns</th><th>Hit rate</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}
```

- [ ] **Step 7: Append Tab 4 — Token Composition**

```js
// ── Tab 4: Token Composition ──────────────────────────────────────────────────
function renderComposition(session, agents) {
  function hbar(label, value, total, color, trackColor) {
    const pct = total > 0 ? (value / total * 100).toFixed(1) : 0
    return `
      <div class="hbar-label"><span>${label}</span><span>${fmt(value)} tok (${pct}%)</span></div>
      <div class="hbar-track" style="background:${trackColor}">
        <div class="hbar-fill" style="background:${color};width:${pct}%"></div>
      </div>`
  }

  const t = session.totals
  const totalIn = t.cacheRead + t.cacheWrite + t.inputRaw
  const writeReadRatio = t.cacheRead > 0 ? (t.cacheWrite / t.cacheRead).toFixed(2) : "—"
  const readsPerWrite  = t.cacheWrite > 0 ? (t.cacheRead  / t.cacheWrite).toFixed(1) : "—"

  const agentRows = agents.map((a, i) => {
    const tagCls = i === 0 ? "agent-main" : `agent-sub${(i - 1) % 3}`
    const aTotal = a.cumulative.cacheRead + a.cumulative.cacheWrite + a.cumulative.inputRaw
    return `<tr>
      <td><span class="agent-tag ${tagCls}">${a.agentLabel}</span></td>
      <td style="color:#34d399;font-family:monospace">${fmt(a.cumulative.cacheRead)}</td>
      <td style="color:#fbbf24;font-family:monospace">${fmt(a.cumulative.cacheWrite)}</td>
      <td style="color:#f87171;font-family:monospace">${fmt(a.cumulative.inputRaw)}</td>
      <td style="color:#94a3b8;font-family:monospace">${fmt(a.cumulative.output)}</td>
      <td><span class="rate-pill ${a.cumulative.hitRate >= 65 ? "rate-high" : a.cumulative.hitRate >= 40 ? "rate-mid" : "rate-low"}">${a.cumulative.hitRate.toFixed(1)}%</span></td>
    </tr>`
  }).join("")

  return `
    <div class="chart-box">
      <div class="chart-title">Session token breakdown</div>
      ${hbar("Cache read (hits)",      t.cacheRead,  totalIn, "#34d399", "#064e3b")}
      ${hbar("Cache written (seeded)", t.cacheWrite, totalIn, "#fbbf24", "#451a03")}
      ${hbar("Raw input (uncached)",   t.inputRaw,   totalIn, "#f87171", "#450a0a")}
      <p style="font-size:12px;color:var(--subtext);margin-top:12px">
        Write/Read ratio: <strong>${writeReadRatio}</strong> &nbsp;·&nbsp;
        Reads per written token: <strong>${readsPerWrite}</strong>
      </p>
      <div class="annotation">Higher reads-per-write = more cache leverage. First session turn seeds the cache.</div>
    </div>
    <div class="chart-box">
      <div class="chart-title">Per-agent breakdown</div>
      <table class="data-table">
        <thead><tr><th>Agent</th><th>Read</th><th>Written</th><th>Raw in</th><th>Output</th><th>Hit rate</th></tr></thead>
        <tbody>${agentRows}</tbody>
      </table>
    </div>`
}
```

- [ ] **Step 8: Append Tab 5 — Cross-session Heatmap**

```js
// ── Tab 5: Heatmap ────────────────────────────────────────────────────────────
function renderHeatmap() {
  const summaries = data.global.dailySummaries
  const summaryMap = new Map(summaries.map(d => [d.date, d]))

  // Last 30 days
  const days = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }

  const cells = days.map(date => {
    const s = summaryMap.get(date)
    if (!s) return `<div class="hm-cell hm-none" title="${date}: no sessions"></div>`
    const cls = s.hitRate < 40 ? "hm-cold" : s.hitRate < 65 ? "hm-low" : s.hitRate < 80 ? "hm-mid" : "hm-high"
    return `<div class="hm-cell ${cls}" title="${date}: ${s.hitRate.toFixed(1)}% hit rate, ${s.sessionCount} session(s), ${s.turnCount} turns"></div>`
  }).join("")

  const tableRows = summaries.slice().reverse().map(s => {
    const rateCls = s.hitRate >= 65 ? "rate-high" : s.hitRate >= 40 ? "rate-mid" : "rate-low"
    return `<tr>
      <td>${s.date}</td>
      <td>${s.sessionCount}</td>
      <td>${s.turnCount}</td>
      <td><span class="rate-pill ${rateCls}">${s.hitRate.toFixed(1)}%</span></td>
    </tr>`
  }).join("")

  return `
    <div class="chart-box">
      <div class="chart-title">Activity heatmap — last 30 days</div>
      <div class="chart-hint">Hover for details. Color = avg daily hit rate.</div>
      <div class="heatmap-grid">${cells}</div>
      <div class="legend">
        <div class="legend-item"><div class="legend-dot hm-none" style="border:1px solid var(--border)"></div>No sessions</div>
        <div class="legend-item"><div class="legend-dot hm-low"></div>&lt;65%</div>
        <div class="legend-item"><div class="legend-dot hm-mid"></div>65–80%</div>
        <div class="legend-item"><div class="legend-dot hm-high"></div>&gt;80%</div>
        <div class="legend-item"><div class="legend-dot hm-cold"></div>&lt;40% (cold)</div>
      </div>
    </div>
    <div class="chart-box">
      <div class="chart-title">Daily summary</div>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Sessions</th><th>Turns</th><th>Avg hit rate</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`
}
```

- [ ] **Step 9: Append formatting utilities**

```js
// ── Utilities ─────────────────────────────────────────────────────────────────
function fmt(n) {
  return (n ?? 0).toLocaleString()
}

function fmtDate(iso) {
  if (!iso) return ""
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString())     return `Today ${d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`
  return d.toLocaleDateString([], {month:"short",day:"numeric"}) + " " + d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})
}
```

- [ ] **Step 10: Build and verify**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 11: Commit**

```bash
git add src/dashboard/ui/app.js
git commit -m "feat(dashboard): SPA app — 5 tabs, SSE live update, filters"
```

---

## Task 6: Wire UI files into dist and smoke-test end-to-end

**Files:**
- Modify: `tsup.config.ts`
- Modify: `package.json`

The UI files are static (not compiled), so they must be copied to `dist/dashboard/ui/` at build time.

- [ ] **Step 1: Check current tsup config**

```bash
cat tsup.config.ts
```

- [ ] **Step 2: Add a `postbuild` script to copy UI files**

In `package.json` scripts, add:

```json
"postbuild": "node -e \"const{cpSync}=require('fs');cpSync('src/dashboard/ui','dist/dashboard/ui',{recursive:true})\""
```

- [ ] **Step 3: Rebuild**

```bash
npm run build
```

Verify `dist/dashboard/ui/index.html`, `dist/dashboard/ui/app.js`, `dist/dashboard/ui/style.css` exist.

- [ ] **Step 4: End-to-end smoke test**

If `~/.config/opencode/cache-stats.jsonl` exists:

```bash
node bin/dashboard.js --no-open
```

Expected:
```
  Cache stats dashboard running at http://localhost:4321
  Watching ~/.config/opencode/cache-stats.jsonl
  Press Ctrl+C to stop.
```

Open `http://localhost:4321` in a browser. Verify:
- Page loads with dark theme
- Session list populates in sidebar
- KPI strip shows numbers
- All 5 tabs render without JS errors (check browser console)
- Time/agent filter pills respond to clicks

If no JSONL file exists yet, the dashboard should still load (empty state, no sessions).

- [ ] **Step 5: Test port conflict**

In a second terminal:

```bash
node bin/dashboard.js --no-open --port 4321
```

Expected (since 4321 is already in use):
```
  Port 4321 in use, trying 4322...
  Cache stats dashboard running at http://localhost:4322
  ...
```

Ctrl+C both servers.

- [ ] **Step 6: Commit**

```bash
git add tsup.config.ts package.json
git commit -m "feat(dashboard): copy UI files to dist on build"
```

---

## Task 7: Update README and bump version

**Files:**
- Modify: `README.md`
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Add dashboard section to README**

Add after the existing `## Stats file` section:

```markdown
## Live dashboard

Start a live web dashboard to explore your cache stats:

\`\`\`bash
npx opencode-cache-stats dashboard
\`\`\`

Opens `http://localhost:4321` in your browser automatically. The dashboard:

- **Live updates** as new turns are appended to the JSONL file
- **5 views:** Turn Timeline, Turn Deltas, Hit Rate Trend, Token Composition, Cross-session Heatmap
- **Per-turn deltas** — see how cache read/write/raw changed turn-over-turn and whether the cache is warming up
- **Filters** — narrow by time range (today / 7d / 30d) and agent type (main / subagents)

### Options

| Flag | Default | Description |
|---|---|---|
| `--port` | `4321` | Preferred port (auto-increments if in use) |
| `--file` | `~/.config/opencode/cache-stats.jsonl` | Path to JSONL |
| `--no-open` | — | Don't auto-open browser |

Stop with **Ctrl+C**.
```

- [ ] **Step 2: Bump version to 1.3.0 in `package.json` and `package-lock.json`**

(Bump from whatever version Plan A left it at — if Plan A ran first it will be 1.2.0, otherwise 1.1.3. Set to 1.3.0 in either case.)

- [ ] **Step 3: Commit**

```bash
git add README.md package.json package-lock.json
git commit -m "docs: add dashboard section to README; chore: bump version to 1.3.0"
```
