import {
  RECOMMENDATION_CONFIG,
  type RecommendationStage,
  type RecommendationStageWeights,
} from "../config/recommendationConfig";
import type {
  DraftPick,
  LeagueConfig,
  Player,
  PlayerRecommendation,
  NewPlayerProjectionInput,
  ProjectionMetrics,
  RecommendationComponents,
  RecommendationContributions,
  RecommendationResult,
  YahooPosition,
} from "../types";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import { getDraftProgress } from "./draftState";
import { getMyOverallPicks } from "./draftOrder";
import { calculateRecentPositionRuns } from "./draftSignals";
import { assignRosterSlots } from "./rosterAssignment";
import { projectPlayerForRecommendations } from "./newPlayerProjection";
import { calculateFlexibilityScore, calculateRosterFitScore, getRosterCoverage } from "./rosterFit";
import {
  calculatePlayerScarcityScore,
  calculatePositionScarcity,
} from "./scarcity";

export interface RankPlayersInput {
  players: readonly Player[];
  draftedPlayerIds: readonly string[];
  myRoster: readonly Player[];
  currentRound: number;
  currentOverallPick?: number;
  draftPicks?: readonly DraftPick[];
  leagueConfig?: LeagueConfig;
  asOfDate?: Date;
  newPlayerInputs?: readonly NewPlayerProjectionInput[];
}

interface ProjectedCandidate {
  player: Player;
  metrics: ProjectionMetrics;
  newPlayerInput?: NewPlayerProjectionInput;
}

export function getRecommendationStage(
  currentRound: number,
  leagueConfig: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): RecommendationStage {
  const progress = (currentRound - 1) / Math.max(1, leagueConfig.rounds - 1);
  if (progress < 1 / 3) {
    return "early";
  }
  if (progress < 2 / 3) {
    return "middle";
  }
  return "late";
}

export function getRecommendationWeights(
  currentRound: number,
  leagueConfig: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): RecommendationStageWeights {
  const progress = clamp((currentRound - 1) / Math.max(1, leagueConfig.rounds - 1), 0, 1);
  return getRecommendationWeightsForProgress(progress);
}

export function getRecommendationWeightsForProgress(progress: number): RecommendationStageWeights {
  const clamped = clamp(progress, 0, 1);
  const from = clamped <= 0.5 ? RECOMMENDATION_CONFIG.stages.early.weights : RECOMMENDATION_CONFIG.stages.middle.weights;
  const to = clamped <= 0.5 ? RECOMMENDATION_CONFIG.stages.middle.weights : RECOMMENDATION_CONFIG.stages.late.weights;
  const amount = clamped <= 0.5 ? clamped * 2 : (clamped - 0.5) * 2;
  return Object.fromEntries((Object.keys(from) as Array<keyof RecommendationStageWeights>).map((key) => [key, from[key] + (to[key] - from[key]) * amount])) as unknown as RecommendationStageWeights;
}

