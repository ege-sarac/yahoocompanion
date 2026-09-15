import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import type { DraftState, LeagueConfig, PlayerRecommendation, RecommendationCandidateTrace, RecommendationCompactCandidateTrace, RecommendationRankMovement, RecommendationResult, RecommendationTrace, RecommendationTraceSnapshot } from "../types";
import { createRosterFingerprint, createScoringFingerprint } from "./marketDraft";
import { getDraftInfo, getNextMyPick, getPicksUntilMyNextPick } from "./draftState";

export const RECOMMENDATION_TRACE_SCHEMA_VERSION = 1 as const;
export const RECOMMENDATION_ENGINE_VERSION = "10.4";

export function createRecommendationTrace(createdAt = ""): RecommendationTrace {
  return { schemaVersion: RECOMMENDATION_TRACE_SCHEMA_VERSION, createdAt, engineVersion: RECOMMENDATION_ENGINE_VERSION, snapshots: [] };
}

export function createRecommendationTraceSnapshot(state: DraftState, config: LeagueConfig, result: RecommendationResult, selectedPlayerId: string, detailLevel: RecommendationTraceSnapshot["detailLevel"], recordedAt = new Date().toISOString()): RecommendationTraceSnapshot {
  const info = getDraftInfo(state.currentOverallPick, config);
  if (!info) throw new Error("Cannot trace a completed draft pick.");
  const previous = state.recommendationTrace.snapshots.at(-1);
  const previousById = previous ? new Map([...previous.topCandidates, ...previous.compactCandidates].map((candidate) => [candidate.playerId, candidate])) : new Map();
  const ranks = new Map(result.recommendations.map((candidate, index) => [candidate.player.id, index + 1]));
  const fullCandidates = detailLevel === "FULL_USER_TURN" ? result.recommendations.slice(0, 10).map((candidate, index) => fullTrace(candidate, index + 1, previousById)) : [];
  const compactStart = detailLevel === "FULL_USER_TURN" ? 10 : 0;
  const compactEnd = detailLevel === "FULL_USER_TURN" ? 25 : 10;
  const compactCandidates = result.recommendations.slice(compactStart, compactEnd).map((candidate, index) => compactTrace(candidate, index + compactStart + 1, previousById));
  const currentTop = result.recommendations.slice(0, 25);
  const carriedForwardCandidates = previous?.detailLevel === "FULL_USER_TURN"
    ? previous.topCandidates.flatMap((candidate) => {
      const currentRank = ranks.get(candidate.playerId);
      const current = currentRank ? result.recommendations[currentRank - 1] : undefined;
      if (currentRank === undefined || !current || currentRank <= 25) return [];
      return [{ playerId: candidate.playerId, playerName: candidate.playerName, currentRank, previousRank: candidate.rank, currentDraftScore: rounded(current.finalScore), previousDraftScore: candidate.draftScore, largestChangedScoreComponents: largestChanges(current, candidate), strongestExplanation: current.explanations[0] ?? "No new user-facing reason." }];
    })
    : [];
  const previousDropouts = previous?.detailLevel === "FULL_USER_TURN"
    ? previous.topCandidates.flatMap((candidate) => {
      const currentRank = ranks.get(candidate.playerId);
      if (currentRank !== undefined && currentRank <= 25) return [];
      const current = currentRank === undefined ? undefined : result.recommendations[currentRank - 1];
      const kinds = [candidate.rank <= 5 ? "left Top 5" : "left Top 10", "previous Top-10 dropped below 25"];
      return [{ playerId: candidate.playerId, playerName: candidate.playerName, fromRank: candidate.rank, toRank: currentRank ?? null, scoreDelta: rounded((current?.finalScore ?? candidate.draftScore) - candidate.draftScore), largestComponentChanges: current ? largestChanges(current, candidate) : ["Unavailable / drafted"], kinds }];
    })
    : [];
  const notableRankMovements = [...buildMovements(currentTop, previousById), ...previousDropouts];
  const optionCap = stageValue(DRAFT_VALUE_CONFIG.roleScenarios.optionScoreCapEarly, DRAFT_VALUE_CONFIG.roleScenarios.optionScoreCapMiddle, DRAFT_VALUE_CONFIG.roleScenarios.optionScoreCapLate, result.draftProgress);
  const tailWeight = stageValue(DRAFT_VALUE_CONFIG.availabilityTail.earlyWeight, DRAFT_VALUE_CONFIG.availabilityTail.middleWeight, DRAFT_VALUE_CONFIG.availabilityTail.lateWeight, result.draftProgress);
  const positionCap = result.recommendations[0]?.positionContextComposite.cap ?? 0;
  const snapshotKey = `${draftFingerprint(state)}:${state.currentOverallPick}`;
  return {
    snapshotKey, detailLevel, recordedAt, overallPick: info.overallPick, round: info.round, pickInRound: info.pickInRound, selectedPlayerId,
    header: {
      teamCount: config.teamCount, configuredRounds: config.rounds, userDraftSlot: config.userDraftSlot, draftProgress: rounded(result.draftProgress), nextUserPick: getNextMyPick(state.currentOverallPick + 1, config), picksUntilNextUserPick: getPicksUntilMyNextPick(state.currentOverallPick, config), scoringFingerprint: createScoringFingerprint(config.scoring), rosterFingerprint: createRosterFingerprint(config), draftFingerprint: draftFingerprint(state), recommendationEngineVersion: RECOMMENDATION_ENGINE_VERSION, marketProfileVersion: result.marketProfileVersion, marketCorpusDraftCount: result.marketCorpusDraftCount, availablePlayerCount: result.recommendations.length, projectablePlayerCount: result.recommendations.length + result.excludedForNoHistory, rosterFeasiblePlayerCount: result.recommendations.filter((candidate) => candidate.candidateFeasibility.candidateKeepsRosterFeasible).length, rosterPlayerIds: [...state.myPlayerIds], positionIntent: structuredClone(state.positionIntent), rosterNeed: { ...result.rosterFeasibility.restrictiveSlotsRequired },
      resolved: { replacementFPPerGame: { ...result.replacementLevels.byPosition }, draftStage: result.draftProgress < 1 / 3 ? "early" : result.draftProgress < 2 / 3 ? "middle" : "late", optionValueStageCap: optionCap, availabilityTailStageWeight: tailWeight, positionContextStageCap: positionCap, waitMaximumPenalty: DRAFT_VALUE_CONFIG.market.liveWait.maximumPenalty, teamDiversificationMode: result.teamDiversificationMode, preferredMaxSameTeam: result.preferredMaxSameTeam, recommendationDisplay: structuredClone(result.recommendationDisplay) },
    },
    topCandidates: fullCandidates, compactCandidates, carriedForwardCandidates, notableRankMovements,
  };
}

