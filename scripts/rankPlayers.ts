import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { rankPlayers } from "../src/engine/recommendationEngine";
import { validateNewPlayerOverrides } from "../src/engine/newPlayerOverrides";
import { applyNbaPositionFallbacks, mergePlayerOverrides, validatePlayerOverrides } from "../src/engine/playerOverrides";
import type { Player } from "../src/types";

const playerDataPath = resolve("data", "processed", "players.json");
const newPlayerOverridesPath = resolve("data", "manual", "newPlayerOverrides.json");
const playerOverridesPath = resolve("data", "manual", "playerOverrides.json");

try {
  const parsed = JSON.parse(readFileSync(playerDataPath, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isPlayer)) {
    throw new Error(`${playerDataPath} is empty or malformed.`);
  }
  const newPlayerInputs = validateNewPlayerOverrides(
    JSON.parse(readFileSync(newPlayerOverridesPath, "utf8")) as unknown,
    new Set(parsed.map((player) => player.id)),
  );

  const fallbackPlayers = applyNbaPositionFallbacks(parsed);
  const playerOverrides = existsSync(playerOverridesPath)
    ? validatePlayerOverrides(JSON.parse(readFileSync(playerOverridesPath, "utf8")) as unknown, new Set(parsed.map((player) => player.id)))
    : [];
  const players = mergePlayerOverrides(fallbackPlayers, playerOverrides);
  const result = rankPlayers({
    players,
    draftedPlayerIds: [],
    myRoster: [],
    currentRound: 1,
    newPlayerInputs,
  });
  const top15 = result.recommendations.slice(0, 15).map((recommendation, index) => ({
    Rank: index + 1,
    Name: recommendation.player.name,
    "Projected FP/G": recommendation.projection.projectedFantasyPointsPerGame.toFixed(2),
    "Projected MPG": recommendation.projection.projectedMinutes.toFixed(2),
    "Injury risk": recommendation.historicalAvailabilityRisk.toFixed(3),
    Opportunity: recommendation.opportunityScore.toFixed(2),
    Breakout: recommendation.breakoutScore.toFixed(2),
    Confidence: recommendation.modelConfidence.toFixed(3),
    "Final score": recommendation.finalScore.toFixed(2),
    Model: recommendation.projectionSource,
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

function isPlayer(value: unknown): value is Player {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const player = value as Record<string, unknown>;
  return (
    typeof player.id === "string" &&
    typeof player.name === "string" &&
    Array.isArray(player.yahooPositions) &&
    Array.isArray(player.historicalStats)
  );
}
