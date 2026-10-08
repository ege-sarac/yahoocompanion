export type NewPlayerClass =
  | "Rookie"
  | "International newcomer"
  | "Returning NBA veteran"
  | "G League / developmental"
  | "Other newcomer"
  | "Unknown";

export type NewPlayerPreviousLeague =
  | "NCAA"
  | "International"
  | "G League"
  | "Prior NBA"
  | "Other"
  | "Unknown";

export type NewPlayerRoleExpectation =
  | "Likely starter"
  | "Rotation"
  | "Bench"
  | "Unclear";

export type NewPlayerClassificationConfidence =
  | "high"
  | "medium"
  | "low";

export type ExpectedMinutesSource =
  | "availability status"
  | "manual expected NBA MPG range"
  | "manual expected NBA MPG"
  | "role expectation"
  | "draft capital / age / previous MPG heuristic"
  | "classification fallback";

export type ProjectionSource =
  | "Veteran NBA history"
  | "Rookie/new-player model"
  | "Yahoo external baseline";

export type NbaAvailabilityStatus =
  | "NBA roster"
  | "Two-way contract"
  | "G League assignment"
  | "Unsigned"
  | "Overseas / stash"
  | "Not expected to play"
  | "Unknown";

export interface NewPlayerSourceMetadata {
  sourceName?: string | null;
  sourceUrl?: string | null;
  reviewedAt?: string | null;
}

export interface NewPlayerProjectionInput {
  playerId: string;
  classification: NewPlayerClass;
  age?: number | null;
  nbaDraftYear?: number | null;
  nbaDraftRound?: number | null;
  nbaDraftPick?: number | null;
  previousLeague?: NewPlayerPreviousLeague;
  previousTeamOrSchool?: string | null;
  previousGames?: number | null;
  previousMinutesPerGame?: number | null;
  previousPointsPerGame?: number | null;
  previousOffensiveReboundsPerGame?: number | null;
  previousDefensiveReboundsPerGame?: number | null;
  previousAssistsPerGame?: number | null;
  previousStealsPerGame?: number | null;
  previousBlocksPerGame?: number | null;
  previousTurnoversPerGame?: number | null;
  expectedNbaMinutes?: number | null;
  expectedNbaMinutesLow?: number | null;
  expectedNbaMinutesBase?: number | null;
  expectedNbaMinutesHigh?: number | null;
  nbaAvailabilityStatus?: NbaAvailabilityStatus;
  roleExpectation?: NewPlayerRoleExpectation;
  summerLeagueGames?: number | null;
  summerLeagueMinutesPerGame?: number | null;
  summerLeaguePointsPerGame?: number | null;
  summerLeagueReboundsPerGame?: number | null;
  summerLeagueAssistsPerGame?: number | null;
  summerLeagueStealsPerGame?: number | null;
  summerLeagueBlocksPerGame?: number | null;
  summerLeagueTurnoversPerGame?: number | null;
  source?: NewPlayerSourceMetadata;
  notes?: string | null;
}

export interface NewPlayerClassification {
  classification: NewPlayerClass;
  confidence: NewPlayerClassificationConfidence;
  confidenceScore: number;
  basis: string;
}

export interface NewPlayerProjectionDetails {
  classification: NewPlayerClass;
  classificationConfidence: NewPlayerClassificationConfidence;
  expectedMinutesSource: ExpectedMinutesSource;
  expectedMinutesRange: readonly [number, number];
  draftCapitalContribution: number;
  previousLeague: NewPlayerPreviousLeague;
  previousLeagueTranslationFactor: number;
  sampleSizeAdjustment: number;
  metadataCompleteness: number;
  confidenceAdjustment: number;
  usedConservativeFallback: boolean;
  warnings: string[];
  nbaAvailabilityStatus: NbaAvailabilityStatus;
  draftYearDecay: number;
  summerLeagueWeight: number;
}

export interface NewPlayerSanityWarning {
  playerId: string;
  playerName: string;
  warning: string;
}
