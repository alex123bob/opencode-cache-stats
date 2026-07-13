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
