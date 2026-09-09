import { INJURY_SNAPSHOT_CONFIG } from "../config/injurySnapshotConfig";
import { NEW_PLAYER_PROJECTION_CONFIG } from "../config/newPlayerProjectionConfig";
import type {
  ExpectedMinutesSource,
  NewPlayerClass,
  NewPlayerClassification,
  NewPlayerPreviousLeague,
  NewPlayerProjectionInput,
  NewPlayerSanityWarning,
  Player,
  Projection,
  ProjectionMetrics,
} from "../types";
import { calculateFantasyPoints } from "./fantasyPoints";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { LeagueConfig } from "../types";
import {
  calculateCurrentInjuryPenalty,
  combineAvailabilityRisks,
  projectPlayerProduction,
} from "./projectionModel";

type ProjectionStat =
  | "points"
  | "offensiveRebounds"
  | "defensiveRebounds"
  | "assists"
  | "steals"
  | "blocks"
  | "turnovers";

const PREVIOUS_STAT_FIELDS: Record<
  ProjectionStat,
  keyof NewPlayerProjectionInput
> = {
  points: "previousPointsPerGame",
  offensiveRebounds: "previousOffensiveReboundsPerGame",
  defensiveRebounds: "previousDefensiveReboundsPerGame",
  assists: "previousAssistsPerGame",
  steals: "previousStealsPerGame",
  blocks: "previousBlocksPerGame",
  turnovers: "previousTurnoversPerGame",
};

export function hasUsableNbaHistory(player: Player): boolean {
  return player.historicalStats.length > 0;
}

export function classifyNewPlayer(
  player: Player,
  input?: NewPlayerProjectionInput,
): NewPlayerClassification {
  if (input) {
    return {
      classification: input.classification,
      confidence: input.classification === "Unknown" ? "medium" : "high",
      confidenceScore: input.classification === "Unknown" ? 0.7 : 1,
      basis: "Manual new-player override",
    };
  }
  const experience = player.nbaExperience?.trim();
  if (player.isRookie === true || experience === "R") {
    return {
      classification: "Rookie",
      confidence: "high",
      confidenceScore: 0.98,
      basis: "Official NBA roster experience is R",
    };
  }
  if (experience && Number.isFinite(Number(experience)) && Number(experience) > 0) {
    return {
      classification: "Returning NBA veteran",
      confidence: "high",
      confidenceScore: 0.92,
      basis: `Official NBA roster experience is ${experience}`,
    };
  }
  return {
    classification: "Unknown",
    confidence: "low",
    confidenceScore: 0.25,
    basis: "Official roster data does not establish a prior league",
  };
}

export function calculateDraftCapitalSignal(
  input?: NewPlayerProjectionInput,
  asOfYear = new Date().getUTCFullYear(),
): number {
  const config = NEW_PLAYER_PROJECTION_CONFIG.draftCapital;
  const pick = input?.nbaDraftPick;
  let signal: number = config.unknown;
  if (pick !== undefined && pick !== null) {
    signal = pick <= 5 ? config.topFive : pick <= 14 ? config.lottery : pick <= 30 ? config.firstRound : config.secondRound;
  } else if (input?.nbaDraftRound === 1) signal = config.firstRoundWithoutPick;
  else if (input?.nbaDraftRound === 2) signal = config.secondRoundWithoutPick;
  const age = input?.nbaDraftYear == null ? 0 : Math.max(0, asOfYear - input.nbaDraftYear - 1);
  return signal * Math.exp(-config.decayPerYearAfterDraft * age);
}