export function appendRecommendationTrace(trace: RecommendationTrace, snapshot: RecommendationTraceSnapshot, state: DraftState): RecommendationTrace {
  if (trace.snapshots.some((entry) => entry.snapshotKey === snapshot.snapshotKey)) return trace;
  const snapshots = trace.snapshots.map((entry) => snapshot.detailLevel === "FULL_USER_TURN" && entry.detailLevel === "FULL_USER_TURN" && !entry.outcome ? settleSnapshot(entry, snapshot, state) : entry);
  const finalSnapshot = snapshot.detailLevel === "FULL_USER_TURN" && snapshot.header.nextUserPick === null
    ? { ...snapshot, outcome: { hasFutureUserPick: false, settledAt: snapshot.recordedAt, candidates: snapshot.topCandidates.map((candidate) => ({ playerId: candidate.playerId, survivedToNextUserTurn: false, draftedBeforeNextUserTurn: candidate.playerId === snapshot.selectedPlayerId, draftedAtOverallPick: candidate.playerId === snapshot.selectedPlayerId ? snapshot.overallPick : null, draftedByUser: candidate.playerId === snapshot.selectedPlayerId, stillAvailableAtNextUserTurn: false })), top5SurvivedCount: null, top10SurvivedCount: null, top5DraftedBeforeNextTurn: null, top10DraftedBeforeNextTurn: null, nextWindowRecallAt5: null, nextWindowRecallAt10: null } }
    : snapshot;
  return { ...trace, createdAt: trace.createdAt || snapshot.recordedAt, snapshots: [...snapshots, finalSnapshot] };
}

export function serializeRecommendationTraceExport(trace: RecommendationTrace, config: LeagueConfig, state: DraftState, createdAt = new Date().toISOString()): string {
  return JSON.stringify({ schemaVersion: 1, createdAt, leagueConfig: config, recommendationDisplay: state.recommendationDisplay, traceEnabled: state.recommendationTraceEnabled, traceGranularity: state.recommendationTraceGranularity, recommendationTrace: trace }, null, 2);
}

