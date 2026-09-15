import { describe, expect, it } from "vitest";
import { DEFAULT_RECOMMENDATION_DISPLAY, normalizeRecommendationDisplay } from "../config/recommendationDisplayConfig";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { Player, RecommendationResult } from "../types";
import { draftPlayer, createInitialDraftState, serializeDraftExport, validateDraftState } from "./draftState";
import { appendRecommendationTrace, createRecommendationTraceSnapshot, serializeRecommendationTraceExport } from "./recommendationTrace";
import { rankPlayers } from "./recommendationEngine";

function player(id: string, points: number): Player {
  return { id, name: id, nbaTeam: `T${Number(id.slice(1)) % 8}`, yahooPositions: [Number(id.slice(1)) % 3 === 0 ? "G" : Number(id.slice(1)) % 3 === 1 ? "F" : "C"], age: 26, injuryStatus: "Healthy", expectedReturnDate: null, historicalStats: [0, 1, 2].map((year) => ({ season: `${2025 - year}-${String(26 - year).padStart(2, "0")}`, gamesPlayed: 70, minutesPerGame: 30, points: points - year, offensiveRebounds: 1, defensiveRebounds: 4, assists: 5, steals: 1, blocks: .5, turnovers: 2 })), projections: null, injuryRisk: null, opportunityScore: null, breakoutScore: null };
}

const players = Array.from({ length: 42 }, (_, index) => player(`p${index}`, 42 - index * .45));
function ranked(state = createInitialDraftState(), display = DEFAULT_RECOMMENDATION_DISPLAY): RecommendationResult {
  return rankPlayers({ players, draftedPlayerIds: state.draftedPlayerIds, manualUnavailablePlayerIds: state.manualUnavailablePlayerIds, myRoster: [], currentRound: Math.ceil(state.currentOverallPick / DEFAULT_LEAGUE_CONFIG.teamCount), currentOverallPick: state.currentOverallPick, draftPicks: state.picks, recommendationDisplay: display });
}
function stateAt(overallPick: number) { let state = createInitialDraftState(); for (let index = 0; index < overallPick - 1; index++) state = draftPlayer(state, players[index].id); return state; }

