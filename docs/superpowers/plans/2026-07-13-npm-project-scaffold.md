# opencode-cache-stats npm project scaffold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a fully scaffolded, publishable npm package `opencode-cache-stats` at `~/personal_github_repos/opencode-cache-stats/`, with source split across `src/shared.ts`, `src/index.ts`, and `src/tui.ts`, config files, README, LICENSE, and the existing specs/plans docs moved in.

**Architecture:** Single repo, `tsup`-built ESM package. `src/shared.ts` holds types and pure functions; `src/index.ts` exports the server Plugin; `src/tui.ts` exports the TuiPlugin. `package.json` exposes both via `exports` map. All peer deps (opentui, solid-js, opencode-ai/plugin) are external — not bundled.

**Tech Stack:** TypeScript 5.8, tsup 8.5, Node ≥22.13, npm publish to npmjs.org.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `~/personal_github_repos/opencode-cache-stats/` | Create dir | Project root |
| `src/shared.ts` | Create | `SessionStats`, `JsonlRecord`, `computeHitRate()`, `renderCacheStats()`, `STATS_FILE`, `appendJsonl()` |
| `src/index.ts` | Create | Server `Plugin` export; lazy TUI loader; default export |
| `src/tui.ts` | Create | `TuiPlugin` export; sidebar_content slot; reactive widget |
| `package.json` | Create | npm metadata, scripts, peer/dev deps, exports map |
| `tsconfig.json` | Create | TS compiler options |
| `tsup.config.ts` | Create | Build config: two entry points, ESM, dts, external deps |
| `.gitignore` | Create | Ignore node_modules, dist, tsbuildinfo |
| `.npmignore` | Create | Keep src/, docs/, config out of npm tarball |
| `README.md` | Create | Install instructions, config snippet, provider table |
| `LICENSE` | Create | MIT license text |
| `docs/superpowers/specs/2026-07-13-cache-hit-rate-plugin-design.md` | Move from `~/.config/opencode/docs/superpowers/specs/` | Plugin design spec |
| `docs/superpowers/specs/2026-07-13-npm-project-scaffold-design.md` | Move from `~/.config/opencode/docs/superpowers/specs/` | Scaffold design spec |
| `docs/superpowers/plans/2026-07-13-cache-hit-rate-plugin.md` | Move from `~/.config/opencode/docs/superpowers/plans/` | Plugin implementation plan |
| `docs/superpowers/plans/2026-07-13-npm-project-scaffold.md` | This file, copied here after writing | Scaffold implementation plan |

---

## Task 1: Create repo, config files, and git init

**Files:**
- Create: `~/personal_github_repos/opencode-cache-stats/package.json`
- Create: `~/personal_github_repos/opencode-cache-stats/tsconfig.json`
- Create: `~/personal_github_repos/opencode-cache-stats/tsup.config.ts`
- Create: `~/personal_github_repos/opencode-cache-stats/.gitignore`
- Create: `~/personal_github_repos/opencode-cache-stats/.npmignore`
- Create: `~/personal_github_repos/opencode-cache-stats/LICENSE`

- [ ] **Step 1: Create the project directory**

```bash
mkdir -p ~/personal_github_repos/opencode-cache-stats/src
mkdir -p ~/personal_github_repos/opencode-cache-stats/docs/superpowers/specs
mkdir -p ~/personal_github_repos/opencode-cache-stats/docs/superpowers/plans
```

Expected: directories exist with no error.

- [ ] **Step 2: Create package.json**

Create `~/personal_github_repos/opencode-cache-stats/package.json`:

