# opencode-cache-stats npm project scaffold — Design Spec

**Date:** 2026-07-13  
**Status:** Approved

---

## Goal

Create a publishable npm package `opencode-cache-stats` at `~/personal_github_repos/opencode-cache-stats/` that wraps the cache hit rate plugin logic, ready for `git push` and `npm publish`.

---

## Repository layout

```
~/personal_github_repos/opencode-cache-stats/
├── src/
│   ├── shared.ts       ← SessionStats type, JsonlRecord type, computeHitRate(), renderCacheStats()
│   ├── index.ts        ← server Plugin export, JSONL append logic
│   └── tui.ts          ← TuiPlugin export, sidebar_content slot
├── dist/               ← tsup build output (gitignored, included in npm tarball)
├── docs/
│   └── superpowers/
│       ├── specs/
│       │   └── 2026-07-13-cache-hit-rate-plugin-design.md   (moved from ~/.config/opencode/docs/)
│       └── plans/
│           └── 2026-07-13-cache-hit-rate-plugin.md          (moved from ~/.config/opencode/docs/)
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── .gitignore
├── .npmignore
├── README.md
└── LICENSE
```

---

## package.json

```json
{
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
  "keywords": ["opencode", "plugin", "cache", "llm", "tui"],
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

Note: TypeScript 5.x (not 6.x) — more stable for public packages.

---

## tsup.config.ts

Two entry points compiled independently so opencode can lazy-load `tui.js` only in the TUI process:

```ts
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

All peer deps are marked `external` — they are NOT bundled, resolving at opencode's runtime.

---

## tsconfig.json

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

---

## .gitignore

```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
```

---

## .npmignore

```
src/
docs/
tsup.config.ts
tsconfig.json
*.tsbuildinfo
.gitignore
```

---

## Source file responsibilities

### `src/shared.ts`
- `SessionStats` type
- `JsonlRecord` type  
- `computeHitRate(cacheRead, totalInput): number`
- `renderCacheStats(stats: SessionStats | undefined): string`
- `STATS_FILE` constant (`~/.config/opencode/cache-stats.jsonl`)
- `appendJsonl(record: JsonlRecord): void`

### `src/index.ts`
- Imports from `./shared`
- `server` Plugin: `event` hook → accumulate per-session stats → `appendJsonl()`
- `tui` lazy loader: `async (...args) => { const mod = await import("./tui.js"); return mod.tui(...args) }`
- `default export { id: "opencode-cache-stats", server, tui }`

### `src/tui.ts`
- Imports from `./shared`
- `tui` TuiPlugin: `api.event.on("message.updated")` → accumulate stats → `bump()`; `api.slots.register({ sidebar_content })` using `@opentui/solid/jsx-runtime`
- Graceful `try/catch` around `@opentui` imports
- Named export `tui`

---

## README.md sections

1. One-line description
2. Install (`npm i opencode-cache-stats`)
3. Configure (`"plugin": ["opencode-cache-stats"]` in `~/.config/opencode/opencode.json`)
4. What it shows (sidebar widget screenshot description + JSONL file location)
5. Provider compatibility table (Anthropic, OpenAI, Google, Bedrock, Groq, xAI, Mistral, Cohere)
6. License

---

## Publish workflow

```bash
# First publish
npm login          # one-time: log in to npmjs.org
npm publish        # runs prepublishOnly (typecheck + build) then uploads dist/

# Subsequent releases
# bump version in package.json, then:
npm publish
```

---

## What is NOT in this scaffold

- No test harness (opencode plugins have no sandboxed test environment; smoke testing is manual)
- No CI/CD (can be added later via GitHub Actions)
- No changelog tooling
- No cross-session query CLI (follow-up feature)
