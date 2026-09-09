import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  calculateNewPlayerMetadataCompleteness,
  classifyNewPlayer,
  getNewPlayerSanityWarnings,
  projectNewPlayer,
} from "../src/engine/newPlayerProjection";
import { validateNewPlayerOverrides } from "../src/engine/newPlayerOverrides";
import { rankPlayers } from "../src/engine/recommendationEngine";
import type {
  NewPlayerClass,
  Player,
} from "../src/types";

const playersPath = resolve("data", "processed", "players.json");
const inputsPath = resolve("data", "manual", "newPlayerOverrides.json");

try {
  const players = JSON.parse(readFileSync(playersPath, "utf8")) as Player[];
  if (!Array.isArray(players) || players.length === 0) {
    throw new Error("Processed players are empty or malformed.");
  }
  const zeroHistory = players.filter(
    (player) => player.historicalStats.length === 0,
  );
  const inputs = validateNewPlayerOverrides(
    JSON.parse(readFileSync(inputsPath, "utf8")) as unknown,
    new Set(players.map((player) => player.id)),
  );
  const inputById = new Map(inputs.map((input) => [input.playerId, input]));
  const rows = zeroHistory.map((player) => {
    const input = inputById.get(player.id);
    const classification = classifyNewPlayer(player, input);
    const metrics = projectNewPlayer(player, input);
    return { player, input, classification, metrics };
  });
  const classificationCounts = rows.reduce<Record<NewPlayerClass, number>>(
    (counts, row) => {
      counts[row.classification.classification] += 1;
      return counts;
    },
    {
      Rookie: 0,
      "International newcomer": 0,
      "Returning NBA veteran": 0,
      "G League / developmental": 0,
      "Other newcomer": 0,
      Unknown: 0,
    },
  );
  const conservativeFallbacks = rows.filter(
    ({ metrics }) => metrics.newPlayerDetails?.usedConservativeFallback,
  ).length;
  const earlyRanking = rankPlayers({
    players,
    draftedPlayerIds: [],
    myRoster: [],
    currentRound: 1,
    newPlayerInputs: inputs,
  });
  const earlyScoreById = new Map(
    earlyRanking.recommendations.map((entry) => [entry.player.id, entry.finalScore]),
  );
  const sanityWarnings = rows.flatMap(({ player, input, metrics }) =>
    getNewPlayerSanityWarnings(
      player,
      metrics,
      input,
      earlyScoreById.get(player.id),
    ),
  );

  console.log(`Total zero-history players: ${zeroHistory.length}`);
  console.log(`Classified rookies: ${classificationCounts.Rookie}`);
  console.log(
    `Returning veterans: ${classificationCounts["Returning NBA veteran"]}`,
  );
  console.log(
    `International newcomers: ${classificationCounts["International newcomer"]}`,
  );
  console.log(
    `G League / developmental: ${classificationCounts["G League / developmental"]}`,
  );
  console.log(`Other newcomers: ${classificationCounts["Other newcomer"]}`);
  console.log(`Unknown classification: ${classificationCounts.Unknown}`);
  console.log(`Players with manual metadata: ${inputs.length}`);
  console.log(`Using conservative fallback: ${conservativeFallbacks}`);
  const availabilityCounts = rows.reduce<Record<string, number>>((counts, row) => { const key = row.metrics.newPlayerDetails?.nbaAvailabilityStatus ?? "Unknown"; counts[key] = (counts[key] ?? 0) + 1; return counts; }, {});
  console.log("NBA availability statuses:");
  console.table(availabilityCounts);
  console.log(`Stash / not-playing: ${rows.filter((row) => ["Overseas / stash", "Not expected to play"].includes(row.metrics.newPlayerDetails?.nbaAvailabilityStatus ?? "")).length}`);
  console.log(`Zero projected MPG: ${rows.filter((row) => row.metrics.projection.projectedMinutes === 0).length}`);
  console.log(`Manual MPG ranges: ${inputs.filter((input) => input.expectedNbaMinutesLow != null && input.expectedNbaMinutesBase != null && input.expectedNbaMinutesHigh != null).length}`);
  console.log(`Successfully projected: ${rows.length}`);
  console.log("Invalid entries: 0");
  console.log(`Sanity warnings: ${sanityWarnings.length}`);
  console.table(
    rows.map(({ player, input, classification, metrics }) => ({
      Name: player.name,
      "NBA ID": player.id,
      Team: player.nbaTeam ?? "—",
      Age: player.age ?? "—",
      Experience: player.nbaExperience ?? "—",
      Classification: classification.classification,
      "Class confidence": classification.confidence,
      "Metadata %": Math.round(calculateNewPlayerMetadataCompleteness(input) * 100),
      "Projected FP/G": metrics.projection.projectedFantasyPointsPerGame.toFixed(1),
      "Expected MPG": metrics.projection.projectedMinutes.toFixed(1),
      Confidence: metrics.modelConfidence.toFixed(2),
    })),
  );
  if (sanityWarnings.length > 0) {
    console.warn("Sanity warnings:");
    for (const warning of sanityWarnings) {
      console.warn(`- ${warning.playerName} (${warning.playerId}): ${warning.warning}`);
    }
  }
} catch (error) {
  console.error(
    "New-player validation failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