```json
{
  "$schema": "https://json.schemastore.org/package.json",
  "name": "opencode-cache-stats",
  "version": "0.1.0",
  "description": "opencode plugin — live cache hit rate widget in the TUI sidebar + per-session JSONL stats log",
  "type": "module",
  "author": "Alexander Li",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/jiali_mstr/opencode-cache-stats.git"
  },
  "homepage": "https://github.com/jiali_mstr/opencode-cache-stats#readme",
  "bugs": {
    "url": "https://github.com/jiali_mstr/opencode-cache-stats/issues"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    },
    "./tui": {
      "types": "./dist/tui.d.ts",
      "import": "./dist/tui.js",
      "default": "./dist/tui.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "keywords": ["opencode", "plugin", "cache", "llm", "tui", "cache-hit-rate"],
  "engines": { "node": ">=22.13" },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run typecheck && npm run build"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": ">=1.15.0 <2",
    "@opentui/core": ">=0.4.0 <0.5",
    "@opentui/solid": ">=0.4.0 <0.5",
    "solid-js": "1.9.x"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^1.17.18",
    "@opentui/core": "^0.4.3",
    "@opentui/solid": "^0.4.3",
    "@types/node": "^24.0.0",
    "solid-js": "^1.9.14",
    "tsup": "^8.5.1",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `~/personal_github_repos/opencode-cache-stats/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "jsx": "preserve",
    "jsxImportSource": "solid-js"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create tsup.config.ts**

Create `~/personal_github_repos/opencode-cache-stats/tsup.config.ts`:

```typescript
import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    tui:   "src/tui.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  external: [
    "@opencode-ai/plugin",
    "@opencode-ai/sdk",
    "@opentui/core",
    "@opentui/solid",
    "solid-js",
  ],
  treeshake: true,
})
```

- [ ] **Step 5: Create .gitignore**

Create `~/personal_github_repos/opencode-cache-stats/.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 6: Create .npmignore**

Create `~/personal_github_repos/opencode-cache-stats/.npmignore`:

```
src/
docs/
tsup.config.ts
tsconfig.json
*.tsbuildinfo
.gitignore
.npmignore
```

- [ ] **Step 7: Create LICENSE**

Create `~/personal_github_repos/opencode-cache-stats/LICENSE`:

```
MIT License

Copyright (c) 2026 Alexander Li

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 8: Git init and first commit**

```bash
cd ~/personal_github_repos/opencode-cache-stats
git init
git add package.json tsconfig.json tsup.config.ts .gitignore .npmignore LICENSE
git commit -m "chore: initial project scaffold"
```

Expected: `[main (root-commit) xxxxxxx] chore: initial project scaffold`

---

## Task 2: Write src/shared.ts

**Files:**
- Create: `~/personal_github_repos/opencode-cache-stats/src/shared.ts`

- [ ] **Step 1: Create src/shared.ts**

Create `~/personal_github_repos/opencode-cache-stats/src/shared.ts`:

