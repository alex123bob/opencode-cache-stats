// src/dashboard/ui/app.js

// ── State ────────────────────────────────────────────────────────────────────
let data            = null
let activeSessionID = null
let activeTab       = "timeline"
let timeFilter      = "all"
let agentFilter     = "all"
let modelFilter     = "all"

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setupFilters()
  setupTabs()
  connectSSE()
})

function connectSSE() {
  const es = new EventSource("/api/stream")
  es.onmessage = e => {
    data = JSON.parse(e.data)
    if (!activeSessionID && data.sessions.length > 0) {
      activeSessionID = data.sessions[0].sessionID
    }
    render()
  }
  es.onerror = () => { es.close(); setTimeout(connectSSE, 3000) }
}

// ── Filters ───────────────────────────────────────────────────────────────────
function setupFilters() {
  document.getElementById("timeFilter").addEventListener("click", e => {
    const btn = e.target.closest(".pill")
    if (!btn) return
    timeFilter = btn.dataset.value
    document.querySelectorAll("#timeFilter .pill").forEach(p => p.classList.toggle("active", p === btn))
    render()
  })
  document.getElementById("agentFilter").addEventListener("click", e => {
    const btn = e.target.closest(".pill")
    if (!btn) return
    agentFilter = btn.dataset.value
    document.querySelectorAll("#agentFilter .pill").forEach(p => p.classList.toggle("active", p === btn))
    render()
  })
}

function renderModelFilter() {
  const toolbar = document.getElementById("toolbar")
  const existing = document.getElementById("modelFilter")
  if (existing) existing.remove()
  const sepExisting = document.getElementById("modelFilterSep")
  if (sepExisting) sepExisting.remove()

  const models = [...new Set(
    data.sessions.flatMap(s => s.agents.flatMap(a => a.turns.map(t => t.modelID ?? "unknown")))
  )].filter(Boolean)

  if (models.length <= 1) return

  const sep = document.createElement("div")
  sep.className = "sep"
  sep.id = "modelFilterSep"
  sep.textContent = "|"

  const group = document.createElement("div")
  group.className = "filter-group"
  group.id = "modelFilter"
  group.innerHTML = [
    `<button class="pill ${modelFilter === "all" ? "active" : ""}" data-value="all">All models</button>`,
    ...models.map(m => `<button class="pill ${modelFilter === m ? "active" : ""}" data-value="${m}">${m}</button>`)
  ].join("")
  group.addEventListener("click", e => {
    const btn = e.target.closest(".pill")
    if (!btn) return
    modelFilter = btn.dataset.value
    group.querySelectorAll(".pill").forEach(p => p.classList.toggle("active", p === btn))
    render()
  })

  toolbar.appendChild(sep)
  toolbar.appendChild(group)
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function setupTabs() {
  document.getElementById("tabs").addEventListener("click", e => {
    const btn = e.target.closest(".tab")
    if (!btn) return
    activeTab = btn.dataset.tab
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === btn))
    renderTabContent()
  })
}

// ── Filter helpers ────────────────────────────────────────────────────────────
function filterSessions(sessions) {
  const now    = Date.now()
  const cutoff = { all: 0, today: 86400000, "7d": 604800000, "30d": 2592000000 }[timeFilter] ?? 0
  return sessions.filter(s => {
    if (cutoff > 0 && now - new Date(s.startedAt).getTime() > cutoff) return false
    if (modelFilter !== "all") {
      const hasModel = s.agents.some(a => a.turns.some(t => t.modelID === modelFilter))
      if (!hasModel) return false
    }
    return true
  })
}

function filterAgents(agents) {
  if (agentFilter === "main") return agents.filter(a => a.agentLabel === "Main Agent")
  if (agentFilter === "sub")  return agents.filter(a => a.agentLabel !== "Main Agent")
  return agents
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  if (!data) return
  renderSessionList()
  renderKPIs()
  renderTabContent()
  renderModelFilter()
}

