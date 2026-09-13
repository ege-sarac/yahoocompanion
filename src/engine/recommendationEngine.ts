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
  PositionIntent,
  PlayerRoleDataSet,
  PlayerRoleMetrics,
  RoleContextSummary,
  TeamDiversificationMode,
  MarketDataSet,
} from "../types";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import { getDraftProgress } from "./draftState";
import { getMyOverallPicks } from "./draftOrder";
import { calculateRecentPositionRuns } from "./draftSignals";
import { assignRosterSlots } from "./rosterAssignment";
import { projectPlayerForRecommendations } from "./newPlayerProjection";
import { calculateFlexibilityScore, calculateRosterFitScore } from "./rosterFit";
import { analyzeCandidateFeasibility, analyzeRosterFeasibility, calculatePositionNeedUrgency } from "./rosterFeasibility";
import { buildTeamEcosystem } from "./teamEcosystem";
import { POST_MOCK_CONFIG } from "../config/postMockConfig";
import { ROLE_PROJECTION_CONFIG } from "../config/roleProjectionConfig";
import { applyRoleIntelligence } from "./roleProjection";
import { applyDraftValueProjection } from "./draftValueProjection";
import { reconcileTeamMinutes } from "./teamMinutesBudget";
import { calculateReplacementLevels, calculateSeasonValue } from "./seasonValue";
import { calculateMarketTiming } from "./marketDraft";
import { roundEquivalentToOverallPick } from "./marketDraft";
import { calculatePositionContextComposite } from "./positionContext";
import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
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
  manualUnavailablePlayerIds?: readonly string[];
  positionIntent?: PositionIntent;
  teamEcosystemEnabled?: boolean;
  roleData?: PlayerRoleDataSet;
  teamDiversificationMode?: TeamDiversificationMode;
  preferredMaxSameTeam?: number;
  marketData?: MarketDataSet;
}

interface ProjectedCandidate {
  player: Player;
  metrics: ProjectionMetrics;
  newPlayerInput?: NewPlayerProjectionInput;
  roleContextSummary?: RoleContextSummary;
}

