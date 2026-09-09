import type { InjuryStatus, ReturnConfidence } from "../types";

export const INJURY_SNAPSHOT_CONFIG = {
  schemaVersion: 1,
  freshThroughDays: 3,
  staleAfterDays: 7,
  majorInjuryStatuses: ["Out", "Injured"] as InjuryStatus[],
  majorFantasyRelevantMinimumFpG: 25,
  returnConfidencePenalty: {
    high: 0,
    medium: 0.015,
    low: 0.04,
    unknown: 0.07,
  } satisfies Record<ReturnConfidence, number>,
  narrativeGuidancePenaltyScale: 0.85,
  returnConfidenceInformationScore: {
    high: 1,
    medium: 0.85,
    low: 0.65,
    unknown: 0.5,
  } satisfies Record<ReturnConfidence, number>,
  currentRiskOverlapReduction: 0.65,
  maximumCombinedAvailabilityRisk: 0.75,
  maximumAvailabilityValueDiscount: 0.65,
} as const;
