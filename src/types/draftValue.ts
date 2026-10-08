import type { DraftPick, DraftState, PositionIntent } from "./draft";
import type { LeagueConfig } from "./league";
import type { YahooPosition } from "./player";

export type CareerStage = "PRIME" | "LATE_PRIME" | "AGING" | "LATE_CAREER" | "EXTREME_LATE_CAREER";
export type CareerTrend = "IMPROVING" | "STABLE" | "MILD_DECLINE" | "STRUCTURAL_DECLINE";

export interface CareerStageProjection {
  careerStage: CareerStage;
  careerTrend: CareerTrend;
  careerTrendConfidence: number;
  minutesAdjustment: number;
  durabilityAdjustment: number;
  reasons: string[];
}

export interface MajorInjuryComebackProjection {
  isMajorInjuryComeback: boolean;
  comebackRisk: number;
  expectedGamesLow: number;
  expectedGames: number;
  expectedGamesHigh: number;
  expectedMinutesLow: number;
  expectedMinutes: number;
  expectedMinutesHigh: number;
  confidenceAdjustment: number;
  reasons: string[];
}

export interface ExpectedGamesProjection {
  expectedGamesLow: number;
  expectedGames: number;
  expectedGamesHigh: number;
  availabilityConfidence: number;
  availabilityRiskLabel: "STABLE" | "MODERATE" | "HIGH RISK";
  currentHealthVerified: boolean;
  majorInjuryComeback?: MajorInjuryComebackProjection;
  reasons: string[];
  historicalDurabilityBaseline?: number;
  currentHealthAdjustment?: number;
  currentInjuryTimelineAdjustment?: number;
  returnRampAdjustment?: number;
}

export interface ReplacementLevelProfile {
  byPosition: Record<YahooPosition, number>;
  pool: number;
  boundaryByPosition: Record<YahooPosition, number>;
}

export interface SeasonValueProjection {
  replacementFantasyPointsPerGame: number;
  perGameVorp: number;
  seasonVorp: number;
  availabilityAdjustedFantasyPointsEquivalent: number;
  projectedTotalFantasyPoints: number;
}

export interface CurrentRoleAssessment {
  skillConfidence: number;
  currentRoleSecurity: number;
  currentTeamContinuity: boolean | null;
  latestTeamStintMinutes?: number;
  reasons: string[];
}

export type MarketFormat = "points" | "category" | "unknown";
export interface MarketPlayerProfile {
  playerId: string;
  yahooPreRank?: number;
  yahooADP?: number;
  /** External Yahoo consensus historical reference; diagnostic only, never projection input. */
  externalHistoricalFantasyPointsPerGame?: number;
  externalConsensusRank?: number;
  externalRank?: number;
  externalRankChangeVsPrior?: string;
  mockMedianPick?: number;
  mockMeanPick?: number;
  mockRoundEquivalentMedian?: number;
  mockRoundEquivalentLow?: number;
  mockRoundEquivalentHigh?: number;
  sampleCount?: number;
  format?: MarketFormat;
  scoringFingerprint?: string;
  updatedAt?: string;
  source?: string;
  observedRoundEquivalents?: number[];
  observedOverallPicks?: number[];
  rightCensoredRoundEquivalents?: number[];
  /** Source-aware observations permit market evidence from different league sizes. */
  normalizedObservations?: MarketObservation[];
}

export interface MarketObservation {
  /** Absolute source-board coordinate. Never rescaled to target draft progress. */
  overallPick?: number;
  /** Last observed available pick for a right-censored source draft. */
  censorThreshold?: number;
  teamCount: number;
  rounds: number;
  rightCensored: boolean;
  source?: "USER_MOCK" | "EXTERNAL_REFERENCE" | "CURRENT_ROOM" | "YAHOO_REFERENCE" | "OTHER_REFERENCE";
  confidence?: number;
  asOfDate?: string;
  /** Legacy-only fields retained so old marketProfiles.json can be read once. */
  draftProgress?: number;
  roundEquivalent?: number;
}

export interface MarketDataSet {
  schemaVersion: 1;
  generatedAt: string | null;
  mockDraftCount: number;
  yahooRanksLoaded: number;
  matchingScoringSamples: number;
  profiles: MarketPlayerProfile[];
  warnings: string[];
}

