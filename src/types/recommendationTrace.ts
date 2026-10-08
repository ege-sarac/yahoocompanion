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
  secondNextUserPick: number | null;
  picksUntilSecondNextUserPick: number | null;
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
  projectionSanity: { recentSeasonFantasyPPG: number | null; weightedHistoricalFantasyPPG: number | null; externalHistoricalFantasyPPG: number | null; externalReferenceProjectionGap: number | null; projectionCompressionRatio: number | null; unexplainedProjectionCompression: boolean; unexplainedProjectionInflation: boolean; projectionChangeReasons: string[] };
  externalYahooProjection: { available: boolean; rawSlotFppg: number | null; leagueAdjustedFppg: number | null; internalComparableFppg: number; gap: number | null; absoluteGap: number | null; threshold: number; sourceSelected: string; selectionReason: string; reboundSplitSource: string | null; ddTdSource: string | null };
  transformation: { baseProjectionFPPerGame: number; baseHealthyMPG: number; finalHealthyMPG: number; minuteAdjustment: number; rateAdjustment: number; teamContextAdjustment: number; historicalBlendEffect: number; minutesEffect: number; rateEffect: number; absenceDependencyEffect: number; injuryEffect: number; declineEffect: number; doubleTripleDoubleEffect: number; finalProjectedFantasyPPG: number };
  role: { skillConfidence: number; currentRoleSecurity: number; rotationTier: string; roleSustainability: number; minutesLow: number; minutesBase: number; minutesHigh: number; currentTeamContinuity: boolean | null; minutesOutsideRoleRange: boolean; roleDataGeneratedAt: string | null };
  scenarios: Array<{ label: "LOW" | "BASE" | "HIGH"; probability: number; healthyGameMPG: number; projectedFantasyPointsPerGame: number; seasonVorp: number }>;
  option: { optionPremium: number; credibleUpsideSurplus: number; credibleDownsideGap: number; upsideLabel: "LOW" | "MEDIUM" | "HIGH" };
  teamResourceShock: { scoringUsage: number; creation: number; rebounding: number; minutes: number };
  teammateAbsence: { absenceDependencyScore: number; roleDependencyApplied: boolean; activeSampleGames: number | null; absentSampleGames: number | null; sampleShrinkage: number | null; roleSustainabilityAdjustment: number; baseMinutesAdjustment: number; highScenarioProbabilityAdjustment: number };
  availability: { participationRisk: number; availabilityRiskLabel: string; majorComeback: boolean; postReturnEstablished: boolean; availabilityDownsideGap: number; availabilityTailPenalty: number; currentHealthStatus?: string; historicalDurabilityBaseline?: number; currentHealthAdjustment?: number; currentInjuryTimelineAdjustment?: number };
  market: { marketEvidenceType: string; exactPickCount: number; rightCensoredCount: number; marketObservationSummary: string; marketPickEstimate: number | null; marketRoundEstimate: number | null; yahooAdp: number | null; mockMeanPick: number | null; combinedMarketPickEstimate: number | null; marketSourceGap: number | null; marketSourceAgreement: number | null; marketConfidence: number; conditionalSurvival: boolean; survivalEstimate: number; liveRoomSurvivalEvidence: number; historicalWaitAdjustment: number; censorDerivedWait: number; exactMarketDerivedWait: number; liveRoomDerivedWait: number; liveWaitCost?: number; multiTurnTargetDistanceWait: number; reachCost: number; modelEdge: number | null; modelEdgeEscapeActivated: boolean };
  position: { rosterFeasible: boolean; positionNeed: number; positionScarcity: number; tierDrop: number; recentPositionRun: number; marketDepletion: number; flexibility: number; composite: number; cap: number; contribution: number };
  score: { weightedComponents: Record<string, number>; optionValue: number; availabilityTail: number; positionContext: number; marketUrgency: number; historicalWait: number; liveWait: number; reach: number; teamDiversification: number; manualPositionIntent: number; rosterRisk: number; productionAnchor: number; credibleCeiling: number; nonProductionStackPenalty: number; lateHoldability: number; endgameUtility: number; preAdjustmentScore: number; finalDraftScore: number; reconciliationResidual: number };
  pickNow: { intrinsicPlayerValue: number; pickNowValue: number; targetLaterValue: number; rawOpportunitySignal: number; rawBreakoutSignal: number; rawCeilingSignal: number; rawRoleSignal: number; productionAnchor: number; nonProductionStackTotal: number; nonProductionStackCap: number; credibleCeilingValue: number; highScenarioSurplusPerGame: number; fantasyPointsPerMinute: number; promotionPathProbability: number; currentDepthCompetition: number; netVacatedMinutes: number; endgameBlend: number; lateHoldabilityAdjustment: number; endgameUtility: number; timingBlend: number; timingDirectionConfidence: number; marketPrecisionConfidence: number; survivalNextTurn: number; survivalTwoTurns: number; censoredSurvivalLowerBound: number | null; targetWindowStart: number | null; targetWindowCenter: number | null; targetWindowEnd: number | null; targetWindowLowerBound: number | null; userTurnsUntilTargetWindow: number | null; waitOpportunityCost: number; timingLabel: string; lateProductionBlend?: number; projectedSurplusPerGame?: number; baseSurplusPerGame?: number; lowSurplusPerGame?: number; highSurplusPerGame?: number; lateProductionQuality?: number; riskAdjustedProduction?: number; durabilityEfficiency?: number; requiredRiskPremium?: number; stashCapacity?: number; stashBurden?: number; rosterAvailabilityLoad?: number; highVsBaseGain?: number; ceilingMagnitude?: number; ceilingCredibility?: number; lateUpsideValue?: number; lateValueClassification?: string; lateRoundDominanceAdjustment?: number; pickNowQualityFloorAdjustment?: number; acquisitionFrontierPick?: number | null; userTurnsBeforeFrontier?: number };
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
