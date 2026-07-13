# Cache Hit Rate Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global opencode plugin that tracks LLM cache token usage per session, appends stats to a JSONL file, and displays a live cache hit rate widget in the TUI sidebar.

**Architecture:** Single TypeScript file at `~/.config/opencode/plugins/cache-hit-rate.ts` with a `server` export (opencode plugin hook, appends JSONL) and a `tui` export (TUI plugin, renders sidebar widget). The two halves are process-isolated and each accumulates state independently from `message.updated` events.

**Tech Stack:** TypeScript, Bun runtime, `@opencode-ai/plugin` ≥1.15, `@opencode-ai/sdk` ≥1.15, `@opentui/core` ^0.4, `@opentui/solid` ^0.4, `solid-js` ^1.9, Node.js `fs` built-in for JSONL append.

**Reference:** `~/.cache/opencode/packages/@rejacky/opencode-insights@latest/node_modules/@rejacky/opencode-insights/dist/` — working dual server+TUI plugin, slot registration, reactive text pattern.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `~/.config/opencode/package.json` | Modify | Add `@opencode-ai/plugin`, `@opentui/core`, `@opentui/solid`, `solid-js` deps |
| `~/.config/opencode/plugins/cache-hit-rate.ts` | Create | Full plugin: server hook + TUI sidebar widget |
| `~/.config/opencode/cache-stats.jsonl` | Created at runtime | Append-only JSONL stats log |

---

## Task 1: Install dependencies

**Files:**
- Modify: `~/.config/opencode/package.json`

- [ ] **Step 1: Update package.json with required deps**

Open `~/.config/opencode/package.json`. Replace the existing content with:

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "^1.17.18",
    "@opentui/core": "^0.4.3",
    "@opentui/solid": "^0.4.3",
    "oh-my-openagent": "^3.17.3",
    "oh-my-opencode": "^3.17.3",
    "solid-js": "^1.9.14",
    "superpowers": "github:obra/superpowers"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd ~/.config/opencode && npm install
