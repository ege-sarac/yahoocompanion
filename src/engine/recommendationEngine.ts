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
  AlternativeRecommendation,
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
  DraftDecisionSnapshot,
  ExpectedGamesProjection,
  SeasonValueProjection,
  RecommendationDisplayConfig,
  Projection,
  PlayerRoleHistoryRecord,
  CurrentRoleOverride,
  YahooDefaultProjectionDataSet,
} from "../types";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import { getDraftProgress } from "./draftState";
import { getMyOverallPicks, getUserPickSchedule } from "./draftOrder";
import { calculateRecentPositionRuns } from "./draftSignals";
import { assignRosterSlots } from "./rosterAssignment";
import { projectPlayerForRecommendations } from "./newPlayerProjection";
import { calculateFlexibilityScore, calculateRosterFitScore } from "./rosterFit";
import { analyzeCandidateFeasibility, analyzeRosterFeasibility, calculatePositionNeedUrgency } from "./rosterFeasibility";
import { buildTeamEcosystem } from "./teamEcosystem";
import { POST_MOCK_CONFIG } from "../config/postMockConfig";
import { ROLE_PROJECTION_CONFIG } from "../config/roleProjectionConfig";
import { applyRoleIntelligence } from "./roleProjection";
import { applyCurrentRoleOverride } from "./currentRoleOverrides";
import currentRoleOverridesJson from "../../data/manual/currentRoleOverrides.json";
import { applyDraftValueProjection } from "./draftValueProjection";
import { applyYahooProjectionBaseline } from "./yahooProjection";
import { reconcileTeamMinutes } from "./teamMinutesBudget";
import { calculateReplacementLevels, calculateSeasonValue } from "./seasonValue";
import { calculateMarketTiming } from "./marketDraft";
import { roundEquivalentToOverallPick } from "./marketDraft";
import { calculatePositionContextComposite } from "./positionContext";
import { buildRoleScenarioSummary } from "./roleOutcomes";
import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import { DEFAULT_RECOMMENDATION_DISPLAY, normalizeRecommendationDisplay } from "../config/recommendationDisplayConfig";
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
  roleOverrides?: readonly CurrentRoleOverride[];
  teamDiversificationMode?: TeamDiversificationMode;
  preferredMaxSameTeam?: number;
  marketData?: MarketDataSet;
  decisionLog?: readonly DraftDecisionSnapshot[];
  recommendationDisplay?: RecommendationDisplayConfig;
  yahooDefaultProjections?: YahooDefaultProjectionDataSet;
}

interface ProjectedCandidate {
  player: Player;
  metrics: ProjectionMetrics;
  newPlayerInput?: NewPlayerProjectionInput;
  roleContextSummary?: RoleContextSummary;
  baseProjection: Projection;
  roleProjection: Projection;
  roleRecord?: PlayerRoleHistoryRecord;
}

