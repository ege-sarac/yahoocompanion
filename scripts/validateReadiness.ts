import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyNbaPositionFallbacks } from "../src/engine/playerOverrides";
import { validateNewPlayerOverrides } from "../src/engine/newPlayerOverrides";
import { matchInjurySnapshot, validateInjurySnapshot } from "../src/engine/injurySnapshot";
import { DEFAULT_LEAGUE_CONFIG, getTotalDraftPicks, validateLeagueConfig } from "../src/config/leagueConfig";
import type { Player } from "../src/types";
import { rankPlayers } from "../src/engine/recommendationEngine";
import { readRoleData } from "./roleDataUtils";

try {
  const players = JSON.parse(readFileSync(resolve("data", "processed", "players.json"), "utf8")) as Player[];
  const known = new Set(players.map((player) => player.id));
  const newcomers = validateNewPlayerOverrides(JSON.parse(readFileSync(resolve("data", "manual", "newPlayerOverrides.json"), "utf8")), known);
  const injury = validateInjurySnapshot(JSON.parse(readFileSync(resolve("data", "manual", "currentInjuries.json"), "utf8")));
  const injuryReport = matchInjurySnapshot(injury, players);
  const positioned = applyNbaPositionFallbacks(players);
  const roleData = readRoleData();
  const ranking = rankPlayers({ players: positioned, draftedPlayerIds: [], myRoster: [], currentRound: 1, newPlayerInputs: newcomers, roleData, teamEcosystemEnabled: true });
  validateLeagueConfig(DEFAULT_LEAGUE_CONFIG);
  const duplicateIds = players.length - known.size;
  const zeroHistory = players.filter((player) => player.historicalStats.length === 0).length;
  console.log(`Players: ${players.length}; duplicate IDs: ${duplicateIds}; missing teams: ${players.filter((p) => !p.nbaTeam).length}`);
  console.log(`Positions: ${positioned.filter((p) => p.positionSource === "NBA fallback").length} fallback; ${positioned.filter((p) => p.positionSource === "unknown").length} unknown`);
  console.log(`Newcomers: ${zeroHistory} zero-history; ${newcomers.length} repository overrides`);
  console.log(`Injuries: ${injuryReport.matchedEntries.length} matched; ${injuryReport.unmatchedEntries.length} unmatched`);
  console.log(`Default league: ${DEFAULT_LEAGUE_CONFIG.teamCount} teams; ${DEFAULT_LEAGUE_CONFIG.rounds} rounds; ${getTotalDraftPicks(DEFAULT_LEAGUE_CONFIG)} picks`);
  console.log(`Role data: ${roleData?.sourceCoverage.advancedPlayerSeasons ?? 0} advanced player-seasons; ${roleData?.sourceCoverage.trackingPlayerSeasons ?? 0} tracking; ${roleData?.sourceCoverage.playersWithGameLogs ?? 0} game-log players`);
  console.log(`Team ecosystem: ${ranking.teamEcosystemDiagnostics.teamsBuilt} teams; ${ranking.teamEcosystemDiagnostics.capViolations} cap violations; default diversification ${ranking.teamDiversificationMode} at ${ranking.preferredMaxSameTeam}`);
  if (duplicateIds || injuryReport.conflictingEntries.length) process.exitCode = 1;
} catch (error) {
  console.error("Readiness validation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
