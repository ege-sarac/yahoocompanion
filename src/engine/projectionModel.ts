import { RECOMMENDATION_CONFIG } from "../config/recommendationConfig";
import { INJURY_SNAPSHOT_CONFIG } from "../config/injurySnapshotConfig";
import type {
  HistoricalStats,
  InjuryStatus,
  Player,
  Projection,
  ProjectionMetrics,
} from "../types";
import { calculateFantasyPoints } from "./fantasyPoints";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { LeagueConfig, ScoringSettings } from "../types";

type ProjectedStatKey =
  | "points"
  | "offensiveRebounds"
  | "defensiveRebounds"
  | "assists"
  | "steals"
  | "blocks"
  | "turnovers";

const PROJECTED_STATS: ReadonlyArray<{
  historical: ProjectedStatKey;
  projected: keyof Pick<
    Projection,
    | "projectedPoints"
    | "projectedOffensiveRebounds"
    | "projectedDefensiveRebounds"
    | "projectedAssists"
    | "projectedSteals"
    | "projectedBlocks"
    | "projectedTurnovers"
  >;
}> = [
  { historical: "points", projected: "projectedPoints" },
  {
    historical: "offensiveRebounds",
    projected: "projectedOffensiveRebounds",
  },
  {
    historical: "defensiveRebounds",
    projected: "projectedDefensiveRebounds",
  },
  { historical: "assists", projected: "projectedAssists" },
  { historical: "steals", projected: "projectedSteals" },
  { historical: "blocks", projected: "projectedBlocks" },
  { historical: "turnovers", projected: "projectedTurnovers" },
];

interface WeightedSeason {
  stats: HistoricalStats;
  weight: number;
}

export function projectPlayerProduction(
  player: Player,
  asOfDate = new Date(),
  leagueConfig: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): ProjectionMetrics | null {
  const seasons = getWeightedSeasons(player.historicalStats);
  if (seasons.length === 0) {
    return null;
  }

  const projectedGames = weightedAverage(
    seasons.map(({ stats, weight }) => ({ value: stats.gamesPlayed, weight })),
  );
  const projectedMinutes = estimateProjectedMinutes(seasons);
  const rateSeasons = seasons
    .map(({ stats, weight }) => ({
      stats,
      weight: weight * sampleReliability(stats),
    }))
    .filter(
      ({ stats }) =>
        stats.minutesPerGame >=
          RECOMMENDATION_CONFIG.projection.minimumMinutesForRate &&
        stats.gamesPlayed >= RECOMMENDATION_CONFIG.projection.minimumGamesForRate,
    );
  const usedPerGameFallback = rateSeasons.length === 0;

  const projectedStats = Object.fromEntries(
    PROJECTED_STATS.map(({ historical, projected }) => {
      const value = usedPerGameFallback
        ? weightedAverage(
            seasons.map(({ stats, weight }) => ({
              value: stats[historical],
              weight,
            })),
          )
        : weightedAverage(
            rateSeasons.map(({ stats, weight }) => ({
              value: stats[historical] / stats.minutesPerGame,
              weight,
            })),
          ) * projectedMinutes;
      return [projected, Math.max(0, value)];
    }),
  ) as Pick<
    Projection,
    | "projectedPoints"
    | "projectedOffensiveRebounds"
    | "projectedDefensiveRebounds"
    | "projectedAssists"
    | "projectedSteals"
    | "projectedBlocks"
    | "projectedTurnovers"
  >;

  const bonusEstimates = estimateProjectedBonusCounts(
    projectedStats,
    projectedGames,
  );
  const projectedFantasyPointsPerGame = calculateFantasyPoints({
    points: projectedStats.projectedPoints,
    offensiveRebounds: projectedStats.projectedOffensiveRebounds,
    defensiveRebounds: projectedStats.projectedDefensiveRebounds,
    assists: projectedStats.projectedAssists,
    steals: projectedStats.projectedSteals,
    blocks: projectedStats.projectedBlocks,
    turnovers: projectedStats.projectedTurnovers,
    doubleDoubles:
      bonusEstimates.projectedDoubleDoubles / projectedGames,
    tripleDoubles:
      bonusEstimates.projectedTripleDoubles / projectedGames,
  }, leagueConfig.scoring);

  const projection: Projection = {
    projectedGames,
    projectedMinutes,
    ...projectedStats,
    ...bonusEstimates,
    projectedFantasyPointsPerGame,
    projectedMinutesLow: Math.max(0, projectedMinutes - veteranMinutesSpread(seasons)),
    projectedMinutesHigh: Math.min(48, projectedMinutes + veteranMinutesSpread(seasons)),
    projectedFantasyPointsPerGameLow: Math.max(0, projectedFantasyPointsPerGame * (1 - veteranRangeRate(seasons))),
    projectedFantasyPointsPerGameHigh: projectedFantasyPointsPerGame * (1 + veteranRangeRate(seasons)),
  };
  const historicalAvailabilityRisk = calculateHistoricalAvailabilityRisk(
    player.historicalStats,
  );
  const currentInjuryPenalty = calculateCurrentInjuryPenalty(
    player.injuryStatus,
    player.expectedReturnDate,
    asOfDate,
    player.expectedReturnText,
    player.returnConfidence,
  );
  const combinedAvailabilityRisk = combineAvailabilityRisks(
    historicalAvailabilityRisk,
    currentInjuryPenalty,
  );
  const projectedFantasyPointsPerSeason =
    projectedFantasyPointsPerGame * projectedGames;
  const availabilityValueDiscount = Math.min(
    INJURY_SNAPSHOT_CONFIG.maximumAvailabilityValueDiscount,
    historicalAvailabilityRisk *
      RECOMMENDATION_CONFIG.availability.historicalRiskImpactOnSeasonValue +
      currentInjuryPenalty *
        (1 -
          historicalAvailabilityRisk *
            INJURY_SNAPSHOT_CONFIG.currentRiskOverlapReduction),
  );
  const availabilityAdjustedFantasyPoints =
    projectedFantasyPointsPerSeason * (1 - availabilityValueDiscount);

  return {
    projection,
    projectionSource: "Veteran NBA history",
    projectedFantasyPointsPerSeason,
    availabilityAdjustedFantasyPoints,
    historicalAvailabilityRisk,
    currentInjuryPenalty,
    combinedAvailabilityRisk,
    modelConfidence: calculateConfidenceFromSeasons(
      player,
      seasons,
      usedPerGameFallback,
    ),
    opportunityScore: calculateOpportunityScore(player, seasons, leagueConfig.scoring),
    breakoutScore: calculateBreakoutScore(player, seasons, leagueConfig.scoring),
    usedPerGameFallback,
  };
}