function fullTrace(recommendation: PlayerRecommendation, rank: number, previousById: Map<string, { rank: number; draftScore: number }>): RecommendationCandidateTrace {
  const previous = previousById.get(recommendation.player.id);
  const projection = recommendation.projection;
  const base = recommendation.diagnosticInputs.baseProjection;
  const scenarios = recommendation.roleScenarioSummary.scenarios;
  const dependency = recommendation.diagnosticInputs.teammateDependencies[0];
  const dependencySampleStrength = dependency ? Math.min(1, dependency.gamesWith / 8) * Math.min(1, dependency.gamesWithout / 8) : 0;
  const market = recommendation.marketTiming;
  const team = recommendation.teamContextSummary;
  const flags = candidateFlags(recommendation);
  return {
    rank, playerId: recommendation.player.id, playerName: recommendation.player.name, nbaTeam: recommendation.player.nbaTeam, positions: [...recommendation.player.yahooPositions], draftScore: rounded(recommendation.finalScore), previousRank: previous?.rank ?? null, rankChange: previous ? previous.rank - rank : null, previousDraftScore: previous?.draftScore ?? null, draftScoreChange: previous ? rounded(recommendation.finalScore - previous.draftScore) : null,
    projection: { projectedFantasyPointsPerGame: rounded(projection.projectedFantasyPointsPerGame), expectedGames: rounded(recommendation.expectedGamesProjection.expectedGames), expectedGamesLow: rounded(recommendation.expectedGamesProjection.expectedGamesLow), expectedGamesHigh: rounded(recommendation.expectedGamesProjection.expectedGamesHigh), seasonVorp: rounded(recommendation.seasonValue.seasonVorp), meanSeasonVorp: rounded(recommendation.roleScenarioSummary.meanSeasonVorp), optionAdjustedSeasonVorp: rounded(recommendation.roleScenarioSummary.optionAdjustedSeasonVorp), replacementFPPerGameUsed: rounded(recommendation.seasonValue.replacementFantasyPointsPerGame), healthyGameMPG: rounded(projection.projectedMinutes), points: rounded(projection.projectedPoints), offensiveRebounds: rounded(projection.projectedOffensiveRebounds), defensiveRebounds: rounded(projection.projectedDefensiveRebounds), assists: rounded(projection.projectedAssists), steals: rounded(projection.projectedSteals), blocks: rounded(projection.projectedBlocks), turnovers: rounded(projection.projectedTurnovers), projectedDoubleDoubles: rounded(projection.projectedDoubleDoubles), projectedTripleDoubles: rounded(projection.projectedTripleDoubles) },
    transformation: { baseProjectionFPPerGame: rounded(base.projectedFantasyPointsPerGame), baseHealthyMPG: rounded(base.projectedMinutes), finalHealthyMPG: rounded(projection.projectedMinutes), minuteAdjustment: rounded(projection.projectedMinutes - base.projectedMinutes), rateAdjustment: rounded(rate(projection) - rate(base)), teamContextAdjustment: rounded(team?.adjustmentPercent ?? 0) },
    role: { skillConfidence: rounded(recommendation.modelConfidence), currentRoleSecurity: rounded(recommendation.roleAssessment.currentRoleSecurity), rotationTier: recommendation.roleAssessment.currentRoleSecurity >= .75 ? "SECURE" : recommendation.roleAssessment.currentRoleSecurity >= .5 ? "ROTATION" : "UNCERTAIN", roleSustainability: rounded(recommendation.roleScenarioSummary.roleSustainability), minutesLow: rounded(scenarios[0]?.healthyGameMPG ?? projection.projectedMinutes), minutesBase: rounded(scenarios[1]?.healthyGameMPG ?? projection.projectedMinutes), minutesHigh: rounded(scenarios[2]?.healthyGameMPG ?? projection.projectedMinutes), currentTeamContinuity: recommendation.roleAssessment.currentTeamContinuity, minutesOutsideRoleRange: recommendation.diagnosticInputs.minutesOutsideRoleRange, roleDataGeneratedAt: recommendation.diagnosticInputs.roleDataGeneratedAt },
    scenarios: scenarios.map((scenario) => ({ label: scenario.label, probability: rounded(scenario.probability), healthyGameMPG: rounded(scenario.healthyGameMPG), projectedFantasyPointsPerGame: rounded(scenario.projectedFantasyPointsPerGame), seasonVorp: rounded(scenario.seasonVorp) })),
    option: { optionPremium: rounded(recommendation.roleScenarioSummary.optionPremium), credibleUpsideSurplus: rounded(recommendation.roleScenarioSummary.credibleUpsideSurplus), credibleDownsideGap: rounded(recommendation.roleScenarioSummary.credibleDownsideGap), upsideLabel: recommendation.roleScenarioSummary.upsideLabel },
    teamResourceShock: { scoringUsage: rounded(team?.resourceShock?.usage ?? 0), creation: rounded(team?.resourceShock?.creation ?? 0), rebounding: rounded(team?.resourceShock?.rebounding ?? 0), minutes: rounded(team?.minutesAdjustmentPercent ?? 0) },
    teammateAbsence: { absenceDependencyScore: rounded(recommendation.roleContextSummary?.absenceDependencyScore ?? 0), roleDependencyApplied: (recommendation.roleContextSummary?.absenceDependencyScore ?? 0) > 0, activeSampleGames: dependency?.gamesWith ?? null, absentSampleGames: dependency?.gamesWithout ?? null, sampleShrinkage: dependency ? rounded(.35 + .65 * dependencySampleStrength) : null, roleSustainabilityAdjustment: rounded(Math.max(0, 1 - recommendation.roleScenarioSummary.roleSustainability)), baseMinutesAdjustment: rounded((scenarios[1]?.healthyGameMPG ?? projection.projectedMinutes) - projection.projectedMinutes), highScenarioProbabilityAdjustment: rounded(Math.max(0, .16 * (recommendation.roleContextSummary?.absenceDependencyScore ?? 0)) ) },
    availability: { participationRisk: rounded(recommendation.combinedAvailabilityRisk), availabilityRiskLabel: recommendation.expectedGamesProjection.availabilityRiskLabel, majorComeback: Boolean(recommendation.expectedGamesProjection.majorInjuryComeback), postReturnEstablished: !recommendation.expectedGamesProjection.majorInjuryComeback, availabilityDownsideGap: rounded(recommendation.availabilityDownsideGap), availabilityTailPenalty: rounded(recommendation.availabilityTailPenalty) },
    market: { marketEvidenceType: market.marketEvidenceLevel, exactPickCount: recommendation.diagnosticInputs.marketExactPickCount, rightCensoredCount: recommendation.diagnosticInputs.marketRightCensoredCount, marketObservationSummary: market.marketEvidenceLabel, marketPickEstimate: market.marketPickEstimate, marketRoundEstimate: market.marketRoundLow, marketConfidence: rounded(market.marketConfidence), conditionalSurvival: market.conditionalSurvival, survivalEstimate: rounded(market.survivalEstimate), liveRoomSurvivalEvidence: market.liveRoomSurvivalEvidence, historicalWaitAdjustment: rounded(market.waitValue), liveWaitCost: rounded(market.liveWaitCost), reachCost: rounded(market.reachCost), modelEdge: market.marketCostRank === null ? null : recommendation.modelValueRank - market.marketCostRank, modelEdgeEscapeActivated: recommendation.eliteDiversificationEscape },
    position: { rosterFeasible: recommendation.candidateFeasibility.candidateKeepsRosterFeasible, positionNeed: rounded(recommendation.automaticPositionNeedComponent), positionScarcity: rounded(recommendation.scarcityScore), tierDrop: rounded(recommendation.tierDropoffScore), recentPositionRun: rounded(recommendation.recentRunPressure), marketDepletion: rounded(recommendation.positionContextComposite.marketDepletion), flexibility: rounded(recommendation.flexibilityScore), composite: rounded(recommendation.positionContextComposite.composite), cap: rounded(recommendation.positionContextComposite.cap), contribution: rounded(recommendation.positionContextComposite.contribution) },
    score: { ...recommendation.scoreBreakdown, weightedComponents: Object.fromEntries(Object.entries(recommendation.scoreBreakdown.weightedComponents).map(([key, value]) => [key, rounded(value)])), optionValue: rounded(recommendation.scoreBreakdown.optionValue), availabilityTail: rounded(recommendation.scoreBreakdown.availabilityTail), positionContext: rounded(recommendation.scoreBreakdown.positionContext), marketUrgency: rounded(recommendation.scoreBreakdown.marketUrgency), historicalWait: rounded(recommendation.scoreBreakdown.historicalWait), liveWait: rounded(recommendation.scoreBreakdown.liveWait), reach: rounded(recommendation.scoreBreakdown.reach), teamDiversification: rounded(recommendation.scoreBreakdown.teamDiversification), manualPositionIntent: rounded(recommendation.scoreBreakdown.manualPositionIntent), rosterRisk: rounded(recommendation.scoreBreakdown.rosterRisk), preAdjustmentScore: rounded(recommendation.scoreBreakdown.preAdjustmentScore), finalDraftScore: rounded(recommendation.scoreBreakdown.finalDraftScore), reconciliationResidual: rounded(recommendation.scoreBreakdown.reconciliationResidual) },
    reasons: [...recommendation.explanations], flags,
  };
}

