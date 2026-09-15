import type { LeagueConfig } from "./league";
import type { PositionIntent } from "./draft";
import type { RecommendationDisplayConfig, RecommendationTraceGranularity } from "./draft";

export interface RecommendationTrace {
  schemaVersion: 1;
  createdAt: string;
  engineVersion: string;
  snapshots: RecommendationTraceSnapshot[];
}

export interface RecommendationTraceSnapshot {
  snapshotKey: string;
  detailLevel: "FULL_USER_TURN" | "LIGHT_PICK";
  recordedAt: string;
  overallPick: number;
  round: number;
  pickInRound: number;
  selectedPlayerId: string;
  header: RecommendationTraceHeader;
  topCandidates: RecommendationCandidateTrace[];
  compactCandidates: RecommendationCompactCandidateTrace[];
  carriedForwardCandidates: RecommendationCarryForwardCandidate[];
  notableRankMovements: RecommendationRankMovement[];
  outcome?: RecommendationTraceOutcome;
}

export interface RecommendationTraceHeader {
  teamCount: number;
  configuredRounds: number;
  userDraftSlot: number;
  draftProgress: number;
  nextUserPick: number | null;
  picksUntilNextUserPick: number | null;
  scoringFingerprint: string;
  rosterFingerprint: string;
  draftFingerprint: string;
  recommendationEngineVersion: string;
  marketProfileVersion: string | null;
  marketCorpusDraftCount: number;
  availablePlayerCount: number;
  projectablePlayerCount: number;
  rosterFeasiblePlayerCount: number;
  rosterPlayerIds: string[];
  positionIntent: PositionIntent;
  rosterNeed: Record<"G" | "F" | "C", number>;
  resolved: {
    replacementFPPerGame: Record<"G" | "F" | "C", number>;
    draftStage: "early" | "middle" | "late";
    optionValueStageCap: number;
    availabilityTailStageWeight: number;
    positionContextStageCap: number;
    waitMaximumPenalty: number;
    teamDiversificationMode: string;
    preferredMaxSameTeam: number;
    recommendationDisplay: RecommendationDisplayConfig;
  };
}

export interface RecommendationCandidateTrace {
  rank: number;
  playerId: string;
  playerName: string;
  nbaTeam: string | null;
  positions: string[];
  draftScore: number;
  previousRank: number | null;
  rankChange: number | null;
  previousDraftScore: number | null;
  draftScoreChange: number | null;
  projection: { projectedFantasyPointsPerGame: number; expectedGames: number; expectedGamesLow: number; expectedGamesHigh: number; seasonVorp: number; meanSeasonVorp: number; optionAdjustedSeasonVorp: number; replacementFPPerGameUsed: number; healthyGameMPG: number; points: number; offensiveRebounds: number; defensiveRebounds: number; assists: number; steals: number; blocks: number; turnovers: number; projectedDoubleDoubles: number; projectedTripleDoubles: number };
  transformation: { baseProjectionFPPerGame: number; baseHealthyMPG: number; finalHealthyMPG: number; minuteAdjustment: number; rateAdjustment: number; teamContextAdjustment: number };
  role: { skillConfidence: number; currentRoleSecurity: number; rotationTier: string; roleSustainability: number; minutesLow: number; minutesBase: number; minutesHigh: number; currentTeamContinuity: boolean | null; minutesOutsideRoleRange: boolean; roleDataGeneratedAt: string | null };
  scenarios: Array<{ label: "LOW" | "BASE" | "HIGH"; probability: number; healthyGameMPG: number; projectedFantasyPointsPerGame: number; seasonVorp: number }>;
  option: { optionPremium: number; credibleUpsideSurplus: number; credibleDownsideGap: number; upsideLabel: "LOW" | "MEDIUM" | "HIGH" };
  teamResourceShock: { scoringUsage: number; creation: number; rebounding: number; minutes: number };
  teammateAbsence: { absenceDependencyScore: number; roleDependencyApplied: boolean; activeSampleGames: number | null; absentSampleGames: number | null; sampleShrinkage: number | null; roleSustainabilityAdjustment: number; baseMinutesAdjustment: number; highScenarioProbabilityAdjustment: number };
  availability: { participationRisk: number; availabilityRiskLabel: string; majorComeback: boolean; postReturnEstablished: boolean; availabilityDownsideGap: number; availabilityTailPenalty: number };
  market: { marketEvidenceType: string; exactPickCount: number; rightCensoredCount: number; marketObservationSummary: string; marketPickEstimate: number | null; marketRoundEstimate: number | null; marketConfidence: number; conditionalSurvival: boolean; survivalEstimate: number; liveRoomSurvivalEvidence: number; historicalWaitAdjustment: number; liveWaitCost: number; reachCost: number; modelEdge: number | null; modelEdgeEscapeActivated: boolean };
  position: { rosterFeasible: boolean; positionNeed: number; positionScarcity: number; tierDrop: number; recentPositionRun: number; marketDepletion: number; flexibility: number; composite: number; cap: number; contribution: number };
  score: { weightedComponents: Record<string, number>; optionValue: number; availabilityTail: number; positionContext: number; marketUrgency: number; historicalWait: number; liveWait: number; reach: number; teamDiversification: number; manualPositionIntent: number; rosterRisk: number; preAdjustmentScore: number; finalDraftScore: number; reconciliationResidual: number };
  reasons: string[];
  flags: string[];
}

export interface RecommendationCompactCandidateTrace {
  rank: number;
  playerId: string;
  playerName: string;
  nbaTeam: string | null;
  positions: string[];
  projectedFantasyPointsPerGame: number;
  expectedGames: number;
  seasonVorp: number;
  draftScore: number;
  previousRank: number | null;
  rankChange: number | null;
  optionValueContribution: number;
  availabilityTailPenalty: number;
  positionContextContribution: number;
  marketTimingContribution: number;
  liveWaitCost: number;
  currentRoleSecurity: number;
  roleSustainability: number;
  upsideLabel: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
}

export interface RecommendationCarryForwardCandidate { playerId: string; playerName: string; currentRank: number; previousRank: number; currentDraftScore: number; previousDraftScore: number; largestChangedScoreComponents: string[]; strongestExplanation: string; }
export interface RecommendationRankMovement { playerId: string; playerName: string; fromRank: number | null; toRank: number | null; scoreDelta: number; largestComponentChanges: string[]; kinds: string[]; }
export interface RecommendationTraceOutcome { hasFutureUserPick: boolean; settledAt: string; candidates: Array<{ playerId: string; survivedToNextUserTurn: boolean; draftedBeforeNextUserTurn: boolean; draftedAtOverallPick: number | null; draftedByUser: boolean; stillAvailableAtNextUserTurn: boolean }>; top5SurvivedCount: number | null; top10SurvivedCount: number | null; top5DraftedBeforeNextTurn: number | null; top10DraftedBeforeNextTurn: number | null; nextWindowRecallAt5: number | null; nextWindowRecallAt10: number | null; }

export interface RecommendationTraceExport { schemaVersion: 1; createdAt: string; leagueConfig: LeagueConfig; recommendationDisplay: RecommendationDisplayConfig; traceEnabled: boolean; traceGranularity: RecommendationTraceGranularity; recommendationTrace: RecommendationTrace; }