export function calculateHistoricalAvailabilityRisk(
  historicalStats: readonly HistoricalStats[],
): number {
  const seasons = getWeightedSeasons(historicalStats);
  if (seasons.length === 0) {
    return 0;
  }

  const weightedAvailability = weightedAverage(
    seasons.map(({ stats, weight }) => ({
      value: clamp(
        stats.gamesPlayed / RECOMMENDATION_CONFIG.seasonLengthGames,
        0,
        1,
      ),
      weight,
    })),
  );
  const lowSeasonCount = seasons.filter(
    ({ stats }) =>
      stats.gamesPlayed <
      RECOMMENDATION_CONFIG.availability.lowGamesThreshold,
  ).length;
  const repeatedLowSeasonPenalty =
    Math.max(0, lowSeasonCount - 1) *
    RECOMMENDATION_CONFIG.availability.repeatedLowSeasonPenalty;

  return clamp(1 - weightedAvailability + repeatedLowSeasonPenalty, 0, 1);
}

export function calculateCurrentInjuryPenalty(
  injuryStatus: InjuryStatus | null,
  expectedReturnDate: string | null,
  asOfDate = new Date(),
  expectedReturnText?: string | null,
  returnConfidence?: import("../types").ReturnConfidence,
): number {
  const statusPenalty = injuryStatus
    ? RECOMMENDATION_CONFIG.availability.statusPenalties[injuryStatus]
    : 0;
  let returnDatePenalty = 0;

  if (expectedReturnDate) {
    const returnTime = Date.parse(expectedReturnDate);
    if (Number.isFinite(returnTime) && returnTime > asOfDate.getTime()) {
      const daysUntilReturn =
        (returnTime - asOfDate.getTime()) / (24 * 60 * 60 * 1000);
      returnDatePenalty = Math.min(
        RECOMMENDATION_CONFIG.availability.maximumReturnDatePenalty,
        (daysUntilReturn /
          RECOMMENDATION_CONFIG.availability.seasonCalendarDays) *
          RECOMMENDATION_CONFIG.availability.returnDatePenaltyScale,
      );
    }
  }

  const hasInterpretableFutureReturn = returnDatePenalty > 0;
  let adjustedPenalty = hasInterpretableFutureReturn
    ? statusPenalty *
        RECOMMENDATION_CONFIG.availability.returnDateStatusWeight +
      returnDatePenalty *
        RECOMMENDATION_CONFIG.availability.returnDateTimelineWeight
    : statusPenalty;
  const requiresReturnGuidance =
    injuryStatus === "Out" || injuryStatus === "Injured";
  if (requiresReturnGuidance && !hasInterpretableFutureReturn) {
    const confidence = returnConfidence ?? "unknown";
    const hasNarrativeGuidance = Boolean(expectedReturnText?.trim());
    adjustedPenalty +=
      INJURY_SNAPSHOT_CONFIG.returnConfidencePenalty[confidence] *
      (hasNarrativeGuidance && confidence !== "unknown"
        ? INJURY_SNAPSHOT_CONFIG.narrativeGuidancePenaltyScale
        : 1);
  }

  return clamp(
    adjustedPenalty,
    0,
    RECOMMENDATION_CONFIG.availability.maximumCurrentInjuryPenalty,
  );
}

