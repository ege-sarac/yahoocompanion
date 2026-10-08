export type DraftPickProvenance = "OBSERVED_ROOM" | "USER_REAL_PICK" | "SYNTHETIC_PADDING" | "MANUAL_EXTENSION";

export interface DraftPick {
  overallPick: number;
  round: number;
  pickInRound: number;
  teamNumber: number;
  playerId: string;
  isMyTeam: boolean;
  /** Describes whether this pick is genuine room evidence or only board state. */
  pickProvenance?: DraftPickProvenance;
}

export interface DraftState {
  picks: DraftPick[];
  draftedPlayerIds: string[];
  myPlayerIds: string[];
  currentOverallPick: number;
  manualUnavailablePlayerIds: string[];
  positionIntent: PositionIntent;
  keepPositionPreferenceAfterMyPick: boolean;
  teamEcosystemEnabled: boolean;
  showTeamContextDetails: boolean;
  teamDiversificationMode: TeamDiversificationMode;
  preferredMaxSameTeam: number;
  decisionLoggingEnabled: boolean;
  decisionLog: import("./draftValue").DraftDecisionSnapshot[];
  recommendationTraceEnabled: boolean;
  recommendationTraceGranularity: RecommendationTraceGranularity;
  recommendationDisplay: RecommendationDisplayConfig;
  recommendationTrace: import("./recommendationTrace").RecommendationTrace;
}

export type TeamDiversificationMode = "Off" | "Strong soft cap" | "Strict";

export type PositionIntentMode = "Normal" | "Prefer" | "Filter";

export interface PositionIntent {
  mode: PositionIntentMode;
  positions: import("./player").YahooPosition[];
}

export type RecommendationTraceGranularity = "USER_TURNS" | "EVERY_RECORDED_PICK";
export type RecommendationExpansionMode = "DRAFT_PROGRESS" | "ROUND";
export interface RecommendationDisplayConfig { primaryCount: number; expandedTotalCount: number; expansionMode: RecommendationExpansionMode; expandAtProgress: number; expandAtRound: number; }
