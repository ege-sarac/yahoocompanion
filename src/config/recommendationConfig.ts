import type { InjuryStatus, YahooPosition } from "../types";

export type RecommendationStage = "early" | "middle" | "late";

export interface RecommendationStageWeights {
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

export const RECOMMENDATION_CONFIG = {
  seasonWeights: [0.6, 0.25, 0.15],
  seasonLengthGames: 82,
  baseValueNormalization: {
    lowerPercentile: 0.1,
    upperPercentile: 1,
  },
  projection: {
    minimumProjectedMinutes: 4,
    maximumProjectedMinutes: 38,
    minimumMinutesForRate: 5,
    minimumGamesForRate: 8,
    gamesForFullSample: 30,
    minutesForFullSample: 18,
    minimumSampleReliability: 0.15,
    minutesTrendWeight: 0.2,
    maximumMinutesTrendAdjustment: 3.5,
    trendMinimumGames: 12,
    trendMinimumMinutes: 5,
  },
  doubleDoubleEstimate: {
    categoryThreshold: 10,
    strengthFloor: 7,
    strengthRange: 5,
    maximumCategoryStrength: 0.85,
    doubleDoubleRateMultiplier: 0.6,
    tripleDoubleRateMultiplier: 0.12,
    maximumDoubleDoubleRate: 0.48,
    maximumTripleDoubleRate: 0.1,
  },
  availability: {
    lowGamesThreshold: 55,
    repeatedLowSeasonPenalty: 0.07,
    historicalRiskImpactOnSeasonValue: 0.35,
    statusPenalties: {
      Healthy: 0,
      "Day-to-day": 0.02,
      "Returning soon": 0.06,
      Out: 0.28,
      Injured: 0.32,
      Unknown: 0,
    } satisfies Record<InjuryStatus, number>,
    seasonCalendarDays: 180,
    returnDatePenaltyScale: 0.6,
    maximumReturnDatePenalty: 0.4,
    returnDateStatusWeight: 0.5,
    returnDateTimelineWeight: 0.5,
    maximumCurrentInjuryPenalty: 0.65,
  },
  confidence: {
    seasonCoverage: [0, 0.5, 0.78, 1],
    seasonCoverageWeight: 0.4,
    gamesSampleWeight: 0.3,
    minutesSampleWeight: 0.2,
    injuryInformationWeight: 0.1,
    targetGamesPerSeason: 50,
    targetMinutes: 18,
    missingInjuryInformationScore: 0.5,
    perGameFallbackPenalty: 0.18,
  },
  opportunity: {
    minutesWeight: 0.4,
    minutesTrendWeight: 0.2,
    productionTrendWeight: 0.15,
    ageWeight: 0.1,
    stabilityWeight: 0.15,
    fullRoleMinutes: 32,
    positiveMinutesTrend: 8,
    productionTrendScale: 0.025,
    youngestAge: 20,
    oldestOpportunityAge: 32,
    stableGames: 65,
    stableMinutesDifference: 4,
  },
  breakout: {
    youthWeight: 0.3,
    minutesTrendWeight: 0.27,
    productionTrendWeight: 0.28,
    sampleWeight: 0.15,
    youngestAge: 20,
    oldestBreakoutAge: 31,
    positiveMinutesTrend: 8,
    productionTrendScale: 0.025,
    fullSampleGames: 40,
    fullSampleMinutes: 20,
    insufficientTrendScore: 0.35,
    missingAgeScore: 0.4,
  },
  rosterFit: {
    targetCoverage: {
      G: 5.5,
      F: 5.5,
      C: 4.5,
    } satisfies Record<YahooPosition, number>,
    neutralScore: 50,
    deficitBonusRange: 42,
    surplusPenaltyRange: 15,
  },
  rosterFeedback: {
    minimumRoundForWarnings: 6,
    coverageTolerance: 0.75,
    concentrationMinimumPlayers: 8,
    concentrationThreshold: 0.75,
  },
  flexibilityScores: {
    unknown: 50,
    onePosition: 50,
    twoPositions: 72,
    threePositions: 100,
  },
  scarcity: {
    neutralUnknownScore: 50,
    viablePercentile: 0.45,
    healthyPoolSize: 32,
    lookAheadPlayers: 6,
    meaningfulQualityDrop: 0.25,
    playerCountWeight: 0.4,
    qualityDropWeight: 0.6,
    smoothingFactor: 0.72,
  },
  stages: {
    early: {
      roundEnd: 5,
      weights: {
        projectedValue: 0.62,
        availability: 0.13,
        rosterFit: 0.02,
        scarcity: 0.04,
        opportunity: 0.035,
        breakout: 0.015,
        flexibility: 0.01,
        confidence: 0.04,
        survivalUrgency: 0.05,
        recentRun: 0.015,
        tierDropoff: 0.02,
      },
    },
    middle: {
      roundEnd: 10,
      weights: {
        projectedValue: 0.47,
        availability: 0.11,
        rosterFit: 0.08,
        scarcity: 0.08,
        opportunity: 0.07,
        breakout: 0.045,
        flexibility: 0.02,
        confidence: 0.05,
        survivalUrgency: 0.04,
        recentRun: 0.015,
        tierDropoff: 0.02,
      },
    },
    late: {
      roundEnd: 15,
      weights: {
        projectedValue: 0.36,
        availability: 0.1,
        rosterFit: 0.14,
        scarcity: 0.1,
        opportunity: 0.1,
        breakout: 0.08,
        flexibility: 0.025,
        confidence: 0.035,
        survivalUrgency: 0.03,
        recentRun: 0.01,
        tierDropoff: 0.02,
      },
    },
  } satisfies Record<
    RecommendationStage,
    { roundEnd: number; weights: RecommendationStageWeights }
  >,
  draftSignals: {
    recentWindow: 12,
    recentRunScale: 2.5,
    tierLookAhead: 4,
    meaningfulTierGapFantasyPoints: 5,
  },
} as const;