```typescript
import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// ── Types ──────────────────────────────────────────────────────────────────

export type SessionStats = {
  cacheRead:  number
  cacheWrite: number
  inputRaw:   number
  output:     number
  turnCount:  number
  providerID: string
  modelID:    string
}

export type JsonlRecord = {
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

// ── Constants ──────────────────────────────────────────────────────────────

export const STATS_FILE = join(homedir(), ".config", "opencode", "cache-stats.jsonl")

// ── Pure helpers ───────────────────────────────────────────────────────────

/** Returns hit rate as a number with one decimal place (e.g. 68.9). */
export function computeHitRate(cacheRead: number, totalInput: number): number {
  if (totalInput <= 0) return 0
  return Math.round((cacheRead / totalInput) * 1000) / 10
}

/** Formats a number with locale-appropriate thousands separators. */
export function fmt(n: number): string {
  return n.toLocaleString()
}

/**
 * Renders the sidebar text block for a session.
 * Returns an empty string when stats is undefined (widget hidden).
 */
export function renderCacheStats(stats: SessionStats | undefined): string {
  if (!stats) return ""

  const totalInput = stats.cacheRead + stats.cacheWrite + stats.inputRaw
  const sep = "── Cache " + "─".repeat(20)

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

/** Appends one JSON line to the stats file. Never throws. */
export function appendJsonl(record: JsonlRecord): void {
  try {
    mkdirSync(join(homedir(), ".config", "opencode"), { recursive: true })
    appendFileSync(STATS_FILE, JSON.stringify(record) + "\n", "utf8")
  } catch {
    // never crash opencode over stats logging
  }
}

/** Extracts and accumulates cache token fields from a completed AssistantMessage info object. */
export function extractTokens(info: any): {
  cacheRead: number
  cacheWrite: number
  inputRaw: number
  output: number
  providerID: string
  modelID: string
} {
  return {
    cacheRead:  info?.tokens?.cache?.read  ?? 0,
    cacheWrite: info?.tokens?.cache?.write ?? 0,
    inputRaw:   info?.tokens?.input        ?? 0,
    output:     info?.tokens?.output       ?? 0,
    providerID: info?.providerID ?? "unknown",
    modelID:    info?.modelID    ?? "unknown",
  }
}

/** Returns true when an event is a completed AssistantMessage. */
export function isCompletedAssistant(event: any): boolean {
  if (event?.type !== "message.updated") return false
  const info = event?.properties?.info
  return info?.role === "assistant" && !!info?.time?.completed && !!info?.sessionID
}

/** Merges one turn's tokens into existing session stats. */
export function accumulateStats(
  prev: SessionStats | undefined,
  tokens: ReturnType<typeof extractTokens>,
): SessionStats {
  const base = prev ?? {
    cacheRead: 0, cacheWrite: 0, inputRaw: 0, output: 0,
    turnCount: 0, providerID: tokens.providerID, modelID: tokens.modelID,
  }
  return {
    cacheRead:  base.cacheRead  + tokens.cacheRead,
    cacheWrite: base.cacheWrite + tokens.cacheWrite,
    inputRaw:   base.inputRaw   + tokens.inputRaw,
    output:     base.output     + tokens.output,
    turnCount:  base.turnCount  + 1,
    providerID: tokens.providerID,
    modelID:    tokens.modelID,
  }
}
```

- [ ] **Step 2: Verify shared.ts compiles**

```bash
cd ~/personal_github_repos/opencode-cache-stats
npm install
npx tsc --noEmit 2>&1
```

Expected: clean output (no errors). `node_modules/` is now populated.

- [ ] **Step 3: Commit**

```bash
cd ~/personal_github_repos/opencode-cache-stats
git add src/shared.ts package-lock.json node_modules/.package-lock.json
git commit -m "feat: shared types and helpers"
```

---

## Task 3: Write src/index.ts (server half)

**Files:**
- Create: `~/personal_github_repos/opencode-cache-stats/src/index.ts`

- [ ] **Step 1: Create src/index.ts**

Create `~/personal_github_repos/opencode-cache-stats/src/index.ts`:

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import {
  type SessionStats,
  type JsonlRecord,
  computeHitRate,
  appendJsonl,
  extractTokens,
  isCompletedAssistant,
  accumulateStats,
} from "./shared.js"

// ── Server export ──────────────────────────────────────────────────────────

export const server: Plugin = async (_input) => {
  const sessionStats = new Map<string, SessionStats>()

  return {
    event: async ({ event }) => {
      if (!isCompletedAssistant(event)) return

      const info      = (event.properties as any).info
      const sessionID = info.sessionID as string
      const tokens    = extractTokens(info)
      const next      = accumulateStats(sessionStats.get(sessionID), tokens)

      sessionStats.set(sessionID, next)

      const totalInput = tokens.cacheRead + tokens.cacheWrite + tokens.inputRaw

      const record: JsonlRecord = {
        ts:         new Date().toISOString(),
        sessionID,
        providerID: tokens.providerID,
        modelID:    tokens.modelID,
        turn:       next.turnCount,
        cacheRead:  tokens.cacheRead,
        cacheWrite: tokens.cacheWrite,
        inputRaw:   tokens.inputRaw,
        output:     tokens.output,
        totalInput,
        hitRate:    computeHitRate(tokens.cacheRead, totalInput),
      }

      appendJsonl(record)
    },
  }
}

// ── TUI lazy loader ────────────────────────────────────────────────────────
// Loaded only by the TUI process; keeps server bundle free of opentui deps.