export function rankPlayers(input: RankPlayersInput): RecommendationResult {
  const leagueConfig = input.leagueConfig ?? DEFAULT_LEAGUE_CONFIG;
  const draftedIds = new Set(input.draftedPlayerIds);
  const availablePlayers = input.players.filter(
    (player) => !draftedIds.has(player.id),
  );
  const newPlayerInputById = new Map(
    (input.newPlayerInputs ?? []).map((entry) => [entry.playerId, entry]),
  );
  const projectedCandidates: ProjectedCandidate[] = availablePlayers.flatMap(
    (player) => {
      const newPlayerInput = newPlayerInputById.get(player.id);
      const metrics = projectPlayerForRecommendations(
        player,
        newPlayerInput,
        input.asOfDate,
        leagueConfig,
      );
      return metrics ? [{ player, metrics, newPlayerInput }] : [];
    },
  );
  const draftProgress = input.currentOverallPick === undefined
    ? clamp((input.currentRound - 1) / Math.max(1, leagueConfig.rounds - 1), 0, 1)
    : getDraftProgress(Math.max(0, input.currentOverallPick - 1), leagueConfig);
  const currentOverallPick = input.currentOverallPick ?? Math.max(1, (input.currentRound - 1) * leagueConfig.teamCount + 1);
  const nextUserPick = getMyOverallPicks(leagueConfig).find((pick) => pick > currentOverallPick) ?? null;
  const picksUntilNextUserPick = nextUserPick === null ? null : Math.max(0, nextUserPick - currentOverallPick - 1);
  const rosterAssignment = assignRosterSlots(input.myRoster, leagueConfig);
  const remainingNeeds = { G: leagueConfig.roster.G, F: leagueConfig.roster.F, C: leagueConfig.roster.C };
  for (const entry of rosterAssignment.assignments) if (entry.slot === "G" || entry.slot === "F" || entry.slot === "C") remainingNeeds[entry.slot] = Math.max(0, remainingNeeds[entry.slot] - 1);
  const scarcityByPosition = calculatePositionScarcity(
    projectedCandidates.map(({ player, metrics }) => ({
      player,
      projectedFantasyPointsPerGame:
        metrics.projection.projectedFantasyPointsPerGame,
    })), { picksUntilNextUserPick, draftProgress, remainingNeeds },
  );
  const productionValues = projectedCandidates
    .map(
      ({ metrics }) => metrics.projection.projectedFantasyPointsPerGame,
    )
    .sort((left, right) => left - right);
  const lowerProductionAnchor = percentileValue(
    productionValues,
    RECOMMENDATION_CONFIG.baseValueNormalization.lowerPercentile,
  );
  const upperProductionAnchor = percentileValue(
    productionValues,
    RECOMMENDATION_CONFIG.baseValueNormalization.upperPercentile,
  );
  const weights = getRecommendationWeightsForProgress(draftProgress);
  const recentRuns = calculateRecentPositionRuns(input.draftPicks ?? [], input.players);
  const productionRank = new Map([...projectedCandidates]
    .sort((a, b) => b.metrics.projection.projectedFantasyPointsPerGame - a.metrics.projection.projectedFantasyPointsPerGame)
    .map((candidate, index) => [candidate.player.id, index + 1]));

  const recommendations = projectedCandidates
    .map(({ player, metrics, newPlayerInput }): PlayerRecommendation => {
      const baseValue = normalizeProductionValue(
        metrics.projection.projectedFantasyPointsPerGame,
        lowerProductionAnchor,
        upperProductionAnchor,
      );
      const rosterFitScore = calculateRosterFitScore(player, input.myRoster, leagueConfig);
      const scarcityScore = calculatePlayerScarcityScore(
        player,
        scarcityByPosition,
      );
      const flexibilityScore = calculateFlexibilityScore(player);
      const recentRunPressure = player.yahooPositions.length === 0 ? 0 : Math.max(...player.yahooPositions.map((position) => recentRuns[position].runPressure));
      const recentRunLabel = recentRunPressure >= 0.65 ? "Strong run" as const : recentRunPressure >= 0.3 ? "Mild run" as const : "No run" as const;
      const tier = calculateTierDropoff(player, projectedCandidates);
      const survival = calculateSurvival(productionRank.get(player.id) ?? projectedCandidates.length, picksUntilNextUserPick, scarcityScore, recentRunPressure, tier.score);
      const components: RecommendationComponents = {
        projectedValue: baseValue,
        availability:
          100 * (1 - metrics.combinedAvailabilityRisk),
        rosterFit: rosterFitScore,
        scarcity: scarcityScore,
        opportunity: metrics.opportunityScore,
        breakout: metrics.breakoutScore,
        flexibility: flexibilityScore,
        confidence: metrics.modelConfidence * 100,
        survivalUrgency: survival.urgency,
        recentRun: recentRunPressure * Math.min(1, rosterFitScore / 65) * 100,
        tierDropoff: tier.score,
      };
      const contributions = weightedContributions(components, weights);
      const finalScore = Object.values(contributions).reduce(
        (total, contribution) => total + contribution,
        0,
      );

      return {
        player,
        newPlayerInput,
        ...metrics,
        baseValue,
        rosterFitScore,
        scarcityScore,
        flexibilityScore,
        finalScore,
        survivalEstimate: survival.estimate,
        survivalLabel: survival.label,
        urgencyScore: survival.urgency,
        picksUntilNextUserPick,
        recentRunPressure,
        recentRunLabel,
        tierDropoffScore: tier.score,
        tierDropoffExplanation: tier.explanation,
        components,
        contributions,
        explanations: buildExplanations(
          player,
          metrics,
          baseValue,
          rosterFitScore,
          scarcityScore,
          input.myRoster,
          input.currentRound,
          survival.label,
          picksUntilNextUserPick,
          recentRunLabel,
          tier.explanation,
        ),
      };
    })
    .sort(
      (left, right) =>
        right.finalScore - left.finalScore ||
        right.projection.projectedFantasyPointsPerGame -
          left.projection.projectedFantasyPointsPerGame ||
        left.player.name.localeCompare(right.player.name),
    );

  const result = {
    recommendations,
    scarcityByPosition,
    excludedForNoHistory:
      availablePlayers.length - projectedCandidates.length,
    newPlayerModelCount: projectedCandidates.filter(
      ({ metrics }) => metrics.projectionSource === "Rookie/new-player model",
    ).length,
    missingEligibilityCount: availablePlayers.filter(
      (player) => player.yahooPositions.length === 0,
    ).length,
    topRecommendations: recommendations.slice(0, 5),
    recentRuns,
    draftProgress,
  };
  return result;
}

