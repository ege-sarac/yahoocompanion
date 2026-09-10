import type { ProjectionMetrics } from "./recommendation";

export interface PlayerRoleProfile {
  usageRoleScore: number;
  creationRoleScore: number;
  reboundingRoleScore: number;
  rimProtectionRoleScore: number;
  guardMinutesRoleScore: number;
  forwardMinutesRoleScore: number;
  centerMinutesRoleScore: number;
}

export interface TeamRoleDebug {
  team: string;
  playerCount: number;
  normalizedMinuteShares: Record<string, number>;
  supply: PlayerRoleProfile;
  vacuums: PlayerRoleProfile;
  congestion: PlayerRoleProfile;
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
}

export interface TeamEcosystemResult {
  metricsByPlayerId: Map<string, ProjectionMetrics>;
  contextsByPlayerId: Map<string, TeamContextSummary>;
  teams: TeamRoleDebug[];
  playersEvaluated: number;
  capViolations: number;
  unresolvedTeamPlayers: number;
}