export function estimateNewPlayerMinutes(
  player: Player,
  input: NewPlayerProjectionInput | undefined,
  classification = classifyNewPlayer(player, input).classification,
  asOfYear = new Date().getUTCFullYear(),
): {
  minutes: number;
  source: ExpectedMinutesSource;
  range: readonly [number, number];
} {
  const config = NEW_PLAYER_PROJECTION_CONFIG.minutes;
  const availability = input?.nbaAvailabilityStatus ?? "Unknown";
  if (availability === "Overseas / stash" || availability === "Not expected to play") {
    return { minutes: 0, source: "availability status", range: [0, 0] };
  }
  if (input?.expectedNbaMinutesLow != null && input.expectedNbaMinutesBase != null && input.expectedNbaMinutesHigh != null) {
    return {
      minutes: clamp(input.expectedNbaMinutesBase, 0, 48), source: "manual expected NBA MPG range",
      range: [clamp(input.expectedNbaMinutesLow, 0, 48), clamp(input.expectedNbaMinutesHigh, 0, 48)],
    };
  }
  if (input?.expectedNbaMinutes !== undefined && input.expectedNbaMinutes !== null) {
    const minutes = clamp(input.expectedNbaMinutes, 0, 48);
    return { minutes, source: "manual expected NBA MPG", range: minutes === 0 ? [0, 0] : [Math.max(0, minutes - 3), Math.min(48, minutes + 3)] };
  }
  if (input?.roleExpectation) {
    const roleRange = config.roles[input.roleExpectation];
    return {
      minutes: midpoint(roleRange),
      source: "role expectation",
      range: [roleRange.minimum, roleRange.maximum],
    };
  }
  const hasHeuristicEvidence =
    input?.nbaDraftPick != null ||
    input?.nbaDraftRound != null ||
    input?.previousMinutesPerGame != null;
  if (input && hasHeuristicEvidence) {
    const draftSignal = calculateDraftCapitalSignal(input, asOfYear);
    const effectiveAge = input.age ?? player.age;
    const ageBonus =
      classification === "Returning NBA veteran" || effectiveAge === null
        ? 0
        : clamp(
            (config.youngestAge + 5 - effectiveAge) * config.ageBonusPerYear,
            0,
            config.maximumAgeBonus,
          );
    const previousMinutesAdjustment =
      input.previousMinutesPerGame === undefined ||
      input.previousMinutesPerGame === null
        ? 0
        : clamp(
            (input.previousMinutesPerGame - config.previousMinutesBaseline) *
              config.previousMinutesScale,
            -config.maximumPreviousMinutesAdjustment,
            config.maximumPreviousMinutesAdjustment,
          );
    const minutes = clamp(
      config.heuristicBase +
        draftSignal * config.draftCapitalScale +
        ageBonus +
        previousMinutesAdjustment,
      config.minimum,
      config.maximum,
    );
    return {
      minutes,
      source: "draft capital / age / previous MPG heuristic",
      range: [
        clamp(minutes - 2, config.minimum, config.maximum),
        clamp(minutes + 2, config.minimum, config.maximum),
      ],
    };
  }
  const fallback = config.classificationFallbacks[classification];
  return {
    minutes: midpoint(fallback),
    source: "classification fallback",
    range: [fallback.minimum, fallback.maximum],
  };
}