export const tui: TuiPlugin = async (...args) => {
  const mod = await import("./tui.js")
  return mod.tui(...args)
}

// ── Plugin metadata ────────────────────────────────────────────────────────

export const id = "opencode-cache-stats"

export default { id, server, tui }
```

- [ ] **Step 2: Verify compiles**

```bash
cd ~/personal_github_repos/opencode-cache-stats && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/personal_github_repos/opencode-cache-stats
git add src/index.ts
git commit -m "feat: server plugin half (event hook + JSONL appender)"
```

---

## Task 4: Write src/tui.ts (TUI half)

**Files:**
- Create: `~/personal_github_repos/opencode-cache-stats/src/tui.ts`

- [ ] **Step 1: Create src/tui.ts**

Create `~/personal_github_repos/opencode-cache-stats/src/tui.ts`:

```typescript
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import {
  type SessionStats,
  renderCacheStats,
  extractTokens,
  isCompletedAssistant,
  accumulateStats,
} from "./shared.js"

export const tui: TuiPlugin = async (api) => {
  // Per-session cumulative stats — TUI process accumulates independently from server process
  const sessionStats = new Map<string, SessionStats>()

  // Subscriber pattern: sidebar component subscribes, bump() notifies on each update
  const listeners = new Set<() => void>()
  const bump      = () => { for (const fn of listeners) fn() }
  const subscribe = (fn: () => void): (() => void) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  // Accumulate stats from message.updated events
  const offMessage = api.event.on("message.updated", (evt) => {
    if (!isCompletedAssistant(evt)) return

    const info      = (evt.properties as any).info
    const sessionID = info.sessionID as string
    const tokens    = extractTokens(info)

    sessionStats.set(sessionID, accumulateStats(sessionStats.get(sessionID), tokens))
    bump()
  })

  // Register sidebar_content slot — gracefully skip if @opentui is unavailable
  let offSlots: (() => void) | undefined

  try {
    const { jsx }       = await import("@opentui/solid/jsx-runtime")
    const { onCleanup } = await import("solid-js")

    function CacheStatsText(props: {
      sessionID: string
      api: typeof api
      subscribe: (fn: () => void) => () => void
    }) {
      let textNode: any

      const sync = () => {
        if (!textNode) return
        const content = renderCacheStats(sessionStats.get(props.sessionID))
        textNode.content = content
        textNode.visible = content.length > 0
        textNode.height  = content.length > 0 ? "auto" : 0
        props.api.renderer.requestRender()
      }

      onCleanup(props.subscribe(sync))

      return jsx("text", {
        ref: (ref: any) => { textNode = ref; sync() },
        fg:  props.api.theme.current.textMuted,
        children: renderCacheStats(sessionStats.get(props.sessionID)) ?? "",
      })
    }

    const registration = api.slots.register({
      slots: {
        sidebar_content: (_ctx: any, slotProps: any) =>
          jsx(CacheStatsText, {
            sessionID: (slotProps.session_id ?? "") as string,
            api,
            subscribe,
          }),
      },
    })

    // slots.register returns an ID string, not a cleanup fn — store for documentation only
    offSlots = typeof registration === "function" ? registration : undefined
  } catch {
    // @opentui unavailable — TUI widget silently disabled; server side still works
  }

  api.lifecycle.onDispose(() => {
    offMessage()
    offSlots?.()
  })
}

export default tui
```

- [ ] **Step 2: Verify compiles**

```bash
cd ~/personal_github_repos/opencode-cache-stats && npx tsc --noEmit 2>&1
```

Expected: no errors (or only errors on `@opentui/solid/jsx-runtime` — those types resolve at opencode runtime).

- [ ] **Step 3: Commit**

```bash
cd ~/personal_github_repos/opencode-cache-stats
git add src/tui.ts
git commit -m "feat: TUI sidebar widget (sidebar_content slot)"
```

---

## Task 5: Write README.md

**Files:**
- Create: `~/personal_github_repos/opencode-cache-stats/README.md`

- [ ] **Step 1: Create README.md**

Create `~/personal_github_repos/opencode-cache-stats/README.md`:

```markdown
# opencode-cache-stats

