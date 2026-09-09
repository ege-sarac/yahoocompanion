import { INJURY_SNAPSHOT_CONFIG } from "../config/injurySnapshotConfig";
import type {
  ConflictingInjuryEntry,
  DuplicateInjuryMatch,
  InjuryFreshnessResult,
  InjuryMatchingReport,
  InjuryMatchMethod,
  InjurySnapshot,
  InjurySnapshotEntry,
  Player,
  ReturnConfidence,
} from "../types";
import { ALLOWED_INJURY_STATUSES, isValidOptionalIsoDate } from "./playerOverrides";

const RETURN_CONFIDENCE_VALUES: ReturnConfidence[] = [
  "high",
  "medium",
  "low",
  "unknown",
];

export function validateInjurySnapshot(value: unknown): InjurySnapshot {
  if (!isRecord(value)) {
    throw new Error("Injury snapshot must be a JSON object.");
  }
  if (value.schemaVersion !== INJURY_SNAPSHOT_CONFIG.schemaVersion) {
    throw new Error(
      `Injury snapshot schemaVersion must be ${INJURY_SNAPSHOT_CONFIG.schemaVersion}.`,
    );
  }
  if (!isIsoDateTime(value.generatedAt)) {
    throw new Error("Injury snapshot generatedAt must be a valid ISO date/time.");
  }
  if (typeof value.season !== "string" || !value.season.trim()) {
    throw new Error("Injury snapshot season must be non-empty text.");
  }
  if (!Array.isArray(value.entries)) {
    throw new Error("Injury snapshot entries must be an array.");
  }

  return {
    schemaVersion: INJURY_SNAPSHOT_CONFIG.schemaVersion,
    generatedAt: value.generatedAt,
    season: value.season.trim(),
    entries: value.entries.map((entry, index) =>
      validateSnapshotEntry(entry, index),
    ),
  };
}

export function matchInjurySnapshot(
  snapshot: InjurySnapshot,
  players: readonly Player[],
): InjuryMatchingReport {
  const playerById = new Map(players.map((player) => [player.id, player]));
  const exactNameIndex = buildNameIndex(players, normalizePlayerName);
  const accentNameIndex = buildNameIndex(
    players,
    normalizePlayerNameAccentInsensitive,
  );
  const matchedEntries: InjuryMatchingReport["matchedEntries"] = [];
  const unmatchedEntries: InjuryMatchingReport["unmatchedEntries"] = [];
  const conflictingEntries: ConflictingInjuryEntry[] = [];

  snapshot.entries.forEach((entry, entryIndex) => {
    if (entry.playerId) {
      const player = playerById.get(entry.playerId);
      if (player) {
        matchedEntries.push(
          matchedEntry(entry, entryIndex, player, "playerId"),
        );
      } else {
        unmatchedEntries.push({
          entryIndex,
          playerName: entry.playerName,
          reason: `NBA player ID ${entry.playerId} is not in the processed dataset.`,
        });
      }
      return;
    }

    const exactMatches =
      exactNameIndex.get(normalizePlayerName(entry.playerName)) ?? [];
    if (exactMatches.length === 1) {
      matchedEntries.push(
        matchedEntry(entry, entryIndex, exactMatches[0], "exact-name"),
      );
      return;
    }
    if (exactMatches.length > 1) {
      conflictingEntries.push({
        playerName: entry.playerName,
        entryIndexes: [entryIndex],
        reason: "Normalized name matches multiple NBA players.",
      });
      return;
    }

    const accentMatches =
      accentNameIndex.get(
        normalizePlayerNameAccentInsensitive(entry.playerName),
      ) ?? [];
    if (accentMatches.length === 1) {
      matchedEntries.push(
        matchedEntry(
          entry,
          entryIndex,
          accentMatches[0],
          "accent-insensitive-name",
        ),
      );
      return;
    }
    if (accentMatches.length > 1) {
      conflictingEntries.push({
        playerName: entry.playerName,
        entryIndexes: [entryIndex],
        reason: "Accent-insensitive name matches multiple NBA players.",
      });
      return;
    }

    unmatchedEntries.push({
      entryIndex,
      playerName: entry.playerName,
      reason: "No exact normalized NBA player name matched.",
    });
  });

  const duplicateMatches = findDuplicateMatches(matchedEntries);
  for (const duplicate of duplicateMatches) {
    const entries = duplicate.entryIndexes.map(
      (index) => snapshot.entries[index],
    );
    const firstCanonical = canonicalInjuryValue(entries[0]);
    if (
      entries.slice(1).some(
        (entry) => canonicalInjuryValue(entry) !== firstCanonical,
      )
    ) {
      conflictingEntries.push({
        playerId: duplicate.playerId,
        playerName: duplicate.playerName,
        entryIndexes: duplicate.entryIndexes,
        reason: "Multiple snapshot entries assign conflicting injury information.",
      });
    }
  }

  return {
    matchedEntries,
    unmatchedEntries,
    duplicateMatches,
    conflictingEntries,
  };
}

