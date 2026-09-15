export type RoleDataSourceFlag = "NBA Advanced" | "NBA Tracking" | "derived traditional-box-score proxy" | "manual override" | "missing";

export interface PlayerRoleMetrics {
  playerId: string;
  season: string;
  team?: string;
  games?: number;
  minutesPerGame?: number;
  starterRate?: number;
  usagePct?: number;
  trueShootingPct?: number;
  turnoverPct?: number;
  assistPct?: number;
  potentialAssistsPer36?: number;
  touchesPer36?: number;
  timeOfPossessionPer36?: number;
  timeOfPossessionPctOfMinutes?: number;
  passesMadePer36?: number;
  passesReceivedPer36?: number;
  offensiveReboundPct?: number;
  defensiveReboundPct?: number;
  totalReboundPct?: number;
  reboundChancesPer36?: number;
  fgaPer36?: number;
  ftaPer36?: number;
  turnoversPer36?: number;
  pointsPer36?: number;
  assistsPer36?: number;
  offensiveReboundsPer36?: number;
  defensiveReboundsPer36?: number;
  stealsPer36?: number;
  blocksPer36?: number;
  pace?: number;
  dataCompleteness: number;
  dataSourceFlags: RoleDataSourceFlag[];
}

export interface PlayerRoleGame {
  playerId: string;
  team: string;
  gameId: string;
  gameDate: string;
  teamGameNumber: number;
  minutes: number;
  points: number;
  fga: number;
  fta: number;
  assists: number;
  turnovers: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  steals: number;
  blocks: number;
  usagePct?: number;
  trueShootingPct?: number;
  pace?: number;
}

export interface TeamGameParticipation {
  team: string;
  gameId: string;
  gameDate: string;
  teamGameNumber: number;
  playerIds: string[];
}

export type LateSeasonRegimeType =
  | "NO_MEANINGFUL_CHANGE"
  | "SUSTAINED_ROLE_GAIN"
  | "SUSTAINED_ROLE_LOSS"
  | "TRADE_ROLE_CHANGE"
  | "ABSENCE_DEPENDENT_BOOST"
  | "RETURN_FROM_INJURY_RAMP"
  | "LATE_SEASON_DEVELOPMENT_ROLE"
  | "END_SEASON_VOLATILITY"
  | "EFFICIENCY_SPIKE_WITHOUT_ROLE_CHANGE"
  | "UNKNOWN_INSUFFICIENT_SAMPLE";

export interface RoleWindowSummary {
  games: number;
  minutesPerGame?: number;
  usagePct?: number;
  trueShootingPct?: number;
  fgaPer36?: number;
  assistsPer36?: number;
  reboundsPer36?: number;
  fantasyPointsPerMinute?: number;
}

export interface LateSeasonRegime {
  type: LateSeasonRegimeType;
  roleChangeScore: number;
  regimeConfidence: number;
  persistenceScore: number;
  direction: -1 | 0 | 1;
  regimeWeight: number;
  absenceDependencyScore: number;
  returnRampDetected: boolean;
  finalWeekVolatility: boolean;
  currentTeamMatch: boolean;
  roleMetricAgreement: number;
  windows: {
    fullSeason: RoleWindowSummary;
    firstTwoThirds: RoleWindowSummary;
    finalThird: RoleWindowSummary;
    postAllStar: RoleWindowSummary;
    postTradeDeadline: RoleWindowSummary;
    last20: RoleWindowSummary;
    last10: RoleWindowSummary;
    last5: RoleWindowSummary;
    currentTeamStint: RoleWindowSummary;
  };
  reasons: string[];
}

export interface TeammateDependency {
  teammatePlayerId: string;
  gamesWith: number;
  gamesWithout: number;
  roleChangeWhenAbsent: number;
  dependencyScore: number;
  teammateStillOnCurrentTeam: boolean;
}

export interface PlayerRoleHistoryRecord {
  playerId: string;
  seasons: PlayerRoleMetrics[];
  latestSeasonGames: PlayerRoleGame[];
  regime?: LateSeasonRegime;
  teammateDependencies?: TeammateDependency[];
}

export interface PlayerRoleDataSet {
  schemaVersion: 1;
  generatedAt: string | null;
  seasonsIncluded: string[];
  sourceCoverage: {
    advancedPlayerSeasons: number;
    trackingPlayerSeasons: number;
    playersWithGameLogs: number;
    sourceFlags: RoleDataSourceFlag[];
  };
  players: PlayerRoleHistoryRecord[];
  teamGames: TeamGameParticipation[];
  warnings: string[];
}

export interface RoleContextSummary {
  usagePctBaseline?: number;
  usagePctRecent?: number;
  usageChange?: number;
  creationRoleChange?: number;
  reboundRoleChange?: number;
  lateSeasonRegime?: LateSeasonRegimeType;
  regimeConfidence?: number;
  lateSeasonPersistenceScore?: number;
  absenceDependencyScore?: number;
  roleSustainability?: number;
  lateSeasonMinutesChange?: number;
  adjustmentPercent: number;
  roleReasons: string[];
}