export type SurvivalSource = "MARKET_HISTORY" | "YAHOO_ADP" | "BLENDED_MARKET" | "MODEL_ONLY";
export interface MarketTimingProjection {
  /** Raw external reference fields are diagnostic/timing-only; they never feed player projections. */
  yahooAdp?: number | null;
  mockMeanPick?: number | null;
  combinedMarketPickEstimate?: number | null;
  marketSourceGap?: number | null;
  marketSourceAgreement?: number | null;
  externalHistoricalFantasyPointsPerGame?: number | null;
  marketPickEstimate: number | null;
  marketRoundLow: number | null;
  marketRoundHigh: number | null;
  marketConfidence: number;
  marketCostRank: number | null;
  modelValueRank: number;
  valueLabel: "SLEEPER" | "MODEL VALUE" | "FAIR" | "OVERPRICED" | "UNKNOWN";
  survivalEstimate: number;
  survivalConfidence: number;
  survivalSource: SurvivalSource;
  survivalLabel: string;
  draftNowUrgency: number;
  waitValue: number;
  reachCost: number;
  marketEvidenceLabel: string;
  marketEvidenceLevel: "NONE" | "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH";
  conditionalSurvival: boolean;
  liveRoomSurvivalEvidence: number;
  liveRoomConfidence: number;
  liveWaitCost: number;
  marketPrecisionConfidence?: number;
  timingDirectionConfidence?: number;
  survivalNextTurn?: number;
  survivalTwoTurns?: number;
  waitOpportunityCost?: number;
  timingLabel?: "DRAFT NOW" | "WINDOW APPROACHING" | "LIKELY TO SURVIVE" | "TARGET LATER";
  timingBlend?: number;
  censoredSurvivalLowerBound?: number | null;
  targetWindowStart?: number | null;
  targetWindowCenter?: number | null;
  targetWindowEnd?: number | null;
  targetWindowLowerBound?: number | null;
  userTurnsUntilTargetWindow?: number | null;
  censorDerivedWait?: number;
  exactMarketDerivedWait?: number;
  liveRoomDerivedWait?: number;
  multiTurnTargetDistanceWait?: number;
  alternativeUrgencyWait?: number;
  survivalThirdTurn?: number;
  futureUserPickSurvival?: Array<{ overallPick: number; survival: number; evidenceCount: number }>;
  lastSafeUserPick?: number | null;
  acquisitionFrontierPick?: number | null;
  userTurnsBeforeFrontier?: number;
}

export type RoleScenarioLabel = "LOW" | "BASE" | "HIGH";
export interface RoleOutcomeScenario {
  label: RoleScenarioLabel;
  probability: number;
  healthyGameMPG: number;
  projectedFantasyPointsPerMinute: number;
  projectedFantasyPointsPerGame: number;
  expectedGames: number;
  seasonVorp: number;
}

export interface RoleScenarioSummary {
  roleSustainability: number;
  scenarios: RoleOutcomeScenario[];
  meanSeasonVorp: number;
  optionAdjustedSeasonVorp: number;
  optionPremium: number;
  optionScoreAdjustment: number;
  credibleUpsideSurplus: number;
  credibleDownsideGap: number;
  upsideLabel: "LOW" | "MEDIUM" | "HIGH";
  minutesOutsideRoleRange: boolean;
  reasons: string[];
}

export interface PositionContextBreakdown {
  feasibility: number;
  needUrgency: number;
  scarcity: number;
  tierDropoff: number;
  recentRun: number;
  flexibility: number;
  marketDepletion: number;
  uncappedComposite: number;
  composite: number;
  contribution: number;
  cap: number;
  criticalOverride: boolean;
}

export interface DraftDecisionPlayerSnapshot {
  playerId: string;
  draftScore: number;
  projectedFantasyPointsPerGame: number;
  expectedGames: number;
  seasonVorp: number;
  marketPickEstimate: number | null;
  survivalEstimate: number;
  meanSeasonVorp?: number;
  optionAdjustedSeasonVorp?: number;
  roleScenarioSummary?: string;
  marketConfidence?: number;
  conditionalSurvival?: boolean;
  liveRoomSurvivalEvidence?: number;
  waitAdjustment?: number;
  positionalNeed: string;
  reasons: string[];
}

export interface DraftDecisionSnapshot {
  overallPick: number;
  recordedAt: string;
  rosterPlayerIds: string[];
  positionIntent: PositionIntent;
  topFive: DraftDecisionPlayerSnapshot[];
}

export interface DraftExportMetadata {
  teamCount: number;
  rounds: number;
  userDraftSlot: number;
  scoringFingerprint: string;
  rosterFingerprint: string;
  createdAt: string;
}

export interface DraftExportEnvelope {
  schemaVersion: 2;
  metadata: DraftExportMetadata;
  draftState: DraftState;
  recommendationTrace?: import("./recommendationTrace").RecommendationTrace;
}

export interface MockDraftRecord {
  teamCount: number;
  rounds: number;
  format: MarketFormat;
  scoringFingerprint?: string;
  picks: DraftPick[];
  metadata?: Partial<DraftExportMetadata>;
  decisionLog?: DraftDecisionSnapshot[];
}

export interface MarketImportOptions {
  leagueConfig?: LeagueConfig;
  format?: MarketFormat;
}
