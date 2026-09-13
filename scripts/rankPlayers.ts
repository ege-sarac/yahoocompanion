import { rankPlayers } from "../src/engine/recommendationEngine";
import { readRoleData } from "./roleDataUtils";
import { readMarketData } from "./marketUtils";
import { readCalibratedInputs } from "./draftValueDataUtils";

try {
  const { players, newPlayerInputs } = readCalibratedInputs();
  const parsed = players;
  const roleData = readRoleData();
  const roleDebug = process.argv.includes("--role-debug");
  const result = rankPlayers({
    players,
    draftedPlayerIds: [],
    myRoster: [],
    currentRound: 1,
    newPlayerInputs,
    roleData,
    teamEcosystemEnabled: true,
    marketData: readMarketData(),
  });
  const top15 = result.recommendations.slice(0, 15).map((recommendation, index) => ({
    Rank: index + 1,
    Name: recommendation.player.name,
    "Projected FP/G": recommendation.projection.projectedFantasyPointsPerGame.toFixed(2),
    "Projected MPG": recommendation.projection.projectedMinutes.toFixed(2),
    "Expected GP": recommendation.expectedGamesProjection.expectedGames.toFixed(1),
    "Season VORP": recommendation.seasonValue.seasonVorp.toFixed(1),
    "Season equivalent": recommendation.seasonValue.availabilityAdjustedFantasyPointsEquivalent.toFixed(2),
    "Market pick": recommendation.marketTiming.marketPickEstimate ?? "-",
    "Injury risk": recommendation.historicalAvailabilityRisk.toFixed(3),
    Opportunity: recommendation.opportunityScore.toFixed(2),
    Breakout: recommendation.breakoutScore.toFixed(2),
    Confidence: recommendation.modelConfidence.toFixed(3),
    "Final score": recommendation.finalScore.toFixed(2),
    Model: recommendation.projectionSource,
    ...(roleDebug ? { USG: recommendation.roleContextSummary?.usagePctBaseline?.toFixed(1) ?? "-", "Role trend": recommendation.roleContextSummary?.usageChange?.toFixed(1) ?? "-", Regime: recommendation.roleContextSummary?.lateSeasonRegime ?? "fallback", "Team context": recommendation.teamContextSummary?.label ?? "-" } : {}),
  }));

  console.log(
    `Ranked ${result.recommendations.length} players from ${parsed.length} real records.`,
  );
  if (result.excludedForNoHistory > 0) {
    console.warn(
      `${result.excludedForNoHistory} players were excluded because they have no history.`,
    );
  }
  console.log(
    `${result.newPlayerModelCount} players used the rookie/new-player model.`,
  );
  console.log(`Position sources: ${players.filter((p) => p.positionSource === "manual Yahoo").length} manual, ${players.filter((p) => p.positionSource === "NBA fallback").length} NBA fallback, ${players.filter((p) => p.positionSource === "unknown").length} unknown.`);
  if (result.missingEligibilityCount > 0) {
    console.warn(
      `${result.missingEligibilityCount} players have unknown Yahoo eligibility; position components were neutral.`,
    );
  }
  console.table(top15);
} catch (error) {
  console.error(
    "Real-data ranking failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