export function mergeInjurySnapshot(
  players: readonly Player[],
  report: InjuryMatchingReport,
): Player[] {
  const injuryByPlayerId = new Map(
    report.matchedEntries.map((match) => [match.playerId, match.entry]),
  );

  return players.map((player) => {
    const entry = injuryByPlayerId.get(player.id);
    if (!entry) {
      return { ...player, currentInjurySource: "default" };
    }
    return {
      ...player,
      injuryStatus: entry.status,
      injuryDescription: entry.injuryDescription ?? null,
      expectedReturnDate: entry.expectedReturnDate ?? null,
      expectedReturnText: entry.expectedReturnText ?? null,
      returnConfidence: entry.returnConfidence,
      injurySource: {
        sourceName: entry.sourceName,
        sourceUrl: entry.sourceUrl ?? null,
        sourcePublishedAt: entry.sourcePublishedAt ?? null,
        fetchedOrReviewedAt: entry.fetchedOrReviewedAt,
      },
      currentInjurySource: "snapshot",
    };
  });
}

export function prepareInjurySnapshotImport(
  currentSnapshot: InjurySnapshot,
  value: unknown,
  players: readonly Player[],
): { snapshot: InjurySnapshot; report: InjuryMatchingReport } {
  void currentSnapshot;
  const snapshot = validateInjurySnapshot(value);
  const report = matchInjurySnapshot(snapshot, players);
  if (report.duplicateMatches.length > 0) {
    throw new Error(
      `Injury snapshot contains ${report.duplicateMatches.length} duplicate player match(es).`,
    );
  }
  if (report.conflictingEntries.length > 0) {
    throw new Error(
      `Injury snapshot contains ${report.conflictingEntries.length} conflicting match(es).`,
    );
  }
  return { snapshot, report };
}

export function getInjurySnapshotFreshness(
  generatedAt: string,
  asOfDate = new Date(),
): InjuryFreshnessResult {
  const generatedTime = Date.parse(generatedAt);
  if (!Number.isFinite(generatedTime)) {
    return { freshness: "invalid", ageDays: null };
  }
  const ageDays = Math.max(
    0,
    (asOfDate.getTime() - generatedTime) / (24 * 60 * 60 * 1000),
  );
  if (ageDays <= INJURY_SNAPSHOT_CONFIG.freshThroughDays) {
    return { freshness: "fresh", ageDays };
  }
  if (ageDays <= INJURY_SNAPSHOT_CONFIG.staleAfterDays) {
    return { freshness: "acceptable", ageDays };
  }
  return { freshness: "stale", ageDays };
}

export function getSuspiciousReturnDateWarnings(players: readonly Player[], asOfDate = new Date()): string[] {
  const today = asOfDate.getTime();
  return players.flatMap((player) => {
    if (!player.expectedReturnDate) return [];
    const time = Date.parse(player.expectedReturnDate);
    if (!Number.isFinite(time)) return [`${player.name}: invalid expected return date.`];
    if (player.injuryStatus === "Healthy" && time > today) return [`${player.name}: healthy status has a future return date.`];
    if ((player.injuryStatus === "Out" || player.injuryStatus === "Injured") && time < today - 7 * 86400000) return [`${player.name}: injury status has a return date more than seven days in the past.`];
    return [];
  });
}

