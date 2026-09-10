import type { YahooPosition } from "./player";

export type PositionUrgencyLabel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export interface RosterFeasibility {
  remainingUserPicks: number;
  restrictiveSlotsRequired: Record<YahooPosition, number>;
  minimumPicksNeededForRestrictiveSlots: number;
  feasibilitySlack: number;
  canCompleteRoster: boolean;
  exposedPositions: YahooPosition[];
  unknownEligibilityCount: number;
}

export interface CandidateFeasibility {
  candidateKeepsRosterFeasible: boolean;
  candidateFeasibilityImpact: number;
  candidateSlotsRelieved: YahooPosition[];
  candidateCriticalNeedMatch: boolean;
  resultingFeasibility: RosterFeasibility;
}

export interface PositionNeedUrgency {
  score: number;
  label: PositionUrgencyLabel;
  requiredSlots: number;
}
