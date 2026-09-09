export type YahooPosition = "G" | "F" | "C";
export type PositionSource = "manual Yahoo" | "NBA fallback" | "unknown";

export type InjuryStatus =
  | "Healthy"
  | "Day-to-day"
  | "Out"
  | "Injured"
  | "Returning soon"
  | "Unknown";

export interface HistoricalStats {
  season: string;
  gamesPlayed: number;
  minutesPerGame: number;
  points: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
}

export interface Projection {
  projectedGames: number;
  projectedMinutes: number;
  projectedPoints: number;
  projectedOffensiveRebounds: number;
  projectedDefensiveRebounds: number;
  projectedAssists: number;
  projectedSteals: number;
  projectedBlocks: number;
  projectedTurnovers: number;
  projectedDoubleDoubles: number;
  projectedTripleDoubles: number;
  projectedFantasyPointsPerGame: number;
  projectedMinutesLow?: number;
  projectedMinutesHigh?: number;
  projectedFantasyPointsPerGameLow?: number;
  projectedFantasyPointsPerGameHigh?: number;
}

export interface DataSourceMetadata {
  source: string;
  fetchedAt: string;
  seasonsIncluded: string[];
  catalogSeason?: string;
  catalogSources?: string[];
}

export interface Player {
  id: string;
  name: string;
  nbaTeam: string | null;
  nbaPosition?: string | null;
  nbaExperience?: string | null;
  isRookie?: boolean | null;
  yahooPositions: YahooPosition[];
  positionSource?: PositionSource;
  age: number | null;
  injuryStatus: InjuryStatus | null;
  injuryDescription?: string | null;
  expectedReturnDate: string | null;
  expectedReturnText?: string | null;
  returnConfidence?: import("./injurySnapshot").ReturnConfidence;
  injurySource?: import("./injurySnapshot").InjurySourceMetadata;
  currentInjurySource?: "manual" | "snapshot" | "default";
  historicalStats: HistoricalStats[];
  projections: Projection | null;
  injuryRisk: number | null;
  opportunityScore: number | null;
  breakoutScore: number | null;
  notes?: string;
  dataSource?: DataSourceMetadata;
}
