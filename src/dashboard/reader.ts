import { readFileSync } from "node:fs"

// ── Types ────────────────────────────────────────────────────────────────────

export type TurnRecord = {
  ts:           string
  turn:         number
  modelID:      string
  cacheRead:    number
  cacheWrite:   number
  inputRaw:     number
  output:       number
  totalInput:   number
  hitRate:      number        // per-turn rate from JSONL
  // computed:
  deltaRead:    number | null  // null for first turn of this agent
  deltaWrite:   number | null
  deltaRaw:     number | null
  deltaHitRate: number | null
}

export type SessionTotals = {
  cacheRead:  number
  cacheWrite: number
  inputRaw:   number
  output:     number
  turnCount:  number
  hitRate:    number   // cumulative
}

export type AgentView = {
  agentLabel: string
  parentID:   string | null
  turns:      TurnRecord[]
  cumulative: SessionTotals
}

export type SessionView = {
  sessionID: string
  startedAt: string
  agents:    AgentView[]
  totals:    SessionTotals
}

export type DailySummary = {
  date:         string   // YYYY-MM-DD
  hitRate:      number
  turnCount:    number
  sessionCount: number
}

export type GlobalStats = {
  totalSessions:   number
  totalTurns:      number
  avgHitRate:      number
  totalCacheRead:  number
  totalCacheWrite: number
  totalRawInput:   number
  totalOutput:     number
  dailySummaries:  DailySummary[]
}

export type DashboardData = {
  sessions: SessionView[]
  global:   GlobalStats
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function readAndAggregate(filePath: string): DashboardData {
  let lines: string[]
  try {
    lines = readFileSync(filePath, "utf8").split("\n").filter(l => l.trim())
  } catch {
    return { sessions: [], global: emptyGlobal() }
  }

  // sessionID → agentLabel → TurnRecord[]
  const rawTurns = new Map<string, Map<string, TurnRecord[]>>()
  // sessionID → startedAt (earliest ts)
  const sessionStart = new Map<string, string>()

  for (const line of lines) {
    let rec: any
    try { rec = JSON.parse(line) } catch { continue }

    const sid   = rec.sessionID as string
    const label = rec.agentLabel as string
    if (!sid || !label) continue

    if (!rawTurns.has(sid)) rawTurns.set(sid, new Map())
    const agentMap = rawTurns.get(sid)!
    if (!agentMap.has(label)) agentMap.set(label, [])

    const prev    = agentMap.get(label)!
    const prevRec = prev.length > 0 ? prev[prev.length - 1] : null

    const turn: TurnRecord = {
      ts:           rec.ts,
      turn:         rec.turn,
      modelID:      rec.modelID ?? "unknown",
      cacheRead:    rec.cacheRead  ?? 0,
      cacheWrite:   rec.cacheWrite ?? 0,
      inputRaw:     rec.inputRaw   ?? 0,
      output:       rec.output     ?? 0,
      totalInput:   rec.totalInput ?? 0,
      hitRate:      rec.hitRate    ?? 0,
      deltaRead:    prevRec ? rec.cacheRead  - prevRec.cacheRead  : null,
      deltaWrite:   prevRec ? rec.cacheWrite - prevRec.cacheWrite : null,
      deltaRaw:     prevRec ? rec.inputRaw   - prevRec.inputRaw   : null,
      deltaHitRate: prevRec ? rec.hitRate    - prevRec.hitRate    : null,
    }
    prev.push(turn)

    // track earliest ts per session
    if (!sessionStart.has(sid) || rec.ts < sessionStart.get(sid)!) {
      sessionStart.set(sid, rec.ts)
    }
  }

  // Build SessionView[]
  const sessions: SessionView[] = []
  for (const [sessionID, agentMap] of rawTurns) {
    const agents: AgentView[] = []
    for (const [agentLabel, turns] of agentMap) {
      const cumulative = computeCumulative(turns)
      agents.push({ agentLabel, parentID: null, turns, cumulative })
    }
    const totals = mergeAgentTotals(agents.map(a => a.cumulative))
    sessions.push({
      sessionID,
      startedAt: sessionStart.get(sessionID) ?? "",
      agents,
      totals,
    })
  }

  // Sort newest first
  sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt))

  const global = computeGlobal(sessions)
  return { sessions, global }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeCumulative(turns: TurnRecord[]): SessionTotals {
  const last = turns[turns.length - 1]
  const totalRead  = turns.reduce((s, t) => s + t.cacheRead,  0)
  const totalWrite = turns.reduce((s, t) => s + t.cacheWrite, 0)
  const totalRaw   = turns.reduce((s, t) => s + t.inputRaw,   0)
  const totalOut   = turns.reduce((s, t) => s + t.output,     0)
  const totalIn    = totalRead + totalWrite + totalRaw
  return {
    cacheRead:  totalRead,
    cacheWrite: totalWrite,
    inputRaw:   totalRaw,
    output:     totalOut,
    turnCount:  last?.turn ?? turns.length,
    hitRate:    totalIn > 0 ? Math.round((totalRead / totalIn) * 1000) / 10 : 0,
  }
}

