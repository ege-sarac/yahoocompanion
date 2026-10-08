import type { Player, Projection, YahooPosition } from "./player";
import type { TeammateDependency } from "./role";
import type {
  NewPlayerProjectionDetails,
  NewPlayerProjectionInput,
  ProjectionSource,
} from "./newPlayer";
import type { CandidateFeasibility, PositionNeedUrgency, RosterFeasibility } from "./feasibility";
import type { PositionIntent } from "./draft";
import type { TeamContextSummary, TeamRoleDebug } from "./teamContext";
import type { RoleContextSummary } from "./role";
import type { YahooProjectionComparison } from "./yahooProjection";
import type { CareerStageProjection, CurrentRoleAssessment, ExpectedGamesProjection, MarketTimingProjection, PositionContextBreakdown, ReplacementLevelProfile, RoleScenarioSummary, SeasonValueProjection } from "./draftValue";

export interface ProjectionMetrics {
  projection: Projection;
  projectionSource: ProjectionSource;
  newPlayerDetails?: NewPlayerProjectionDetails;
  projectedFantasyPointsPerSeason: number;
  availabilityAdjustedFantasyPoints: number;
  historicalAvailabilityRisk: number;
  currentInjuryPenalty: number;
  combinedAvailabilityRisk: number;
  modelConfidence: number;
  opportunityScore: number;
  breakoutScore: number;
  usedPerGameFallback: boolean;
  expectedGamesProjection?: ExpectedGamesProjection;
  careerStageProjection?: CareerStageProjection;
  roleAssessment?: CurrentRoleAssessment;
  yahooProjectionComparison?: YahooProjectionComparison;
}

export interface RecommendationComponents {
  projectedValue: number;
  availability: number;
  rosterFit: number;
  scarcity: number;
  opportunity: number;
  breakout: number;
  flexibility: number;
  confidence: number;
  survivalUrgency: number;
  recentRun: number;
  tierDropoff: number;
}

export interface RecommendationContributions {
  projectedValue: number;
  availability: number;
  rosterFit: number;
  scarcity: number;
  opportunity: number;
  breakout: number;
  flexibility: number;
  confidence: number;
  survivalUrgency: number;
  recentRun: number;
  tierDropoff: number;
}

export interface PositionScarcitySummary {
  position: YahooPosition;
  viablePlayerCount: number;
  qualityDrop: number;
  score: number;
}

export type RunPressureLabel = "No run" | "Mild run" | "Strong run";
export interface PositionRunSummary {
  position: YahooPosition;
  recentCount: number;
  runPressure: number;
  label: RunPressureLabel;
}

