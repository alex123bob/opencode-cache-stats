import { mkdirSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// src/shared.ts
var STATS_FILE = join(homedir(), ".config", "opencode", "cache-stats.jsonl");
function computeHitRate(cacheRead, totalInput) {
  if (totalInput <= 0) return 0;
  return Math.round(cacheRead / totalInput * 1e3) / 10;
}
function fmt(n) {
  return n.toLocaleString();
}
function renderCacheStats(stats) {
  if (!stats) return "";
  const totalInput = stats.cacheRead + stats.cacheWrite + stats.inputRaw;
  const sep = "\u2500\u2500 Cache " + "\u2500".repeat(20);
  if (totalInput <= 0) {
    return [
      sep,
      `  No cache data (turn ${stats.turnCount})`,
      `  (provider may not report cache tokens)`
    ].join("\n");
  }
  const hitRate = computeHitRate(stats.cacheRead, totalInput);
  const lines = [
    sep,
    `  Hit rate:  ${hitRate.toFixed(1)}%`,
    `  Read:      ${fmt(stats.cacheRead)} tok`
  ];
  if (stats.cacheWrite > 0) {
    lines.push(`  Written:   ${fmt(stats.cacheWrite)} tok`);
  }
  lines.push(
    `  Raw input: ${fmt(stats.inputRaw)} tok`,
    `  Output:    ${fmt(stats.output)} tok`,
    `  Turns:     ${stats.turnCount}`
  );
  return lines.join("\n");
}
var _statsDirEnsured = false;
function appendJsonl(record) {
  try {
    if (!_statsDirEnsured) {
      mkdirSync(join(homedir(), ".config", "opencode"), { recursive: true });
      _statsDirEnsured = true;
    }
    appendFileSync(STATS_FILE, JSON.stringify(record) + "\n", "utf8");
  } catch {
  }
}
function extractTokens(info) {
  return {
    cacheRead: info?.tokens?.cache?.read ?? 0,
    cacheWrite: info?.tokens?.cache?.write ?? 0,
    inputRaw: info?.tokens?.input ?? 0,
    output: info?.tokens?.output ?? 0,
    providerID: info?.providerID ?? "unknown",
    modelID: info?.modelID ?? "unknown"
  };
}
function isCompletedAssistant(event) {
  if (event?.type !== "message.updated") return false;
  const info = event?.properties?.info;
  return info?.role === "assistant" && !!info?.time?.completed && !!info?.sessionID;
}
function accumulateStats(prev, tokens) {
  const base = prev ?? {
    cacheRead: 0,
    cacheWrite: 0,
    inputRaw: 0,
    output: 0,
    turnCount: 0,
    providerID: tokens.providerID,
    modelID: tokens.modelID
  };
  return {
    cacheRead: base.cacheRead + tokens.cacheRead,
    cacheWrite: base.cacheWrite + tokens.cacheWrite,
    inputRaw: base.inputRaw + tokens.inputRaw,
    output: base.output + tokens.output,
    turnCount: base.turnCount + 1,
    providerID: tokens.providerID,
    modelID: tokens.modelID
  };
}

export { accumulateStats, appendJsonl, computeHitRate, extractTokens, isCompletedAssistant, renderCacheStats };
