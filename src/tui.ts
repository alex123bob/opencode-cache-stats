import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import {
  type SessionStats,
  renderCacheStats,
  extractTokens,
  isCompletedAssistant,
  accumulateStats,
} from "./shared.js"

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

  // Register sidebar_content slot — gracefully skip if @opentui is unavailable
  let offSlots: (() => void) | undefined

  try {
    const { jsx }       = await import("@opentui/solid/jsx-runtime")
    const { onCleanup } = await import("solid-js")

    function CacheStatsText(props: Record<string, unknown>) {
      const sessionID = props.sessionID as string
      const propApi   = props.api as typeof api
      const propSub   = props.subscribe as (fn: () => void) => () => void
      if (!propSub || !propApi) return null
      let textNode: any

      const sync = () => {
        if (!textNode) return
        const content = renderCacheStats(sessionStats.get(sessionID))
        textNode.content = content
        textNode.visible = content.length > 0
        textNode.height  = content.length > 0 ? "auto" : 0
        propApi.renderer.requestRender()
      }

      onCleanup(propSub(sync))

      return jsx("text", {
        ref: (ref: any) => { textNode = ref; sync() },
        fg:  propApi.theme.current.textMuted,
        children: renderCacheStats(sessionStats.get(sessionID)) ?? "",
      })
    }

    const registration = api.slots.register({
      slots: {
        sidebar_content: (_ctx: any, slotProps: any) =>
          jsx(CacheStatsText, {
            sessionID: (slotProps.session_id ?? "") as string,
            api,
            subscribe,
          }),
      },
    })

    // slots.register returns an ID string, not a cleanup fn — store for documentation only
    offSlots = typeof registration === "function" ? registration : undefined
  } catch {
    // @opentui unavailable — TUI widget silently disabled; server side still works
  }

  api.lifecycle.onDispose(() => {
    offMessage()
    offSlots?.()
  })
}

export default tui
