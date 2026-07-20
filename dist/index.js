import { isCompletedAssistant, extractTokens, accumulateStats, computeHitRate, appendJsonl } from './chunk-OFH6IIJI.js';

// src/index.ts
var server = async (_input) => {
  const sessionStats = /* @__PURE__ */ new Map();
  return {
    event: async ({ event }) => {
      if (!isCompletedAssistant(event)) return;
      const info = event.properties.info;
      const sessionID = info.sessionID;
      const tokens = extractTokens(info);
      const next = accumulateStats(sessionStats.get(sessionID), tokens);
      sessionStats.set(sessionID, next);
      const totalInput = tokens.cacheRead + tokens.cacheWrite + tokens.inputRaw;
      const record = {
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        sessionID,
        providerID: tokens.providerID,
        modelID: tokens.modelID,
        turn: next.turnCount,
        cacheRead: tokens.cacheRead,
        cacheWrite: tokens.cacheWrite,
        inputRaw: tokens.inputRaw,
        output: tokens.output,
        totalInput,
        hitRate: computeHitRate(tokens.cacheRead, totalInput)
      };
      appendJsonl(record);
    }
  };
};
var id = "opencode-cache-stats";

export { id, server };