```

Expected: `node_modules/@opencode-ai/plugin`, `node_modules/@opentui/core`, `node_modules/@opentui/solid`, `node_modules/solid-js` all present.

Verify:
```bash
ls ~/.config/opencode/node_modules/@opentui/core/package.json
ls ~/.config/opencode/node_modules/@opentui/solid/package.json
node -e "console.log(require('/Users/$(whoami)/.config/opencode/node_modules/@opencode-ai/plugin/package.json').version)"
```

Expected output: path exists, version is `1.17.x`.

- [ ] **Step 3: Commit**

```bash
cd ~/.config/opencode && git add package.json package-lock.json && git commit -m "deps: add opentui and upgrade opencode-ai/plugin for cache-hit-rate plugin"
```

---

## Task 2: Create the server-side plugin half

**Files:**
- Create: `~/.config/opencode/plugins/cache-hit-rate.ts`

The server half listens to the `event` hook, filters for completed `AssistantMessage` events (`type === "message.updated"` with `info.role === "assistant"` and `info.time.completed` set), accumulates per-session stats in memory, and appends a JSONL record to `~/.config/opencode/cache-stats.jsonl`.

- [ ] **Step 1: Create the plugin file with the server export**

Create `~/.config/opencode/plugins/cache-hit-rate.ts` with this content:

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// ── Types ──────────────────────────────────────────────────────────────────

type SessionStats = {
  cacheRead:  number
  cacheWrite: number
  inputRaw:   number
  output:     number
  turnCount:  number
  providerID: string
  modelID:    string
}

type JsonlRecord = {
  ts:         string
  sessionID:  string
  providerID: string
  modelID:    string
  turn:       number
  cacheRead:  number
  cacheWrite: number
  inputRaw:   number
  output:     number
  totalInput: number
  hitRate:    number
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STATS_FILE = join(homedir(), ".config", "opencode", "cache-stats.jsonl")

function computeHitRate(cacheRead: number, totalInput: number): number {
  if (totalInput <= 0) return 0
  return Math.round((cacheRead / totalInput) * 1000) / 10  // one decimal place
}

function appendJsonl(record: JsonlRecord): void {
  try {
    mkdirSync(join(homedir(), ".config", "opencode"), { recursive: true })
    appendFileSync(STATS_FILE, JSON.stringify(record) + "\n", "utf8")
  } catch {
    // never crash opencode over stats logging
  }
}

// ── Server export ──────────────────────────────────────────────────────────

export const server: Plugin = async (_input) => {
  const sessionStats = new Map<string, SessionStats>()

  return {
    event: async ({ event }) => {
      if (event.type !== "message.updated") return

      const info = (event.properties as any)?.info
      if (!info || info.role !== "assistant") return
      if (!info.time?.completed) return

      const sessionID: string = info.sessionID ?? ""
      if (!sessionID) return

      const cacheRead:  number = info.tokens?.cache?.read  ?? 0
      const cacheWrite: number = info.tokens?.cache?.write ?? 0
      const inputRaw:   number = info.tokens?.input        ?? 0
      const output:     number = info.tokens?.output       ?? 0
      const providerID: string = info.providerID ?? "unknown"
      const modelID:    string = info.modelID    ?? "unknown"

      const prev = sessionStats.get(sessionID) ?? {
        cacheRead: 0, cacheWrite: 0, inputRaw: 0, output: 0,
        turnCount: 0, providerID, modelID,
      }

      const next: SessionStats = {
        cacheRead:  prev.cacheRead  + cacheRead,
        cacheWrite: prev.cacheWrite + cacheWrite,
        inputRaw:   prev.inputRaw   + inputRaw,
        output:     prev.output     + output,
        turnCount:  prev.turnCount  + 1,
        providerID,
        modelID,
      }
      sessionStats.set(sessionID, next)

      const totalInput = cacheRead + cacheWrite + inputRaw

      const record: JsonlRecord = {
        ts:         new Date().toISOString(),
        sessionID,
        providerID,
        modelID,
        turn:       next.turnCount,
        cacheRead,
        cacheWrite,
        inputRaw,
        output,
        totalInput,
        hitRate:    computeHitRate(cacheRead, totalInput),
      }

      appendJsonl(record)
    },
  }
}

// ── TUI export (stub for now — filled in Task 3) ───────────────────────────

export const tui: TuiPlugin = async (_api) => {
  // Task 3 fills this in
}

// ── Default export required by opencode plugin loader ─────────────────────

export default { server, tui }
```

- [ ] **Step 2: Verify TypeScript compiles without errors**

```bash
cd ~/.config/opencode && npx tsc --noEmit --strict --target ES2022 --moduleResolution bundler --module ESNext plugins/cache-hit-rate.ts 2>&1 | head -30
```

Expected: no output (no errors). If type errors appear on the `event.properties` cast, that is expected because the SDK's `Event` union type requires narrowing — the `as any` cast is intentional for now.

- [ ] **Step 3: Commit**

```bash
cd ~/.config/opencode && git add plugins/cache-hit-rate.ts && git commit -m "feat: cache-hit-rate plugin - server side JSONL appender"
```

---

## Task 3: Add the TUI sidebar widget

**Files:**
- Modify: `~/.config/opencode/plugins/cache-hit-rate.ts`

The TUI half subscribes to `message.updated` via `api.event.on`, maintains a `Map<sessionID, SessionStats>` signal updated in place, and registers a `sidebar_content` slot that renders a compact stats block. It uses the same reactive-text pattern as `@rejacky/opencode-insights`: a `subscribe`/`bump` listener set, and a `ReactiveText`-style component that calls `requestRender()` on each update.

- [ ] **Step 1: Replace the TUI stub with the full implementation**

Replace the entire `~/.config/opencode/plugins/cache-hit-rate.ts` file with:

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// ── Types ──────────────────────────────────────────────────────────────────

