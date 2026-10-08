import type { InjuryStatus } from "./player";

export type ReturnConfidence = "high" | "medium" | "low" | "unknown";
export type InjuryAvailabilityClass = "DAY_TO_DAY" | "OPENING_WEEKS" | "FIRST_QUARTER" | "MIDSEASON" | "LATE_SEASON" | "MOST_OF_SEASON" | "FULL_SEASON" | "RETURN_RAMP" | "UNKNOWN";
export type CurrentHealthStatus = "HEALTHY_CLEARED" | "FULL_PARTICIPATION" | "RETURNING_SOON" | "RETURN_RAMP" | "LIMITED" | "INJURED" | "OUT_LONG_TERM" | "UNKNOWN";
export type InjuryMatchMethod =
  | "playerId"
  | "exact-name"
  | "accent-insensitive-name";
export type InjurySnapshotFreshness =
  | "fresh"
  | "acceptable"
  | "stale"
  | "invalid";

export interface InjurySnapshotEntry {
  playerId?: string;
  playerName: string;
  status: InjuryStatus;
  injuryDescription?: string | null;
  expectedReturnDate?: string | null;
  expectedReturnText?: string | null;
  returnConfidence: ReturnConfidence;
  sourceName: string;
  sourceUrl?: string | null;
  sourcePublishedAt?: string | null;
  fetchedOrReviewedAt: string;
  notes?: string | null;
  availabilityClass?: InjuryAvailabilityClass;
  currentHealthStatus?: CurrentHealthStatus;
  expectedGamesLowOverride?: number;
  expectedGamesBaseOverride?: number;
  expectedGamesHighOverride?: number;
}

export interface InjurySnapshot {
  schemaVersion: number;
  generatedAt: string;
  season: string;
  entries: InjurySnapshotEntry[];
}

export interface MatchedInjuryEntry {
  entryIndex: number;
  playerId: string;
  playerName: string;
  matchMethod: InjuryMatchMethod;
  entry: InjurySnapshotEntry;
}

export interface UnmatchedInjuryEntry {
  entryIndex: number;
  playerName: string;
  reason: string;
}

export interface DuplicateInjuryMatch {
  playerId: string;
  playerName: string;
  entryIndexes: number[];
}

export interface ConflictingInjuryEntry {
  playerId?: string;
  playerName: string;
  entryIndexes: number[];
  reason: string;
}

export interface InjuryMatchingReport {
  matchedEntries: MatchedInjuryEntry[];
  unmatchedEntries: UnmatchedInjuryEntry[];
  duplicateMatches: DuplicateInjuryMatch[];
  conflictingEntries: ConflictingInjuryEntry[];
}

export interface InjuryFreshnessResult {
  freshness: InjurySnapshotFreshness;
  ageDays: number | null;
}

export interface InjurySourceMetadata {
  sourceName: string;
  sourceUrl: string | null;
  sourcePublishedAt: string | null;
  fetchedOrReviewedAt: string;
}