function compactTrace(recommendation: PlayerRecommendation, rank: number, previousById: Map<string, { rank: number }>): RecommendationCompactCandidateTrace {
  const previous = previousById.get(recommendation.player.id);
  return { rank, playerId: recommendation.player.id, playerName: recommendation.player.name, nbaTeam: recommendation.player.nbaTeam, positions: [...recommendation.player.yahooPositions], projectedFantasyPointsPerGame: rounded(recommendation.projection.projectedFantasyPointsPerGame), expectedGames: rounded(recommendation.expectedGamesProjection.expectedGames), seasonVorp: rounded(recommendation.seasonValue.seasonVorp), draftScore: rounded(recommendation.finalScore), previousRank: previous?.rank ?? null, rankChange: previous ? previous.rank - rank : null, optionValueContribution: rounded(recommendation.scoreBreakdown.optionValue), availabilityTailPenalty: rounded(recommendation.availabilityTailPenalty), positionContextContribution: rounded(recommendation.scoreBreakdown.positionContext), marketTimingContribution: rounded(recommendation.scoreBreakdown.marketUrgency + recommendation.scoreBreakdown.historicalWait + recommendation.scoreBreakdown.reach), liveWaitCost: rounded(recommendation.marketTiming.liveWaitCost), currentRoleSecurity: rounded(recommendation.roleAssessment.currentRoleSecurity), roleSustainability: rounded(recommendation.roleScenarioSummary.roleSustainability), upsideLabel: recommendation.roleScenarioSummary.upsideLabel, reasons: recommendation.explanations.slice(0, 2) };
}

