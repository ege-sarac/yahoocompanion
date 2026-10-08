import { describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import { RECOMMENDATION_CONFIG } from "../config/recommendationConfig";
import type { Player, Projection, ProjectionMetrics } from "../types";
import { calculateFantasyPoints } from "./fantasyPoints";
import { calculateMarketTiming, normalizeDraftProgress, progressToOverallPick } from "./marketDraft";
import { calculateProjectionSanity, calculateRecentSeasonFantasyPPG } from "./projectionSanity";
import { rankPlayers } from "./recommendationEngine";
import { createInitialDraftState } from "./draftState";
import { createRecommendationTraceSnapshot } from "./recommendationTrace";

function player(id: string, points = 20, minutes = 30, team = "TST"): Player { return { id, name: id, nbaTeam: team, yahooPositions: ["G"], age: 27, injuryStatus: "Healthy", expectedReturnDate: null, historicalStats: [{ season: "2025-26", gamesPlayed: 72, minutesPerGame: minutes, points, offensiveRebounds: 1.1, defensiveRebounds: 3, assists: 4.6, steals: 1.2, blocks: .2, turnovers: 1.6 }, { season: "2024-25", gamesPlayed: 70, minutesPerGame: minutes, points: points - 1, offensiveRebounds: 1, defensiveRebounds: 3, assists: 4, steals: 1, blocks: .2, turnovers: 1.8 }], projections: null, injuryRisk: null, opportunityScore: null, breakoutScore: null }; }
function projection(fp = 26, minutes = 28): Projection { return { projectedGames: 70, projectedMinutes: minutes, projectedPoints: 12.7, projectedOffensiveRebounds: 1.1, projectedDefensiveRebounds: 3, projectedAssists: 4.6, projectedSteals: 1.2, projectedBlocks: .2, projectedTurnovers: 1.6, projectedDoubleDoubles: 4, projectedTripleDoubles: .2, projectedFantasyPointsPerGame: fp }; }
function metrics(p: Projection): ProjectionMetrics { return { projection: p, projectionSource: "Veteran NBA history", projectedFantasyPointsPerSeason: p.projectedFantasyPointsPerGame * 70, availabilityAdjustedFantasyPoints: p.projectedFantasyPointsPerGame * 70, historicalAvailabilityRisk: .1, currentInjuryPenalty: 0, combinedAvailabilityRisk: .1, modelConfidence: .9, opportunityScore: 60, breakoutScore: 60, usedPerGameFallback: false }; }

describe("Prompt 10.5 production and timing calibration", () => {
  it("recomputes recent production with the configured league scoring", () => {
    const p = player("recent", 12.7, 28.5);
    const expected = calculateFantasyPoints({ points: 12.7, offensiveRebounds: 1.1, defensiveRebounds: 3, assists: 4.6, steals: 1.2, blocks: .2, turnovers: 1.6, doubleDoubles: 0, tripleDoubles: 0 }, DEFAULT_LEAGUE_CONFIG.scoring);
    expect(calculateRecentSeasonFantasyPPG(p, DEFAULT_LEAGUE_CONFIG)).toBeGreaterThan(expected - 1);
  });

  it("flags a material unexplained compression", () => {
    const p = player("compressed", 20, 29), result = calculateProjectionSanity(p, projection(26, 29), projection(19, 29), DEFAULT_LEAGUE_CONFIG, metrics(projection(19, 29)));
    expect(result.unexplainedProjectionCompression).toBe(true);
  });

  it("allows a large injury-supported reduction without a false compression flag", () => {
    const p = { ...player("hurt", 20, 29), injuryStatus: "Injured" as const }, result = calculateProjectionSanity(p, projection(26, 29), projection(19, 22), DEFAULT_LEAGUE_CONFIG, { ...metrics(projection(19, 22)), expectedGamesProjection: { expectedGamesLow: 20, expectedGames: 40, expectedGamesHigh: 55, availabilityConfidence: .4, availabilityRiskLabel: "HIGH RISK", currentHealthVerified: true, reasons: [] } });
    expect(result.unexplainedProjectionCompression).toBe(false);
  });

  it("keeps confidence small relative to production after the middle draft", () => {
    expect(RECOMMENDATION_CONFIG.stages.late.weights.confidence).toBeLessThan(.02);
    expect(RECOMMENDATION_CONFIG.stages.late.weights.projectedValue).toBeGreaterThan(RECOMMENDATION_CONFIG.stages.late.weights.confidence * 20);
  });

  it("does not let a 19 FP/G profile beat a stable 26 FP/G profile on generic confidence", () => {
    const strong = player("strong", 26, 32, "A"), weak = player("weak", 19, 28, "B");
    const ranked = rankPlayers({ players: [strong, weak], draftedPlayerIds: [], myRoster: [], currentRound: 13, currentOverallPick: 200 });
    expect(ranked.recommendations[0].player.id).toBe("strong");
  });

  it("uses right-censored observations as survival evidence without an exact market pick", () => {
    const timing = calculateMarketTiming({ playerId: "wait", rightCensoredRoundEquivalents: [14, 14], observedRoundEquivalents: [] }, DEFAULT_LEAGUE_CONFIG, 80, 95, 80, 500);
    expect(timing.survivalNextTurn).toBeGreaterThan(0);
    expect(timing.marketPickEstimate).toBeNull();
  });

  it("normalizes a 14x13 market observation into a 16x15 league", () => {
    const progress = normalizeDraftProgress(130, 14, 13);
    expect(progressToOverallPick(progress, DEFAULT_LEAGUE_CONFIG)).toBeGreaterThan(160);
  });

  it("separates exact-pick precision from survival direction", () => {
    const timing = calculateMarketTiming({ playerId: "censored", normalizedObservations: [{ draftProgress: .8, roundEquivalent: 11, teamCount: 14, rounds: 13, rightCensored: false }, { draftProgress: 1, roundEquivalent: 14, teamCount: 14, rounds: 13, rightCensored: true }, { draftProgress: 1, roundEquivalent: 14, teamCount: 14, rounds: 13, rightCensored: true }] }, DEFAULT_LEAGUE_CONFIG, 100, 119, 50, 500);
    expect(timing.timingDirectionConfidence).toBeGreaterThan(timing.marketPrecisionConfidence ?? 0);
    expect(timing.survivalNextTurn).toBeGreaterThan(0);
  });

  it("keeps raw basketball signals stable as draft stage changes", () => {
    const p = player("stable-signals", 24, 31);
    const early = rankPlayers({ players: [p], draftedPlayerIds: [], myRoster: [], currentRound: 6, currentOverallPick: 80 }).recommendations[0];
    const late = rankPlayers({ players: [p], draftedPlayerIds: [], myRoster: [], currentRound: 12, currentOverallPick: 176 }).recommendations[0];
    expect(late.rawOpportunitySignal).toBeCloseTo(early.rawOpportunitySignal, 8);
    expect(late.rawBreakoutSignal).toBeCloseTo(early.rawBreakoutSignal, 8);
    expect(late.rawCeilingSignal).toBeCloseTo(early.rawCeilingSignal, 8);
    expect(late.baseValue).toBeCloseTo(early.baseValue, 8);
  });

  it("sets WAIT to zero at the final user pick", () => {
    const timing = calculateMarketTiming(undefined, DEFAULT_LEAGUE_CONFIG, 230, null, 100, 500);
    expect(timing.waitOpportunityCost).toBe(0);
  });

  it("derives endgame smoothly from configured 13- and 15-round leagues", () => {
    const p = player("endgame", 22, 30);
    const fifteen = rankPlayers({ players: [p], draftedPlayerIds: [], myRoster: [], currentRound: 11, currentOverallPick: 161 }).recommendations[0];
    const thirteenConfig = { ...DEFAULT_LEAGUE_CONFIG, rounds: 13, roster: { ...DEFAULT_LEAGUE_CONFIG.roster, BN: 3 } };
    const thirteen = rankPlayers({ players: [p], draftedPlayerIds: [], myRoster: [], currentRound: 9, currentOverallPick: 129, leagueConfig: thirteenConfig }).recommendations[0];
    expect(fifteen.endgameBlend).toBeGreaterThan(0);
    expect(thirteen.endgameBlend).toBeGreaterThan(0);
  });

  it("preserves ranking and trace identity when the stable-universe cache is reused", () => {
    const players = [player("identity-a", 26, 32, "A"), player("identity-b", 22, 28, "B")];
    const stages = [{ currentRound: 1, currentOverallPick: 10, leagueConfig: DEFAULT_LEAGUE_CONFIG }, { currentRound: 8, currentOverallPick: 119, leagueConfig: DEFAULT_LEAGUE_CONFIG }, { currentRound: 13, currentOverallPick: 202, leagueConfig: DEFAULT_LEAGUE_CONFIG }, { currentRound: 13, currentOverallPick: 170, leagueConfig: { ...DEFAULT_LEAGUE_CONFIG, teamCount: 14, rounds: 13 } }];
    for (const stage of stages) {
      const input = { players, draftedPlayerIds: [], myRoster: [], ...stage };
      const first = rankPlayers(input), second = rankPlayers(input);
      const summarize = (result: typeof first) => result.recommendations.map((entry) => [entry.player.id, entry.finalScore, entry.seasonValue.seasonVorp, entry.projection.projectedFantasyPointsPerGame, entry.roleScenarioSummary, entry.marketTiming, entry.endgameBlend]);
      expect(summarize(second)).toEqual(summarize(first));
      const state = { ...createInitialDraftState(), currentOverallPick: stage.currentOverallPick };
      const firstTrace = createRecommendationTraceSnapshot(state, stage.leagueConfig, first, players[0].id, "FULL_USER_TURN", "2026-09-15T00:00:00.000Z");
      const secondTrace = createRecommendationTraceSnapshot(state, stage.leagueConfig, second, players[0].id, "FULL_USER_TURN", "2026-09-15T00:00:00.000Z");
      expect(secondTrace.topCandidates).toEqual(firstTrace.topCandidates);
    }
  });

  it("gives censor-only late evidence real WAIT without inventing an ADP", () => {
    const profile = { playerId: "censored-only", normalizedObservations: Array.from({ length: 5 }, () => ({ draftProgress: 1, roundEquivalent: 14, teamCount: 14, rounds: 13, rightCensored: true })) };
    const timing = calculateMarketTiming(profile, DEFAULT_LEAGUE_CONFIG, 106, 119, 90, 500);
    expect(timing.marketPickEstimate).toBeNull();
    expect(timing.targetWindowCenter).toBeNull();
    expect(timing.targetWindowLowerBound).toBe(182);
    expect(timing.censorDerivedWait).toBeGreaterThan(0);
    expect(timing.waitOpportunityCost).toBeGreaterThan(0);
  });

  it("uses one late exact observation plus censoring as directional WAIT evidence", () => {
    const profile = { playerId: "late-plus-censored", normalizedObservations: [{ draftProgress: .78, roundEquivalent: 11, teamCount: 14, rounds: 13, rightCensored: false }, ...Array.from({ length: 4 }, () => ({ draftProgress: 1, roundEquivalent: 14, teamCount: 14, rounds: 13, rightCensored: true }))] };
    const timing = calculateMarketTiming(profile, DEFAULT_LEAGUE_CONFIG, 106, 119, 90, 500);
    expect(timing.marketPickEstimate).toBeNull();
    expect(timing.exactMarketDerivedWait).toBeGreaterThan(0);
    expect(timing.censorDerivedWait).toBeGreaterThan(0);
    expect(timing.waitOpportunityCost).toBeGreaterThan(3);
  });

  it("makes a multi-turn target wait more than a next-turn target", () => {
    const far = { playerId: "far", normalizedObservations: Array.from({ length: 5 }, () => ({ draftProgress: normalizeDraftProgress(170, 16, 15), roundEquivalent: 11.6, teamCount: 16, rounds: 15, rightCensored: false })) };
    const near = { playerId: "near", normalizedObservations: Array.from({ length: 5 }, () => ({ draftProgress: normalizeDraftProgress(119, 16, 15), roundEquivalent: 8.4, teamCount: 16, rounds: 15, rightCensored: false })) };
    const farTiming = calculateMarketTiming(far, DEFAULT_LEAGUE_CONFIG, 106, 119, 90, 500);
    const nearTiming = calculateMarketTiming(near, DEFAULT_LEAGUE_CONFIG, 106, 119, 90, 500);
    expect(farTiming.userTurnsUntilTargetWindow).toBe(4);
    expect(farTiming.waitOpportunityCost).toBeGreaterThan(nearTiming.waitOpportunityCost!);
  });

  it("allows an elite intrinsic rank to escape part of a multi-turn WAIT", () => {
    const profile = { playerId: "edge", normalizedObservations: Array.from({ length: 5 }, () => ({ draftProgress: normalizeDraftProgress(170, 16, 15), roundEquivalent: 11.6, teamCount: 16, rounds: 15, rightCensored: false })) };
    const ordinary = calculateMarketTiming(profile, DEFAULT_LEAGUE_CONFIG, 106, 119, 90, 500, [], undefined, [], 0, 90);
    const elite = calculateMarketTiming(profile, DEFAULT_LEAGUE_CONFIG, 106, 119, 90, 500, [], undefined, [], 0, 1);
    expect(elite.waitOpportunityCost).toBeLessThan(ordinary.waitOpportunityCost!);
  });

  it("strengthens censor-derived timing after current-room survival", () => {
    const profile = { playerId: "room", normalizedObservations: Array.from({ length: 5 }, () => ({ draftProgress: 1, roundEquivalent: 14, teamCount: 14, rounds: 13, rightCensored: true })) };
    const before = calculateMarketTiming(profile, DEFAULT_LEAGUE_CONFIG, 106, 119, 90, 500);
    const after = calculateMarketTiming(profile, DEFAULT_LEAGUE_CONFIG, 106, 119, 90, 500, [], undefined, [], 2);
    expect(after.waitOpportunityCost).toBeGreaterThan(before.waitOpportunityCost!);
    expect(after.liveRoomDerivedWait).toBeGreaterThan(0);
  });
});
