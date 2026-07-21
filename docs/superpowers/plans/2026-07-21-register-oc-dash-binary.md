# Register `oc-dash` Binary via postinstall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `postinstall` script that registers an `oc-dash` symlink (macOS/Linux) or `.cmd` wrapper (Windows) into a user-writable bin directory so users can run `oc-dash` immediately after installing the plugin — no shell config required.

**Architecture:** A CJS script (`scripts/register.cjs`) runs via `npm postinstall`. It resolves the absolute path of `bin/dashboard.js` (using `__dirname`), picks the right target bin dir per platform, creates a symlink or `.cmd` wrapper, and prints a one-time warning if the target dir is not on `$PATH`. The `package.json` `bin` entry (`oc-cache-dashboard`) is retained as a fallback.

**Tech Stack:** Node.js (CJS, no extra deps), `fs`, `os`, `path`, `child_process`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `scripts/register.cjs` | postinstall logic — detect platform, resolve paths, create symlink/wrapper, PATH check |
| Modify | `package.json` | add `"postinstall": "node scripts/register.cjs"` to `scripts` |
| Modify | `package.json` | add `"scripts"` to `files` array so `register.cjs` is published |
| Modify | `README.md` | replace shell-function instructions with "runs automatically on install" note |

---

## Task 1: Write `scripts/register.cjs`

**Files:**
- Create: `scripts/register.cjs`

- [ ] **Step 1: Create the scripts directory**

```bash
mkdir -p scripts
```

- [ ] **Step 2: Write `scripts/register.cjs`**

```js
#!/usr/bin/env node
// scripts/register.cjs
// Runs as postinstall. Registers `oc-dash` in a user-writable bin dir.
// Must be CJS (.cjs) because package.json has "type":"module".

"use strict";
const fs   = require("fs");
const os   = require("os");
const path = require("path");

// ── 1. Resolve the real dashboard entry point ───────────────────────────────
// __dirname = <pkg-root>/scripts/ when run as postinstall
const pkgRoot    = path.resolve(__dirname, "..");
const dashEntry  = path.join(pkgRoot, "bin", "dashboard.js");

if (!fs.existsSync(dashEntry)) {
  console.warn(`[opencode-cache-stats] postinstall: bin/dashboard.js not found at ${dashEntry}, skipping registration.`);
  process.exit(0);
}

// ── 2. Pick target bin dir per platform ────────────────────────────────────
const home     = os.homedir();
const platform = process.platform;

function targetBinDir() {
  if (platform === "win32") {
    // Prefer %APPDATA%\npm (npm global bin on Windows) then LOCALAPPDATA\Microsoft\WindowsApps
    return process.env.APPDATA
      ? path.join(process.env.APPDATA, "npm")
      : path.join(home, "AppData", "Roaming", "npm");
  }
  // macOS / Linux — prefer ~/.local/bin (XDG standard, widely on PATH)
  return path.join(home, ".local", "bin");
}

const binDir = targetBinDir();

// ── 3. Ensure the bin dir exists ────────────────────────────────────────────
try {
  fs.mkdirSync(binDir, { recursive: true });
} catch (e) {
  console.warn(`[opencode-cache-stats] postinstall: could not create ${binDir}: ${e.message}`);
  process.exit(0);
}

// ── 4. Create symlink (Unix) or .cmd wrapper (Windows) ─────────────────────
if (platform === "win32") {
  // Windows: write a .cmd wrapper that delegates to node
  const cmdPath = path.join(binDir, "oc-dash.cmd");
  const cmdContent = `@echo off\nnode "${dashEntry}" %*\n`;
  try {
    fs.writeFileSync(cmdPath, cmdContent, "utf8");
    console.log(`[opencode-cache-stats] Registered oc-dash.cmd → ${cmdPath}`);
  } catch (e) {
    console.warn(`[opencode-cache-stats] postinstall: could not write ${cmdPath}: ${e.message}`);
  }
} else {
  // macOS / Linux: symlink oc-dash → bin/dashboard.js
  const linkPath = path.join(binDir, "oc-dash");
  try {
    // Remove stale symlink if it exists
    if (fs.existsSync(linkPath) || fs.lstatSync(linkPath).isSymbolicLink()) {
      fs.unlinkSync(linkPath);
    }
  } catch (_) { /* doesn't exist yet, that's fine */ }

  try {
    fs.symlinkSync(dashEntry, linkPath);
    // Ensure the target is executable
    fs.chmodSync(dashEntry, 0o755);
    console.log(`[opencode-cache-stats] Registered oc-dash → ${linkPath}`);
  } catch (e) {
    console.warn(`[opencode-cache-stats] postinstall: could not create symlink at ${linkPath}: ${e.message}`);
    process.exit(0);
  }
}

// ── 5. Warn if the bin dir is not on $PATH ──────────────────────────────────
if (platform !== "win32") {
  const pathDirs = (process.env.PATH || "").split(":");
  const onPath   = pathDirs.some(d => path.resolve(d) === path.resolve(binDir));
  if (!onPath) {
    console.warn(`\n[opencode-cache-stats] NOTE: ${binDir} is not on your PATH.`);
    console.warn(`  Add this line to your ~/.zshrc or ~/.bashrc to use oc-dash:`);
    console.warn(`  export PATH="$HOME/.local/bin:$PATH"\n`);
  }
}
```