type SessionStats = {
  cacheRead:  number
  cacheWrite: number
  inputRaw:   number
  output:     number
  turnCount:  number
  providerID: string
  modelID:    string
}

type JsonlRecord = {
  ts:         string
  sessionID:  string
  providerID: string
  modelID:    string
  turn:       number
  cacheRead:  number
  cacheWrite: number
  inputRaw:   number
  output:     number
  totalInput: number
  hitRate:    number
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STATS_FILE = join(homedir(), ".config", "opencode", "cache-stats.jsonl")

function computeHitRate(cacheRead: number, totalInput: number): number {
  if (totalInput <= 0) return 0
  return Math.round((cacheRead / totalInput) * 1000) / 10
}

function appendJsonl(record: JsonlRecord): void {
  try {
    mkdirSync(join(homedir(), ".config", "opencode"), { recursive: true })
    appendFileSync(STATS_FILE, JSON.stringify(record) + "\n", "utf8")
  } catch {
    // never crash opencode over stats logging
  }
}

function fmt(n: number): string {
  return n.toLocaleString()
}

function renderCacheStats(stats: SessionStats | undefined): string {
  if (!stats) return ""

  const totalInput = stats.cacheRead + stats.cacheWrite + stats.inputRaw
  const hasCacheData = totalInput > 0

  const sep = "── Cache " + "─".repeat(20)

  if (!hasCacheData) {
    return [
      sep,
      `  No cache data (turn ${stats.turnCount})`,
      `  (provider may not report cache tokens)`,
    ].join("\n")
  }

  const hitRate = computeHitRate(stats.cacheRead, totalInput)

  const lines = [
    sep,
    `  Hit rate:  ${hitRate.toFixed(1)}%`,
    `  Read:      ${fmt(stats.cacheRead)} tok`,
  ]

  if (stats.cacheWrite > 0) {
    lines.push(`  Written:   ${fmt(stats.cacheWrite)} tok`)
  }

  lines.push(
    `  Raw input: ${fmt(stats.inputRaw)} tok`,
    `  Output:    ${fmt(stats.output)} tok`,
    `  Turns:     ${stats.turnCount}`,
  )

  return lines.join("\n")
}

// ── Server export ──────────────────────────────────────────────────────────

export const server: Plugin = async (_input) => {
  const sessionStats = new Map<string, SessionStats>()

  return {
    event: async ({ event }) => {
      if (event.type !== "message.updated") return

      const info = (event.properties as any)?.info
      if (!info || info.role !== "assistant") return
      if (!info.time?.completed) return

      const sessionID: string = info.sessionID ?? ""
      if (!sessionID) return

      const cacheRead:  number = info.tokens?.cache?.read  ?? 0
      const cacheWrite: number = info.tokens?.cache?.write ?? 0
      const inputRaw:   number = info.tokens?.input        ?? 0
      const output:     number = info.tokens?.output       ?? 0
      const providerID: string = info.providerID ?? "unknown"
      const modelID:    string = info.modelID    ?? "unknown"

      const prev = sessionStats.get(sessionID) ?? {
        cacheRead: 0, cacheWrite: 0, inputRaw: 0, output: 0,
        turnCount: 0, providerID, modelID,
      }

      const next: SessionStats = {
        cacheRead:  prev.cacheRead  + cacheRead,
        cacheWrite: prev.cacheWrite + cacheWrite,
        inputRaw:   prev.inputRaw   + inputRaw,
        output:     prev.output     + output,
        turnCount:  prev.turnCount  + 1,
        providerID,
        modelID,
      }
      sessionStats.set(sessionID, next)

      const totalInput = cacheRead + cacheWrite + inputRaw

      appendJsonl({
        ts:         new Date().toISOString(),
        sessionID,
        providerID,
        modelID,
        turn:       next.turnCount,
        cacheRead,
        cacheWrite,
        inputRaw,
        output,
        totalInput,
        hitRate:    computeHitRate(cacheRead, totalInput),
      })
    },
  }
}

// ── TUI export ─────────────────────────────────────────────────────────────

export const tui: TuiPlugin = async (api) => {
  // Per-session cumulative stats (TUI process — independent from server process)
  const sessionStats = new Map<string, SessionStats>()

  // Subscriber pattern: components call subscribe(fn) and get called on each bump()
  const listeners = new Set<() => void>()
  const bump = () => { for (const fn of listeners) fn() }
  const subscribe = (fn: () => void) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  // Listen to message.updated events in the TUI event bus
  const offMessage = api.event.on("message.updated", (evt) => {
    const info = (evt.properties as any)?.info
    if (!info || info.role !== "assistant") return
    if (!info.time?.completed) return

    const sessionID: string = info.sessionID ?? ""
    if (!sessionID) return

    const cacheRead:  number = info.tokens?.cache?.read  ?? 0
    const cacheWrite: number = info.tokens?.cache?.write ?? 0
    const inputRaw:   number = info.tokens?.input        ?? 0
    const output:     number = info.tokens?.output       ?? 0
    const providerID: string = info.providerID ?? "unknown"
    const modelID:    string = info.modelID    ?? "unknown"

    const prev = sessionStats.get(sessionID) ?? {
      cacheRead: 0, cacheWrite: 0, inputRaw: 0, output: 0,
      turnCount: 0, providerID, modelID,
    }

    sessionStats.set(sessionID, {
      cacheRead:  prev.cacheRead  + cacheRead,
      cacheWrite: prev.cacheWrite + cacheWrite,
      inputRaw:   prev.inputRaw   + inputRaw,
      output:     prev.output     + output,
      turnCount:  prev.turnCount  + 1,
      providerID,
      modelID,
    })

    bump()
  })

  // Sidebar widget component (reactive text, no JSX needed — plain imperative update)
  function CacheWidget(props: { sessionID: string }) {
    // Dynamically import JSX runtime to stay compatible with opencode's Bun bundle
    return (api as any).ui?.Slot
      ? renderSlotJSX(props.sessionID)
      : null
  }

  function renderSlotJSX(sessionID: string) {
    // We use the low-level opentui text node pattern (same as opencode-insights)
    // to avoid needing a JSX transform in a plain .ts file.
    // The slot callback receives (_ctx, props) and returns a JSX element via
    // the JSX runtime already loaded by opencode's TUI process.
    return null  // replaced below in slots.register
  }

  // Register sidebar_content slot using the opentui JSX runtime
  // We import dynamically so the plugin degrades gracefully if opentui is unavailable
  let offSlots: (() => void) | undefined

  try {
    const { jsx }      = await import("@opentui/solid/jsx-runtime")
    const { onCleanup } = await import("solid-js")

    // Reactive text component: subscribes to bump(), updates text node content
    function CacheStatsText(props: {
      sessionID: string
      api: typeof api
      subscribe: typeof subscribe
    }) {
      let textNode: any

      const sync = () => {
        if (!textNode) return
        const stats  = sessionStats.get(props.sessionID)
        const content = renderCacheStats(stats)
        textNode.content = content
        textNode.visible = content.length > 0
        textNode.height  = content.length > 0 ? "auto" : 0
        props.api.renderer.requestRender()
      }

      const unsub = props.subscribe(sync)
      onCleanup(unsub)

      return jsx("text", {
        ref: (ref: any) => { textNode = ref; sync() },
        fg: props.api.theme.current.textMuted,
        children: renderCacheStats(sessionStats.get(props.sessionID)) ?? "",
      })
    }

    const registration = api.slots.register({
      slots: {
        sidebar_content: (_ctx: any, slotProps: any) => {
          const sessionID: string = slotProps.session_id ?? ""
          return jsx(CacheStatsText, {
            sessionID,
            api,
            subscribe,
          })
        },
      },
    })

    offSlots = () => registration  // slots.register returns an unregister fn
  } catch {
    // @opentui not available — TUI widget silently disabled, server side still works
  }

  api.lifecycle.onDispose(() => {
    offMessage()
    offSlots?.()
  })
}

// ── Default export ─────────────────────────────────────────────────────────

export default { server, tui }
```

- [ ] **Step 2: Check TypeScript compiles**

```bash
cd ~/.config/opencode && npx tsc --noEmit --strict --target ES2022 --moduleResolution bundler --module ESNext --jsx preserve --jsxImportSource solid-js plugins/cache-hit-rate.ts 2>&1 | head -40
```

Expected: zero errors, or only errors on `@opentui/solid/jsx-runtime` (acceptable — those types resolve at opencode runtime, not at local tsc time). Any errors on `SessionStats`, `JsonlRecord`, `computeHitRate`, or `renderCacheStats` must be fixed before continuing.

- [ ] **Step 3: Commit**

```bash
cd ~/.config/opencode && git add plugins/cache-hit-rate.ts && git commit -m "feat: cache-hit-rate plugin - TUI sidebar widget"
```

---

## Task 4: Smoke test end-to-end

No automated test harness exists for opencode plugins. Verification is manual.

- [ ] **Step 1: Restart opencode**

Quit opencode completely and relaunch it. The plugin is loaded once at startup.

- [ ] **Step 2: Send a message and wait for a response**

In any session, send a short message (e.g. "say hello") and wait for the assistant to finish responding.

- [ ] **Step 3: Check the sidebar**

Look at the right-column sidebar. After the first completed turn you should see:

```
── Cache ─────────────────────
  Hit rate:   X.X%
  Read:       X,XXX tok
  Raw input:  XXX tok
  Output:     XXX tok
  Turns:      1
```

If the model/provider doesn't surface cache tokens (e.g. Cohere), you should see:

```
── Cache ─────────────────────
  No cache data (turn 1)
  (provider may not report cache tokens)
```

- [ ] **Step 4: Check the JSONL file**

```bash
tail -3 ~/.config/opencode/cache-stats.jsonl
```

Expected: one JSON object per completed turn, e.g.:

```json
{"ts":"2026-07-13T...","sessionID":"ses_...","providerID":"anthropic","modelID":"claude-sonnet-4-6","turn":1,"cacheRead":1240,"cacheWrite":512,"inputRaw":308,"output":180,"totalInput":2060,"hitRate":60.2}
```

- [ ] **Step 5: Send a second message and verify cumulative stats update**

Send another message. The sidebar `Hit rate`, `Read`, `Raw input`, `Output`, and `Turns` values should all update to reflect the cumulative session totals.

- [ ] **Step 6: Commit any fixes found during smoke test**

```bash
cd ~/.config/opencode && git add plugins/cache-hit-rate.ts && git commit -m "fix: cache-hit-rate smoke test fixes"
```

(Skip this step if no fixes were needed.)

---

## Task 5: Fix `slots.register` unregister handle

The `slots.register` call in Task 3 returns an unregister function, but the current code assigns the return value incorrectly. Fix it.

- [ ] **Step 1: Fix the offSlots assignment**

In `~/.config/opencode/plugins/cache-hit-rate.ts`, find this line inside the `try` block:

```typescript
    offSlots = () => registration  // slots.register returns an unregister fn
```

Replace it with:

```typescript
    offSlots = typeof registration === "function" ? registration : undefined
```

- [ ] **Step 2: Verify and commit**

```bash
cd ~/.config/opencode && git add plugins/cache-hit-rate.ts && git commit -m "fix: correctly store slots unregister handle"
```

---

## Known limitations / follow-up

- The `slots.register` return type in `@opencode-ai/plugin/tui` is `string` (an ID), not a cleanup function. The `onDispose` handler for slots is therefore a no-op — slots live for the TUI session lifetime regardless. This is acceptable; the pattern matches how `@rejacky/opencode-insights` handles it.
- `cacheWrite` is only shown when > 0, since most providers (OpenAI, Google, Groq, xAI, Mistral) do not report it.
- No cross-session history view — the JSONL file is the audit trail; a future plan can add a command to query it.