const projectionUniverseCache = new WeakMap<readonly Player[], { leagueConfig: LeagueConfig; newPlayerInputs?: readonly NewPlayerProjectionInput[]; roleData?: PlayerRoleDataSet; base: ProjectedCandidate[]; minutes: ReturnType<typeof reconcileTeamMinutes>; ecosystem: ReturnType<typeof buildTeamEcosystem> }>();

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
  const unavailableIds = new Set([...input.draftedPlayerIds, ...(input.manualUnavailablePlayerIds ?? [])]);
  const newPlayerInputById = new Map(
    (input.newPlayerInputs ?? []).map((entry) => [entry.playerId, entry]),
  );
  const roleRecordById = new Map((input.roleData?.players ?? []).map((record) => [record.playerId, record]));
  const referenceSeason = input.players.flatMap((player) => player.historicalStats.map((season) => season.season)).sort((a, b) => b.localeCompare(a))[0];
  const latestRoleMetricsById = new Map<string, PlayerRoleMetrics>();
  for (const record of input.roleData?.players ?? []) {
    const latest = [...record.seasons].sort((a, b) => b.season.localeCompare(a.season))[0];
    if (latest) latestRoleMetricsById.set(record.playerId, latest);
  }
  const cachedUniverse = input.asOfDate === undefined ? projectionUniverseCache.get(input.players) : undefined;
  const reusableUniverse = cachedUniverse?.leagueConfig === leagueConfig && cachedUniverse.newPlayerInputs === input.newPlayerInputs && cachedUniverse.roleData === input.roleData ? cachedUniverse : undefined;
  const allProjectedCandidates: ProjectedCandidate[] = reusableUniverse?.base ?? input.players.flatMap(
    (player) => {
      const newPlayerInput = newPlayerInputById.get(player.id);
      const metrics = projectPlayerForRecommendations(
        player,
        newPlayerInput,
        input.asOfDate,
        leagueConfig,
      );
      if (!metrics) return [];
      const roleRecord = roleRecordById.get(player.id);
      const roleAdjusted = applyRoleIntelligence(player, metrics, roleRecord, leagueConfig);
      return [{ player, metrics: applyDraftValueProjection(player, roleAdjusted.metrics, roleRecord, leagueConfig, referenceSeason), newPlayerInput, roleContextSummary: roleAdjusted.summary }];
    },
  );
  const minutesBudget = reusableUniverse?.minutes ?? reconcileTeamMinutes(allProjectedCandidates, leagueConfig);
  const minuteAdjustedCandidates = allProjectedCandidates.map((entry) => ({ ...entry, metrics: minutesBudget.metricsByPlayerId.get(entry.player.id) ?? entry.metrics }));
  const builtEcosystem = reusableUniverse?.ecosystem ?? buildTeamEcosystem(minuteAdjustedCandidates, leagueConfig, latestRoleMetricsById);
  if (!reusableUniverse && input.asOfDate === undefined) projectionUniverseCache.set(input.players, { leagueConfig, newPlayerInputs: input.newPlayerInputs, roleData: input.roleData, base: allProjectedCandidates, minutes: minutesBudget, ecosystem: builtEcosystem });
  const ecosystem = input.teamEcosystemEnabled === true
    ? builtEcosystem
    : { metricsByPlayerId: new Map(minuteAdjustedCandidates.map((entry) => [entry.player.id, entry.metrics])), contextsByPlayerId: new Map(), teams: [], playersEvaluated: 0, capViolations: 0, unresolvedTeamPlayers: 0 };
  const availablePlayers = input.players.filter((player) => !unavailableIds.has(player.id));
  const projectedCandidates: ProjectedCandidate[] = allProjectedCandidates
    .filter(({ player }) => !unavailableIds.has(player.id))
    .map((entry) => ({ ...entry, metrics: ecosystem.metricsByPlayerId.get(entry.player.id) ?? entry.metrics }));
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
  const replacementLevels = calculateReplacementLevels(projectedCandidates.map(({ player, metrics }) => ({ player, projectedFantasyPointsPerGame: metrics.projection.projectedFantasyPointsPerGame })), leagueConfig);
  const seasonValueById = new Map(projectedCandidates.map(({ player, metrics }) => [player.id, calculateSeasonValue(player, metrics.projection.projectedFantasyPointsPerGame, metrics.expectedGamesProjection?.expectedGames ?? metrics.projection.projectedGames, replacementLevels)]));
  const productionValues = projectedCandidates.map(({ player }) => seasonValueById.get(player.id)!.seasonVorp).sort((left, right) => left - right);
  const lowerProductionAnchor = percentileValue(
    productionValues,
    RECOMMENDATION_CONFIG.baseValueNormalization.lowerPercentile,
  );
  const upperProductionAnchor = percentileValue(
    productionValues,
    RECOMMENDATION_CONFIG.baseValueNormalization.upperPercentile,
  );
  const rawProductionValues = projectedCandidates.map(({ metrics }) => metrics.projection.projectedFantasyPointsPerGame).sort((left, right) => left - right);
  const eliteValueReference = rawProductionValues.length > 1 ? rawProductionValues[rawProductionValues.length - 2] : rawProductionValues[0] ?? 0;
  const weights = getRecommendationWeightsForProgress(draftProgress);
  const recentRuns = calculateRecentPositionRuns(input.draftPicks ?? [], input.players);
  const remainingUserPicks = getMyOverallPicks(leagueConfig).filter((pick) => pick >= currentOverallPick).length;
  const rosterFeasibility = analyzeRosterFeasibility(input.myRoster, remainingUserPicks, availablePlayers, leagueConfig);
  const marketProfileById = new Map((input.marketData?.profiles ?? []).map((profile) => [profile.playerId, profile]));
  const marketDepletionByPosition = Object.fromEntries((["G", "F", "C"] as YahooPosition[]).map((position) => {
    const quality = [...projectedCandidates].filter((candidate) => candidate.player.yahooPositions.includes(position)).sort((a, b) => seasonValueById.get(b.player.id)!.seasonVorp - seasonValueById.get(a.player.id)!.seasonVorp).slice(0, Math.max(6, picksUntilNextUserPick ?? 6));
    const timed = quality.flatMap((candidate) => { const profile = marketProfileById.get(candidate.player.id); const round = profile?.mockRoundEquivalentMedian; return round === undefined || nextUserPick === null ? [] : [roundEquivalentToOverallPick(round, leagueConfig.teamCount) < nextUserPick ? 1 : 0]; });
    return [position, timed.length ? timed.reduce((sum, value) => sum + value, 0) / timed.length : 0];
  })) as Record<YahooPosition, number>;
  const positionNeedUrgency = calculatePositionNeedUrgency(rosterFeasibility, scarcityByPosition, picksUntilNextUserPick, draftProgress, marketDepletionByPosition);
  const positionIntent = input.positionIntent ?? { mode: "Normal", positions: [] };
  const activeIntentPositions = positionIntent.positions.length > 0 && positionIntent.positions.length < 3 ? positionIntent.positions : [];
  const productionRank = new Map([...projectedCandidates]
    .sort((a, b) => seasonValueById.get(b.player.id)!.seasonVorp - seasonValueById.get(a.player.id)!.seasonVorp)
    .map((candidate, index) => [candidate.player.id, index + 1]));
  const tierByPlayerId = calculateTierDropoffs(projectedCandidates);
  const teamDiversificationMode = input.teamDiversificationMode ?? ROLE_PROJECTION_CONFIG.teamDiversification.defaultMode;
  const preferredMaxSameTeam = Math.max(1, Math.floor(input.preferredMaxSameTeam ?? ROLE_PROJECTION_CONFIG.teamDiversification.preferredMax));
  const myRosterCountByNbaTeam = new Map<string, number>();
  for (const player of input.myRoster) if (player.nbaTeam) myRosterCountByNbaTeam.set(player.nbaTeam, (myRosterCountByNbaTeam.get(player.nbaTeam) ?? 0) + 1);

  const recommendations = projectedCandidates
    .map(({ player, metrics, newPlayerInput, roleContextSummary }): PlayerRecommendation => {
      const seasonValue = seasonValueById.get(player.id)!;
      const baseValue = normalizeProductionValue(
        seasonValue.seasonVorp,
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
      const tier = tierByPlayerId.get(player.id) ?? { score: 50, explanation: "Eligibility unknown; tier is neutral" };
      const marketTiming = calculateMarketTiming(marketProfileById.get(player.id), leagueConfig, currentOverallPick, nextUserPick, productionRank.get(player.id) ?? projectedCandidates.length, projectedCandidates.length, input.draftPicks, player, input.players);
      const candidateFeasibility = analyzeCandidateFeasibility(input.myRoster, player, remainingUserPicks, availablePlayers, leagueConfig, rosterFeasibility);
      const manualPositionMatch = activeIntentPositions.some((position) => player.yahooPositions.includes(position));
      const automaticPositionNeedComponent = player.yahooPositions.length ? Math.max(...player.yahooPositions.map((position) => positionNeedUrgency[position].score)) * 100 : 0;
      const rosterFeasibilityComponent = candidateFeasibility.candidateKeepsRosterFeasible ? (candidateFeasibility.candidateSlotsRelieved.length ? 100 : 55) : 0;
      const manualPositionPriorityComponent = positionIntent.mode === "Prefer" && manualPositionMatch
        ? Math.min(POST_MOCK_CONFIG.positionIntent.maximumPreferAdjustment, 5 + automaticPositionNeedComponent / 25)
        : 0;
      const positionContextComposite = calculatePositionContextComposite({ draftProgress, feasibility: candidateFeasibility, needUrgency: automaticPositionNeedComponent, scarcity: scarcityScore, tierDropoff: tier.score, recentRun: recentRunPressure * 100, flexibility: flexibilityScore, marketDepletion: 100 - marketTiming.survivalEstimate });
      const materialPositionReason = Math.abs(positionContextComposite.contribution) >= DRAFT_VALUE_CONFIG.positionComposite.materialReasonContribution
        ? positionContextComposite.contribution > 0
          ? [`Position context adds ${positionContextComposite.contribution.toFixed(1)} points within the ${positionContextComposite.cap}-point stage cap.`]
          : [`Position context subtracts ${Math.abs(positionContextComposite.contribution).toFixed(1)} points within the ${positionContextComposite.cap}-point stage cap.`]
        : [];
      const expectedGamesProjection = metrics.expectedGamesProjection!;
      const availabilityRange = expectedGamesProjection.expectedGamesHigh - expectedGamesProjection.expectedGamesLow;
      const reliability = expectedGamesProjection.availabilityConfidence * 70 + (1 - Math.min(1, availabilityRange / DRAFT_VALUE_CONFIG.availabilityReliability.rangePenaltyGames)) * 30;
      const components: RecommendationComponents = {
        projectedValue: baseValue,
        availability: reliability,
        rosterFit: rosterFitScore,
        scarcity: scarcityScore,
        opportunity: metrics.opportunityScore,
        breakout: metrics.breakoutScore,
        flexibility: flexibilityScore,
        confidence: metrics.modelConfidence * 100,
        survivalUrgency: marketTiming.draftNowUrgency / Math.max(1, DRAFT_VALUE_CONFIG.market.maximumUrgencyBonus) * 100,
        recentRun: recentRunPressure * Math.min(1, rosterFitScore / 65) * 100,
        tierDropoff: tier.score,
      };
      const contributions = weightedContributions(components, weights);
      const baseFinalScore = Object.values(contributions).reduce(
        (total, contribution) => total + contribution,
        0,
      );
      const automaticAdjustment = positionContextComposite.contribution;
      const feasibilityAdjustment = 0;
      const sameTeamPlayersBeforePick = player.nbaTeam ? myRosterCountByNbaTeam.get(player.nbaTeam) ?? 0 : 0;
      const sameTeamPlayersAfterPick = sameTeamPlayersBeforePick + (player.nbaTeam ? 1 : 0);
      const eliteDiversificationEscape = baseValue >= ROLE_PROJECTION_CONFIG.teamDiversification.eliteValueEscapeBaseValue && metrics.projection.projectedFantasyPointsPerGame >= eliteValueReference + ROLE_PROJECTION_CONFIG.teamDiversification.eliteValueMinimumFpGap;
      const excess = Math.max(0, sameTeamPlayersAfterPick - preferredMaxSameTeam);
      const teamDiversificationComponent = teamDiversificationMode === "Off" || excess === 0 || eliteDiversificationEscape ? 0 : -(excess === 1 ? ROLE_PROJECTION_CONFIG.teamDiversification.thirdPlayerPenalty : ROLE_PROJECTION_CONFIG.teamDiversification.fourthPlayerPenalty + (excess - 2) * ROLE_PROJECTION_CONFIG.teamDiversification.additionalPlayerPenalty);
      const teamConcentrationWarning = excess > 0 && player.nbaTeam ? eliteDiversificationEscape ? `Elite value despite ${player.nbaTeam} team concentration.` : `Would be your ${ordinal(sameTeamPlayersAfterPick)} ${player.nbaTeam} player.` : undefined;
      const rosterRiskCount = input.myRoster.filter((rosterPlayer) => (allProjectedCandidates.find((entry) => entry.player.id === rosterPlayer.id)?.metrics.expectedGamesProjection?.expectedGames ?? 82) < DRAFT_VALUE_CONFIG.riskConcentration.highRiskExpectedGames).length;
      const rosterRiskPenalty = expectedGamesProjection.expectedGames < DRAFT_VALUE_CONFIG.riskConcentration.highRiskExpectedGames && rosterRiskCount >= DRAFT_VALUE_CONFIG.riskConcentration.startAtCount ? Math.min(DRAFT_VALUE_CONFIG.riskConcentration.maximumPenalty, (rosterRiskCount - DRAFT_VALUE_CONFIG.riskConcentration.startAtCount + 1) * DRAFT_VALUE_CONFIG.riskConcentration.penaltyPerExtra) : 0;
      const finalScore = baseFinalScore + automaticAdjustment + marketTiming.draftNowUrgency - marketTiming.waitValue - marketTiming.reachCost + manualPositionPriorityComponent + feasibilityAdjustment + teamDiversificationComponent - rosterRiskPenalty;

      return {
        player,
        newPlayerInput,
        ...metrics,
        baseValue,
        rosterFitScore,
        scarcityScore,
        flexibilityScore,
        finalScore,
        survivalEstimate: marketTiming.survivalEstimate,
        survivalLabel: marketTiming.survivalLabel,
        urgencyScore: marketTiming.draftNowUrgency,
        picksUntilNextUserPick,
        recentRunPressure,
        recentRunLabel,
        tierDropoffScore: tier.score,
        tierDropoffExplanation: tier.explanation,
        components,
        contributions,
        explanations: ([] as string[]).concat(
          !candidateFeasibility.candidateKeepsRosterFeasible ? ["Roster completion risk."] : [],
          candidateFeasibility.candidateCriticalNeedMatch ? [`Addresses a critical ${candidateFeasibility.candidateSlotsRelieved.join("/")} need.`] : [],
          positionIntent.mode === "Prefer" && manualPositionMatch ? [`Matches your ${activeIntentPositions.join("/")} preference.`] : [],
          marketTiming.waitValue >= 3 ? ["Excellent value, but market suggests he is likely to survive your next turn."] : [],
          marketTiming.draftNowUrgency >= 3 ? ["Market suggests he may not make it back."] : [],
          marketTiming.valueLabel === "MODEL VALUE" || marketTiming.valueLabel === "SLEEPER" ? ["Strong model value relative to market."] : [],
          materialPositionReason,
          buildExplanations(player, metrics, baseValue, input.currentRound),
          expectedGamesProjection.reasons,
          metrics.careerStageProjection?.reasons ?? [],
          metrics.roleAssessment?.reasons ?? [],
          ecosystem.contextsByPlayerId.get(player.id)?.explanations ?? [],
          roleContextSummary?.roleReasons ?? [],
          teamConcentrationWarning ? [teamConcentrationWarning] : [],
        ).slice(0, 4),
        manualPositionMatch,
        manualPositionPriorityComponent,
        automaticPositionNeedComponent,
        rosterFeasibilityComponent,
        candidateFeasibility,
        teamContextSummary: ecosystem.contextsByPlayerId.get(player.id),
        roleContextSummary,
        sameTeamPlayersBeforePick,
        sameTeamPlayersAfterPick,
        teamConcentrationBefore: sameTeamPlayersBeforePick,
        teamConcentrationAfter: sameTeamPlayersAfterPick,
        teamDiversificationComponent,
        teamConcentrationWarning,
        eliteDiversificationEscape,
        expectedGamesProjection,
        careerStageProjection: metrics.careerStageProjection!,
        roleAssessment: metrics.roleAssessment!,
        seasonValue,
        marketTiming,
        positionContextComposite,
        modelValueRank: productionRank.get(player.id) ?? projectedCandidates.length,
        marketCostRank: marketTiming.marketCostRank,
      };
    })
    .sort(
      (left, right) =>
        right.finalScore - left.finalScore ||
        right.projection.projectedFantasyPointsPerGame -
          left.projection.projectedFantasyPointsPerGame ||
        left.player.name.localeCompare(right.player.name),
    );

  const positionFilterActive = positionIntent.mode === "Filter" && activeIntentPositions.length > 0;
  const filteredRecommendations = positionFilterActive ? recommendations.filter((recommendation) => recommendation.manualPositionMatch) : recommendations;
  const filterExcludesAllFeasible = positionFilterActive && filteredRecommendations.every((recommendation) => !recommendation.candidateFeasibility.candidateKeepsRosterFeasible) && recommendations.some((recommendation) => recommendation.candidateFeasibility.candidateKeepsRosterFeasible);
  const guardedRecommendations = rosterFeasibility.feasibilitySlack <= 1
    ? filteredRecommendations.filter((recommendation) => recommendation.candidateFeasibility.candidateKeepsRosterFeasible)
    : filteredRecommendations;
  const feasiblePool = guardedRecommendations.length > 0 ? guardedRecommendations : filteredRecommendations;
  const diversificationAllowed = feasiblePool.filter((recommendation) => {
    if (teamDiversificationMode === "Off" || recommendation.sameTeamPlayersAfterPick <= preferredMaxSameTeam || recommendation.eliteDiversificationEscape || recommendation.candidateFeasibility.candidateCriticalNeedMatch) return true;
    if (teamDiversificationMode === "Strict") return false;
    return recommendation.sameTeamPlayersAfterPick < preferredMaxSameTeam + 2;
  });
  const topPool = diversificationAllowed.length >= Math.min(ROLE_PROJECTION_CONFIG.teamDiversification.minimumReasonableAlternatives, feasiblePool.length) ? diversificationAllowed : feasiblePool;
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
    topRecommendations: topPool.slice(0, 5).map((recommendation) => {
      if (positionIntent.mode !== "Prefer" || recommendation.manualPositionMatch || !activeIntentPositions.length) return recommendation;
      return { ...recommendation, explanations: ["Best value despite current position preference.", ...recommendation.explanations].slice(0, 4) };
    }),
    recentRuns,
    draftProgress,
    rosterFeasibility,
    positionNeedUrgency,
    positionIntent,
    positionFilterActive,
    positionFilterHadNoMatches: positionFilterActive && filteredRecommendations.length === 0,
    filterExcludesAllFeasible,
    teamEcosystemDiagnostics: { teamsBuilt: ecosystem.teams.length, playersEvaluated: ecosystem.playersEvaluated, capViolations: ecosystem.capViolations, unresolvedTeamPlayers: ecosystem.unresolvedTeamPlayers, teams: ecosystem.teams },
    teamDiversificationMode,
    preferredMaxSameTeam,
    teamDiversificationFilteredCount: Math.max(0, feasiblePool.length - diversificationAllowed.length),
    replacementLevels,
    marketProfilesLoaded: input.marketData?.profiles.length ?? 0,
    matchingMarketProfiles: projectedCandidates.filter((candidate) => marketProfileById.has(candidate.player.id)).length,
    teamMinutesDiagnostics: { teamsProcessed: minutesBudget.teams.length, teamsOutsideTolerance: minutesBudget.teams.filter((team) => team.outsideTolerance).length, capViolations: minutesBudget.capViolations, maximumTotalMinutes: Math.max(0, ...minutesBudget.teams.map((team) => team.after)) },
  };
  return result;
}