export function normalizePlayerName(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[-‐‑–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePlayerNameAccentInsensitive(value: string): string {
  return normalizePlayerName(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function validateSnapshotEntry(
  value: unknown,
  index: number,
): InjurySnapshotEntry {
  const label = `Injury entry ${index + 1}`;
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  if (
    value.playerId !== undefined &&
    (typeof value.playerId !== "string" || !value.playerId.trim())
  ) {
    throw new Error(`${label} has an invalid playerId.`);
  }
  if (typeof value.playerName !== "string" || !value.playerName.trim()) {
    throw new Error(`${label} has an invalid playerName.`);
  }
  if (
    typeof value.status !== "string" ||
    !ALLOWED_INJURY_STATUSES.includes(
      value.status as InjurySnapshotEntry["status"],
    )
  ) {
    throw new Error(`${label} has an invalid status.`);
  }
  if (
    typeof value.returnConfidence !== "string" ||
    !RETURN_CONFIDENCE_VALUES.includes(
      value.returnConfidence as ReturnConfidence,
    )
  ) {
    throw new Error(`${label} has an invalid returnConfidence.`);
  }
  if (typeof value.sourceName !== "string" || !value.sourceName.trim()) {
    throw new Error(`${label} has an invalid sourceName.`);
  }
  if (!isIsoDateTime(value.fetchedOrReviewedAt)) {
    throw new Error(`${label} has an invalid fetchedOrReviewedAt.`);
  }
  if (!isValidOptionalIsoDate(value.expectedReturnDate ?? null)) {
    throw new Error(`${label} has a malformed expectedReturnDate.`);
  }
  validateOptionalText(value.injuryDescription, label, "injuryDescription");
  validateOptionalText(value.expectedReturnText, label, "expectedReturnText");
  validateOptionalText(value.notes, label, "notes");
  validateOptionalText(value.sourceUrl, label, "sourceUrl");
  if (
    value.sourcePublishedAt !== undefined &&
    value.sourcePublishedAt !== null &&
    !isIsoDateTime(value.sourcePublishedAt)
  ) {
    throw new Error(`${label} has an invalid sourcePublishedAt.`);
  }

  return {
    playerId: value.playerId?.trim(),
    playerName: value.playerName.trim(),
    status: value.status as InjurySnapshotEntry["status"],
    injuryDescription: optionalText(value.injuryDescription),
    expectedReturnDate:
      (value.expectedReturnDate as string | null | undefined) ?? null,
    expectedReturnText: optionalText(value.expectedReturnText),
    returnConfidence: value.returnConfidence as ReturnConfidence,
    sourceName: value.sourceName.trim(),
    sourceUrl: optionalText(value.sourceUrl),
    sourcePublishedAt: optionalText(value.sourcePublishedAt),
    fetchedOrReviewedAt: value.fetchedOrReviewedAt as string,
    notes: optionalText(value.notes),
  };
}

function buildNameIndex(
  players: readonly Player[],
  normalizer: (name: string) => string,
): Map<string, Player[]> {
  const index = new Map<string, Player[]>();
  for (const player of players) {
    const key = normalizer(player.name);
    index.set(key, [...(index.get(key) ?? []), player]);
  }
  return index;
}

function matchedEntry(
  entry: InjurySnapshotEntry,
  entryIndex: number,
  player: Player,
  matchMethod: InjuryMatchMethod,
): InjuryMatchingReport["matchedEntries"][number] {
  return {
    entryIndex,
    playerId: player.id,
    playerName: player.name,
    matchMethod,
    entry,
  };
}

function findDuplicateMatches(
  matches: InjuryMatchingReport["matchedEntries"],
): DuplicateInjuryMatch[] {
  const byPlayerId = new Map<string, typeof matches>();
  for (const match of matches) {
    byPlayerId.set(match.playerId, [
      ...(byPlayerId.get(match.playerId) ?? []),
      match,
    ]);
  }
  return [...byPlayerId.values()]
    .filter((matchesForPlayer) => matchesForPlayer.length > 1)
    .map((matchesForPlayer) => ({
      playerId: matchesForPlayer[0].playerId,
      playerName: matchesForPlayer[0].playerName,
      entryIndexes: matchesForPlayer.map(({ entryIndex }) => entryIndex),
    }));
}

function canonicalInjuryValue(entry: InjurySnapshotEntry): string {
  return JSON.stringify({
    status: entry.status,
    injuryDescription: entry.injuryDescription ?? null,
    expectedReturnDate: entry.expectedReturnDate ?? null,
    expectedReturnText: entry.expectedReturnText ?? null,
    returnConfidence: entry.returnConfidence,
  });
}

function validateOptionalText(
  value: unknown,
  label: string,
  field: string,
): void {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new Error(`${label} has an invalid ${field}.`);
  }
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isIsoDateTime(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      value,
    ) ||
    !isValidOptionalIsoDate(value.slice(0, 10))
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
