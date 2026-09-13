import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyNbaPositionFallbacks } from "../src/engine/playerOverrides";
import { rankPlayers } from "../src/engine/recommendationEngine";
import type { Player } from "../src/types";
import { readRoleData } from "./roleDataUtils";

try {
  const data = readRoleData();
  if (!data) throw new Error("playerRoleHistory.json is missing. Run npm.cmd run roles:process.");
  const players = applyNbaPositionFallbacks(JSON.parse(readFileSync(resolve("data", "processed", "players.json"), "utf8")) as Player[]);
  const known = new Set(players.map((player) => player.id));
  const errors: string[] = [], warnings = [...data.warnings];
  const keys = new Set<string>(); let duplicates = 0, invalidUsage = 0, invalidPct = 0, impossibleMpg = 0;
  for (const record of data.players) for (const metric of record.seasons) {
    const key = `${record.playerId}|${metric.season}`; if (keys.has(key)) duplicates++; keys.add(key);
    if (metric.usagePct !== undefined && (metric.usagePct < 0 || metric.usagePct > 60)) invalidUsage++;
    for (const value of [metric.trueShootingPct, metric.turnoverPct, metric.assistPct, metric.offensiveReboundPct, metric.defensiveReboundPct, metric.totalReboundPct]) if (value !== undefined && (value < 0 || value > 100)) invalidPct++;
    if (metric.minutesPerGame !== undefined && (metric.minutesPerGame < 0 || metric.minutesPerGame > 48.5)) impossibleMpg++;
  }
  if (duplicates) errors.push(`${duplicates} duplicate player-season records`);
  if (invalidUsage) errors.push(`${invalidUsage} invalid USG% values`);
  if (invalidPct) errors.push(`${invalidPct} invalid percentage values`);
  if (impossibleMpg) errors.push(`${impossibleMpg} impossible MPG values`);
  const roleIds = new Set(data.players.map((record) => record.playerId));
  const missing = players.filter((player) => player.historicalStats.length && !roleIds.has(player.id)).length;
  const orphanRecords = data.players.filter((record) => !known.has(record.playerId)).length;
  if (orphanRecords) warnings.push(`${orphanRecords} role records are not in the current player catalog.`);
  if (missing) warnings.push(`${missing} NBA-history players have no role record; Prompt #8.2 fallback applies.`);
  const ranking = rankPlayers({ players, draftedPlayerIds: [], myRoster: [], currentRound: 1, roleData: data, teamEcosystemEnabled: true });
  const regimes = Object.fromEntries([...new Set(data.players.map((record) => record.regime?.type ?? "MISSING"))].sort().map((type) => [type, data.players.filter((record) => (record.regime?.type ?? "MISSING") === type).length]));
  console.log(`NBA-history players: ${players.filter((player) => player.historicalStats.length).length}`);
  for (const season of data.seasonsIncluded) console.log(`${season} advanced coverage: ${data.players.filter((record) => record.seasons.some((metric) => metric.season === season && metric.dataSourceFlags.includes("NBA Advanced"))).length}`);
  console.log(`Tracking player-seasons: ${data.sourceCoverage.trackingPlayerSeasons}`);
  console.log(`Players with game logs: ${data.sourceCoverage.playersWithGameLogs}`);
  console.log(`Missing role records: ${missing}`);
  console.log(`Invalid USG%: ${invalidUsage}; invalid percentages: ${invalidPct}; impossible MPG: ${impossibleMpg}; duplicate player-seasons: ${duplicates}`);
  console.log("Regime counts:", regimes);
  console.log(`Absence-dependent: ${data.players.filter((record) => record.regime?.type === "ABSENCE_DEPENDENT_BOOST").length}; injury-return ramps: ${data.players.filter((record) => record.regime?.returnRampDetected).length}`);
  console.log(`Usage/context cap violations: ${ranking.teamEcosystemDiagnostics.capViolations}`);
  console.log(`Role adjustment cap hits: ${ranking.recommendations.filter((entry) => Math.abs(entry.roleContextSummary?.adjustmentPercent ?? 0) >= .0999).length}`);
  console.log(`Data refresh: ${data.generatedAt ?? "unavailable"}`);
  for (const warning of warnings) console.warn(`WARNING: ${warning}`);
  for (const error of errors) console.error(`ERROR: ${error}`);
  if (errors.length) process.exitCode = 1;
} catch (error) { console.error("Role validation failed:", error instanceof Error ? error.message : error); process.exitCode = 1; }
