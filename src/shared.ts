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
