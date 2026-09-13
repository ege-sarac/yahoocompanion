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
  rightCensoredRoundEquivalents?: number[];
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
