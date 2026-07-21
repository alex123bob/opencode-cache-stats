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
    // Remove stale symlink or file if it exists (lstatSync does NOT follow symlinks,
    // so it correctly detects broken symlinks that existsSync would miss)
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink() || stat.isFile()) {
      fs.unlinkSync(linkPath);
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

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