interface ProjectionUniverse {
  leagueConfig: LeagueConfig;
  newPlayerInputs?: readonly NewPlayerProjectionInput[];
  roleData?: PlayerRoleDataSet;
  yahooDefaultProjections?: YahooDefaultProjectionDataSet;
  base: ProjectedCandidate[];
  minutes: ReturnType<typeof reconcileTeamMinutes>;
  minuteAdjustedCandidates: ProjectedCandidate[];
  ecosystem: ReturnType<typeof buildTeamEcosystem>;
  intrinsicCandidates: ProjectedCandidate[];
  replacementLevels: ReturnType<typeof calculateReplacementLevels>;
  seasonValueById: Map<string, SeasonValueProjection>;
  lowerProductionAnchor: number;
  upperProductionAnchor: number;
  eliteValueReference: number;
}
const projectionUniverseCache = new WeakMap<readonly Player[], ProjectionUniverse>();

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
  const cachedUniverse = input.asOfDate === undefined ? projectionUniverseCache.get(input.players) : undefined;
  const reusableUniverse = cachedUniverse?.leagueConfig === leagueConfig && cachedUniverse.newPlayerInputs === input.newPlayerInputs && cachedUniverse.roleData === input.roleData && cachedUniverse.yahooDefaultProjections === input.yahooDefaultProjections ? cachedUniverse : undefined;
  const allProjectedCandidates: ProjectedCandidate[] = reusableUniverse?.base ?? (() => {
    const newPlayerInputById = new Map((input.newPlayerInputs ?? []).map((entry) => [entry.playerId, entry]));
    const roleRecordById = new Map((input.roleData?.players ?? []).map((record) => [record.playerId, record]));
    const yahooProjectionById = new Map((input.yahooDefaultProjections?.entries ?? []).map((entry) => [entry.playerId, entry]));
    const referenceSeason = input.players.flatMap((player) => player.historicalStats.map((season) => season.season)).sort((a, b) => b.localeCompare(a))[0];
    const configuredOverrides = Array.isArray(currentRoleOverridesJson.entries) ? currentRoleOverridesJson.entries as CurrentRoleOverride[] : [];
    return input.players.flatMap((player) => {
      const currentOverride = configuredOverrides.find((entry) => entry.playerId === player.id || entry.playerName.toLocaleLowerCase() === player.name.toLocaleLowerCase());
      const resolvedPlayer = currentOverride?.currentHealthStatus ? { ...player, currentHealthStatus: currentOverride.currentHealthStatus } : player;
      const newPlayerInput = newPlayerInputById.get(player.id);
      const metrics = projectPlayerForRecommendations(resolvedPlayer, newPlayerInput, input.asOfDate, leagueConfig);
      if (!metrics) return [];
      const roleRecord = roleRecordById.get(player.id);
      const yahooBaseline = applyYahooProjectionBaseline(resolvedPlayer, metrics, yahooProjectionById.get(player.id), leagueConfig);
      const roleAdjusted = applyRoleIntelligence(resolvedPlayer, yahooBaseline, roleRecord, leagueConfig);
      const currentRoleAdjusted = applyCurrentRoleOverride(resolvedPlayer, roleAdjusted.metrics, [...configuredOverrides, ...(input.roleOverrides ?? [])], input.asOfDate);
      return [{ player: resolvedPlayer, metrics: applyDraftValueProjection(resolvedPlayer, currentRoleAdjusted, roleRecord, leagueConfig, referenceSeason), newPlayerInput, roleContextSummary: roleAdjusted.summary, baseProjection: metrics.projection, roleProjection: currentRoleAdjusted.projection, roleRecord }];
    });
  })();
  const minutesBudget = reusableUniverse?.minutes ?? reconcileTeamMinutes(allProjectedCandidates, leagueConfig);
  const minuteAdjustedCandidates = reusableUniverse?.minuteAdjustedCandidates ?? allProjectedCandidates.map((entry) => ({ ...entry, metrics: minutesBudget.metricsByPlayerId.get(entry.player.id) ?? entry.metrics }));
  const builtEcosystem = reusableUniverse?.ecosystem ?? (() => {
    const latestRoleMetricsById = new Map<string, PlayerRoleMetrics>();
    for (const record of input.roleData?.players ?? []) {
      const latest = [...record.seasons].sort((a, b) => b.season.localeCompare(a.season))[0];
      if (latest) latestRoleMetricsById.set(record.playerId, latest);
    }
    return buildTeamEcosystem(minuteAdjustedCandidates, leagueConfig, latestRoleMetricsById);
  })();
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
  const pickSchedule = getUserPickSchedule(currentOverallPick, leagueConfig);
  const nextUserPick = pickSchedule.nextUserPick;
  const picksUntilNextUserPick = pickSchedule.picksUntilNextUserPick;
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
  // Replacement value is an intrinsic league baseline, never a shrinking live-room baseline.
  const intrinsicUniverse = input.teamEcosystemEnabled === true ? reusableUniverse : undefined;
  const intrinsicCandidates = intrinsicUniverse?.intrinsicCandidates ?? allProjectedCandidates.map((entry) => ({ ...entry, metrics: ecosystem.metricsByPlayerId.get(entry.player.id) ?? entry.metrics }));
  const replacementLevels = intrinsicUniverse?.replacementLevels ?? calculateReplacementLevels(intrinsicCandidates.map(({ player, metrics }) => ({ player, projectedFantasyPointsPerGame: metrics.projection.projectedFantasyPointsPerGame })), leagueConfig);
  const seasonValueById = intrinsicUniverse?.seasonValueById ?? new Map(intrinsicCandidates.map(({ player, metrics }) => [player.id, calculateSeasonValue(player, metrics.projection.projectedFantasyPointsPerGame, metrics.expectedGamesProjection?.expectedGames ?? metrics.projection.projectedGames, replacementLevels)]));
  const minutesOutsideRoleRange = new Set(minutesBudget.minutesOutsideRoleRangePlayerIds);
  const roleScenarioById = new Map(projectedCandidates.map(({ player, metrics, newPlayerInput, roleContextSummary }) => [player.id, buildRoleScenarioSummary({ player, metrics, newPlayerInput, roleContextSummary, seasonValue: seasonValueById.get(player.id)!, draftProgress, minutesOutsideRoleRange: minutesOutsideRoleRange.has(player.id) })]));
  // Intrinsic value is normalized against the full projectable universe, never the
  // shrinking available room.  Draft progress can change timing, not player quality.
  const productionValues = intrinsicUniverse ? undefined : intrinsicCandidates.map(({ player }) => seasonValueById.get(player.id)!.seasonVorp).sort((left, right) => left - right);
  const lowerProductionAnchor = intrinsicUniverse?.lowerProductionAnchor ?? percentileValue(
    productionValues!,
    RECOMMENDATION_CONFIG.baseValueNormalization.lowerPercentile,
  );
  const upperProductionAnchor = intrinsicUniverse?.upperProductionAnchor ?? percentileValue(
    productionValues!,
    RECOMMENDATION_CONFIG.baseValueNormalization.upperPercentile,
  );
  const rawProductionValues = intrinsicUniverse ? undefined : intrinsicCandidates.map(({ metrics }) => metrics.projection.projectedFantasyPointsPerGame).sort((left, right) => left - right);
  const eliteValueReference = intrinsicUniverse?.eliteValueReference ?? (rawProductionValues!.length > 1 ? rawProductionValues![rawProductionValues!.length - 2] : rawProductionValues![0] ?? 0);
  if (!reusableUniverse && input.asOfDate === undefined && input.teamEcosystemEnabled === true) projectionUniverseCache.set(input.players, { leagueConfig, newPlayerInputs: input.newPlayerInputs, roleData: input.roleData, yahooDefaultProjections: input.yahooDefaultProjections, base: allProjectedCandidates, minutes: minutesBudget, minuteAdjustedCandidates, ecosystem: builtEcosystem, intrinsicCandidates, replacementLevels, seasonValueById, lowerProductionAnchor, upperProductionAnchor, eliteValueReference });
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
    .sort((a, b) => roleScenarioById.get(b.player.id)!.meanSeasonVorp - roleScenarioById.get(a.player.id)!.meanSeasonVorp)
    .map((candidate, index) => [candidate.player.id, index + 1]));
  const intrinsicValueRank = new Map([...intrinsicCandidates]
    .sort((left, right) => seasonValueById.get(right.player.id)!.seasonVorp - seasonValueById.get(left.player.id)!.seasonVorp)
    .map((candidate, index) => [candidate.player.id, index + 1]));
  const tierByPlayerId = calculateTierDropoffs(projectedCandidates);
  const teamDiversificationMode = input.teamDiversificationMode ?? ROLE_PROJECTION_CONFIG.teamDiversification.defaultMode;
  const preferredMaxSameTeam = Math.max(1, Math.floor(input.preferredMaxSameTeam ?? ROLE_PROJECTION_CONFIG.teamDiversification.preferredMax));
  const myRosterCountByNbaTeam = new Map<string, number>();
  for (const player of input.myRoster) if (player.nbaTeam) myRosterCountByNbaTeam.set(player.nbaTeam, (myRosterCountByNbaTeam.get(player.nbaTeam) ?? 0) + 1);
  const bestAvailableFpg = Math.max(0, ...projectedCandidates.map((entry) => entry.metrics.projection.projectedFantasyPointsPerGame));
  const rosterAvailabilityLoad = input.myRoster.filter((rosterPlayer) => (allProjectedCandidates.find((entry) => entry.player.id === rosterPlayer.id)?.metrics.expectedGamesProjection?.expectedGames ?? 82) < DRAFT_VALUE_CONFIG.lateValue.highRiskGames).length;
  const remainingBenchSlots = Math.max(0, leagueConfig.roster.BN - Math.max(0, input.myRoster.length - (leagueConfig.roster.G + leagueConfig.roster.F + leagueConfig.roster.C + leagueConfig.roster.UTIL)));
  const unresolvedStarterSlots = rosterFeasibility.minimumPicksNeededForRestrictiveSlots;

  const recommendations = projectedCandidates
    .map(({ player, metrics, newPlayerInput, roleContextSummary, baseProjection, roleProjection, roleRecord }): PlayerRecommendation => {
      const seasonValue = seasonValueById.get(player.id)!;
      const roleScenarioSummary = roleScenarioById.get(player.id)!;
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
      const liveRoomSurvivalEvidence = countLiveRoomSurvivalEvidence(input.decisionLog, player.id, currentOverallPick);
      const marketTiming = calculateMarketTiming(marketProfileById.get(player.id), leagueConfig, currentOverallPick, nextUserPick, productionRank.get(player.id) ?? projectedCandidates.length, projectedCandidates.length, input.draftPicks, player, input.players, liveRoomSurvivalEvidence, intrinsicValueRank.get(player.id) ?? projectedCandidates.length);
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
      const availabilityDownsideGap = calculateAvailabilityDownsideGap(seasonValue, expectedGamesProjection);
      const availabilityTailPenalty = calculateAvailabilityTailPenalty(availabilityDownsideGap, expectedGamesProjection, draftProgress);
      const availabilityRange = expectedGamesProjection.expectedGamesHigh - expectedGamesProjection.expectedGamesLow;
      const reliability = expectedGamesProjection.availabilityConfidence * 70 + (1 - Math.min(1, availabilityRange / DRAFT_VALUE_CONFIG.availabilityReliability.rangePenaltyGames)) * 30;
      const teamContext = ecosystem.contextsByPlayerId.get(player.id);
      const currentDepthCompetition = teamContext?.positionalMinuteCompetition ?? 0;
      const netVacatedMinutes = (teamContext?.opportunityVacuum ?? 0) * 12 - currentDepthCompetition * 8;
      const perMinuteProduction = metrics.projection.projectedMinutes > 0 ? metrics.projection.projectedFantasyPointsPerGame / metrics.projection.projectedMinutes : 0;
      const productionBlendForOpportunity = productionBlendForDraft(draftProgress);
      const promotionPathProbability = clamp((Math.max(0, netVacatedMinutes) / 12 * .45 + Math.max(0, roleContextSummary?.lateSeasonMinutesChange ?? 0) / 8 * .2 + clamp(perMinuteProduction / 1.15, 0, 1) * .15) * (1 - currentDepthCompetition * .55) * (.45 + roleAssessmentSecurity(metrics) * .55), 0, 1);
      // Existing projected minutes already feed production and VORP.  This only rewards
      // unpriced future promotion evidence, and legacy breakout fades as scenarios matter.
      const rawOpportunitySignal = promotionPathProbability * 100;
      const rawBreakoutSignal = metrics.breakoutScore;
      const rawCeilingSignal = Math.max(0, (roleScenarioSummary.scenarios.find((scenario) => scenario.label === "HIGH")?.projectedFantasyPointsPerGame ?? 0) - seasonValue.replacementFantasyPointsPerGame);
      const rawRoleSignal = roleAssessmentSecurity(metrics) * 100;
      const opportunityScore = rawOpportunitySignal;
      const legacyBreakoutScore = rawBreakoutSignal * (1 - productionBlendForOpportunity * .25);
      const components: RecommendationComponents = {
        projectedValue: baseValue,
        availability: reliability,
        rosterFit: rosterFitScore,
        scarcity: scarcityScore,
        opportunity: opportunityScore,
        breakout: legacyBreakoutScore,
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
      const lateProductionBlend = smoothLateProductionBlend(draftProgress);
      const automaticAdjustment = positionContextComposite.contribution * (candidateFeasibility.candidateCriticalNeedMatch ? 1 : 1 - lateProductionBlend * .5);
      const feasibilityAdjustment = 0;
      const sameTeamPlayersBeforePick = player.nbaTeam ? myRosterCountByNbaTeam.get(player.nbaTeam) ?? 0 : 0;
      const sameTeamPlayersAfterPick = sameTeamPlayersBeforePick + (player.nbaTeam ? 1 : 0);
      const eliteDiversificationEscape = baseValue >= ROLE_PROJECTION_CONFIG.teamDiversification.eliteValueEscapeBaseValue && metrics.projection.projectedFantasyPointsPerGame >= eliteValueReference + ROLE_PROJECTION_CONFIG.teamDiversification.eliteValueMinimumFpGap;
      const excess = Math.max(0, sameTeamPlayersAfterPick - preferredMaxSameTeam);
      const teamDiversificationComponent = teamDiversificationMode === "Off" || excess === 0 || eliteDiversificationEscape ? 0 : -(excess === 1 ? ROLE_PROJECTION_CONFIG.teamDiversification.thirdPlayerPenalty : ROLE_PROJECTION_CONFIG.teamDiversification.fourthPlayerPenalty + (excess - 2) * ROLE_PROJECTION_CONFIG.teamDiversification.additionalPlayerPenalty);
      const teamConcentrationWarning = excess > 0 && player.nbaTeam ? eliteDiversificationEscape ? `Elite value despite ${player.nbaTeam} team concentration.` : `Would be your ${ordinal(sameTeamPlayersAfterPick)} ${player.nbaTeam} player.` : undefined;
      const rosterRiskCount = input.myRoster.filter((rosterPlayer) => (allProjectedCandidates.find((entry) => entry.player.id === rosterPlayer.id)?.metrics.expectedGamesProjection?.expectedGames ?? 82) < DRAFT_VALUE_CONFIG.riskConcentration.highRiskExpectedGames).length;
      const rosterRiskPenalty = expectedGamesProjection.expectedGames < DRAFT_VALUE_CONFIG.riskConcentration.highRiskExpectedGames && rosterRiskCount >= DRAFT_VALUE_CONFIG.riskConcentration.startAtCount ? Math.min(DRAFT_VALUE_CONFIG.riskConcentration.maximumPenalty, (rosterRiskCount - DRAFT_VALUE_CONFIG.riskConcentration.startAtCount + 1) * DRAFT_VALUE_CONFIG.riskConcentration.penaltyPerExtra) : 0;
      const baseScenario = roleScenarioSummary.scenarios.find((scenario) => scenario.label === "BASE") ?? roleScenarioSummary.scenarios[1];
      const lowScenario = roleScenarioSummary.scenarios.find((scenario) => scenario.label === "LOW") ?? roleScenarioSummary.scenarios[0];
      const highScenario = roleScenarioSummary.scenarios.find((scenario) => scenario.label === "HIGH") ?? roleScenarioSummary.scenarios[2];
      const projectedSurplusPerGame = metrics.projection.projectedFantasyPointsPerGame - seasonValue.replacementFantasyPointsPerGame;
      const baseSurplusPerGame = (baseScenario?.projectedFantasyPointsPerGame ?? metrics.projection.projectedFantasyPointsPerGame) - seasonValue.replacementFantasyPointsPerGame;
      const lowSurplusPerGame = (lowScenario?.projectedFantasyPointsPerGame ?? metrics.projection.projectedFantasyPointsPerGame) - seasonValue.replacementFantasyPointsPerGame;
      const highScenarioSurplusPerGame = Math.max(0, (highScenario?.projectedFantasyPointsPerGame ?? 0) - seasonValue.replacementFantasyPointsPerGame);
      const highVsBaseGain = Math.max(0, (highScenario?.projectedFantasyPointsPerGame ?? 0) - (baseScenario?.projectedFantasyPointsPerGame ?? 0));
      const ceilingMagnitude = clamp((highVsBaseGain / 7) * .55 + highScenarioSurplusPerGame / 12 * .45, 0, 1);
      const ceilingCredibility = clamp((promotionPathProbability * .35 + roleScenarioSummary.roleSustainability * .25 + roleAssessmentSecurity(metrics) * .2 + clamp(perMinuteProduction / 1.15, 0, 1) * .2) * (1 - (roleContextSummary?.absenceDependencyScore ?? 0) * .55), 0, 1);
      const lateUpsideValue = lateProductionBlend * Math.min(DRAFT_VALUE_CONFIG.lateValue.maximumUpsideAdjustment, ceilingMagnitude * ceilingCredibility * DRAFT_VALUE_CONFIG.lateValue.maximumUpsideAdjustment);
      const credibleCeilingValue = Math.min(DRAFT_VALUE_CONFIG.productionDominance.credibleCeilingCap, highScenarioSurplusPerGame / 8 * (highScenario?.probability ?? 0) * ceilingCredibility);
      const productionBlend = clamp((draftProgress - DRAFT_VALUE_CONFIG.productionDominance.startsAtProgress) / (1 - DRAFT_VALUE_CONFIG.productionDominance.startsAtProgress), 0, 1);
      const riskAdjustedProduction = (metrics.projection.projectedFantasyPointsPerGame * .4 + (baseScenario?.projectedFantasyPointsPerGame ?? 0) * .35 + (lowScenario?.projectedFantasyPointsPerGame ?? 0) * .25) * (.72 + expectedGamesProjection.availabilityConfidence * .28);
      const durabilityEfficiency = projectedSurplusPerGame * (.55 + expectedGamesProjection.expectedGames / 82 * .45) - Math.max(0, availabilityRange - 16) / 8;
      const requiredRiskPremium = expectedGamesProjection.availabilityRiskLabel === "HIGH RISK" ? Math.max(0, (DRAFT_VALUE_CONFIG.lateValue.highRiskGames - expectedGamesProjection.expectedGames) / 12 + availabilityRange / 20) : 0;
      const stashCapacity = clamp((remainingBenchSlots / Math.max(1, leagueConfig.roster.BN)) * .55 + (1 - unresolvedStarterSlots / Math.max(1, remainingUserPicks)) * .3 + (1 - rosterAvailabilityLoad / 3) * .15, 0, 1);
      const longTermInjury = expectedGamesProjection.expectedGames < DRAFT_VALUE_CONFIG.lateValue.highRiskGames || player.injuryAvailabilityClass === "LATE_SEASON" || player.injuryAvailabilityClass === "MOST_OF_SEASON" || player.injuryAvailabilityClass === "FULL_SEASON";
      const stashBurden = longTermInjury ? lateProductionBlend * Math.min(DRAFT_VALUE_CONFIG.lateValue.maximumStashBurden, (1 - stashCapacity) * 3 + rosterAvailabilityLoad * 1.2 + unresolvedStarterSlots * .8 + requiredRiskPremium) : 0;
      const lateProductionQuality = projectedSurplusPerGame * .42 + baseSurplusPerGame * .32 + lowSurplusPerGame * .16 + clamp(roleScenarioSummary.meanSeasonVorp / 120, -2, 2) * .1;
      const productionAnchor = lateProductionBlend * clamp(lateProductionQuality / 8 * DRAFT_VALUE_CONFIG.lateValue.maximumProductionAdjustment, -DRAFT_VALUE_CONFIG.lateValue.maximumProductionAdjustment, DRAFT_VALUE_CONFIG.lateValue.maximumProductionAdjustment);
      const pickNowQualityFloorAdjustment = lateProductionBlend * (projectedSurplusPerGame < (bestAvailableFpg - seasonValue.replacementFantasyPointsPerGame) - 5 ? -Math.min(3, ((bestAvailableFpg - metrics.projection.projectedFantasyPointsPerGame) - 5) * .5) : 0);
      const lateRoundDominanceAdjustment = lateProductionBlend * clamp(baseSurplusPerGame * .3 + Math.max(0, expectedGamesProjection.expectedGames - DRAFT_VALUE_CONFIG.lateValue.highRiskGames) / 30 - requiredRiskPremium, -DRAFT_VALUE_CONFIG.lateValue.maximumDominanceAdjustment, DRAFT_VALUE_CONFIG.lateValue.maximumDominanceAdjustment);
       const nonProductionStackTotal = contributions.opportunity + contributions.breakout + contributions.confidence + contributions.flexibility + roleScenarioSummary.optionScoreAdjustment;
      const nonProductionStackCap = productionBlend ? DRAFT_VALUE_CONFIG.productionDominance.nonProductionCapMiddle + (DRAFT_VALUE_CONFIG.productionDominance.nonProductionCapLate - DRAFT_VALUE_CONFIG.productionDominance.nonProductionCapMiddle) * productionBlend : Number.POSITIVE_INFINITY;
      const nonProductionStackPenalty = Math.max(0, nonProductionStackTotal - nonProductionStackCap);
      const roundsRemaining = leagueConfig.rounds - input.currentRound + 1;
      const endgameBlend = clamp((DRAFT_VALUE_CONFIG.productionDominance.endgameRoundsRemaining - roundsRemaining + 1) / DRAFT_VALUE_CONFIG.productionDominance.endgameRoundsRemaining, 0, 1);
       const lateHoldabilityAdjustment = endgameBlend * clamp(((baseScenario?.projectedFantasyPointsPerGame ?? 0) - seasonValue.replacementFantasyPointsPerGame) / 7 + credibleCeilingValue * .35 + promotionPathProbability * 1.5 - currentDepthCompetition * 1.5 - availabilityTailPenalty * .2, -3, 3);
       const endgameUtility = endgameBlend * clamp(Math.max((baseScenario?.projectedFantasyPointsPerGame ?? 0) - seasonValue.replacementFantasyPointsPerGame, highScenarioSurplusPerGame * (highScenario?.probability ?? 0)) / 8 * 3 + lateHoldabilityAdjustment, -3, 3);
       const finalScore = baseFinalScore + roleScenarioSummary.optionScoreAdjustment + automaticAdjustment + marketTiming.draftNowUrgency - marketTiming.waitValue - marketTiming.liveWaitCost - marketTiming.reachCost + manualPositionPriorityComponent + feasibilityAdjustment + teamDiversificationComponent - rosterRiskPenalty - availabilityTailPenalty + productionAnchor + credibleCeilingValue + lateUpsideValue + lateRoundDominanceAdjustment + pickNowQualityFloorAdjustment - stashBurden - nonProductionStackPenalty + endgameUtility;
      const scoreBreakdown = {
        weightedComponents: contributions,
        optionValue: roleScenarioSummary.optionScoreAdjustment,
        availabilityTail: -availabilityTailPenalty,
        positionContext: automaticAdjustment,
        marketUrgency: marketTiming.draftNowUrgency,
        historicalWait: -marketTiming.waitValue,
        liveWait: -marketTiming.liveWaitCost,
        reach: -marketTiming.reachCost,
        teamDiversification: teamDiversificationComponent,
        manualPositionIntent: manualPositionPriorityComponent,
        rosterRisk: -rosterRiskPenalty,
        productionAnchor,
        credibleCeiling: credibleCeilingValue,
         nonProductionStackPenalty: -nonProductionStackPenalty,
         lateHoldability: lateHoldabilityAdjustment,
         endgameUtility,
        lateProductionQuality: productionAnchor,
        lateUpside: lateUpsideValue,
        stashBurden: -stashBurden,
        dominance: lateRoundDominanceAdjustment,
        qualityFloor: pickNowQualityFloorAdjustment,
        preAdjustmentScore: baseFinalScore,
        finalDraftScore: finalScore,
        reconciliationResidual: 0,
      };
       scoreBreakdown.reconciliationResidual = finalScore - (scoreBreakdown.preAdjustmentScore + scoreBreakdown.optionValue + scoreBreakdown.availabilityTail + scoreBreakdown.positionContext + scoreBreakdown.marketUrgency + scoreBreakdown.historicalWait + scoreBreakdown.liveWait + scoreBreakdown.reach + scoreBreakdown.teamDiversification + scoreBreakdown.manualPositionIntent + scoreBreakdown.rosterRisk + scoreBreakdown.productionAnchor + scoreBreakdown.credibleCeiling + scoreBreakdown.lateUpside + scoreBreakdown.stashBurden + scoreBreakdown.dominance + scoreBreakdown.qualityFloor + scoreBreakdown.nonProductionStackPenalty + scoreBreakdown.endgameUtility);

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
          marketTiming.liveWaitCost >= 3 ? ["Repeated room survival makes this player a stronger wait candidate."] : [],
          marketTiming.waitValue >= 3 ? ["Excellent value, but market suggests he is likely to survive your next turn."] : [],
          marketTiming.draftNowUrgency >= 3 ? ["Market suggests he may not make it back."] : [],
          marketTiming.valueLabel === "MODEL VALUE" || marketTiming.valueLabel === "SLEEPER" ? ["Strong model value relative to market."] : [],
          marketTiming.marketEvidenceLevel === "VERY_LOW" ? ["Market evidence is very limited; timing confidence is low."] : [],
          marketTiming.liveRoomSurvivalEvidence > 0 ? ["Survived a previous full user turn, reducing urgency."] : [],
          materialPositionReason,
          buildExplanations(player, metrics, baseValue, input.currentRound),
          expectedGamesProjection.reasons,
          metrics.careerStageProjection?.reasons ?? [],
          metrics.roleAssessment?.reasons ?? [],
          ecosystem.contextsByPlayerId.get(player.id)?.explanations ?? [],
          roleContextSummary?.roleReasons ?? [],
          availabilityTailPenalty >= DRAFT_VALUE_CONFIG.availabilityTail.materialReasonPenalty ? ["Excellent per-game production, but the low-games downside lowers Pick-Now value."] : [],
          teamConcentrationWarning ? [teamConcentrationWarning] : [],
        ).slice(0, 4),
        manualPositionMatch,
        manualPositionPriorityComponent,
        automaticPositionNeedComponent,
        rosterFeasibilityComponent,
        candidateFeasibility,
        teamContextSummary: teamContext,
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
        roleScenarioSummary,
        marketTiming,
        positionContextComposite,
        modelValueRank: productionRank.get(player.id) ?? projectedCandidates.length,
        marketCostRank: marketTiming.marketCostRank,
        availabilityDownsideGap,
        availabilityTailPenalty,
        scoreBreakdown,
        diagnosticInputs: { baseProjection, roleProjection, teammateDependencies: (roleRecord?.teammateDependencies ?? []).slice(0, 3), roleDataGeneratedAt: input.roleData?.generatedAt ?? null, minutesOutsideRoleRange: minutesOutsideRoleRange.has(player.id), marketExactPickCount: marketProfileById.get(player.id)?.observedOverallPicks?.length ?? marketProfileById.get(player.id)?.observedRoundEquivalents?.length ?? 0, marketRightCensoredCount: marketProfileById.get(player.id)?.rightCensoredRoundEquivalents?.length ?? 0 },
        productionAnchor,
        nonProductionStackTotal,
        nonProductionStackCap,
        credibleCeilingValue,
        highScenarioSurplusPerGame,
        endgameBlend,
        promotionPathProbability,
        currentDepthCompetition,
        netVacatedMinutes,
        rawOpportunitySignal,
        rawBreakoutSignal,
        rawCeilingSignal,
        rawRoleSignal,
        lateHoldabilityAdjustment,
        lateProductionBlend,
        projectedSurplusPerGame,
        baseSurplusPerGame,
        lowSurplusPerGame,
        highSurplusPerGame: highScenarioSurplusPerGame,
        lateProductionQuality,
        riskAdjustedProduction,
        durabilityEfficiency,
        requiredRiskPremium,
        stashCapacity,
        stashBurden,
        rosterAvailabilityLoad,
        highVsBaseGain,
        ceilingMagnitude,
        ceilingCredibility,
        lateUpsideValue,
        lateValueClassification: classifyLateValue(baseSurplusPerGame, highScenarioSurplusPerGame, lateUpsideValue, stashBurden),
        lateRoundDominanceAdjustment,
        pickNowQualityFloorAdjustment,
        dominanceWarning: false,
      };
    })
    .sort(
      (left, right) =>
        right.finalScore - left.finalScore ||
        right.projection.projectedFantasyPointsPerGame -
          left.projection.projectedFantasyPointsPerGame ||
        left.player.name.localeCompare(right.player.name),
    );

  // A diagnostic, not a brittle override: surface any case where an inferior
  // production/availability/role profile beat a clearly dominant alternative.
  for (const candidate of recommendations) {
    candidate.dominanceWarning = recommendations.some((other) =>
      other.player.id !== candidate.player.id &&
      candidate.finalScore > other.finalScore &&
      other.projection.projectedFantasyPointsPerGame >= candidate.projection.projectedFantasyPointsPerGame + 3 &&
      other.expectedGamesProjection.expectedGames >= candidate.expectedGamesProjection.expectedGames - 1 &&
      other.roleScenarioSummary.meanSeasonVorp >= candidate.roleScenarioSummary.meanSeasonVorp + 25 &&
      other.roleAssessment.currentRoleSecurity >= candidate.roleAssessment.currentRoleSecurity - .05 &&
      Math.abs((other.marketTiming.survivalNextTurn ?? other.marketTiming.survivalEstimate / 100) - (candidate.marketTiming.survivalNextTurn ?? candidate.marketTiming.survivalEstimate / 100)) < .2
    );
  }

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
  const recommendationDisplay = normalizeRecommendationDisplay(input.recommendationDisplay ?? DEFAULT_RECOMMENDATION_DISPLAY, leagueConfig.rounds);
  const displayExpanded = recommendationDisplay.expansionMode === "DRAFT_PROGRESS"
    ? draftProgress >= recommendationDisplay.expandAtProgress
    : input.currentRound >= recommendationDisplay.expandAtRound;
  const topRecommendations = topPool.slice(0, recommendationDisplay.primaryCount).map((recommendation) => {
    if (positionIntent.mode !== "Prefer" || recommendation.manualPositionMatch || !activeIntentPositions.length) return recommendation;
    return { ...recommendation, explanations: ["Best value despite current position preference.", ...recommendation.explanations].slice(0, 4) };
  });
  const alternativeRecommendations = displayExpanded
    ? selectLateAlternatives(topPool, topRecommendations, recommendationDisplay.expandedTotalCount - recommendationDisplay.primaryCount)
    : [];
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
    topRecommendations,
    alternativeRecommendations,
    recommendationDisplay,
    displayExpanded,
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
    marketCorpusDraftCount: input.marketData?.mockDraftCount ?? 0,
    marketProfileVersion: input.marketData?.generatedAt ?? null,
    matchingMarketProfiles: projectedCandidates.filter((candidate) => marketProfileById.has(candidate.player.id)).length,
    teamMinutesDiagnostics: { teamsProcessed: minutesBudget.teams.length, teamsOutsideTolerance: minutesBudget.teams.filter((team) => team.outsideTolerance).length, capViolations: minutesBudget.capViolations, maximumTotalMinutes: Math.max(0, ...minutesBudget.teams.map((team) => team.after)), minutesOutsideRoleRange: minutesOutsideRoleRange.size },
  };
  return result;
}

