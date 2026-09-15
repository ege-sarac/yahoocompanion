import type { ProjectionMetrics } from "./recommendation";

export interface PlayerRoleProfile {
  usageRoleScore: number;
  creationRoleScore: number;
  ballDominanceRoleScore: number;
  reboundingRoleScore: number;
  rimProtectionRoleScore: number;
  guardMinutesRoleScore: number;
  forwardMinutesRoleScore: number;
  centerMinutesRoleScore: number;
  expectedUsagePct?: number;
  pace?: number;
  source: "measured" | "derived proxy" | "projection heuristic";
}

export interface TeamRoleDebug {
  team: string;
  playerCount: number;
  normalizedMinuteShares: Record<string, number>;
  supply: PlayerRoleProfile;
  vacuums: PlayerRoleProfile;
  congestion: PlayerRoleProfile;
  teamUsageLoadBefore: number;
  teamUsageLoadAfter: number;
  creationCongestion: number;
  creationVacuum: number;
  frontcourtCongestion: number;
  frontcourtVacuum: number;
  projectedPace: number;
  projectedMinutesBefore?: number;
  projectedMinutesAfter?: number;
  minuteBudgetOutsideTolerance?: boolean;
}

export interface TeamContextSummary {
  label: "Positive" | "Neutral" | "Crowded";
  roleSecurity: number;
  scoringCompetition: number;
  creationCompetition: number;
  reboundingCompetition: number;
  rimProtectionCompetition: number;
  positionalMinuteCompetition: number;
  opportunityVacuum: number;
  overallContext: number;
  adjustmentPercent: number;
  minutesAdjustmentPercent: number;
  baseFantasyPointsPerGame: number;
  adjustedFantasyPointsPerGame: number;
  explanations: string[];
  roleProfile: PlayerRoleProfile;
  teamUsageLoad: number;
  teamUsageAdjustment: number;
  paceAdjustment: number;
  maximumStatAdjustmentPercent: number;
  resourceShock?: { usage: number; creation: number; rebounding: number };
  skillConfidence?: number;
  currentRoleSecurity?: number;
  minuteBudgetAdjustmentPercent?: number;
}

export interface TeamEcosystemResult {
  metricsByPlayerId: Map<string, ProjectionMetrics>;
  contextsByPlayerId: Map<string, TeamContextSummary>;
  teams: TeamRoleDebug[];
  playersEvaluated: number;
  capViolations: number;
  unresolvedTeamPlayers: number;
}
