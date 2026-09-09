import { RECOMMENDATION_CONFIG } from "../config/recommendationConfig";
import type { Player, PositionScarcitySummary, YahooPosition } from "../types";

export interface ScarcityCandidate {
  player: Player;
  projectedFantasyPointsPerGame: number;
}
export interface ScarcityContext {
  picksUntilNextUserPick?: number | null;
  draftProgress?: number;
  remainingNeeds?: Partial<Record<YahooPosition, number>>;
}

const POSITIONS: YahooPosition[] = ["G", "F", "C"];

export function calculatePositionScarcity(
  candidates: readonly ScarcityCandidate[],
  context: ScarcityContext = {},
): Record<YahooPosition, PositionScarcitySummary> {
  const config = RECOMMENDATION_CONFIG.scarcity;
  const allValues = candidates
    .map((candidate) => candidate.projectedFantasyPointsPerGame)
    .sort((left, right) => left - right);
  const viableThreshold = percentileValue(allValues, config.viablePercentile);

  return Object.fromEntries(
    POSITIONS.map((position) => {
      const viableValues = candidates
        .filter(
          (candidate) =>
            candidate.player.yahooPositions.includes(position) &&
            candidate.projectedFantasyPointsPerGame >= viableThreshold,
        )
        .map((candidate) => candidate.projectedFantasyPointsPerGame)
        .sort((left, right) => right - left);
      const topValue = viableValues[0] ?? 0;
      const lookAheadPlayers = Math.max(config.lookAheadPlayers, Math.ceil((context.picksUntilNextUserPick ?? 0) / 3));
      const lookAheadValue =
        viableValues.length >= lookAheadPlayers
          ? viableValues[lookAheadPlayers - 1]
          : 0;
      const qualityDrop =
        topValue > 0
          ? clamp(
              (topValue - lookAheadValue) /
                topValue /
                config.meaningfulQualityDrop,
              0,
              1,
            )
          : 0;
      const playerCountPressure = clamp(
        1 - viableValues.length / (config.healthyPoolSize + (context.picksUntilNextUserPick ?? 0) * 0.4),
        0,
        1,
      );
      const rawScarcity =
        playerCountPressure * config.playerCountWeight +
        qualityDrop * config.qualityDropWeight;
      const needScale = (context.remainingNeeds?.[position] ?? 1) > 0 ? 1 : 0.45;
      const stageScale = 0.75 + clamp(context.draftProgress ?? 0, 0, 1) * 0.25;
      const score =
        config.neutralUnknownScore +
        (100 - config.neutralUnknownScore) *
          rawScarcity *
          config.smoothingFactor * needScale * stageScale;

      return [
        position,
        {
          position,
          viablePlayerCount: viableValues.length,
          qualityDrop,
          score,
        },
      ];
    }),
  ) as Record<YahooPosition, PositionScarcitySummary>;
}

export function calculatePlayerScarcityScore(
  player: Player,
  scarcityByPosition: Record<YahooPosition, PositionScarcitySummary>,
): number {
  const knownPositions = player.yahooPositions.filter((position) =>
    POSITIONS.includes(position),
  );
  if (knownPositions.length === 0) {
    return RECOMMENDATION_CONFIG.scarcity.neutralUnknownScore;
  }

  return Math.max(
    ...knownPositions.map((position) => scarcityByPosition[position].score),
  );
}

function percentileValue(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.floor((sortedValues.length - 1) * percentile);
  return sortedValues[index];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