function settleSnapshot(snapshot: RecommendationTraceSnapshot, next: RecommendationTraceSnapshot, state: DraftState): RecommendationTraceSnapshot {
  if (snapshot.overallPick >= next.overallPick) return snapshot;
  const picks = state.picks.filter((pick) => pick.overallPick >= snapshot.overallPick && pick.overallPick < next.overallPick);
  const pickByPlayerId = new Map(picks.map((pick) => [pick.playerId, pick]));
  const candidates = snapshot.topCandidates.map((candidate) => {
    const pick = pickByPlayerId.get(candidate.playerId);
    return { playerId: candidate.playerId, survivedToNextUserTurn: !pick, draftedBeforeNextUserTurn: Boolean(pick), draftedAtOverallPick: pick?.overallPick ?? null, draftedByUser: Boolean(pick?.isMyTeam), stillAvailableAtNextUserTurn: !pick };
  });
  const nextRanks = new Set([...next.topCandidates, ...next.compactCandidates].map((candidate) => candidate.playerId));
  const top5 = candidates.slice(0, 5), top10 = candidates;
  const recalled = (items: typeof candidates, limit: number) => items.slice(0, limit).filter((candidate) => nextRanks.has(candidate.playerId)).length;
  return { ...snapshot, outcome: { hasFutureUserPick: true, settledAt: next.recordedAt, candidates, top5SurvivedCount: top5.filter((candidate) => candidate.survivedToNextUserTurn).length, top10SurvivedCount: top10.filter((candidate) => candidate.survivedToNextUserTurn).length, top5DraftedBeforeNextTurn: top5.filter((candidate) => candidate.draftedBeforeNextUserTurn).length, top10DraftedBeforeNextTurn: top10.filter((candidate) => candidate.draftedBeforeNextUserTurn).length, nextWindowRecallAt5: top5.length ? recalled(top5, 5) / top5.length : null, nextWindowRecallAt10: top10.length ? recalled(top10, 10) / top10.length : null } };
}