export interface PlayerRecommendation extends ProjectionMetrics {
  player: Player;
  newPlayerInput?: NewPlayerProjectionInput;
  baseValue: number;
  rosterFitScore: number;
  scarcityScore: number;
  flexibilityScore: number;
  finalScore: number;
  survivalEstimate: number;
  survivalLabel: string;
  urgencyScore: number;
  picksUntilNextUserPick: number | null;
  recentRunPressure: number;
  recentRunLabel: RunPressureLabel;
  tierDropoffScore: number;
  tierDropoffExplanation: string;
  components: RecommendationComponents;
  contributions: RecommendationContributions;
  explanations: string[];
  manualPositionMatch: boolean;
  manualPositionPriorityComponent: number;
  automaticPositionNeedComponent: number;
  rosterFeasibilityComponent: number;
  candidateFeasibility: CandidateFeasibility;
  teamContextSummary?: TeamContextSummary;
  roleContextSummary?: RoleContextSummary;
  sameTeamPlayersBeforePick: number;
  sameTeamPlayersAfterPick: number;
  teamConcentrationBefore: number;
  teamConcentrationAfter: number;
  teamDiversificationComponent: number;
  teamConcentrationWarning?: string;
  eliteDiversificationEscape: boolean;
  expectedGamesProjection: ExpectedGamesProjection;
  careerStageProjection: CareerStageProjection;
  roleAssessment: CurrentRoleAssessment;
  seasonValue: SeasonValueProjection;
  marketTiming: MarketTimingProjection;
  positionContextComposite: PositionContextBreakdown;
  roleScenarioSummary: RoleScenarioSummary;
  modelValueRank: number;
  marketCostRank: number | null;
  availabilityDownsideGap: number;
  availabilityTailPenalty: number;
  scoreBreakdown: RecommendationScoreBreakdown;
  diagnosticInputs: { baseProjection: Projection; roleProjection: Projection; teammateDependencies: TeammateDependency[]; roleDataGeneratedAt: string | null; minutesOutsideRoleRange: boolean; marketExactPickCount: number; marketRightCensoredCount: number };
  productionAnchor: number;
  nonProductionStackTotal: number;
  nonProductionStackCap: number;
  credibleCeilingValue: number;
  highScenarioSurplusPerGame: number;
  endgameBlend: number;
  promotionPathProbability: number;
  currentDepthCompetition: number;
  netVacatedMinutes: number;
  rawOpportunitySignal: number;
  rawBreakoutSignal: number;
  rawCeilingSignal: number;
  rawRoleSignal: number;
  lateHoldabilityAdjustment: number;
  dominanceWarning: boolean;
  lateProductionBlend: number;
  projectedSurplusPerGame: number;
  baseSurplusPerGame: number;
  lowSurplusPerGame: number;
  highSurplusPerGame: number;
  lateProductionQuality: number;
  riskAdjustedProduction: number;
  durabilityEfficiency: number;
  requiredRiskPremium: number;
  stashCapacity: number;
  stashBurden: number;
  rosterAvailabilityLoad: number;
  highVsBaseGain: number;
  ceilingMagnitude: number;
  ceilingCredibility: number;
  lateUpsideValue: number;
  lateValueClassification: "CORE_PRODUCTION" | "BALANCED_VALUE" | "UPSIDE_TARGET" | "INJURY_STASH" | "WAIVER_LEVEL";
  lateRoundDominanceAdjustment: number;
  pickNowQualityFloorAdjustment: number;
}

export interface RecommendationScoreBreakdown {
  weightedComponents: RecommendationContributions;
  optionValue: number;
  availabilityTail: number;
  positionContext: number;
  marketUrgency: number;
  historicalWait: number;
  liveWait: number;
  reach: number;
  teamDiversification: number;
  manualPositionIntent: number;
  rosterRisk: number;
  productionAnchor: number;
  credibleCeiling: number;
  nonProductionStackPenalty: number;
  endgameUtility: number;
  lateHoldability: number;
  lateProductionQuality: number;
  lateUpside: number;
  stashBurden: number;
  dominance: number;
  qualityFloor: number;
  preAdjustmentScore: number;
  finalDraftScore: number;
  reconciliationResidual: number;
}

export interface AlternativeRecommendation {
  recommendation: PlayerRecommendation;
}

export interface RecommendationResult {
  recommendations: PlayerRecommendation[];
  scarcityByPosition: Record<YahooPosition, PositionScarcitySummary>;
  excludedForNoHistory: number;
  newPlayerModelCount: number;
  missingEligibilityCount: number;
  topRecommendations: PlayerRecommendation[];
  alternativeRecommendations: AlternativeRecommendation[];
  recommendationDisplay: import("./draft").RecommendationDisplayConfig;
  displayExpanded: boolean;
  recentRuns: Record<YahooPosition, PositionRunSummary>;
  draftProgress: number;
  rosterFeasibility: RosterFeasibility;
  positionNeedUrgency: Record<YahooPosition, PositionNeedUrgency>;
  positionIntent: PositionIntent;
  positionFilterActive: boolean;
  positionFilterHadNoMatches: boolean;
  filterExcludesAllFeasible: boolean;
  teamEcosystemDiagnostics: { teamsBuilt: number; playersEvaluated: number; capViolations: number; unresolvedTeamPlayers: number; teams: TeamRoleDebug[] };
  teamDiversificationMode: import("./draft").TeamDiversificationMode;
  preferredMaxSameTeam: number;
  teamDiversificationFilteredCount: number;
  replacementLevels: ReplacementLevelProfile;
  marketProfilesLoaded: number;
  marketCorpusDraftCount: number;
  marketProfileVersion: string | null;
  matchingMarketProfiles: number;
  teamMinutesDiagnostics: { teamsProcessed: number; teamsOutsideTolerance: number; capViolations: number; maximumTotalMinutes: number; minutesOutsideRoleRange: number };
}
