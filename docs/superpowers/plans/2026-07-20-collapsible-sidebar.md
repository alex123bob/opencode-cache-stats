# Collapsible TUI Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-collapse finished agent sections in the TUI sidebar, with click-to-toggle on any header line.

**Architecture:** Add `collapsed: boolean` to `AgentEntry` in `shared.ts`. Refactor `tui.ts` to render one clickable `<box>` per agent instead of a single flat `<text>` node, so click events can be scoped per agent. `markIdle` auto-collapses on idle. A `toggleCollapse` function handles manual toggle.

**Tech Stack:** TypeScript, `@opentui/solid` (JSX TUI renderer), `solid-js` reactivity

---

## File Map

| File | Change |
|---|---|
| `src/shared.ts` | Add `collapsed: boolean` to `AgentEntry`; update `renderAgentSection` to accept `collapsed` and render header-only when true; add `▶`/`▼` prefix logic |
| `src/tui.ts` | Replace single `<text>` node with per-agent `<box>` + clickable header nodes; add `toggleCollapse`; update `markIdle` to set `collapsed: true` |

---

## Task 1: Add `collapsed` field to `AgentEntry` and update `renderAgentSection`

**Files:**
- Modify: `src/shared.ts`

- [ ] **Step 1: Add `collapsed` to `AgentEntry` type**

In `src/shared.ts`, update the `AgentEntry` type:

```ts
export type AgentEntry = {
  sessionID:  string
  parentID:   string | null
  label:      string
  isActive:   boolean
  collapsed:  boolean        // true = show header only
  lastActive: number
  stats:      SessionStats
}
```

- [ ] **Step 2: Update `renderAgentSection` to respect `collapsed`**

Replace the existing `renderAgentSection` function:

```ts
/**
 * Renders one agent's stats block.
 * When collapsed=true, renders only the header line.
 */
export function renderAgentSection(agent: AgentEntry): string {
  const arrow       = agent.collapsed ? "▶" : "▼"
  const statusLabel = agent.isActive ? "(active)" : "[done]"
  const headerLabel = `${agent.label} ${statusLabel}`
  // Fill trailing dashes so total line width stays ~33 chars (min 2 dashes)
  const sep = `${arrow} ${headerLabel} ` + "─".repeat(Math.max(2, 27 - headerLabel.length))

  if (agent.collapsed) return sep

  const { stats } = agent
  const totalInput = stats.cacheRead + stats.cacheWrite + stats.inputRaw

  if (totalInput <= 0) {
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
```

- [ ] **Step 3: Update `renderAllAgents` — no change needed, it calls `renderAgentSection` per agent already**

Verify `renderAllAgents` still compiles correctly — it maps over agents and calls `renderAgentSection(a)`. No changes required.

- [ ] **Step 4: Fix all call sites that construct `AgentEntry` to include `collapsed: false`**

In `src/tui.ts`, the "first sight" branch constructs a new `AgentEntry`. Update it to include `collapsed: false`:

```ts
agents.set(sessionID, {
  sessionID,
  parentID,
  label,
  isActive:   true,
  collapsed:  false,
  lastActive: Date.now(),
  stats:      accumulateStats(undefined, tokens),
})
```

The "update existing" branch uses `{ ...prev, ... }` spread, which carries `collapsed` forward automatically — no change needed there.

- [ ] **Step 5: Build to verify no type errors**

```bash
npm run build
```

Expected: clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared.ts src/tui.ts
git commit -m "feat: add collapsed field to AgentEntry, update renderAgentSection"
```

---

## Task 2: Refactor TUI widget to per-agent clickable nodes

**Files:**
- Modify: `src/tui.ts`

- [ ] **Step 1: Add `toggleCollapse` function**

In the `tui` plugin function body (before the `api.slots.register` call), add:

```ts
const toggleCollapse = (sessionID: string) => {
  const entry = agents.get(sessionID)
  if (!entry) return
  agents.set(sessionID, { ...entry, collapsed: !entry.collapsed })
  bump()
}
```

- [ ] **Step 2: Update `markIdle` to auto-collapse**

Replace the existing `markIdle`:

```ts
const markIdle = (sessionID: string) => {
  const entry = agents.get(sessionID)
  if (!entry) return
  agents.set(sessionID, { ...entry, isActive: false, collapsed: true })
  bump()
}
```

- [ ] **Step 3: Refactor `CacheStatsWidget` to render per-agent clickable boxes**

Replace the entire `CacheStatsWidget` component:

```ts
function CacheStatsWidget(props: Record<string, unknown>) {
  const api        = props.api as Parameters<TuiPlugin>[0]
  const subscribe  = props.subscribe as (fn: () => void) => () => void
  const getAgents  = props.getAgents as () => AgentEntry[]
  const onToggle   = props.onToggle as (sessionID: string) => void
  let containerRef: any

  const sync = () => {
    if (!containerRef) return
    const agents = getAgents()

    // Remove old children
    containerRef.children = []

    if (agents.length === 0) {
      containerRef.visible = false
      containerRef.height  = 0
      api.renderer.requestRender()
      return
    }

    containerRef.visible = true
    containerRef.height  = "auto"

    const active   = agents.filter(a => a.isActive).sort((a, b) => b.lastActive - a.lastActive)
    const finished = agents.filter(a => !a.isActive).sort((a, b) => b.lastActive - a.lastActive)

    for (const agent of [...active, ...finished]) {
      const content = renderAgentSection(agent)
      const node = jsx("text", {
        fg:       api.theme.current.textMuted,
        children: content,
        onClick:  () => onToggle(agent.sessionID),
      })
      containerRef.children.push(node)
    }

    api.renderer.requestRender()
  }

  onCleanup(subscribe(sync))

  return jsx("box", {
    ref:    (ref: any) => { containerRef = ref; sync() },
    layout: "vertical",
  })
}
```

- [ ] **Step 4: Pass `onToggle` into the widget from `api.slots.register`**

Update the slot registration:

```ts
api.slots.register({
  slots: {
    sidebar_content: (_ctx, _slotProps) =>
      jsx(CacheStatsWidget, {
        api,
        subscribe,
        getAgents,
        onToggle: toggleCollapse,
      }),
  },
})
```

- [ ] **Step 5: Build to verify**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 6: Smoke-test manually**

Start opencode, send a few messages, verify:
- Active agents show `▼` and full stats
- After 30 s idle, agent collapses to `▶ Agent [done]` header only
- Clicking the header expands it again showing full stats
- Clicking again collapses it

- [ ] **Step 7: Commit**

```bash
git add src/tui.ts
git commit -m "feat: per-agent clickable collapse in TUI sidebar"
```

---

## Task 3: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add collapsibility note to README**

After the sidebar example block, add:

```markdown
## Sidebar behaviour

Active agents show full stats. When an agent finishes (no response for 30 s) its section
collapses to a single header line. Click any header to expand or collapse it manually.

\`\`\`
▼ Main Agent (active) ────────
  Hit rate:  68.9%
  Read:      1,240 tok
  Turns:         3
▶ Subagent 1 [done] ──────────   ← click to expand
▶ Subagent 2 [done] ──────────
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document collapsible sidebar behaviour"
```

---

## Task 4: Bump version

- [ ] **Step 1: Bump to 1.2.0**

In `package.json` and `package-lock.json`, update `"version"` from `"1.1.3"` to `"1.2.0"`.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 1.2.0"
```