- [ ] **Step 3: Verify the script is valid CJS (no syntax errors)**

```bash
node --check scripts/register.cjs
```

Expected: no output (exit 0)

- [ ] **Step 4: Smoke-test the script manually**

```bash
node scripts/register.cjs
```

Expected output (macOS):
```
[opencode-cache-stats] Registered oc-dash → /Users/<you>/.local/bin/oc-dash
```

- [ ] **Step 5: Verify the symlink was created and is executable**

```bash
ls -la ~/.local/bin/oc-dash
~/.local/bin/oc-dash --help 2>/dev/null || ~/.local/bin/oc-dash --no-open &
sleep 1 && kill %1 2>/dev/null
echo "exit: $?"
```

Expected: symlink line pointing at `bin/dashboard.js`; running it starts the server without error.

- [ ] **Step 6: Commit**

```bash
git add scripts/register.cjs
git commit -m "feat: add postinstall script to register oc-dash binary"
```

---

## Task 2: Wire postinstall into `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `postinstall` to `scripts` and `scripts/` to `files`**

Open `package.json`. Make two edits:

1. In `"scripts"`, add after the `"dashboard"` entry:
```json
"postinstall": "node scripts/register.cjs"
```

2. In `"files"`, add `"scripts"` so it is included in the published package:
```json
"files": [
  "bin",
  "dist",
  "scripts",
  "README.md",
  "LICENSE"
]
```

- [ ] **Step 2: Verify JSON is valid**

```bash
node -e "require('./package.json'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Simulate a clean postinstall run**

Remove the symlink created in Task 1 and re-run:

```bash
rm -f ~/.local/bin/oc-dash
npm run postinstall
ls -la ~/.local/bin/oc-dash
```

Expected: symlink re-created.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: wire postinstall to register oc-dash; include scripts/ in published files"
```

---

## Task 3: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the shell-function block with auto-registration note**

Find the current "Live dashboard" section (around line 72-87). Replace:

```markdown
Add this shell function to your `~/.zshrc` or `~/.bash_profile`:

```bash
oc-dash() { node ~/.cache/opencode/packages/@alex123bob/opencode-cache-stats@latest/node_modules/@alex123bob/opencode-cache-stats/bin/dashboard.js "$@"; }
```

Then run:

```bash
oc-dash
```

The `@latest` path always resolves to the currently installed version, so the function keeps working after upgrades.
```

With:

```markdown
The `oc-dash` command is registered automatically when the plugin is installed.
Run:

```bash
oc-dash
```

> **If `oc-dash` is not found:** the installer places the command in `~/.local/bin`
> (macOS/Linux) or `%APPDATA%\npm` (Windows). Make sure that directory is on your
> `PATH`. Add to `~/.zshrc` or `~/.bashrc` if needed:
> ```bash
> export PATH="$HOME/.local/bin:$PATH"
> ```
```

- [ ] **Step 2: Verify README renders correctly (scan for broken markdown)**

```bash
node -e "
const fs = require('fs');
const txt = fs.readFileSync('README.md','utf8');
const unclosed = (txt.match(/\`\`\`/g)||[]).length % 2;
console.log(unclosed === 0 ? 'fence check: ok' : 'WARNING: odd number of triple-backtick fences');
"
```

Expected: `fence check: ok`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update Live dashboard section — oc-dash now auto-registered on install"
```

---

## Task 4: Bump version and verify end-to-end

**Files:**
- Modify: `package.json` (version bump)

- [ ] **Step 1: Bump patch version**

In `package.json`, change:
```json
"version": "1.4.2"
```
to:
```json
"version": "1.4.3"
```

- [ ] **Step 2: Full clean build**

```bash
npm run build
```

Expected: `dist/` rebuilt, no errors.

- [ ] **Step 3: End-to-end postinstall simulation**

```bash
rm -f ~/.local/bin/oc-dash
node scripts/register.cjs
ls -la ~/.local/bin/oc-dash
oc-dash --no-open &
sleep 2
curl -s http://localhost:4321 | head -5
kill %1
```

Expected: symlink exists, server responds with HTML.

- [ ] **Step 4: Commit version bump**

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 1.4.3"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** postinstall registration (all 3 platforms), PATH warning, README update, version bump — all covered.
- [x] **Placeholder scan:** No TBDs. All code blocks are complete.
- [x] **Type consistency:** `register.cjs` is pure Node.js stdlib — no types to mismatch. `dashEntry` resolved via `__dirname` consistently across tasks.
- [x] **Edge cases covered:** stale symlink removal, missing `bin/dashboard.js` guard, `mkdirSync` failure guard, Windows `.cmd` wrapper vs Unix symlink.
