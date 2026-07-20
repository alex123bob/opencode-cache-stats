import type { Plugin } from "@opencode-ai/plugin"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import {
  type SessionStats,
  type JsonlRecord,
  computeHitRate,
  appendJsonl,
  extractTokens,
  extractSessionParent,
  isCompletedAssistant,
  accumulateStats,
} from "./shared.js"

// ── Server export ──────────────────────────────────────────────────────────

export const server: Plugin = async (_input) => {
  const sessionStats:   Map<string, SessionStats> = new Map()
  const agentLabels:    Map<string, string>        = new Map()
  const sessionParents: Map<string, string | null> = new Map()  // sessionID → parentID
  // Process-local counter — may differ from TUI's counter; use parentID for cross-process correlation
  let   subagentCount = 0

  return {
    event: async ({ event }) => {
      // Track session parentID from session.created
      const sessionInfo = extractSessionParent(event)
      if (sessionInfo) {
        sessionParents.set(sessionInfo.sessionID, sessionInfo.parentID)
        return
      }

      if (!isCompletedAssistant(event)) return

      const info      = (event.properties as any).info
      const sessionID = info.sessionID as string
      const tokens    = extractTokens(info)
      const next      = accumulateStats(sessionStats.get(sessionID), tokens)

      sessionStats.set(sessionID, next)

      // Assign label on first sight
      if (!agentLabels.has(sessionID)) {
        const parentID   = sessionParents.get(sessionID) ?? null
        const isSubagent = parentID !== null
        agentLabels.set(sessionID, isSubagent ? `Subagent ${++subagentCount}` : "Main Agent")
      }
      const agentLabel = agentLabels.get(sessionID)!
      const parentID   = sessionParents.get(sessionID) ?? null

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
        parentID,
        agentLabel,
      }

      appendJsonl(record)
    },
  }
}

// ── TUI lazy loader ────────────────────────────────────────────────────────
// Loaded only by the TUI process; keeps server bundle free of opentui deps.

const rootTui: TuiPlugin = async (...args) => {
  const mod = await import("./tui.js")
  return mod.tui(...args)
}
export { rootTui as tui }

// ── Plugin metadata ────────────────────────────────────────────────────────

export const id = "opencode-cache-stats"

export default { id, server }
