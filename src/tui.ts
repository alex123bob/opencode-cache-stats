import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { onCleanup } from "solid-js"
import { jsx } from "@opentui/solid/jsx-runtime"
import {
  type AgentEntry,
  renderAgentSection,
  extractTokens,
  extractSessionParent,
  isCompletedAssistant,
  accumulateStats,
} from "./shared.js"

function CacheStatsWidget(props: Record<string, unknown>) {
  const api        = props.api as Parameters<TuiPlugin>[0]
  const subscribe  = props.subscribe as (fn: () => void) => () => void
  const getAgents  = props.getAgents as () => AgentEntry[]
  const onToggle   = props.onToggle as (sessionID: string) => void
  let containerRef: any

  const sync = () => {
    if (!containerRef) return
    const agents = getAgents()

    // Remove old children
    for (const child of containerRef.getChildren()) {
      containerRef.remove(child)
    }

    if (agents.length === 0) {
      containerRef.visible = false
      containerRef.height  = 0
      api.renderer.requestRender()
      return
    }

    containerRef.visible = true
    containerRef.height  = "auto"

    const active   = agents.filter(a => a.isActive).sort((a, b) => b.lastActive - a.lastActive)
    const finished = agents.filter(a => !a.isActive).sort((a, b) => b.lastActive - a.lastActive)

    for (const agent of [...active, ...finished]) {
      const content = renderAgentSection(agent)
      const node = jsx("text", {
        fg:       api.theme.current.textMuted,
        children: content,
        onClick:  () => onToggle(agent.sessionID),
      })
      containerRef.add(node)
    }

    api.renderer.requestRender()
  }

  onCleanup(subscribe(sync))

  return jsx("box", {
    ref:    (ref: any) => { containerRef = ref; sync() },
    layout: "vertical",
  })
}

export const tui: TuiPlugin = async (api) => {
  // Per-agent cumulative stats — TUI process accumulates independently from server process
  const agents        = new Map<string, AgentEntry>()
  const idleTimers    = new Map<string, ReturnType<typeof setTimeout>>()
  // sessionParents: populated from session.created events; used to detect subagents
  const sessionParents = new Map<string, string | null>()  // sessionID → parentID
  let   subagentCount = 0
  const IDLE_MS       = 30_000

  // Subscriber pattern: sidebar component subscribes, bump() notifies on each update
  const listeners = new Set<() => void>()
  const bump      = () => { for (const fn of listeners) fn() }
  const subscribe = (fn: () => void): (() => void) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  const getAgents = (): AgentEntry[] => Array.from(agents.values())

  const toggleCollapse = (sessionID: string) => {
    const entry = agents.get(sessionID)
    if (!entry) return
    agents.set(sessionID, { ...entry, collapsed: !entry.collapsed })
    bump()
  }

  const markIdle = (sessionID: string) => {
    const entry = agents.get(sessionID)
    if (!entry) return
    agents.set(sessionID, { ...entry, isActive: false, collapsed: true })
    bump()
  }

  const resetIdleTimer = (sessionID: string) => {
    const existing = idleTimers.get(sessionID)
    if (existing) clearTimeout(existing)
    idleTimers.set(sessionID, setTimeout(() => markIdle(sessionID), IDLE_MS))
  }

  // Track session parentID from session.created events
  const offSession = api.event.on("session.created", (evt) => {
    const s = extractSessionParent(evt)
    if (s) sessionParents.set(s.sessionID, s.parentID)
  })

  // Accumulate stats from message.updated events
  const offMessage = api.event.on("message.updated", (evt) => {
    if (!isCompletedAssistant(evt)) return

    const info      = (evt.properties as any).info
    const sessionID = info.sessionID as string
    const tokens    = extractTokens(info)

    // Register agent on first sight
    if (!agents.has(sessionID)) {
      const parentID   = sessionParents.get(sessionID) ?? null
      const isSubagent = parentID !== null
      const label      = isSubagent ? `Subagent ${++subagentCount}` : "Main Agent"
      agents.set(sessionID, {
        sessionID,
        parentID,
        label,
        isActive:   true,
        collapsed:  false,
        lastActive: Date.now(),
        stats:      accumulateStats(undefined, tokens),
      })
    } else {
      const prev = agents.get(sessionID)!
      agents.set(sessionID, {
        ...prev,
        isActive:   true,
        lastActive: Date.now(),
        stats:      accumulateStats(prev.stats, tokens),
      })
    }

    resetIdleTimer(sessionID)
    bump()
  })

  api.slots.register({
    slots: {
      sidebar_content: (_ctx, _slotProps) =>
        jsx(CacheStatsWidget, {
          api,
          subscribe,
          getAgents,
          onToggle: toggleCollapse,
        }),
    },
  })

  api.lifecycle.onDispose(() => {
    offSession()
    offMessage()
    for (const t of idleTimers.values()) clearTimeout(t)
    idleTimers.clear()
  })
}

// ── Plugin metadata ────────────────────────────────────────────────────────

export const id = "opencode-cache-stats"

export default { id, tui } satisfies TuiPluginModule