export function projectNewPlayer(
  player: Player,
  input?: NewPlayerProjectionInput,
  asOfDate = new Date(),
  leagueConfig: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): ProjectionMetrics {
  const classification = classifyNewPlayer(player, input);
  const minutesEstimate = estimateNewPlayerMinutes(
    player,
    input,
    classification.classification,
    asOfDate.getUTCFullYear(),
  );
  const previousLeague: NewPlayerPreviousLeague =
    input?.previousLeague ??
    (classification.classification === "Returning NBA veteran"
      ? "Prior NBA"
      : "Unknown");
  const translationFactor =
    NEW_PLAYER_PROJECTION_CONFIG.translationFactors[previousLeague];
  const completeness = previousStatCompleteness(input);
  const sampleAdjustment = previousSampleAdjustment(input, completeness);
  const stats = blendSummerLeagueStats(translateStats(
    input,
    minutesEstimate.minutes,
    translationFactor,
    sampleAdjustment,
  ), input, minutesEstimate.minutes);
  const projectedGames = minutesEstimate.minutes === 0 ? 0 : clamp(
    NEW_PLAYER_PROJECTION_CONFIG.projectedGames.byClassification[
      classification.classification
    ] +
      (minutesEstimate.minutes -
        NEW_PLAYER_PROJECTION_CONFIG.projectedGames.minutesBaseline) *
        NEW_PLAYER_PROJECTION_CONFIG.projectedGames.gamesPerExtraMinute,
    NEW_PLAYER_PROJECTION_CONFIG.projectedGames.minimum,
    NEW_PLAYER_PROJECTION_CONFIG.projectedGames.maximum,
  );
  const fantasyPointsWithoutBonuses = calculateFantasyPoints({
    ...stats,
    doubleDoubles: 0,
    tripleDoubles: 0,
  }, leagueConfig.scoring);
  const bonuses = estimateBonuses(stats, projectedGames, sampleAdjustment);
  const projectedFantasyPointsPerGame = calculateFantasyPoints({
    ...stats,
    doubleDoubles: bonuses.projectedDoubleDoubles / Math.max(1, projectedGames),
    tripleDoubles: bonuses.projectedTripleDoubles / Math.max(1, projectedGames),
  }, leagueConfig.scoring);
  const minuteLow = minutesEstimate.range[0];
  const minuteHigh = minutesEstimate.range[1];
  const uncertainty = 0.08 + (1 - calculateNewPlayerMetadataCompleteness(input)) * 0.12;
  const projection: Projection = {
    projectedGames,
    projectedMinutes: minutesEstimate.minutes,
    projectedPoints: stats.points,
    projectedOffensiveRebounds: stats.offensiveRebounds,
    projectedDefensiveRebounds: stats.defensiveRebounds,
    projectedAssists: stats.assists,
    projectedSteals: stats.steals,
    projectedBlocks: stats.blocks,
    projectedTurnovers: stats.turnovers,
    ...bonuses,
    projectedFantasyPointsPerGame,
    projectedMinutesLow: minuteLow,
    projectedMinutesHigh: minuteHigh,
    projectedFantasyPointsPerGameLow: minutesEstimate.minutes === 0 ? 0 : Math.max(0, projectedFantasyPointsPerGame * (minuteLow / minutesEstimate.minutes) * (1 - uncertainty)),
    projectedFantasyPointsPerGameHigh: minutesEstimate.minutes === 0 ? 0 : projectedFantasyPointsPerGame * (minuteHigh / minutesEstimate.minutes) * (1 + uncertainty),
  };
  const currentInjuryPenalty = calculateCurrentInjuryPenalty(
    player.injuryStatus,
    player.expectedReturnDate,
    asOfDate,
    player.expectedReturnText,
    player.returnConfidence,
  );
  const modelConfidence = calculateNewPlayerConfidence(
    player,
    input,
    classification.confidenceScore,
    sampleAdjustment,
    completeness,
  );
  const draftCapitalContribution = calculateDraftCapitalSignal(input, asOfDate.getUTCFullYear());
  const opportunityScore = calculateNewPlayerOpportunity(
    classification.classification,
    minutesEstimate.minutes,
    input,
    draftCapitalContribution,
    modelConfidence,
  );
  const breakoutScore = calculateNewPlayerBreakout(
    player,
    classification.classification,
    minutesEstimate.minutes,
    input,
    draftCapitalContribution,
    fantasyPointsWithoutBonuses,
    modelConfidence,
  );
  const usedConservativeFallback =
    minutesEstimate.source === "classification fallback" &&
    completeness === 0;
  const warnings: string[] = [];
  if (usedConservativeFallback) {
    warnings.push("Limited metadata; conservative classification fallback used.");
  }
  if (completeness > 0 && sampleAdjustment < 0.2) {
    warnings.push("Previous-league production is heavily regressed for sample size.");
  }
  const projectedFantasyPointsPerSeason =
    projectedFantasyPointsPerGame * projectedGames;
  const availabilityAdjustedFantasyPoints =
    projectedFantasyPointsPerSeason *
    (1 -
      Math.min(
        INJURY_SNAPSHOT_CONFIG.maximumAvailabilityValueDiscount,
        currentInjuryPenalty *
          NEW_PLAYER_PROJECTION_CONFIG.availability
            .currentPenaltyImpactOnSeasonValue,
      ));

  return {
    projection,
    projectionSource: "Rookie/new-player model",
    newPlayerDetails: {
      classification: classification.classification,
      classificationConfidence: classification.confidence,
      expectedMinutesSource: minutesEstimate.source,
      expectedMinutesRange: minutesEstimate.range,
      draftCapitalContribution,
      previousLeague,
      previousLeagueTranslationFactor: translationFactor,
      sampleSizeAdjustment: sampleAdjustment,
      metadataCompleteness: calculateNewPlayerMetadataCompleteness(input),
      confidenceAdjustment:
        modelConfidence - NEW_PLAYER_PROJECTION_CONFIG.confidence.base,
      usedConservativeFallback,
      warnings,
      nbaAvailabilityStatus: input?.nbaAvailabilityStatus ?? "Unknown",
      draftYearDecay: input?.nbaDraftYear == null ? 1 : Math.exp(-NEW_PLAYER_PROJECTION_CONFIG.draftCapital.decayPerYearAfterDraft * Math.max(0, asOfDate.getUTCFullYear() - input.nbaDraftYear - 1)),
      summerLeagueWeight: calculateSummerLeagueWeight(input),
    },
    projectedFantasyPointsPerSeason,
    availabilityAdjustedFantasyPoints,
    historicalAvailabilityRisk: 0,
    currentInjuryPenalty,
    combinedAvailabilityRisk: combineAvailabilityRisks(0, currentInjuryPenalty),
    modelConfidence,
    opportunityScore,
    breakoutScore,
    usedPerGameFallback: true,
  };
}