describe("recommendation trace", () => {
  it("creates one detailed snapshot per meaningful user turn and ignores duplicate rerenders", () => {
    const state = stateAt(10), snapshot = createRecommendationTraceSnapshot(state, DEFAULT_LEAGUE_CONFIG, ranked(state), "p9", "FULL_USER_TURN", "2026-09-15T00:00:00Z");
    const once = appendRecommendationTrace(state.recommendationTrace, snapshot, state);
    expect(appendRecommendationTrace(once, snapshot, state).snapshots).toHaveLength(1);
  });

  it("stores ordered unique Top-10 diagnostics and ranks 11 through 25 compactly", () => {
    const state = stateAt(10), snapshot = createRecommendationTraceSnapshot(state, DEFAULT_LEAGUE_CONFIG, ranked(state), "p9", "FULL_USER_TURN");
    expect(snapshot.topCandidates.map((candidate) => candidate.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(snapshot.topCandidates.map((candidate) => candidate.playerId)).size).toBe(10);
    expect(snapshot.compactCandidates).toHaveLength(15);
    expect(snapshot.compactCandidates[0].rank).toBe(11);
  });

  it("reconciles every stored Top-10 score decomposition", () => {
    const state = stateAt(10), snapshot = createRecommendationTraceSnapshot(state, DEFAULT_LEAGUE_CONFIG, ranked(state), "p9", "FULL_USER_TURN");
    expect(snapshot.topCandidates.every((candidate) => Math.abs(candidate.score.reconciliationResidual) < .0001 && Math.abs(candidate.score.finalDraftScore - candidate.draftScore) < .0001)).toBe(true);
  });

  it("carries a previous Top-10 player forward when he remains available below rank 25", () => {
    const state = stateAt(10), first = createRecommendationTraceSnapshot(state, DEFAULT_LEAGUE_CONFIG, ranked(state), "p9", "FULL_USER_TURN");
    const withFirst = { ...state, recommendationTrace: appendRecommendationTrace(state.recommendationTrace, first, state) };
    const initial = ranked(withFirst);
    const fallen = initial.recommendations[0];
    const reordered = [...initial.recommendations.filter((candidate) => candidate.player.id !== fallen.player.id), { ...fallen, finalScore: -999, scoreBreakdown: { ...fallen.scoreBreakdown, finalDraftScore: -999, reconciliationResidual: 0 } }];
    const second = createRecommendationTraceSnapshot(withFirst, DEFAULT_LEAGUE_CONFIG, { ...initial, recommendations: reordered }, "p9", "FULL_USER_TURN");
    expect(second.carriedForwardCandidates[0]).toMatchObject({ playerId: fallen.player.id, previousRank: 1, currentRank: reordered.length });
  });

  it("settles prior user-turn outcomes at the next user turn", () => {
    const initialState = stateAt(10), first = createRecommendationTraceSnapshot(initialState, DEFAULT_LEAGUE_CONFIG, ranked(initialState), "p9", "FULL_USER_TURN");
    let nextState = { ...initialState, recommendationTrace: appendRecommendationTrace(initialState.recommendationTrace, first, initialState) };
    for (let index = 9; index < 22; index++) nextState = draftPlayer(nextState, players[index].id);
    const second = createRecommendationTraceSnapshot(nextState, DEFAULT_LEAGUE_CONFIG, ranked(nextState), "p22", "FULL_USER_TURN");
    const settled = appendRecommendationTrace(nextState.recommendationTrace, second, nextState).snapshots[0].outcome;
    expect(settled).toMatchObject({ hasFutureUserPick: true, candidates: expect.any(Array) });
    expect(settled?.top10SurvivedCount).not.toBeNull();
  });

  it("keeps the trace through normal draft export/import and standalone export", () => {
    const state = stateAt(10), snapshot = createRecommendationTraceSnapshot(state, DEFAULT_LEAGUE_CONFIG, ranked(state), "p9", "FULL_USER_TURN");
    const traced = { ...state, recommendationTrace: appendRecommendationTrace(state.recommendationTrace, snapshot, state) };
    expect(validateDraftState(JSON.parse(serializeDraftExport(traced, DEFAULT_LEAGUE_CONFIG))).recommendationTrace.snapshots).toHaveLength(1);
    expect(JSON.parse(serializeRecommendationTraceExport(traced.recommendationTrace, DEFAULT_LEAGUE_CONFIG, traced)).recommendationTrace.snapshots[0].header).toHaveProperty("draftFingerprint");
  });

  it("expands the display by draft-progress mode at the configured threshold", () => {
    const display = { ...DEFAULT_RECOMMENDATION_DISPLAY, expandAtProgress: .4 };
    expect(ranked(stateAt(10), display).displayExpanded).toBe(false);
    expect(ranked({ ...createInitialDraftState(), currentOverallPick: 100 }, display).displayExpanded).toBe(true);
  });

  it("expands the display by configured round mode", () => {
    const display = { ...DEFAULT_RECOMMENDATION_DISPLAY, expansionMode: "ROUND" as const, expandAtRound: 3 };
    expect(ranked(stateAt(10), display).displayExpanded).toBe(false);
    expect(ranked(stateAt(33), display).displayExpanded).toBe(true);
  });

  it("normalizes unsafe recommendation-count settings without losing safe defaults", () => {
    expect(normalizeRecommendationDisplay({ primaryCount: 99, expandedTotalCount: 1, expandAtProgress: 3, expandAtRound: 0, expansionMode: "DRAFT_PROGRESS" }, 15)).toEqual({ primaryCount: 7, expandedTotalCount: 7, expansionMode: "DRAFT_PROGRESS", expandAtProgress: .9, expandAtRound: 1 });
  });

  it("keeps legacy exports without a trace valid", () => {
    const legacy = { picks: [], draftedPlayerIds: [], myPlayerIds: [], currentOverallPick: 1 };
    expect(validateDraftState(legacy).recommendationTrace.snapshots).toEqual([]);
  });
});
