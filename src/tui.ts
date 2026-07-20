import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import { onCleanup } from "solid-js"
import { jsx } from "@opentui/solid/jsx-runtime"
import {
  type SessionStats,
  renderCacheStats,
  extractTokens,
  isCompletedAssistant,
  accumulateStats,
} from "./shared.js"

function CacheStatsWidget(props: Record<string, unknown>) {
  const sessionID = props.sessionID as string
  const api       = props.api as Parameters<TuiPlugin>[0]
  const subscribe = props.subscribe as (fn: () => void) => () => void
  const getStats  = props.getStats as () => SessionStats | undefined
  let textNode: any

  const sync = () => {
    if (!textNode) return
    const content = renderCacheStats(getStats())
    textNode.content = content
    textNode.visible = content.length > 0
    textNode.height  = content.length > 0 ? "auto" : 0
    api.renderer.requestRender()
  }

  onCleanup(subscribe(sync))

  return jsx("text", {
    ref: (ref: any) => { textNode = ref; sync() },
    fg:  api.theme.current.textMuted,
    children: renderCacheStats(getStats()) ?? "",
  })
}

export const tui: TuiPlugin = async (api) => {
  // Per-session cumulative stats — TUI process accumulates independently from server process
  const sessionStats = new Map<string, SessionStats>()

  // Subscriber pattern: sidebar component subscribes, bump() notifies on each update
  const listeners = new Set<() => void>()
  const bump      = () => { for (const fn of listeners) fn() }
  const subscribe = (fn: () => void): (() => void) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  // Accumulate stats from message.updated events
  const offMessage = api.event.on("message.updated", (evt) => {
    if (!isCompletedAssistant(evt)) return

    const info      = (evt.properties as any).info
    const sessionID = info.sessionID as string
    const tokens    = extractTokens(info)

    sessionStats.set(sessionID, accumulateStats(sessionStats.get(sessionID), tokens))
    bump()
  })

  api.slots.register({
    slots: {
      sidebar_content: (_ctx, slotProps) =>
        jsx(CacheStatsWidget, {
          sessionID: slotProps.session_id ?? "",
          api,
          subscribe,
          getStats: () => sessionStats.get(slotProps.session_id ?? ""),
        }),
    },
  })

  api.lifecycle.onDispose(() => {
    offMessage()
  })
}
