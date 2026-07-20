import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { onCleanup } from "solid-js"
import { jsx } from "@opentui/solid/jsx-runtime"
import {
  type AgentEntry,
  type SessionStats,
  renderAllAgents,
  extractTokens,
  isCompletedAssistant,
  accumulateStats,
} from "./shared.js"

function CacheStatsWidget(props: Record<string, unknown>) {
  const api       = props.api as Parameters<TuiPlugin>[0]
  const subscribe = props.subscribe as (fn: () => void) => () => void
  const getAgents = props.getAgents as () => AgentEntry[]
  let textNode: any

  const sync = () => {
    if (!textNode) return
    const content = renderAllAgents(getAgents())
    textNode.content = content
    textNode.visible = content.length > 0
    textNode.height  = content.length > 0 ? "auto" : 0
    api.renderer.requestRender()
  }

  onCleanup(subscribe(sync))

  return jsx("text", {
    ref: (ref: any) => { textNode = ref; sync() },
    fg:  api.theme.current.textMuted,
    children: renderAllAgents(getAgents()) ?? "",
  })
}

export const tui: TuiPlugin = async (api) => {
  // Per-agent cumulative stats — TUI process accumulates independently from server process
  const agents        = new Map<string, AgentEntry>()
  const idleTimers    = new Map<string, ReturnType<typeof setTimeout>>()
  let   subagentCount = 0
  const IDLE_MS       = 30_000

  // Subscriber pattern: sidebar component subscribes, bump() notifies on each update
  const listeners = new Set<() => void>()
  const bump      = () => { for (const fn of listeners) fn() }
  const subscribe = (fn: () => void): (() => void) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  const getAgentsSorted = (): AgentEntry[] => {
    const all      = Array.from(agents.values())
    const active   = all.filter(a => a.isActive).sort((a, b) => b.lastActive - a.lastActive)
    const finished = all.filter(a => !a.isActive).sort((a, b) => b.lastActive - a.lastActive)
    return [...active, ...finished]
  }

  const markIdle = (sessionID: string) => {
    const entry = agents.get(sessionID)
    if (!entry) return
    agents.set(sessionID, { ...entry, isActive: false })
    bump()
  }

  const resetIdleTimer = (sessionID: string) => {
    const existing = idleTimers.get(sessionID)
    if (existing) clearTimeout(existing)
    idleTimers.set(sessionID, setTimeout(() => markIdle(sessionID), IDLE_MS))
  }

  // Accumulate stats from message.updated events
  const offMessage = api.event.on("message.updated", (evt) => {
    if (!isCompletedAssistant(evt)) return

    const info      = (evt.properties as any).info
    const sessionID = info.sessionID as string
    const tokens    = extractTokens(info)

    // Register agent on first sight
    if (!agents.has(sessionID)) {
      const isSubagent = tokens.parentSessionID !== null
      const label      = isSubagent ? `Subagent ${++subagentCount}` : "Main Agent"
      agents.set(sessionID, {
        sessionID,
        parentID:   tokens.parentSessionID,
        label,
        isActive:   true,
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
          getAgents: getAgentsSorted,
        }),
    },
  })

  api.lifecycle.onDispose(() => {
    offMessage()
    for (const t of idleTimers.values()) clearTimeout(t)
    idleTimers.clear()
  })
}

// ── Plugin metadata ────────────────────────────────────────────────────────

export const id = "opencode-cache-stats"

export default { id, tui } satisfies TuiPluginModule