An [opencode](https://opencode.ai) plugin that displays a live **cache hit rate** widget
in the TUI sidebar and writes per-turn stats to a JSONL file.

## Install

```bash
npm i opencode-cache-stats
```

Then add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-cache-stats"]
}
```

Restart opencode. After the first assistant response, the right-column sidebar shows:

```
── Cache ─────────────────────
  Hit rate:  68.9%
  Read:      1,240 tok
  Written:     512 tok
  Raw input:   308 tok
  Output:      320 tok
  Turns:           3
```

## Stats file

Each completed turn appends one JSON line to:

```
~/.config/opencode/cache-stats.jsonl
```

Example record:

```json
{"ts":"2026-07-13T10:23:01.000Z","sessionID":"ses_abc123","providerID":"anthropic","modelID":"claude-sonnet-4-6","turn":3,"cacheRead":1240,"cacheWrite":512,"inputRaw":308,"output":320,"totalInput":2060,"hitRate":60.2}
```

## Cache hit rate definition

```
hitRate = cacheRead / (cacheRead + cacheWrite + inputRaw) × 100
```

This is the fraction of total input tokens served from cache rather than processed fresh.

## Provider compatibility

| Provider | cache read | cache write |
|---|---|---|
| Anthropic | Yes | Yes |
| OpenAI | Yes | Conditional |
| Google Vertex / Gemini | Yes | No |
| Amazon Bedrock | Yes | Yes |
| Groq | Yes | No |
| xAI (Grok) | Yes | No |
| Mistral | Yes | No |
| Cohere | No | No |

When cache data is unavailable the sidebar shows `No cache data` instead of a misleading 0%.

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
cd ~/personal_github_repos/opencode-cache-stats
git add README.md
git commit -m "docs: README with install, usage, provider table"
```

---

## Task 6: Build and verify dist output

**Files:**
- Verify: `~/personal_github_repos/opencode-cache-stats/dist/`

- [ ] **Step 1: Run the build**

```bash
cd ~/personal_github_repos/opencode-cache-stats && npm run build
```

Expected output (tsup):

```
CLI Building entry: src/index.ts, src/tui.ts
CLI Using tsconfig: tsconfig.json
CLI dist/index.js      X.XXkb
CLI dist/tui.js        X.XXkb
CLI dist/index.d.ts    X.XXkb
CLI dist/tui.d.ts      X.XXkb
CLI dist/shared.d.ts   X.XXkb  (may be emitted as a chunk)
```

- [ ] **Step 2: Verify exports map resolves correctly**

```bash
node --input-type=module <<'EOF'
import pkg from '/Users/jiali/personal_github_repos/opencode-cache-stats/dist/index.js'
console.log('id:', pkg.id)
console.log('server:', typeof pkg.server)
console.log('tui:', typeof pkg.tui)
EOF
```

Expected:
```
id: opencode-cache-stats
server: function
tui: function
```

- [ ] **Step 3: Verify tui entry resolves**

```bash
node --input-type=module <<'EOF'
import { tui } from '/Users/jiali/personal_github_repos/opencode-cache-stats/dist/tui.js'
console.log('tui:', typeof tui)
EOF
```

Expected: `tui: function`

- [ ] **Step 4: Commit dist**

```bash
cd ~/personal_github_repos/opencode-cache-stats
git add dist/
git commit -m "build: compiled dist output"
```

Note: `dist/` is committed once as the initial published artifact. In future releases, `npm publish` handles it via `prepublishOnly`. Whether to gitignore `dist/` long-term is a personal preference — either convention is valid.

---

## Task 7: Move docs from ~/.config/opencode

**Files:**
- Move: `~/.config/opencode/docs/superpowers/specs/2026-07-13-cache-hit-rate-plugin-design.md`
- Move: `~/.config/opencode/docs/superpowers/specs/2026-07-13-npm-project-scaffold-design.md`
- Move: `~/.config/opencode/docs/superpowers/plans/2026-07-13-cache-hit-rate-plugin.md`
- Copy this plan file into: `docs/superpowers/plans/2026-07-13-npm-project-scaffold.md`

