import type { RecommendationDisplayConfig } from "../types";

export const DEFAULT_RECOMMENDATION_DISPLAY: RecommendationDisplayConfig = Object.freeze({
  primaryCount: 5,
  expandedTotalCount: 9,
  expansionMode: "DRAFT_PROGRESS",
  expandAtProgress: .6,
  expandAtRound: 8,
});

export function normalizeRecommendationDisplay(value: Partial<RecommendationDisplayConfig> | undefined, configuredRounds: number): RecommendationDisplayConfig {
  const source = value ?? {};
  const primaryCount = clampInteger(source.primaryCount, 3, 7, DEFAULT_RECOMMENDATION_DISPLAY.primaryCount);
  const expandedTotalCount = Math.max(primaryCount, clampInteger(source.expandedTotalCount, 5, 12, DEFAULT_RECOMMENDATION_DISPLAY.expandedTotalCount));
  return {
    primaryCount,
    expandedTotalCount,
    expansionMode: source.expansionMode === "ROUND" ? "ROUND" : "DRAFT_PROGRESS",
    expandAtProgress: clampNumber(source.expandAtProgress, .4, .9, DEFAULT_RECOMMENDATION_DISPLAY.expandAtProgress),
    expandAtRound: source.expandAtRound === undefined ? DEFAULT_RECOMMENDATION_DISPLAY.expandAtRound : clampInteger(source.expandAtRound, 1, Math.max(1, configuredRounds), Math.min(DEFAULT_RECOMMENDATION_DISPLAY.expandAtRound, configuredRounds)),
  };
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}