export function combineAvailabilityRisks(
  historicalAvailabilityRisk: number,
  currentInjuryPenalty: number,
): number {
  return clamp(
    historicalAvailabilityRisk +
      currentInjuryPenalty *
        (1 -
          historicalAvailabilityRisk *
            INJURY_SNAPSHOT_CONFIG.currentRiskOverlapReduction),
    0,
    INJURY_SNAPSHOT_CONFIG.maximumCombinedAvailabilityRisk,
  );
}

export function calculateModelConfidence(
  player: Player,
  usedPerGameFallback = false,
): number {
  return calculateConfidenceFromSeasons(
    player,
    getWeightedSeasons(player.historicalStats),
    usedPerGameFallback,
  );
}

function calculateConfidenceFromSeasons(
  player: Player,
  weightedSeasons: WeightedSeason[],
  usedPerGameFallback: boolean,
): number {
  if (weightedSeasons.length === 0) {
    return 0;
  }

  const config = RECOMMENDATION_CONFIG.confidence;
  const seasonScore =
    config.seasonCoverage[
      Math.min(weightedSeasons.length, config.seasonCoverage.length - 1)
    ];
  const gamesScore = weightedAverage(
    weightedSeasons.map(({ stats, weight }) => ({
      value: clamp(stats.gamesPlayed / config.targetGamesPerSeason, 0, 1),
      weight,
    })),
  );
  const minutesScore = weightedAverage(
    weightedSeasons.map(({ stats, weight }) => ({
      value: clamp(stats.minutesPerGame / config.targetMinutes, 0, 1),
      weight,
    })),
  );
  const statusInformationScore =
    player.injuryStatus === null || player.injuryStatus === "Unknown"
      ? config.missingInjuryInformationScore
      : 1;
  const needsReturnInformation =
    player.injuryStatus === "Out" ||
    player.injuryStatus === "Injured" ||
    player.injuryStatus === "Returning soon";
  const returnInformationScore = needsReturnInformation
    ? INJURY_SNAPSHOT_CONFIG.returnConfidenceInformationScore[
        player.returnConfidence ?? "unknown"
      ]
    : 1;
  const injuryInformationScore =
    (statusInformationScore + returnInformationScore) / 2;
  const fallbackPenalty = usedPerGameFallback
    ? config.perGameFallbackPenalty
    : 0;

  return clamp(
    seasonScore * config.seasonCoverageWeight +
      gamesScore * config.gamesSampleWeight +
      minutesScore * config.minutesSampleWeight +
      injuryInformationScore * config.injuryInformationWeight -
      fallbackPenalty,
    0,
    1,
  );
}