function ordinal(value: number): string { const remainder = value % 100; const suffix = remainder >= 11 && remainder <= 13 ? "th" : value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"; return `${value}${suffix}`; }

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
  currentRound: number,
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
    explanations.push("Best risk-adjusted season value available.");
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

  return explanations;
}

function calculateTierDropoffs(candidates: readonly ProjectedCandidate[]): Map<string, { score: number; explanation: string }> {
  const pools = Object.fromEntries((["G", "F", "C"] as YahooPosition[]).map((position) => [position, candidates
    .filter((candidate) => candidate.player.yahooPositions.includes(position))
    .sort((a, b) => b.metrics.projection.projectedFantasyPointsPerGame - a.metrics.projection.projectedFantasyPointsPerGame)])) as Record<YahooPosition, ProjectedCandidate[]>;
  const indexes = Object.fromEntries((["G", "F", "C"] as YahooPosition[]).map((position) => [position, new Map(pools[position].map((candidate, index) => [candidate.player.id, index]))])) as Record<YahooPosition, Map<string, number>>;
  return new Map(candidates.map((candidate) => {
    const player = candidate.player;
    if (player.yahooPositions.length === 0) return [player.id, { score: 50, explanation: "Eligibility unknown; tier is neutral" }];
    let bestGap = 0;
    let bestPosition: YahooPosition = player.yahooPositions[0];
    for (const position of player.yahooPositions) {
      const index = indexes[position].get(player.id) ?? -1;
      const later = pools[position][index + RECOMMENDATION_CONFIG.draftSignals.tierLookAhead];
      const gap = index >= 0 && later ? Math.max(0, candidate.metrics.projection.projectedFantasyPointsPerGame - later.metrics.projection.projectedFantasyPointsPerGame) : 0;
      if (gap > bestGap) { bestGap = gap; bestPosition = position; }
    }
    const score = clamp(bestGap / RECOMMENDATION_CONFIG.draftSignals.meaningfulTierGapFantasyPoints * 100, 0, 100);
    return [player.id, { score, explanation: score >= 65 ? `Large ${bestPosition} drop-off behind him` : score <= 25 ? `Deep ${bestPosition} tier` : `Moderate ${bestPosition} tier drop-off` }];
  }));
}