export function projectPlayerForRecommendations(
  player: Player,
  input?: NewPlayerProjectionInput,
  asOfDate = new Date(),
  leagueConfig: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): ProjectionMetrics | null {
  return hasUsableNbaHistory(player)
    ? projectPlayerProduction(player, asOfDate, leagueConfig)
    : projectNewPlayer(player, input, asOfDate, leagueConfig);
}

export function calculateNewPlayerMetadataCompleteness(
  input?: NewPlayerProjectionInput,
): number {
  if (!input) return 0;
  const fields: Array<keyof NewPlayerProjectionInput> = [
    "age",
    "nbaDraftYear",
    "nbaDraftRound",
    "nbaDraftPick",
    "previousGames",
    "previousMinutesPerGame",
    ...Object.values(PREVIOUS_STAT_FIELDS),
    "expectedNbaMinutes",
  ];
  const completed = fields.filter(
    (field) => input[field] !== undefined && input[field] !== null,
  ).length;
  const knownLeague =
    input.previousLeague !== undefined && input.previousLeague !== "Unknown"
      ? 1
      : 0;
  const clearRole =
    input.roleExpectation !== undefined && input.roleExpectation !== "Unclear"
      ? 1
      : 0;
  return (completed + knownLeague + clearRole) / (fields.length + 2);
}

