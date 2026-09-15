import { describe, expect, it } from "vitest";
import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { LateSeasonRegime, MarketPlayerProfile, Player, PlayerRoleHistoryRecord } from "../types";
import { createDecisionSnapshot } from "./decisionLog";
import { replayDraft } from "./draftReplay";
import { calculateMarketTiming, learnMarketProfiles, parseMockDraft } from "./marketDraft";
import { projectPlayerProduction } from "./projectionModel";
import { rankPlayers } from "./recommendationEngine";
import { buildRoleScenarioSummary } from "./roleOutcomes";
import { calculateRoleSustainability } from "./roleProjection";

function player(id: string, points = 20): Player {
  return { id, name: id, nbaTeam: "TST", yahooPositions: ["G"], age: 26, injuryStatus: "Healthy", expectedReturnDate: null, historicalStats: [0, 1, 2].map((index) => ({ season: `2025-${26 - index}`, gamesPlayed: 72, minutesPerGame: 30 - index, points: points - index, offensiveRebounds: 1, defensiveRebounds: 4, assists: 5, steals: 1, blocks: .5, turnovers: 2 })), projections: null, injuryRisk: null, opportunityScore: null, breakoutScore: null };
}

function scenario(playerInput = player("scenario"), progress = .2) {
  const metrics = projectPlayerProduction(playerInput)!;
  return buildRoleScenarioSummary({ player: playerInput, metrics, seasonValue: { replacementFantasyPointsPerGame: 45, perGameVorp: -5, seasonVorp: -360, availabilityAdjustedFantasyPointsEquivalent: 0, projectedTotalFantasyPoints: 0 }, draftProgress: progress });
}