function buildMovements(current: readonly PlayerRecommendation[], previousById: Map<string, { rank: number; draftScore: number }>): RecommendationRankMovement[] {
  return current.flatMap((candidate, index) => {
    const rank = index + 1, previous = previousById.get(candidate.player.id);
    if (!previous) return rank <= 5 ? [movement(candidate, null, rank, 0, ["entered Top 5"])] : [];
    const kinds: string[] = [];
    if (previous.rank > 5 && rank <= 5) kinds.push("entered Top 5");
    if (previous.rank <= 5 && rank > 5) kinds.push("left Top 5");
    if (previous.rank > 10 && rank <= 10) kinds.push("entered Top 10");
    if (previous.rank <= 10 && rank > 10) kinds.push("left Top 10");
    if (Math.abs(previous.rank - rank) >= 5) kinds.push("moved 5+ ranks");
    return kinds.length ? [movement(candidate, previous.rank, rank, candidate.finalScore - previous.draftScore, kinds)] : [];
  });
}

function movement(candidate: PlayerRecommendation, fromRank: number | null, toRank: number, scoreDelta: number, kinds: string[]): RecommendationRankMovement { return { playerId: candidate.player.id, playerName: candidate.player.name, fromRank, toRank, scoreDelta: rounded(scoreDelta), largestComponentChanges: ["Draft Score"], kinds }; }
function largestChanges(candidate: PlayerRecommendation, previous: { draftScore: number }): string[] { return Math.abs(candidate.finalScore - previous.draftScore) >= .01 ? ["Draft Score"] : []; }
function candidateFlags(candidate: PlayerRecommendation): string[] { const flags: string[] = []; if (candidate.diagnosticInputs.minutesOutsideRoleRange) flags.push("MINUTES_OUTSIDE_ROLE_RANGE"); if (candidate.roleAssessment.currentRoleSecurity < .5) flags.push("ROLE_SECURITY_LOW"); if (candidate.teamContextSummary?.resourceShock && Math.max(Math.abs(candidate.teamContextSummary.resourceShock.usage), Math.abs(candidate.teamContextSummary.resourceShock.creation), Math.abs(candidate.teamContextSummary.resourceShock.rebounding)) >= .14) flags.push("TEAM_RESOURCE_SHOCK"); if ((candidate.roleContextSummary?.absenceDependencyScore ?? 0) > 0) flags.push("ABSENCE_DEPENDENT_ROLE"); if (candidate.expectedGamesProjection.availabilityRiskLabel === "HIGH RISK") flags.push("EXTREME_GP_RISK"); if (candidate.expectedGamesProjection.majorInjuryComeback) flags.push("POST_RETURN_ESTABLISHED"); if (candidate.marketTiming.marketConfidence < .35) flags.push("MARKET_LOW_CONFIDENCE"); if (candidate.marketTiming.liveRoomSurvivalEvidence > 0) flags.push("REPEATED_ROOM_SURVIVAL"); if (candidate.marketTiming.liveWaitCost > 0 || candidate.marketTiming.waitValue > 0) flags.push("WAIT_CANDIDATE"); if (Math.abs(candidate.positionContextComposite.contribution) >= candidate.positionContextComposite.cap - .01) flags.push("POSITION_CONTEXT_CAP_HIT"); if (candidate.roleScenarioSummary.upsideLabel === "HIGH") flags.push("HIGH_OPTION_VALUE"); return flags; }
function draftFingerprint(state: DraftState): string { let hash = 2166136261; for (const value of state.picks.map((pick) => `${pick.overallPick}:${pick.playerId}`).join("|")) { hash ^= value.charCodeAt(0); hash = Math.imul(hash, 16777619); } return `${state.picks.length}-${(hash >>> 0).toString(36)}`; }
function rate(projection: PlayerRecommendation["projection"]): number { return projection.projectedMinutes > 0 ? projection.projectedFantasyPointsPerGame / projection.projectedMinutes : 0; }
function rounded(value: number): number { return Math.round(value * 10000) / 10000; }
function stageValue(early: number, middle: number, late: number, progress: number): number { return progress <= .5 ? early + (middle - early) * progress * 2 : middle + (late - middle) * (progress - .5) * 2; }
