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

const port   = parseInt(getFlag("--port", "4321"), 10)
const file   = getFlag("--file", join(homedir(), ".config", "opencode", "cache-stats.jsonl"))
const noOpen = args.includes("--no-open")

startDashboardServer({ jsonlPath: file, preferredPort: port })
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