- [ ] **Step 1: Copy docs into the project**

```bash
cp ~/.config/opencode/docs/superpowers/specs/2026-07-13-cache-hit-rate-plugin-design.md \
   ~/personal_github_repos/opencode-cache-stats/docs/superpowers/specs/

cp ~/.config/opencode/docs/superpowers/specs/2026-07-13-npm-project-scaffold-design.md \
   ~/personal_github_repos/opencode-cache-stats/docs/superpowers/specs/

cp ~/.config/opencode/docs/superpowers/plans/2026-07-13-cache-hit-rate-plugin.md \
   ~/personal_github_repos/opencode-cache-stats/docs/superpowers/plans/
```

- [ ] **Step 2: Copy this plan file into the project**

```bash
cp ~/.config/opencode/docs/superpowers/plans/2026-07-13-npm-project-scaffold.md \
   ~/personal_github_repos/opencode-cache-stats/docs/superpowers/plans/
```

(This file will exist in `~/.config/opencode/docs/superpowers/plans/` once it is saved there after writing.)

- [ ] **Step 3: Verify all four files are present**

```bash
ls ~/personal_github_repos/opencode-cache-stats/docs/superpowers/specs/
ls ~/personal_github_repos/opencode-cache-stats/docs/superpowers/plans/
```

Expected:
```
specs/
  2026-07-13-cache-hit-rate-plugin-design.md
  2026-07-13-npm-project-scaffold-design.md
plans/
  2026-07-13-cache-hit-rate-plugin.md
  2026-07-13-npm-project-scaffold.md
```

- [ ] **Step 4: Commit docs**

```bash
cd ~/personal_github_repos/opencode-cache-stats
git add docs/
git commit -m "docs: move specs and plans from opencode config into project"
```

---

## Task 8: Create GitHub repo and push

- [ ] **Step 1: Create remote repo on GitHub**

```bash
gh repo create opencode-cache-stats \
  --public \
  --description "opencode plugin — live cache hit rate widget in the TUI sidebar + JSONL stats log" \
  --remote origin \
  --source ~/personal_github_repos/opencode-cache-stats
```

Expected: `✓ Created repository jiali_mstr/opencode-cache-stats on GitHub`

- [ ] **Step 2: Push**

```bash
cd ~/personal_github_repos/opencode-cache-stats
git push -u origin main
```

Expected: branch `main` tracked to `origin/main`.

- [ ] **Step 3: Verify on GitHub**

```bash
gh repo view jiali_mstr/opencode-cache-stats --web
```

Opens the repo page in browser. Confirm README renders correctly.

---

## Task 9: Publish to npm

- [ ] **Step 1: Log in to npm (first time only)**

```bash
npm login
```

Enter your npmjs.org username, password, and OTP if 2FA is enabled.
Skip this step if already logged in (`npm whoami` returns your username).

- [ ] **Step 2: Dry-run to verify tarball contents**

```bash
cd ~/personal_github_repos/opencode-cache-stats && npm pack --dry-run
```

Expected output lists only: `dist/`, `README.md`, `LICENSE`. It must NOT include `src/`, `docs/`, `tsconfig.json`, `tsup.config.ts`, or `node_modules/`.

- [ ] **Step 3: Publish**

```bash
cd ~/personal_github_repos/opencode-cache-stats && npm publish
```

This runs `prepublishOnly` (typecheck + build) automatically, then uploads to npmjs.org.

Expected: `+ opencode-cache-stats@0.1.0`

- [ ] **Step 4: Verify package is live**

```bash
npm view opencode-cache-stats
```

Expected: package metadata including `0.1.0`, description, and keywords.

---

## Publish notes for future releases

To release a new version:

1. Bump `version` in `package.json` (e.g. `0.1.0` → `0.1.1`)
2. `git add package.json && git commit -m "chore: bump version to 0.1.1"`
3. `git tag v0.1.1 && git push && git push --tags`
4. `npm publish`