function weightedContributions(
  components: RecommendationComponents,
  weights: RecommendationStageWeights,
): RecommendationContributions {
  return {
    projectedValue: components.projectedValue * weights.projectedValue,
    availability: components.availability * weights.availability,
    rosterFit: components.rosterFit * weights.rosterFit,
    scarcity: components.scarcity * weights.scarcity,
    opportunity: components.opportunity * weights.opportunity,
    breakout: components.breakout * weights.breakout,
    flexibility: components.flexibility * weights.flexibility,
    confidence: components.confidence * weights.confidence,
    survivalUrgency: components.survivalUrgency * weights.survivalUrgency,
    recentRun: components.recentRun * weights.recentRun,
    tierDropoff: components.tierDropoff * weights.tierDropoff,
  };
}

function normalizeProductionValue(
  value: number,
  lowerAnchor: number,
  upperAnchor: number,
): number {
  if (upperAnchor <= lowerAnchor) {
    return 100;
  }
  return clamp(
    ((value - lowerAnchor) / (upperAnchor - lowerAnchor)) * 100,
    0,
    100,
  );
}

function percentileValue(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  return sortedValues[Math.floor((sortedValues.length - 1) * percentile)];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function buildExplanations(
  player: Player,
  metrics: ProjectionMetrics,
  baseValue: number,
  rosterFitScore: number,
  scarcityScore: number,
  myRoster: readonly Player[],
  currentRound: number,
  survivalLabel: string,
  picksUntilNext: number | null,
  recentRunLabel: string,
  tierExplanation: string,
): string[] {
  const explanations: string[] = [];
  if (metrics.newPlayerDetails) {
    const details = metrics.newPlayerDetails;
    if (details.classification === "Returning NBA veteran") {
      explanations.push("Returning NBA veteran with limited recent NBA data.");
    } else if (
      details.classification === "Rookie" &&
      details.draftCapitalContribution >= 0.72
    ) {
      explanations.push("Top draft capital improves the expected opportunity.");
    } else if (
      details.classification === "Rookie" &&
      metrics.opportunityScore >= 65
    ) {
      explanations.push("High rookie opportunity, with uncertainty retained.");
    }
    if (
      currentRound > RECOMMENDATION_CONFIG.stages.middle.roundEnd &&
      metrics.breakoutScore >= 65
    ) {
      explanations.push("Strong late-round upside in the new-player model.");
    }
    if (metrics.modelConfidence < 0.4) {
      explanations.push("Low-confidence newcomer projection.");
    }
    if (details.usedConservativeFallback) {
      explanations.push("Limited current NBA data; conservative fallback used.");
    }
  }
  if (baseValue >= 90) {
    explanations.push("Best raw production tier available.");
  }
  if (player.injuryStatus === "Returning soon") {
    explanations.push(
      "Returning soon; the model applies a small current-availability discount.",
    );
  } else if (
    player.injuryStatus === "Out" ||
    player.injuryStatus === "Injured"
  ) {
    explanations.push(
      player.expectedReturnDate || player.expectedReturnText
        ? `Currently ${player.injuryStatus.toLowerCase()}; the stated return guidance moderates the estimate.`
        : `Currently ${player.injuryStatus.toLowerCase()}; the return timeline is uncertain.`,
    );
  }
  if (rosterFitScore >= 66 && player.yahooPositions.length > 0) {
    const neededPosition = mostNeededEligiblePosition(player, myRoster);
    if (neededPosition) {
      explanations.push(
        `Model favors the current ${neededPosition} coverage need.`,
      );
    }
  }
  if (recentRunLabel !== "No run" && player.yahooPositions.length > 0) explanations.push(`${recentRunLabel} at an eligible position.`);
  if (picksUntilNext !== null) explanations.push(`${survivalLabel} over ${picksUntilNext} intervening picks.`);
  if (tierExplanation.startsWith("Large")) explanations.push(tierExplanation);
  if (player.yahooPositions.length >= 2) {
    explanations.push("Multi-position eligibility adds flexibility.");
  }
  if (currentRound > RECOMMENDATION_CONFIG.stages.early.roundEnd && metrics.breakoutScore >= 68) {
    explanations.push("Historical trends suggest higher later-round upside.");
  }
  if (
    metrics.historicalAvailabilityRisk >= 0.42 ||
    metrics.currentInjuryPenalty >= 0.12
  ) {
    explanations.push("Availability risk lowers the estimate.");
  }
  if (metrics.historicalAvailabilityRisk >= 0.42) {
    explanations.push("Historical availability risk is elevated.");
  }
  if (scarcityScore >= 68 && player.yahooPositions.length > 0) {
    explanations.push("The eligible position pool is estimated to be thinning.");
  }
  if (metrics.modelConfidence < 0.58) {
    explanations.push(
      "Projection confidence is lower because the historical sample is limited.",
    );
  }
  if (player.yahooPositions.length === 0) {
    explanations.push(
      "Yahoo eligibility is missing, so fit and scarcity remain neutral.",
    );
  }

  return explanations.slice(0, 3);
}

function calculateSurvival(rank: number, picksUntil: number | null, scarcity: number, run: number, tier: number): { estimate: number; urgency: number; label: string } {
  if (picksUntil === null) return { estimate: 0, urgency: 0, label: "No later user pick" };
  const scale = Math.max(2, picksUntil * 0.35);
  const base = 100 / (1 + Math.exp(-(rank - picksUntil - 1) / scale));
  const estimate = clamp(base - Math.max(0, scarcity - 50) * 0.18 - run * 8 - tier * 0.06, 0, 100);
  const label = estimate >= 80 ? "Very likely to survive" : estimate >= 60 ? "Could survive" : estimate >= 40 ? "Toss-up" : estimate >= 20 ? "Unlikely to survive" : "Very unlikely to survive";
  return { estimate, urgency: 100 - estimate, label };
}

function calculateTierDropoff(player: Player, candidates: readonly ProjectedCandidate[]): { score: number; explanation: string } {
  if (player.yahooPositions.length === 0) return { score: 50, explanation: "Eligibility unknown; tier is neutral" };
  let bestGap = 0;
  let bestPosition: YahooPosition = player.yahooPositions[0];
  for (const position of player.yahooPositions) {
    const pool = candidates.filter((candidate) => candidate.player.yahooPositions.includes(position))
      .sort((a, b) => b.metrics.projection.projectedFantasyPointsPerGame - a.metrics.projection.projectedFantasyPointsPerGame);
    const index = pool.findIndex((candidate) => candidate.player.id === player.id);
    const later = pool[index + RECOMMENDATION_CONFIG.draftSignals.tierLookAhead];
    const gap = index >= 0 && later ? Math.max(0, pool[index].metrics.projection.projectedFantasyPointsPerGame - later.metrics.projection.projectedFantasyPointsPerGame) : 0;
    if (gap > bestGap) { bestGap = gap; bestPosition = position; }
  }
  const score = clamp(bestGap / RECOMMENDATION_CONFIG.draftSignals.meaningfulTierGapFantasyPoints * 100, 0, 100);
  return { score, explanation: score >= 65 ? `Large ${bestPosition} drop-off behind him` : score <= 25 ? `Deep ${bestPosition} tier` : `Moderate ${bestPosition} tier drop-off` };
}

function mostNeededEligiblePosition(
  player: Player,
  roster: readonly Player[],
): YahooPosition | null {
  const coverage = getRosterCoverage(roster);
  const targets = RECOMMENDATION_CONFIG.rosterFit.targetCoverage;
  return (
    [...player.yahooPositions].sort(
      (left, right) =>
        targets[right] - coverage[right] - (targets[left] - coverage[left]),
    )[0] ?? null
  );
}
