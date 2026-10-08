export type RotationTier = "STAR" | "STARTER" | "CORE_ROTATION" | "BENCH" | "DEPTH" | "UNKNOWN";
export type RoleContext = "EXPECTED_STARTER" | "SECURE_STARTER" | "SIZABLE_ROLE" | "ROTATION" | "FRONTCOURT_DEPTH" | "BACKUP" | "OPEN_COMPETITION" | "UNKNOWN";

/** Manually maintained, current-context evidence; it never replaces historical stats. */
export interface CurrentRoleOverride {
  playerId?: string;
  playerName: string;
  nbaTeam?: string | null;
  generatedAt?: string;
  sourceDate?: string;
  sourceLabel?: string;
  currentHealthStatus?: import("./injurySnapshot").CurrentHealthStatus;
  roleContext?: RoleContext;
  rotationTier?: RotationTier;
  starterProbability?: number;
  starterExpectation?: string;
  depthCompetitionOverride?: number;
  roleSecurityOverride?: number;
  roleSustainabilityOverride?: number;
  minutesLowOverride?: number;
  minutesBaseOverride?: number;
  minutesHighOverride?: number;
  minutesLow?: number;
  minutesBase?: number;
  minutesHigh?: number;
  roleSecurity?: number;
  roleSustainability?: number;
  depthCompetition?: number;
  promotionPathModifier?: number;
  notes?: string;
  confidence?: number;
}