function estimateProjectedMinutes(seasons: WeightedSeason[]): number {
  const config = RECOMMENDATION_CONFIG.projection;
  const weightedMinutes = weightedAverage(
    seasons.map(({ stats, weight }) => ({
      value: stats.minutesPerGame,
      weight: weight * sampleReliability(stats),
    })),
  );
  const [latest, previous] = seasons;
  let trendAdjustment = 0;
  if (
    latest &&
    previous &&
    latest.stats.gamesPlayed >= config.trendMinimumGames &&
    previous.stats.gamesPlayed >= config.trendMinimumGames &&
    latest.stats.minutesPerGame >= config.trendMinimumMinutes &&
    previous.stats.minutesPerGame >= config.trendMinimumMinutes
  ) {
    trendAdjustment = clamp(
      (latest.stats.minutesPerGame - previous.stats.minutesPerGame) *
        config.minutesTrendWeight,
      -config.maximumMinutesTrendAdjustment,
      config.maximumMinutesTrendAdjustment,
    );
  }

  return clamp(
    weightedMinutes + trendAdjustment,
    config.minimumProjectedMinutes,
    config.maximumProjectedMinutes,
  );
}

export function estimateProjectedBonusCounts(
  projectedStats: Pick<
    Projection,
    | "projectedPoints"
    | "projectedOffensiveRebounds"
    | "projectedDefensiveRebounds"
    | "projectedAssists"
    | "projectedSteals"
    | "projectedBlocks"
  >,
  projectedGames: number,
): Pick<Projection, "projectedDoubleDoubles" | "projectedTripleDoubles"> {
  const config = RECOMMENDATION_CONFIG.doubleDoubleEstimate;
  const totalRebounds =
    projectedStats.projectedOffensiveRebounds +
    projectedStats.projectedDefensiveRebounds;
  const strengths = [
    projectedStats.projectedPoints,
    totalRebounds,
    projectedStats.projectedAssists,
    projectedStats.projectedSteals,
    projectedStats.projectedBlocks,
  ]
    .map((value) =>
      clamp(
        (value - config.strengthFloor) / config.strengthRange,
        0,
        config.maximumCategoryStrength,
      ),
    )
    .sort((left, right) => right - left);

  const doubleDoubleRate = Math.min(
    config.maximumDoubleDoubleRate,
    strengths[1] * config.doubleDoubleRateMultiplier,
  );
  const tripleDoubleRate = Math.min(
    config.maximumTripleDoubleRate,
    strengths[2] * config.tripleDoubleRateMultiplier,
  );

  return {
    projectedDoubleDoubles: projectedGames * doubleDoubleRate,
    projectedTripleDoubles: projectedGames * tripleDoubleRate,
  };
}

function calculateOpportunityScore(
  player: Player,
  seasons: WeightedSeason[],
  scoring: ScoringSettings,
): number {
  const config = RECOMMENDATION_CONFIG.opportunity;
  const latest = seasons[0]?.stats;
  const previous = seasons[1]?.stats;
  if (!latest) {
    return 0;
  }

  const minutesScore = clamp(latest.minutesPerGame / config.fullRoleMinutes, 0, 1);
  const minutesTrendScore = previous
    ? centeredTrend(
        latest.minutesPerGame - previous.minutesPerGame,
        config.positiveMinutesTrend,
      )
    : 0.5;
  const productionTrendScore = previous
    ? centeredTrend(
        fantasyPointsPerMinute(latest, scoring) - fantasyPointsPerMinute(previous, scoring),
        config.productionTrendScale,
      )
    : 0.5;
  const ageScore =
    player.age === null
      ? 0.5
      : clamp(
          (config.oldestOpportunityAge - player.age) /
            (config.oldestOpportunityAge - config.youngestAge),
          0,
          1,
        );
  const gamesStability = clamp(latest.gamesPlayed / config.stableGames, 0, 1);
  const minutesStability = previous
    ? 1 -
      clamp(
        Math.abs(latest.minutesPerGame - previous.minutesPerGame) /
          config.stableMinutesDifference,
        0,
        1,
      )
    : 0.5;
  const stabilityScore = (gamesStability + minutesStability) / 2;

  return (
    (minutesScore * config.minutesWeight +
      minutesTrendScore * config.minutesTrendWeight +
      productionTrendScore * config.productionTrendWeight +
      ageScore * config.ageWeight +
      stabilityScore * config.stabilityWeight) *
    100
  );
}