describe("role outcome calibration", () => {
  it("uses LOW, BASE, and HIGH probabilities that sum to one", () => {
    const result = scenario();
    expect(result.scenarios.map((item) => item.label)).toEqual(["LOW", "BASE", "HIGH"]);
    expect(result.scenarios.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(1);
    expect(result.scenarios[1].probability).toBeGreaterThanOrEqual(DRAFT_VALUE_CONFIG.roleScenarios.minimumBaseProbability);
  });

  it("derives every scenario FP/G from its own minutes and rate", () => {
    for (const item of scenario().scenarios) expect(item.projectedFantasyPointsPerGame).toBeCloseTo(item.healthyGameMPG * item.projectedFantasyPointsPerMinute);
  });

  it("keeps Expected Games independent of the healthy-game role scenarios", () => {
    const result = scenario();
    expect(new Set(result.scenarios.map((item) => item.expectedGames)).size).toBe(1);
  });

  it("only applies a non-negative, stage-capped option adjustment", () => {
    const early = scenario(player("early", 12), 0);
    const late = scenario(player("late", 12), 1);
    expect(early.optionAdjustedSeasonVorp).toBeGreaterThanOrEqual(early.meanSeasonVorp);
    expect(early.optionScoreAdjustment).toBeLessThanOrEqual(DRAFT_VALUE_CONFIG.roleScenarios.optionScoreCapEarly);
    expect(late.optionScoreAdjustment).toBeLessThanOrEqual(DRAFT_VALUE_CONFIG.roleScenarios.optionScoreCapLate);
  });

  it("discounts an absence-dependent late-season gain more than a sustained same-team gain", () => {
    const windows: LateSeasonRegime["windows"] = { fullSeason: { games: 70 }, firstTwoThirds: { games: 45 }, finalThird: { games: 25 }, postAllStar: { games: 25 }, postTradeDeadline: { games: 25 }, last20: { games: 20 }, last10: { games: 10 }, last5: { games: 5 }, currentTeamStint: { games: 70 } };
    const base = { roleChangeScore: .8, regimeConfidence: .8, persistenceScore: .8, direction: 1 as const, regimeWeight: .2, absenceDependencyScore: 0, returnRampDetected: false, finalWeekVolatility: false, currentTeamMatch: true, roleMetricAgreement: .8, windows, reasons: [] };
    const sustained: LateSeasonRegime = { ...base, type: "SUSTAINED_ROLE_GAIN" };
    const temporary: LateSeasonRegime = { ...base, type: "ABSENCE_DEPENDENT_BOOST", absenceDependencyScore: .8 };
    const record = (regime: LateSeasonRegime): PlayerRoleHistoryRecord => ({ playerId: "scenario", seasons: [{ playerId: "scenario", season: "2025-26", team: "TST", dataCompleteness: .8, dataSourceFlags: ["NBA Advanced"] }], latestSeasonGames: [], regime });
    expect(calculateRoleSustainability(player("scenario"), record(sustained))).toBeGreaterThan(calculateRoleSustainability(player("scenario"), record(temporary)));
  });

  it("keeps a high-investment likely-starter newcomer above fringe minutes in a crowded team budget", () => {
    const rookie: Player = { ...player("rookie"), historicalStats: [], isRookie: true, nbaExperience: "R" };
    const teammates = Array.from({ length: 9 }, (_, index) => ({ ...player(`teammate-${index}`, 19), nbaTeam: "TST" }));
    const ranking = rankPlayers({ players: [rookie, ...teammates], draftedPlayerIds: [], myRoster: [], currentRound: 1, newPlayerInputs: [{ playerId: rookie.id, classification: "Rookie", nbaDraftRound: 1, nbaDraftPick: 3, expectedNbaMinutes: 29, roleExpectation: "Likely starter" }] });
    expect(ranking.recommendations.find((entry) => entry.player.id === rookie.id)!.projection.projectedMinutes).toBeGreaterThan(24);
  });
});

describe("low-sample market calibration", () => {
  const profile: MarketPlayerProfile = { playerId: "market", mockRoundEquivalentMedian: 7, mockMedianPick: 105, sampleCount: 1, observedRoundEquivalents: [7], observedOverallPicks: [105], rightCensoredRoundEquivalents: [] };

  it("does not turn one mock observation into a learned ADP estimate", () => {
    const learned = learnMarketProfiles([player("market")], [parseMockDraft({ teamCount: 16, rounds: 15, picks: [{ overallPick: 105, playerId: "market" }] }, 16, 15)], [], DEFAULT_LEAGUE_CONFIG).profiles[0];
    expect(learned.mockRoundEquivalentMedian).toBeUndefined();
    expect(learned.observedOverallPicks).toEqual([105]);
  });

  it("labels a one-observation market estimate as very low confidence", () => {
    const timing = calculateMarketTiming(profile, DEFAULT_LEAGUE_CONFIG, 80, 101, 30, 500);
    expect(timing.marketEvidenceLevel).toBe("VERY_LOW");
    expect(timing.marketEvidenceLabel).toContain("#105 once");
  });

  it("does not let a stale pre-draft observation create urgent market pressure", () => {
    const timing = calculateMarketTiming(profile, DEFAULT_LEAGUE_CONFIG, 150, 171, 30, 500);
    expect(timing.marketPickEstimate).toBeNull();
    expect(timing.draftNowUrgency).toBe(0);
  });

  it("caps low-sample waiting adjustment near two points", () => {
    const timing = calculateMarketTiming(profile, DEFAULT_LEAGUE_CONFIG, 80, 101, 30, 500, [], undefined, [], 3);
    expect(timing.waitValue).toBeLessThanOrEqual(2);
    expect(timing.liveRoomSurvivalEvidence).toBe(3);
  });
});

describe("live evidence and replay diagnostics", () => {
  it("stores compact role and market evidence in a decision snapshot", () => {
    const ranking = rankPlayers({ players: [player("logged")], draftedPlayerIds: [], myRoster: [], currentRound: 1 });
    const entry = createDecisionSnapshot(10, [], { mode: "Normal", positions: [] }, ranking.topRecommendations).topFive[0];
    expect(entry.roleScenarioSummary).toContain("BASE");
    expect(entry.conditionalSurvival).toBe(true);
  });

  it("reports Top-5 survival and next-window recall without needing market data", () => {
    const players = [player("p1"), player("p2"), player("p3"), player("p4")];
    const config = { ...DEFAULT_LEAGUE_CONFIG, teamCount: 2, userDraftSlot: 1, rounds: 2 };
    const replay = replayDraft(players, ["p1", "p2", "p3", "p4"].map((playerId, index) => ({ playerId, overallPick: index + 1 })), config);
    const first = replay.snapshots[0];
    expect(first.topFiveSurvivalToNextTurn).not.toBeNull();
    expect(first.nextWindowRecallAt5).not.toBeNull();
    expect(first.topFive[0].marketTiming.survivalSource).toBe("MODEL_ONLY");
  });
});
