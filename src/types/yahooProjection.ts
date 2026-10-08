export interface YahooDefaultProjection {
  playerId: string;
  playerName: string;
  team: string | null;
  rank: number;
  yahooSourceSlotFppg: number;
  gp: number;
  mpg: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  usagePct?: number;
}

export interface YahooDefaultProjectionDataSet {
  schemaVersion: 1;
  importedAt: string;
  sourceFilename: string;
  entries: YahooDefaultProjection[];
  matchingReport: { totalRows: number; matched: number; unmatched: string[]; ambiguous: string[] };
}

export interface YahooProjectionComparison {
  available: boolean;
  yahooSourceSlotFppg?: number;
  leagueAdjustedYahooFantasyPPG?: number;
  internalComparableFantasyPPG: number;
  projectionGap?: number;
  absoluteProjectionGap?: number;
  threshold: number;
  sourceSelected: "INTERNAL" | "YAHOO_EXTERNAL";
  selectionReason: "INTERNAL_WITHIN_EXTERNAL_TOLERANCE" | "YAHOO_EXTERNAL_OVERRIDE_GT_CONFIGURED_THRESHOLD" | "YAHOO_UNAVAILABLE_OR_PARTIAL";
  reboundSplitSource?: "HISTORICAL_WEIGHTED" | "INTERNAL_PROJECTION_RATIO" | "PARTIAL_SCORING_CONFIDENCE";
  derivedOffensiveRebounds?: number;
  derivedDefensiveRebounds?: number;
  ddTdSource?: "INTERNAL_GENERIC_ESTIMATE";
}