function countLiveRoomSurvivalEvidence(log: readonly DraftDecisionSnapshot[] | undefined, playerId: string, currentOverallPick: number): number {
  return log?.filter((snapshot) => snapshot.overallPick < currentOverallPick && snapshot.topFive.some((entry) => entry.playerId === playerId)).length ?? 0;
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

function roleAssessmentSecurity(metrics: ProjectionMetrics): number {
  return metrics.roleAssessment?.currentRoleSecurity ?? .5;
}

function productionBlendForDraft(draftProgress: number): number {
  return clamp((draftProgress - DRAFT_VALUE_CONFIG.productionDominance.startsAtProgress) / (1 - DRAFT_VALUE_CONFIG.productionDominance.startsAtProgress), 0, 1);
}

function smoothLateProductionBlend(draftProgress: number): number {
  const config = DRAFT_VALUE_CONFIG.lateValue;
  const progress = clamp((draftProgress - config.startsAtProgress) / (config.fullStrengthProgress - config.startsAtProgress), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function classifyLateValue(baseSurplus: number, highSurplus: number, upside: number, stashBurden: number): "CORE_PRODUCTION" | "BALANCED_VALUE" | "UPSIDE_TARGET" | "INJURY_STASH" | "WAIVER_LEVEL" {
  if (stashBurden >= 3.5) return "INJURY_STASH";
  if (baseSurplus <= 0 && highSurplus < 2 && upside < 1) return "WAIVER_LEVEL";
  if (baseSurplus >= 4) return "CORE_PRODUCTION";
  if (upside >= 2.2 && highSurplus >= 4) return "UPSIDE_TARGET";
  return "BALANCED_VALUE";
}

export function calculateAvailabilityDownsideGap(
  seasonValue: SeasonValueProjection,
  expectedGames: ExpectedGamesProjection,
): number {
  const lowGamesSeasonValue = seasonValue.perGameVorp * expectedGames.expectedGamesLow;
  return Math.max(0, seasonValue.seasonVorp - lowGamesSeasonValue);
}

export function calculateAvailabilityTailPenalty(
  downsideGap: number,
  expectedGames: ExpectedGamesProjection,
  draftProgress: number,
): number {
  const config = DRAFT_VALUE_CONFIG.availabilityTail;
  const stageProgress = clamp(draftProgress, 0, 1);
  const earlyToMiddle = clamp(stageProgress / .5, 0, 1);
  const middleToLate = clamp((stageProgress - .5) / .5, 0, 1);
  const weight = stageProgress <= .5
    ? config.earlyWeight + (config.middleWeight - config.earlyWeight) * earlyToMiddle
    : config.middleWeight + (config.lateWeight - config.middleWeight) * middleToLate;
  const cap = stageProgress <= .5
    ? config.earlyCap + (config.middleCap - config.earlyCap) * earlyToMiddle
    : config.middleCap + (config.lateCap - config.middleCap) * middleToLate;
  const rangeUncertainty = clamp(
    (expectedGames.expectedGamesHigh - expectedGames.expectedGamesLow) / config.rangeForFullUncertainty,
    0,
    1,
  );
  const confidenceUncertainty = 1 - expectedGames.availabilityConfidence;
  const uncertainty = rangeUncertainty * (.5 + confidenceUncertainty * .5);
  return Math.min(cap, downsideGap * weight * uncertainty);
}

export function selectLateAlternatives(
  pool: readonly PlayerRecommendation[],
  topRecommendations: readonly PlayerRecommendation[],
  count: number = DRAFT_VALUE_CONFIG.lateAlternatives.count,
): AlternativeRecommendation[] {
  const primaryIds = new Set(topRecommendations.map((recommendation) => recommendation.player.id));
  return pool
    .filter((recommendation) => !primaryIds.has(recommendation.player.id))
    .slice(0, count)
    .map((recommendation) => ({ recommendation }));
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