export function getNewPlayerSanityWarnings(
  player: Player,
  metrics: ProjectionMetrics,
  input?: NewPlayerProjectionInput,
  earlyRoundScore?: number,
): NewPlayerSanityWarning[] {
  if (!metrics.newPlayerDetails) return [];
  const config = NEW_PLAYER_PROJECTION_CONFIG.sanity;
  const details = metrics.newPlayerDetails;
  const warnings: NewPlayerSanityWarning[] = [];
  const add = (warning: string) =>
    warnings.push({ playerId: player.id, playerName: player.name, warning });
  if (
    details.classification === "Rookie" &&
    metrics.projection.projectedFantasyPointsPerGame > config.eliteFantasyPoints &&
    (details.metadataCompleteness < 0.6 || details.sampleSizeAdjustment < 0.5)
  ) {
    add("Rookie exceeds 40 FP/G without a strong metadata/sample foundation.");
  }
  if (
    details.classification === "Rookie" &&
    metrics.projection.projectedMinutes > config.excessiveMinutes &&
    (!input?.roleExpectation || input.roleExpectation === "Unclear")
  ) {
    add("Rookie exceeds 34 MPG with an unclear role.");
  }
  if (
    (input?.previousGames ?? Infinity) < config.tinySampleGames &&
    metrics.projection.projectedFantasyPointsPerGame > config.eliteFantasyPoints
  ) {
    add("Tiny previous sample is producing an elite projection.");
  }
  if (
    details.classification === "Rookie" &&
    metrics.modelConfidence < 0.45 &&
    (earlyRoundScore ?? 0) >= config.earlyRoundScore
  ) {
    add("Low-confidence rookie is reaching early-round score territory.");
  }
  if (
    details.classification === "Unknown" &&
    metrics.projection.projectedFantasyPointsPerGame > 35
  ) {
    add("Unknown newcomer projects above an established-star threshold.");
  }
  if (
    details.classification === "Returning NBA veteran" &&
    metrics.breakoutScore > 75
  ) {
    add("Returning veteran has an unusually high breakout score; no youth bonus is used.");
  }
  if (
    details.draftCapitalContribution >= 0.72 &&
    details.sampleSizeAdjustment > 0 &&
    details.sampleSizeAdjustment < 0.2 &&
    metrics.projection.projectedFantasyPointsPerGame > 35
  ) {
    add("Draft capital may be overwhelming weak previous-production evidence.");
  }
  return warnings;
}

function translateStats(
  input: NewPlayerProjectionInput | undefined,
  expectedMinutes: number,
  translationFactor: number,
  sampleAdjustment: number,
): Record<ProjectionStat, number> {
  const baseline = NEW_PLAYER_PROJECTION_CONFIG.baselinePerMinute;
  const maximums = NEW_PLAYER_PROJECTION_CONFIG.statMaximums;
  const previousMinutes = input?.previousMinutesPerGame;
  return Object.fromEntries(
    (Object.keys(PREVIOUS_STAT_FIELDS) as ProjectionStat[]).map((stat) => {
      const raw = input?.[PREVIOUS_STAT_FIELDS[stat]];
      const hasRate =
        typeof raw === "number" &&
        previousMinutes !== undefined &&
        previousMinutes !== null &&
        previousMinutes > 0;
      const translatedRate = hasRate
        ? (raw / previousMinutes) * translationFactor
        : baseline[stat];
      const rate =
        baseline[stat] * (1 - sampleAdjustment) +
        translatedRate * sampleAdjustment;
      return [stat, clamp(rate * expectedMinutes, 0, maximums[stat])];
    }),
  ) as Record<ProjectionStat, number>;
}

function calculateSummerLeagueWeight(input?: NewPlayerProjectionInput): number {
  if (!input || input.summerLeagueGames == null || input.summerLeagueMinutesPerGame == null) return 0;
  const config = NEW_PLAYER_PROJECTION_CONFIG.summerLeague;
  return config.maximumWeight * Math.min(1, input.summerLeagueGames / config.gamesForFullWeight) * Math.min(1, input.summerLeagueMinutesPerGame / config.minutesForFullWeight);
}

