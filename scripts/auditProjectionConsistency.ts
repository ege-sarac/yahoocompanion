import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_LEAGUE_CONFIG, migrateLeagueConfig } from "../src/config/leagueConfig";
import { rankPlayers } from "../src/engine/recommendationEngine";
import type { Player, YahooDefaultProjectionDataSet } from "../src/types";

const players = JSON.parse(readFileSync(resolve("data", "processed", "players.json"), "utf8")) as Player[];
const yahoo = JSON.parse(readFileSync(resolve("data", "processed", "yahooDefaultProjections.json"), "utf8")) as YahooDefaultProjectionDataSet;
const configPath = process.argv[2];
const leagueConfig = configPath ? migrateLeagueConfig(JSON.parse(readFileSync(resolve(configPath), "utf8")) as unknown) : DEFAULT_LEAGUE_CONFIG;
const result = rankPlayers({ players, draftedPlayerIds: [], myRoster: [], currentRound: 1, leagueConfig, yahooDefaultProjections: yahoo });
const warnings: string[] = [];
for (const candidate of result.recommendations) {
  const expected = candidate.expectedGamesProjection.expectedGames, risk = candidate.expectedGamesProjection.availabilityRiskLabel;
  if ((expected >= 70 && risk !== "STABLE") || (expected >= 59 && expected < 70 && risk !== "MODERATE") || (expected < 59 && risk !== "HIGH RISK")) warnings.push(`${candidate.player.name}: expected-games/risk mismatch`);
  const scenarios = candidate.roleScenarioSummary.scenarios;
  if (scenarios[0].healthyGameMPG > scenarios[1].healthyGameMPG || scenarios[1].healthyGameMPG > scenarios[2].healthyGameMPG || scenarios[0].projectedFantasyPointsPerGame > scenarios[1].projectedFantasyPointsPerGame || scenarios[1].projectedFantasyPointsPerGame > scenarios[2].projectedFantasyPointsPerGame) warnings.push(`${candidate.player.name}: scenario order`);
  const comparison = candidate.yahooProjectionComparison;
  if (comparison?.available && comparison.absoluteProjectionGap !== undefined && ((comparison.absoluteProjectionGap <= leagueConfig.externalProjectionFallbackThreshold && comparison.sourceSelected !== "INTERNAL") || (comparison.absoluteProjectionGap > leagueConfig.externalProjectionFallbackThreshold && comparison.sourceSelected !== "YAHOO_EXTERNAL"))) warnings.push(`${candidate.player.name}: Yahoo threshold selection`);
  const values = [candidate.projection.projectedFantasyPointsPerGame, expected, candidate.seasonValue.seasonVorp, candidate.finalScore];
  if (values.some((value) => !Number.isFinite(value))) warnings.push(`${candidate.player.name}: non-finite final value`);
}
const overrides = result.recommendations.filter((candidate) => candidate.yahooProjectionComparison?.sourceSelected === "YAHOO_EXTERNAL").length;
console.log(`Projection consistency audit: ${result.recommendations.length} recommendations; ${overrides} Yahoo baselines; fallback gap ${leagueConfig.externalProjectionFallbackThreshold.toFixed(1)} FP/G; ${warnings.length} warnings.`);
if (warnings.length) console.log(warnings.slice(0, 30).join("\n"));
process.exitCode = warnings.length ? 1 : 0;
