import { isCompletedAssistant, extractTokens, accumulateStats, renderCacheStats } from './chunk-OFH6IIJI.js';

// src/tui.ts
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
  let offSlots;
  try {
    let CacheStatsText2 = function(props) {
      const sessionID = props.sessionID;
      const propApi = props.api;
      const propSub = props.subscribe;
      if (!propSub || !propApi) return null;
      let textNode;
      const sync = () => {
        if (!textNode) return;
        const content = renderCacheStats(sessionStats.get(sessionID));
        textNode.content = content;
        textNode.visible = content.length > 0;
        textNode.height = content.length > 0 ? "auto" : 0;
        propApi.renderer.requestRender();
      };
      onCleanup(propSub(sync));
      return jsx("text", {
        ref: (ref) => {
          textNode = ref;
          sync();
        },
        fg: propApi.theme.current.textMuted,
        children: renderCacheStats(sessionStats.get(sessionID)) ?? ""
      });
    };
    var CacheStatsText = CacheStatsText2;
    const { jsx } = await import('@opentui/solid/jsx-runtime');
    const { onCleanup } = await import('solid-js');
    const registration = api.slots.register({
      slots: {
        sidebar_content: (_ctx, slotProps) => jsx(CacheStatsText2, {
          sessionID: slotProps.session_id ?? "",
          api,
          subscribe
        })
      }
    });
    offSlots = typeof registration === "function" ? registration : void 0;
  } catch {
  }
  api.lifecycle.onDispose(() => {
    offMessage();
    offSlots?.();
  });
};
var tui_default = tui;

export { tui_default as default, tui };