function blendSummerLeagueStats(stats: Record<ProjectionStat, number>, input: NewPlayerProjectionInput | undefined, expectedMinutes: number): Record<ProjectionStat, number> {
  const weight = calculateSummerLeagueWeight(input);
  const summerMinutes = input?.summerLeagueMinutesPerGame;
  if (weight <= 0 || !summerMinutes || expectedMinutes <= 0) return stats;
  const totalRebounds = input.summerLeagueReboundsPerGame;
  const values: Partial<Record<ProjectionStat, number | null>> = {
    points: input.summerLeaguePointsPerGame,
    offensiveRebounds: totalRebounds == null ? null : totalRebounds * 0.28,
    defensiveRebounds: totalRebounds == null ? null : totalRebounds * 0.72,
    assists: input.summerLeagueAssistsPerGame,
    steals: input.summerLeagueStealsPerGame,
    blocks: input.summerLeagueBlocksPerGame,
    turnovers: input.summerLeagueTurnoversPerGame,
  };
  return Object.fromEntries((Object.keys(stats) as ProjectionStat[]).map((key) => {
    const raw = values[key];
    const summerProjection = typeof raw === "number" ? raw / summerMinutes * expectedMinutes : stats[key];
    return [key, stats[key] * (1 - weight) + summerProjection * weight];
  })) as Record<ProjectionStat, number>;
}

function previousStatCompleteness(input?: NewPlayerProjectionInput): number {
  if (!input) return 0;
  const fields = Object.values(PREVIOUS_STAT_FIELDS);
  return (
    fields.filter(
      (field) => typeof input[field] === "number" && input[field] !== null,
    ).length / fields.length
  );
}

function previousSampleAdjustment(
  input: NewPlayerProjectionInput | undefined,
  completeness: number,
): number {
  if (
    !input ||
    input.previousGames === undefined ||
    input.previousGames === null ||
    input.previousMinutesPerGame === undefined ||
    input.previousMinutesPerGame === null
  ) {
    return 0;
  }
  return clamp(
    (input.previousGames /
      NEW_PLAYER_PROJECTION_CONFIG.sample.gamesForStrongSample) *
      (input.previousMinutesPerGame /
        NEW_PLAYER_PROJECTION_CONFIG.sample.minutesForStrongSample) *
      completeness,
    0,
    NEW_PLAYER_PROJECTION_CONFIG.sample.maximumTranslatedWeight,
  );
}

function calculateNewPlayerConfidence(
  player: Player,
  input: NewPlayerProjectionInput | undefined,
  classificationConfidence: number,
  sampleAdjustment: number,
  statCompleteness: number,
): number {
  const config = NEW_PLAYER_PROJECTION_CONFIG.confidence;
  const hasClearRole =
    input?.roleExpectation !== undefined && input.roleExpectation !== "Unclear";
  const hasDraftCapital =
    input?.nbaDraftPick != null || input?.nbaDraftRound != null;
  const hasManualMinutes = input?.expectedNbaMinutes != null;
  const knownLeague =
    input?.previousLeague !== undefined && input.previousLeague !== "Unknown";
  const injuryKnown =
    player.injuryStatus !== null && player.injuryStatus !== "Unknown";
  return clamp(
    config.base +
      classificationConfidence * config.classificationWeight +
      sampleAdjustment * config.previousSampleWeight +
      statCompleteness * config.statCompletenessWeight +
      (hasClearRole ? config.roleClarityBonus : 0) +
      (hasDraftCapital ? config.draftCapitalKnownBonus : 0) +
      (hasManualMinutes ? config.manualMinutesBonus : 0) +
      (knownLeague ? config.previousLeagueKnownBonus : 0) +
      (injuryKnown ? config.injuryInformationBonus : 0),
    0,
    config.ceiling,
  );
}

