import { rankPlayers } from "../src/engine/recommendationEngine";
import { readMarketData } from "./marketUtils";
import { readRoleData } from "./roleDataUtils";
import { readCalibratedInputs } from "./draftValueDataUtils";

try {
  const { players, newPlayerInputs } = readCalibratedInputs();
  const result = rankPlayers({ players, draftedPlayerIds: [], myRoster: [], currentRound: 1, currentOverallPick: 1, newPlayerInputs, roleData: readRoleData(), marketData: readMarketData(), teamEcosystemEnabled: true });
  const invalid = result.recommendations.filter((entry) => { const e = entry.expectedGamesProjection; return !Number.isFinite(e.expectedGames) || e.expectedGamesLow > e.expectedGames || e.expectedGames > e.expectedGamesHigh || e.expectedGamesLow < 0 || e.expectedGamesHigh > 82 || entry.seasonValue.seasonVorp !== entry.seasonValue.perGameVorp * e.expectedGames; });
  const highRisk = result.recommendations.filter((entry) => entry.expectedGamesProjection.availabilityRiskLabel === "HIGH RISK").length;
  const comebacks = result.recommendations.filter((entry) => entry.expectedGamesProjection.majorInjuryComeback).length;
  console.log(`Availability projections: ${result.recommendations.length}; high risk: ${highRisk}; major comebacks: ${comebacks}; invalid: ${invalid.length}.`);
  console.log(`Minutes budgets: ${result.teamMinutesDiagnostics.teamsProcessed} teams; outside tolerance: ${result.teamMinutesDiagnostics.teamsOutsideTolerance}; cap violations: ${result.teamMinutesDiagnostics.capViolations}; max total ${result.teamMinutesDiagnostics.maximumTotalMinutes.toFixed(2)}.`);
  if (invalid.length || result.teamMinutesDiagnostics.capViolations) process.exitCode = 1;
} catch (error) { console.error("Availability validation failed:", error instanceof Error ? error.message : error); process.exitCode = 1; }