function calculateBreakoutScore(
  player: Player,
  seasons: WeightedSeason[],
  scoring: ScoringSettings,
): number {
  const config = RECOMMENDATION_CONFIG.breakout;
  const latest = seasons[0]?.stats;
  const previous = seasons[1]?.stats;
  if (!latest) {
    return 0;
  }

  const youthScore =
    player.age === null
      ? config.missingAgeScore
      : clamp(
          (config.oldestBreakoutAge - player.age) /
            (config.oldestBreakoutAge - config.youngestAge),
          0,
          1,
        );
  const hasTrendSample =
    previous !== undefined &&
    latest.gamesPlayed >=
      RECOMMENDATION_CONFIG.projection.trendMinimumGames &&
    previous.gamesPlayed >=
      RECOMMENDATION_CONFIG.projection.trendMinimumGames;
  const minutesTrendScore = hasTrendSample
    ? centeredTrend(
        latest.minutesPerGame - previous.minutesPerGame,
        config.positiveMinutesTrend,
      )
    : config.insufficientTrendScore;
  const productionTrendScore = hasTrendSample
    ? centeredTrend(
        fantasyPointsPerMinute(latest, scoring) - fantasyPointsPerMinute(previous, scoring),
        config.productionTrendScale,
      )
    : config.insufficientTrendScore;
  const sampleScore =
    clamp(latest.gamesPlayed / config.fullSampleGames, 0, 1) *
    clamp(latest.minutesPerGame / config.fullSampleMinutes, 0, 1);

  return (
    (youthScore * config.youthWeight +
      minutesTrendScore * config.minutesTrendWeight +
      productionTrendScore * config.productionTrendWeight +
      sampleScore * config.sampleWeight) *
    100
  );
}

function fantasyPointsPerMinute(stats: HistoricalStats, scoring: ScoringSettings): number {
  if (stats.minutesPerGame <= 0) {
    return 0;
  }
  return (
    calculateFantasyPoints({
      points: stats.points,
      offensiveRebounds: stats.offensiveRebounds,
      defensiveRebounds: stats.defensiveRebounds,
      assists: stats.assists,
      steals: stats.steals,
      blocks: stats.blocks,
      turnovers: stats.turnovers,
      doubleDoubles: 0,
      tripleDoubles: 0,
    }, scoring) / stats.minutesPerGame
  );
}

function veteranMinutesSpread(seasons: WeightedSeason[]): number {
  const latest = seasons[0]?.stats.minutesPerGame ?? 0;
  const previous = seasons[1]?.stats.minutesPerGame ?? latest;
  const sampleUncertainty = 1 - Math.min(1, (seasons[0]?.stats.gamesPlayed ?? 0) / 55);
  return Math.min(6, 1.5 + Math.abs(latest - previous) * 0.3 + sampleUncertainty * 2.5);
}

function veteranRangeRate(seasons: WeightedSeason[]): number {
  const games = seasons[0]?.stats.gamesPlayed ?? 0;
  return 0.08 + (1 - Math.min(1, games / 60)) * 0.1;
}

function getWeightedSeasons(
  historicalStats: readonly HistoricalStats[],
): WeightedSeason[] {
  return [...historicalStats]
    .sort((left, right) => right.season.localeCompare(left.season))
    .slice(0, RECOMMENDATION_CONFIG.seasonWeights.length)
    .map((stats, index) => ({
      stats,
      weight: RECOMMENDATION_CONFIG.seasonWeights[index],
    }));
}

function sampleReliability(stats: HistoricalStats): number {
  const config = RECOMMENDATION_CONFIG.projection;
  const gamesReliability = clamp(
    stats.gamesPlayed / config.gamesForFullSample,
    config.minimumSampleReliability,
    1,
  );
  const minutesReliability = clamp(
    stats.minutesPerGame / config.minutesForFullSample,
    config.minimumSampleReliability,
    1,
  );
  return gamesReliability * minutesReliability;
}

function centeredTrend(change: number, positiveScale: number): number {
  return clamp(0.5 + change / (positiveScale * 2), 0, 1);
}

function weightedAverage(
  values: ReadonlyArray<{ value: number; weight: number }>,
): number {
  const totalWeight = values.reduce((total, item) => total + item.weight, 0);
  if (totalWeight <= 0) {
    return 0;
  }
  return (
    values.reduce((total, item) => total + item.value * item.weight, 0) /
    totalWeight
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