function renderSessionList() {
  const sessions  = filterSessions(data.sessions)
  const newestTS  = data.sessions[0]?.startedAt ?? ""
  const el        = document.getElementById("sessionList")
  el.innerHTML    = `<div class="sidebar-title">Sessions</div>`

  for (const s of sessions) {
    const isLive    = s.startedAt === newestTS
    const isActive  = s.sessionID === activeSessionID
    const hr        = s.totals.hitRate
    const badgeCls  = hr >= 65 ? "badge-green" : hr >= 40 ? "badge-orange" : "badge-red"
    const agentCount = s.agents.length
    const div = document.createElement("div")
    div.className = `session-item${isActive ? " active" : ""}${isLive ? " live" : ""}`
    div.innerHTML = `
      <div class="session-date">${fmtDate(s.startedAt)}</div>
      <div class="session-id">${s.sessionID.slice(0, 12)}</div>
      <div class="session-badges">
        ${isLive ? `<span class="badge badge-live">● LIVE</span>` : ""}
        <span class="badge ${badgeCls}">${hr.toFixed(1)}%</span>
        <span class="badge badge-blue">${agentCount} agent${agentCount !== 1 ? "s" : ""}</span>
      </div>`
    div.addEventListener("click", () => { activeSessionID = s.sessionID; render() })
    el.appendChild(div)
  }
}

function renderKPIs() {
  const sessions   = filterSessions(data.sessions)
  const totalRead  = sessions.reduce((s, x) => s + x.totals.cacheRead,  0)
  const totalWrite = sessions.reduce((s, x) => s + x.totals.cacheWrite, 0)
  const totalRaw   = sessions.reduce((s, x) => s + x.totals.inputRaw,   0)
  const totalIn    = totalRead + totalWrite + totalRaw
  const avgHit     = totalIn > 0 ? (totalRead / totalIn * 100).toFixed(1) : "0.0"
  const totalTurns = sessions.reduce((s, x) => s + x.totals.turnCount, 0)

  document.getElementById("kpiRow").innerHTML = `
    ${kpi("Avg hit rate",     avgHit + "%",                      "across filtered sessions", "kpi-green")}
    ${kpi("Cache read",       fmt(totalRead),                    "tokens from cache",         "kpi-blue")}
    ${kpi("Cache written",    fmt(totalWrite),                   "tokens seeded to cache",    "kpi-yellow")}
    ${kpi("Raw input",        fmt(totalRaw),                     "uncached input tokens",     "kpi-pink")}
    ${kpi("Sessions · Turns", sessions.length + " · " + totalTurns, "filtered",              "kpi-purple")}
  `
}

function kpi(label, value, sub, cls) {
  return `<div class="kpi ${cls}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`
}

function renderTabContent() {
  if (!data || !activeSessionID) return
  const session = data.sessions.find(s => s.sessionID === activeSessionID)
  if (!session) return
  const agents = filterAgents(session.agents)
  const el     = document.getElementById("tabContent")
  switch (activeTab) {
    case "timeline":    el.innerHTML = renderTimeline(agents);            break
    case "deltas":      el.innerHTML = renderDeltas(agents);              break
    case "trend":       el.innerHTML = renderTrend();                     break
    case "composition": el.innerHTML = renderComposition(session, agents); break
    case "heatmap":     el.innerHTML = renderHeatmap();                   break
  }
}

