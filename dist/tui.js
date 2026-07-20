import { isCompletedAssistant, extractTokens, accumulateStats, renderCacheStats } from './chunk-OFH6IIJI.js';
import { onCleanup } from 'solid-js';
import { jsx } from '@opentui/solid/jsx-runtime';

function CacheStatsWidget(props) {
  props.sessionID;
  const api = props.api;
  const subscribe = props.subscribe;
  const getStats = props.getStats;
  let textNode;
  const sync = () => {
    if (!textNode) return;
    const content = renderCacheStats(getStats());
    textNode.content = content;
    textNode.visible = content.length > 0;
    textNode.height = content.length > 0 ? "auto" : 0;
    api.renderer.requestRender();
  };
  onCleanup(subscribe(sync));
  return jsx("text", {
    ref: (ref) => {
      textNode = ref;
      sync();
    },
    fg: api.theme.current.textMuted,
    children: renderCacheStats(getStats()) ?? ""
  });
}
var tui = async (api) => {
  const sessionStats = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  const bump = () => {
    for (const fn of listeners) fn();
  };
  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  const offMessage = api.event.on("message.updated", (evt) => {
    if (!isCompletedAssistant(evt)) return;
    const info = evt.properties.info;
    const sessionID = info.sessionID;
    const tokens = extractTokens(info);
    sessionStats.set(sessionID, accumulateStats(sessionStats.get(sessionID), tokens));
    bump();
  });
  api.slots.register({
    slots: {
      sidebar_content: (_ctx, slotProps) => jsx(CacheStatsWidget, {
        sessionID: slotProps.session_id ?? "",
        api,
        subscribe,
        getStats: () => sessionStats.get(slotProps.session_id ?? "")
      })
    }
  });
  api.lifecycle.onDispose(() => {
    offMessage();
  });
};
var id = "opencode-cache-stats";
var tui_default = { id, tui };

export { tui_default as default, id, tui };
