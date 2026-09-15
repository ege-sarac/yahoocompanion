import { describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { Player, PlayerRoleHistoryRecord } from "../types";
import { calculateMarketTiming } from "./marketDraft";
import { estimateProjectedBonusCounts, projectPlayerProduction } from "./projectionModel";
import { rankPlayers } from "./recommendationEngine";
import { buildRoleScenarioSummary } from "./roleOutcomes";
import { projectMajorInjuryComeback } from "./expectedGames";

function player(id: string, points = 20, team = id): Player {
  return { id, name: id, nbaTeam: team, yahooPositions: ["G"], age: 26, injuryStatus: "Healthy", expectedReturnDate: null, historicalStats: [0, 1, 2].map((index) => ({ season: `2025-${26 - index}`, gamesPlayed: 74, minutesPerGame: 30 - index, points: points - index, offensiveRebounds: 1, defensiveRebounds: 4, assists: 5, steals: 1, blocks: .5, turnovers: 2 })), projections: null, injuryRisk: null, opportunityScore: null, breakoutScore: null };
}

function universe() { return Array.from({ length: 80 }, (_, index) => player(`p${index}`, 38 - index * .25)); }

describe("late-round feedback protections", () => {
  it("keeps a player's intrinsic Season VORP invariant across draft stage", () => {
    const players = universe(), target = players[0];
    const early = rankPlayers({ players, draftedPlayerIds: [], myRoster: [], currentRound: 6, currentOverallPick: 94 }).recommendations.find((entry) => entry.player.id === target.id)!;
    const late = rankPlayers({ players, draftedPlayerIds: players.slice(1, 50).map((entry) => entry.id), myRoster: [], currentRound: 10, currentOverallPick: 150 }).recommendations.find((entry) => entry.player.id === target.id)!;
    expect(late.seasonValue.seasonVorp).toBeCloseTo(early.seasonValue.seasonVorp);
  });

  it("does not let available-pool depletion lower the intrinsic replacement baseline", () => {
    const players = universe();
    const initial = rankPlayers({ players, draftedPlayerIds: [], myRoster: [], currentRound: 1 });
    const depleted = rankPlayers({ players, draftedPlayerIds: players.slice(10).map((entry) => entry.id), myRoster: [], currentRound: 12 });
    expect(depleted.replacementLevels).toEqual(initial.replacementLevels);
  });

  it("turns repeated room survival into a material live WAIT cost", () => {
    const timing = calculateMarketTiming(undefined, DEFAULT_LEAGUE_CONFIG, 150, 169, 9, 500, [], undefined, [], 3);
    expect(timing.liveWaitCost).toBeGreaterThan(5);
    expect(timing.liveRoomConfidence).toBeGreaterThan(.8);
  });

  it("sets live WAIT cost to zero when no future pick exists", () => {
    expect(calculateMarketTiming(undefined, DEFAULT_LEAGUE_CONFIG, 230, null, 9, 500, [], undefined, [], 4).liveWaitCost).toBe(0);
  });

  it("activates credible scenario-spread option value later in the draft", () => {
    const candidate = player("spread", 20), metrics = projectPlayerProduction(candidate)!;
    metrics.roleAssessment = { skillConfidence: .85, currentRoleSecurity: .8, currentTeamContinuity: true, reasons: [] };
    metrics.modelConfidence = .85;
    metrics.projection.projectedMinutesLow = 24; metrics.projection.projectedMinutesHigh = 36;
    metrics.projection.projectedFantasyPointsPerGameLow = 27; metrics.projection.projectedFantasyPointsPerGameHigh = 42;
    const input = { player: candidate, metrics, roleContextSummary: { adjustmentPercent: 0, roleReasons: [], roleSustainability: .82, lateSeasonMinutesChange: 3 }, seasonValue: { replacementFantasyPointsPerGame: 24, perGameVorp: 8, seasonVorp: 560, availabilityAdjustedFantasyPointsEquivalent: 30, projectedTotalFantasyPoints: 2500 } };
    const early = buildRoleScenarioSummary({ ...input, draftProgress: .1 });
    const late = buildRoleScenarioSummary({ ...input, draftProgress: .9 });
    expect(late.credibleUpsideSurplus).toBeGreaterThan(0);
    expect(late.optionScoreAdjustment).toBeGreaterThan(early.optionScoreAdjustment);
  });

  it("does not let a weak five-percent high outcome dominate the option score", () => {
    const candidate = player("fake", 12), metrics = projectPlayerProduction(candidate)!;
    metrics.roleAssessment = { skillConfidence: .1, currentRoleSecurity: .1, currentTeamContinuity: false, reasons: [] };
    metrics.modelConfidence = .1;
    metrics.projection.projectedMinutesLow = 8; metrics.projection.projectedMinutesHigh = 36;
    metrics.projection.projectedFantasyPointsPerGameLow = 8; metrics.projection.projectedFantasyPointsPerGameHigh = 40;
    const result = buildRoleScenarioSummary({ player: candidate, metrics, roleContextSummary: { adjustmentPercent: 0, roleReasons: [], roleSustainability: 0 }, seasonValue: { replacementFantasyPointsPerGame: 20, perGameVorp: -4, seasonVorp: -280, availabilityAdjustedFantasyPointsEquivalent: 16, projectedTotalFantasyPoints: 1200 }, draftProgress: 1 });
    expect(result.scenarios[2].probability).toBeCloseTo(.05);
    expect(result.optionScoreAdjustment).toBeLessThan(1);
  });

  it("scores every available player through the final pipeline", () => {
    const players = universe();
    expect(rankPlayers({ players, draftedPlayerIds: [], myRoster: [], currentRound: 12 }).recommendations).toHaveLength(players.length);
  });

  it("recomputes DD and TD frequency nonlinearly when minutes and stats fall", () => {
    const high = estimateProjectedBonusCounts({ projectedPoints: 20, projectedOffensiveRebounds: 3, projectedDefensiveRebounds: 8, projectedAssists: 5, projectedSteals: 1, projectedBlocks: 1 }, 70);
    const low = estimateProjectedBonusCounts({ projectedPoints: 10, projectedOffensiveRebounds: 1.5, projectedDefensiveRebounds: 4, projectedAssists: 2.5, projectedSteals: .5, projectedBlocks: .5 }, 70);
    expect(low.projectedDoubleDoubles).toBeLessThan(high.projectedDoubleDoubles * .5);
  });

  it("distinguishes a returned major-injury player from an unreturned comeback", () => {
    const comeback = { ...player("return"), injuryStatus: "Returning soon" as const, injuryDescription: "major surgery", historicalStats: [{ ...player("return").historicalStats[0], gamesPlayed: 10 }, { ...player("return").historicalStats[1], gamesPlayed: 70 }] };
    const projection = projectPlayerProduction(comeback)!.projection;
    const record: PlayerRoleHistoryRecord = { playerId: comeback.id, seasons: [], latestSeasonGames: Array.from({ length: 12 }, (_, index) => ({ playerId: comeback.id, team: "return", gameId: String(index), gameDate: "2026-01-01", teamGameNumber: index + 1, minutes: 26, points: 15, fga: 12, fta: 3, assists: 4, turnovers: 2, offensiveRebounds: 1, defensiveRebounds: 4, steals: 1, blocks: .5 })) };
    expect(projectMajorInjuryComeback({ ...comeback, injuryStatus: "Healthy" }, projection, undefined, record)).toBeUndefined();
    expect(projectMajorInjuryComeback(comeback, projection)).toBeDefined();
  });
});
