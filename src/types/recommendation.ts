import type { Player, Projection, YahooPosition } from "./player";
import type {
  NewPlayerProjectionDetails,
  NewPlayerProjectionInput,
  ProjectionSource,
} from "./newPlayer";

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
}

export interface RecommendationResult {
  recommendations: PlayerRecommendation[];
  scarcityByPosition: Record<YahooPosition, PositionScarcitySummary>;
  excludedForNoHistory: number;
  newPlayerModelCount: number;
  missingEligibilityCount: number;
  topRecommendations: PlayerRecommendation[];
  recentRuns: Record<YahooPosition, PositionRunSummary>;
  draftProgress: number;
}
