import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  matchInjurySnapshot,
  mergeInjurySnapshot,
  getSuspiciousReturnDateWarnings,
  validateInjurySnapshot,
} from "../src/engine/injurySnapshot";
import type { InjuryStatus, Player } from "../src/types";

const playersPath = resolve("data", "processed", "players.json");
const snapshotPath = resolve("data", "manual", "currentInjuries.json");

try {
  const playersValue = JSON.parse(readFileSync(playersPath, "utf8")) as unknown;
  if (
    !Array.isArray(playersValue) ||
    playersValue.length === 0 ||
    !playersValue.every(isPlayer)
  ) {
    throw new Error(`${playersPath} is empty or structurally malformed.`);
  }

  const snapshotValue = JSON.parse(
    readFileSync(snapshotPath, "utf8"),
  ) as unknown;
  const snapshot = validateInjurySnapshot(snapshotValue);
  const report = matchInjurySnapshot(snapshot, playersValue);
  const statusDistribution = snapshot.entries.reduce<
    Partial<Record<InjuryStatus, number>>
  >((counts, entry) => {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
    return counts;
  }, {});

  console.log(`Snapshot date: ${snapshot.generatedAt}`);
  console.log(`Season: ${snapshot.season}`);
  console.log(`Entries: ${snapshot.entries.length}`);
  console.log(`Matched: ${report.matchedEntries.length}`);
  console.log(`Unmatched: ${report.unmatchedEntries.length}`);
  console.log(`Duplicate matches: ${report.duplicateMatches.length}`);
  console.log(`Conflicting entries: ${report.conflictingEntries.length}`);
  console.log(`Suspicious return dates: ${getSuspiciousReturnDateWarnings(mergeInjurySnapshot(playersValue, report)).length}`);
  console.log("Status distribution:");
  console.table(statusDistribution);

  if (report.unmatchedEntries.length > 0) {
    console.warn("Unmatched injury entries:");
    for (const unmatched of report.unmatchedEntries) {
      console.warn(`- ${unmatched.playerName}: ${unmatched.reason}`);
    }
  }
  if (report.duplicateMatches.length > 0) {
    console.warn("Duplicate injury matches:");
    for (const duplicate of report.duplicateMatches) {
      console.warn(
        `- ${duplicate.playerName}: entries ${duplicate.entryIndexes
          .map((index) => index + 1)
          .join(", ")}`,
      );
    }
  }
} catch (error) {
  console.error(
    "Injury snapshot validation failed:",
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
    Array.isArray(player.historicalStats)
  );
}
