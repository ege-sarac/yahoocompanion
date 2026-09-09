import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalizePlayerNameAccentInsensitive } from "../src/engine/injurySnapshot";

interface CatalogPlayer {
  id: string;
  full_name: string;
  team_abbreviation?: string | null;
  age?: number | null;
}

interface ProcessedPlayer {
  id: string;
  name: string;
  nbaTeam: string | null;
  age: number | null;
  historicalStats: unknown[];
}

try {
  const catalog = readArray<CatalogPlayer>(
    resolve("data", "raw", "current_players.json"),
    isCatalogPlayer,
  );
  const processed = readArray<ProcessedPlayer>(
    resolve("data", "processed", "players.json"),
    isProcessedPlayer,
  );
  const metadata = JSON.parse(
    readFileSync(resolve("data", "raw", "metadata.json"), "utf8"),
  ) as { seasonsIncluded?: unknown };
  if (
    !Array.isArray(metadata.seasonsIncluded) ||
    !metadata.seasonsIncluded.every((season) => typeof season === "string")
  ) {
    throw new Error("Raw metadata has malformed seasonsIncluded.");
  }

  const catalogIds = catalog.map(({ id }) => id);
  const processedIds = processed.map(({ id }) => id);
  const duplicateIds = duplicates(catalogIds);
  const processedDuplicateIds = duplicates(processedIds);
  const processedIdSet = new Set(processedIds);
  const missingFromOutput = catalog.filter(
    ({ id }) => !processedIdSet.has(id),
  );
  const namesByNormalized = new Map<string, CatalogPlayer[]>();
  for (const player of catalog) {
    const key = normalizePlayerNameAccentInsensitive(player.full_name);
    namesByNormalized.set(key, [...(namesByNormalized.get(key) ?? []), player]);
  }
  const duplicateNames = [...namesByNormalized.values()].filter(
    (players) => new Set(players.map(({ id }) => id)).size > 1,
  );

  const historicalIds = new Set<string>();
  for (const season of metadata.seasonsIncluded) {
    const rows = readArray<Record<string, unknown>>(
      resolve("data", "raw", `player_stats_${season}.json`),
      (value): value is Record<string, unknown> =>
        isRecord(value) &&
        (typeof value.PLAYER_ID === "number" ||
          typeof value.PLAYER_ID === "string"),
    );
    for (const row of rows) historicalIds.add(String(row.PLAYER_ID));
  }
  const catalogIdSet = new Set(catalogIds);
  const unmatchedHistorical = [...historicalIds].filter(
    (id) => !catalogIdSet.has(id),
  );
  const zeroHistory = processed.filter(
    ({ historicalStats }) => historicalStats.length === 0,
  );
  const missingTeams = processed.filter(({ nbaTeam }) => !nbaTeam);
  const aj = processed.find(
    ({ name }) => normalizePlayerNameAccentInsensitive(name) === "aj dybantsa",
  );

  console.log(`Total master players: ${catalog.length}`);
  console.log(`Players with NBA history: ${processed.length - zeroHistory.length}`);
  console.log(`Players without NBA history: ${zeroHistory.length}`);
  console.log(`Duplicate catalog IDs: ${duplicateIds.length}`);
  console.log(`Duplicate processed IDs: ${processedDuplicateIds.length}`);
  console.log(`Duplicate normalized names: ${duplicateNames.length}`);
  console.log(`Catalog players missing from output: ${missingFromOutput.length}`);
  console.log(`Unmatched historical player IDs: ${unmatchedHistorical.length}`);
  console.log(`Players missing teams: ${missingTeams.length}`);
  console.log(
    aj
      ? `AJ Dybantsa present: yes (NBA ID ${aj.id}, team ${aj.nbaTeam ?? "unknown"})`
      : "AJ Dybantsa present: no",
  );

  console.log("Zero-history players:");
  console.table(
    zeroHistory.map((player) => ({
      "NBA ID": player.id,
      Name: player.name,
      Team: player.nbaTeam ?? "—",
      Age: player.age ?? "—",
    })),
  );

  if (duplicateNames.length > 0) {
    console.warn("Duplicate normalized catalog names:");
    for (const players of duplicateNames) {
      console.warn(
        `- ${players.map(({ id, full_name }) => `${full_name} (${id})`).join(", ")}`,
      );
    }
  }
  if (unmatchedHistorical.length > 0) {
    console.warn(
      "Historical-only IDs are expected when former players are absent from the current catalog; see data/processed/players.validation.json for the complete list.",
    );
  }
  if (missingTeams.length > 0) {
    console.warn(
      `Missing teams: ${missingTeams.map(({ id, name }) => `${name} (${id})`).join(", ")}`,
    );
  }

  if (
    duplicateIds.length > 0 ||
    processedDuplicateIds.length > 0 ||
    missingFromOutput.length > 0
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    "Player catalog validation failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}

function readArray<T>(
  path: string,
  predicate: (value: unknown) => value is T,
): T[] {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(value) || value.length === 0 || !value.every(predicate)) {
    throw new Error(`${path} is empty or malformed.`);
  }
  return value;
}

function isCatalogPlayer(value: unknown): value is CatalogPlayer {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.full_name === "string"
  );
}

function isProcessedPlayer(value: unknown): value is ProcessedPlayer {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (typeof value.nbaTeam === "string" || value.nbaTeam === null) &&
    (typeof value.age === "number" || value.age === null) &&
    Array.isArray(value.historicalStats)
  );
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicateValues = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    seen.add(value);
  }
  return [...duplicateValues];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