function mergeAgentTotals(totals: SessionTotals[]): SessionTotals {
  const r = totals.reduce((acc, t) => ({
    cacheRead:  acc.cacheRead  + t.cacheRead,
    cacheWrite: acc.cacheWrite + t.cacheWrite,
    inputRaw:   acc.inputRaw   + t.inputRaw,
    output:     acc.output     + t.output,
    turnCount:  acc.turnCount  + t.turnCount,
    hitRate:    0,
  }), { cacheRead: 0, cacheWrite: 0, inputRaw: 0, output: 0, turnCount: 0, hitRate: 0 })
  const totalIn = r.cacheRead + r.cacheWrite + r.inputRaw
  r.hitRate = totalIn > 0 ? Math.round((r.cacheRead / totalIn) * 1000) / 10 : 0
  return r
}

function computeGlobal(sessions: SessionView[]): GlobalStats {
  const totalCacheRead  = sessions.reduce((s, x) => s + x.totals.cacheRead,  0)
  const totalCacheWrite = sessions.reduce((s, x) => s + x.totals.cacheWrite, 0)
  const totalRawInput   = sessions.reduce((s, x) => s + x.totals.inputRaw,   0)
  const totalOutput     = sessions.reduce((s, x) => s + x.totals.output,     0)
  const totalTurns      = sessions.reduce((s, x) => s + x.totals.turnCount,  0)
  const totalIn         = totalCacheRead + totalCacheWrite + totalRawInput
  const avgHitRate      = totalIn > 0 ? Math.round((totalCacheRead / totalIn) * 1000) / 10 : 0

  // Daily summaries
  const dailyMap = new Map<string, { hitRateSum: number; turns: number; sessions: number }>()
  for (const session of sessions) {
    const date = session.startedAt.slice(0, 10)
    if (!dailyMap.has(date)) dailyMap.set(date, { hitRateSum: 0, turns: 0, sessions: 0 })
    const d = dailyMap.get(date)!
    d.hitRateSum += session.totals.hitRate
    d.turns      += session.totals.turnCount
    d.sessions   += 1
  }
  const dailySummaries: DailySummary[] = Array.from(dailyMap.entries())
    .map(([date, d]) => ({
      date,
      hitRate:      Math.round((d.hitRateSum / d.sessions) * 10) / 10,
      turnCount:    d.turns,
      sessionCount: d.sessions,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    totalSessions: sessions.length,
    totalTurns,
    avgHitRate,
    totalCacheRead,
    totalCacheWrite,
    totalRawInput,
    totalOutput,
    dailySummaries,
  }
}

function emptyGlobal(): GlobalStats {
  return {
    totalSessions: 0, totalTurns: 0, avgHitRate: 0,
    totalCacheRead: 0, totalCacheWrite: 0, totalRawInput: 0,
    totalOutput: 0, dailySummaries: [],
  }
}