// ── Tab 1: Turn Timeline ──────────────────────────────────────────────────────
function renderTimeline(agents) {
  const agentColors = ["#3b82f6", "#a78bfa", "#4ade80", "#fb923c", "#f472b6"]
  const allTurns    = agents.flatMap((a, i) => a.turns.map(t => ({ ...t, agentLabel: a.agentLabel, colorIdx: i })))
  allTurns.sort((a, b) => a.ts.localeCompare(b.ts))

  const maxHit = Math.max(...allTurns.map(t => t.hitRate), 1)
  const bars   = allTurns.map(t => {
    const h     = Math.max(4, (t.hitRate / maxHit) * 90)
    const color = agentColors[t.colorIdx % agentColors.length]
    return `<div class="bar" style="background:${color};height:${h}px" title="${t.agentLabel} T${t.turn}: ${t.hitRate.toFixed(1)}%"></div>`
  }).join("")

  const agentLegend = agents.map((a, i) =>
    `<div class="legend-item"><div class="legend-dot" style="background:${agentColors[i % agentColors.length]}"></div>${a.agentLabel}</div>`
  ).join("")

  const rows = allTurns.map(t => {
    const totalIn  = t.totalInput || 1
    const readPct  = (t.cacheRead  / totalIn * 100).toFixed(0)
    const writePct = (t.cacheWrite / totalIn * 100).toFixed(0)
    const rawPct   = Math.max(0, 100 - +readPct - +writePct)
    const rateCls  = t.hitRate >= 65 ? "rate-high" : t.hitRate >= 40 ? "rate-mid" : "rate-low"
    const tagIdx   = agents.findIndex(a => a.agentLabel === t.agentLabel)
    const tagCls   = tagIdx === 0 ? "agent-main" : `agent-sub${(tagIdx - 1) % 3}`
    return `<tr>
      <td>${t.turn}</td>
      <td><span class="agent-tag ${tagCls}">${t.agentLabel.replace("Subagent ", "Sub ")}</span></td>
      <td><div class="token-bar"><div class="tb-read" style="width:${readPct}%"></div><div class="tb-write" style="width:${writePct}%"></div><div class="tb-raw" style="width:${rawPct}%"></div></div></td>
      <td style="color:#34d399;font-family:monospace">${fmt(t.cacheRead)}</td>
      <td style="color:#f87171;font-family:monospace">${fmt(t.inputRaw)}</td>
      <td><span class="rate-pill ${rateCls}">${t.hitRate.toFixed(1)}%</span></td>
    </tr>`
  }).join("")

  return `
    <div class="chart-box">
      <div class="chart-title">Hit rate per turn</div>
      <div class="chart-hint">Each bar = one completed response. Color = agent.</div>
      <div class="bar-chart">${bars}</div>
      <div class="legend">${agentLegend}</div>
      <div class="annotation">First turn is always lower (cold cache). Rate climbs as cache warms.</div>
    </div>
    <div class="chart-box">
      <div class="chart-title">Per-turn breakdown</div>
      <div class="chart-hint">Token bar: <span style="color:#34d399">■ read</span> <span style="color:#fbbf24">■ write</span> <span style="color:#f87171">■ raw</span></div>
      <table class="data-table">
        <thead><tr><th>#</th><th>Agent</th><th>Tokens</th><th>Read</th><th>Raw in</th><th>Hit rate</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}

// ── Tab 2: Turn Deltas ────────────────────────────────────────────────────────
function renderDeltas(agents) {
  function interpretDelta(t) {
    if (t.deltaHitRate === null) return `<span style="color:var(--muted)">Cold start</span>`
    if (t.deltaHitRate > 10)    return `<span class="delta-pos">Cache warming ↑</span>`
    if (t.deltaHitRate > 0)     return `<span class="delta-pos">Improving ↑</span>`
    if (t.deltaHitRate < -10)   return `<span class="delta-neg">Context shift ↓</span>`
    if (t.deltaHitRate < 0)     return `<span class="delta-neg">Slight drop ↓</span>`
    return `<span class="delta-neu">Stable</span>`
  }

  function fmtDelta(v) {
    if (v === null) return `<span class="delta-neu">—</span>`
    const sign = v > 0 ? "+" : ""
    const cls  = v > 0 ? "delta-pos" : v < 0 ? "delta-neg" : "delta-neu"
    return `<span class="${cls}">${sign}${fmt(Math.round(v))}</span>`
  }

  function fmtDeltaRate(v) {
    if (v === null) return `<span class="delta-neu">—</span>`
    const sign = v > 0 ? "+" : ""
    const cls  = v > 0 ? "delta-pos" : v < 0 ? "delta-neg" : "delta-neu"
    return `<span class="${cls}">${sign}${v.toFixed(1)}%</span>`
  }

  const rows = agents.flatMap((a, i) => {
    const tagCls = i === 0 ? "agent-main" : `agent-sub${(i - 1) % 3}`
    return a.turns.map(t => `<tr>
      <td>${t.turn}</td>
      <td><span class="agent-tag ${tagCls}">${a.agentLabel.replace("Subagent ", "Sub ")}</span></td>
      <td>${fmtDelta(t.deltaRead)}</td>
      <td>${fmtDelta(t.deltaWrite)}</td>
      <td>${fmtDelta(t.deltaRaw)}</td>
      <td>${fmtDeltaRate(t.deltaHitRate)}</td>
      <td>${interpretDelta(t)}</td>
    </tr>`)
  }).join("")

  return `
    <div class="chart-box">
      <div class="chart-title">Turn-over-turn deltas</div>
      <div class="chart-hint">Change vs previous turn of the same agent. — = first turn (cold start).</div>
      <table class="data-table">
        <thead><tr><th>#</th><th>Agent</th><th>Δ read</th><th>Δ write</th><th>Δ raw in</th><th>Δ hit rate</th><th>Interpretation</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}

// ── Tab 3: Hit Rate Trend ─────────────────────────────────────────────────────
function renderTrend() {
  const sessions = filterSessions(data.sessions).slice().reverse()
  if (sessions.length === 0) return `<div class="chart-box"><div class="chart-hint">No sessions to display.</div></div>`

  const rates  = sessions.map(s => s.totals.hitRate)
  const maxR   = Math.max(...rates, 1)
  const W = 500, H = 100, PAD = 20
  const xStep  = sessions.length > 1 ? (W - PAD * 2) / (sessions.length - 1) : 0

  const points = sessions.map((s, i) => ({
    x: PAD + i * xStep,
    y: H - PAD - ((s.totals.hitRate / maxR) * (H - PAD * 2)),
    session: s,
  }))

  const polyline = points.map(p => `${p.x},${p.y}`).join(" ")
  const dots     = points.map(p => {
    const isLow = p.session.totals.hitRate < 40
    return `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${isLow ? "#f87171" : "#3b82f6"}" title="${p.session.sessionID}: ${p.session.totals.hitRate.toFixed(1)}%"/>`
  }).join("")

  const tableRows = sessions.slice().reverse().map(s => {
    const rateCls = s.totals.hitRate >= 65 ? "rate-high" : s.totals.hitRate >= 40 ? "rate-mid" : "rate-low"
    return `<tr>
      <td>${fmtDate(s.startedAt)}</td>
      <td style="font-family:monospace">${s.sessionID.slice(0, 12)}</td>
      <td>${s.agents.length}</td>
      <td>${s.totals.turnCount}</td>
      <td><span class="rate-pill ${rateCls}">${s.totals.hitRate.toFixed(1)}%</span></td>
    </tr>`
  }).join("")

  return `
    <div class="chart-box">
      <div class="chart-title">Hit rate over time</div>
      <div class="chart-hint">One point per session. <span style="color:#f87171">Red</span> = below 40%.</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px">
        <polyline points="${polyline}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round"/>
        ${dots}
        <text x="2" y="${PAD}" fill="#475569" font-size="9">${maxR.toFixed(0)}%</text>
        <text x="2" y="${H - 4}" fill="#475569" font-size="9">0%</text>
      </svg>
      <div class="annotation">Red dots indicate sessions with cold cache or large new context.</div>
    </div>
    <div class="chart-box">
      <div class="chart-title">Session table</div>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Session</th><th>Agents</th><th>Turns</th><th>Hit rate</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`
}

// ── Tab 4: Token Composition ──────────────────────────────────────────────────
function renderComposition(session, agents) {
  function hbar(label, value, total, color, trackColor) {
    const pct = total > 0 ? (value / total * 100).toFixed(1) : 0
    return `
      <div class="hbar-label"><span>${label}</span><span>${fmt(value)} tok (${pct}%)</span></div>
      <div class="hbar-track" style="background:${trackColor}">
        <div class="hbar-fill" style="background:${color};width:${pct}%"></div>
      </div>`
  }

  const t          = session.totals
  const totalIn    = t.cacheRead + t.cacheWrite + t.inputRaw
  const writeRead  = t.cacheRead  > 0 ? (t.cacheWrite / t.cacheRead).toFixed(2)  : "—"
  const readsWrite = t.cacheWrite > 0 ? (t.cacheRead  / t.cacheWrite).toFixed(1) : "—"

  const agentRows = agents.map((a, i) => {
    const tagCls = i === 0 ? "agent-main" : `agent-sub${(i - 1) % 3}`
    return `<tr>
      <td><span class="agent-tag ${tagCls}">${a.agentLabel}</span></td>
      <td style="color:#34d399;font-family:monospace">${fmt(a.cumulative.cacheRead)}</td>
      <td style="color:#fbbf24;font-family:monospace">${fmt(a.cumulative.cacheWrite)}</td>
      <td style="color:#f87171;font-family:monospace">${fmt(a.cumulative.inputRaw)}</td>
      <td style="color:#94a3b8;font-family:monospace">${fmt(a.cumulative.output)}</td>
      <td><span class="rate-pill ${a.cumulative.hitRate >= 65 ? "rate-high" : a.cumulative.hitRate >= 40 ? "rate-mid" : "rate-low"}">${a.cumulative.hitRate.toFixed(1)}%</span></td>
    </tr>`
  }).join("")

  return `
    <div class="chart-box">
      <div class="chart-title">Session token breakdown</div>
      ${hbar("Cache read (hits)",      t.cacheRead,  totalIn, "#34d399", "#064e3b")}
      ${hbar("Cache written (seeded)", t.cacheWrite, totalIn, "#fbbf24", "#451a03")}
      ${hbar("Raw input (uncached)",   t.inputRaw,   totalIn, "#f87171", "#450a0a")}
      <p style="font-size:12px;color:var(--subtext);margin-top:12px">
        Write/Read ratio: <strong>${writeRead}</strong> &nbsp;·&nbsp;
        Reads per written token: <strong>${readsWrite}</strong>
      </p>
      <div class="annotation">Higher reads-per-write = more cache leverage. First session turn seeds the cache.</div>
    </div>
    <div class="chart-box">
      <div class="chart-title">Per-agent breakdown</div>
      <table class="data-table">
        <thead><tr><th>Agent</th><th>Read</th><th>Written</th><th>Raw in</th><th>Output</th><th>Hit rate</th></tr></thead>
        <tbody>${agentRows}</tbody>
      </table>
    </div>`
}

// ── Tab 5: Cross-session Heatmap ──────────────────────────────────────────────
function renderHeatmap() {
  const summaries  = data.global.dailySummaries
  const summaryMap = new Map(summaries.map(d => [d.date, d]))

  const days = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }

  const cells = days.map(date => {
    const s = summaryMap.get(date)
    if (!s) return `<div class="hm-cell hm-none" title="${date}: no sessions"></div>`
    const cls = s.hitRate < 40 ? "hm-cold" : s.hitRate < 65 ? "hm-low" : s.hitRate < 80 ? "hm-mid" : "hm-high"
    return `<div class="hm-cell ${cls}" title="${date}: ${s.hitRate.toFixed(1)}% hit rate, ${s.sessionCount} session(s), ${s.turnCount} turns"></div>`
  }).join("")

  const tableRows = summaries.slice().reverse().map(s => {
    const rateCls = s.hitRate >= 65 ? "rate-high" : s.hitRate >= 40 ? "rate-mid" : "rate-low"
    return `<tr>
      <td>${s.date}</td>
      <td>${s.sessionCount}</td>
      <td>${s.turnCount}</td>
      <td><span class="rate-pill ${rateCls}">${s.hitRate.toFixed(1)}%</span></td>
    </tr>`
  }).join("")

  return `
    <div class="chart-box">
      <div class="chart-title">Activity heatmap — last 30 days</div>
      <div class="chart-hint">Hover for details. Color = avg daily hit rate.</div>
      <div class="heatmap-grid">${cells}</div>
      <div class="legend">
        <div class="legend-item"><div class="legend-dot hm-none" style="border:1px solid var(--border)"></div>No sessions</div>
        <div class="legend-item"><div class="legend-dot hm-low"></div>40–65%</div>
        <div class="legend-item"><div class="legend-dot hm-mid"></div>65–80%</div>
        <div class="legend-item"><div class="legend-dot hm-high"></div>&gt;80%</div>
        <div class="legend-item"><div class="legend-dot hm-cold"></div>&lt;40% (cold)</div>
      </div>
    </div>
    <div class="chart-box">
      <div class="chart-title">Daily summary</div>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Sessions</th><th>Turns</th><th>Avg hit rate</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmt(n) {
  return (n ?? 0).toLocaleString()
}

function fmtDate(iso) {
  if (!iso) return ""
  const d         = new Date(iso)
  const today     = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString())
    return `Today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  if (d.toDateString() === yesterday.toDateString())
    return `Yesterday ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
         d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}