function calculateNewPlayerOpportunity(
  classification: NewPlayerClass,
  expectedMinutes: number,
  input: NewPlayerProjectionInput | undefined,
  draftSignal: number,
  confidence: number,
): number {
  const config = NEW_PLAYER_PROJECTION_CONFIG.opportunity;
  const roleClarity = input?.roleExpectation
    ? input.roleExpectation === "Unclear"
      ? 0.35
      : 1
    : 0;
  const previousMinutes = clamp(
    (input?.previousMinutesPerGame ?? 0) / 36,
    0,
    1,
  );
  return (
    (clamp(expectedMinutes / config.fullRoleMinutes, 0, 1) *
      config.minutesWeight +
      draftSignal * config.draftCapitalWeight +
      roleClarity * config.roleClarityWeight +
      previousMinutes * config.previousMinutesWeight +
      confidence * config.confidenceWeight +
      config.classificationSignals[classification] *
        config.classificationWeight) *
    100
  );
}

function calculateNewPlayerBreakout(
  player: Player,
  classification: NewPlayerClass,
  expectedMinutes: number,
  input: NewPlayerProjectionInput | undefined,
  draftSignal: number,
  fantasyPointsWithoutBonuses: number,
  confidence: number,
): number {
  const config = NEW_PLAYER_PROJECTION_CONFIG.breakout;
  const roleClarity = input?.roleExpectation
    ? input.roleExpectation === "Unclear"
      ? 0.35
      : 1
    : 0;
  const minutesScore = clamp(expectedMinutes / 32, 0, 1);
  const productionScore = expectedMinutes <= 0 ? 0 : clamp(
    fantasyPointsWithoutBonuses / expectedMinutes / config.strongFantasyPointsPerMinute, 0, 1,
  );
  if (classification === "Returning NBA veteran") {
    const weights = config.returningVeteran;
    return (
      (minutesScore * weights.expectedMinutesWeight +
        productionScore * weights.productionWeight +
        roleClarity * weights.roleClarityWeight +
        confidence * weights.confidenceWeight) *
      weights.scoreScale *
      100
    );
  }
  const effectiveAge = input?.age ?? player.age;
  const ageScore =
    effectiveAge === null
      ? 0.35
      : clamp(
          (config.oldestAge - effectiveAge) /
            (config.oldestAge - config.youngestAge),
          0,
          1,
        );
  const weights = config.rookie;
  const rookieScale = classification === "Rookie" ? 1 : 0.82;
  return (
    (ageScore * weights.ageWeight +
      minutesScore * weights.expectedMinutesWeight +
      draftSignal * weights.draftCapitalWeight +
      productionScore * weights.productionWeight +
      roleClarity * weights.roleClarityWeight +
      (1 - confidence) * weights.uncertaintyUpsideWeight) *
    100 *
    rookieScale
  );
}

function estimateBonuses(
  stats: Record<ProjectionStat, number>,
  projectedGames: number,
  sampleAdjustment: number,
): Pick<Projection, "projectedDoubleDoubles" | "projectedTripleDoubles"> {
  const config = NEW_PLAYER_PROJECTION_CONFIG.bonuses;
  const strengths = [
    stats.points,
    stats.offensiveRebounds + stats.defensiveRebounds,
    stats.assists,
    stats.steals,
    stats.blocks,
  ]
    .map((value) =>
      clamp((value - config.categoryFloor) / config.categoryRange, 0, 1),
    )
    .sort((left, right) => right - left);
  const evidenceScale = 0.2 + sampleAdjustment;
  const doubleDoubleRate = Math.min(
    config.maximumDoubleDoubleRate,
    strengths[1] * config.doubleDoubleMultiplier * evidenceScale,
  );
  const tripleDoubleRate = Math.min(
    config.maximumTripleDoubleRate,
    strengths[2] * config.tripleDoubleMultiplier * evidenceScale,
  );
  return {
    projectedDoubleDoubles: projectedGames * doubleDoubleRate,
    projectedTripleDoubles: projectedGames * tripleDoubleRate,
  };
}

function midpoint(range: { minimum: number; maximum: number }): number {
  return (range.minimum + range.maximum) / 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
