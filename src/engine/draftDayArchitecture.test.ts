import { describe, expect, it } from "vitest";
import { DEFAULT_EXTERNAL_PROJECTION_FALLBACK_THRESHOLD, DEFAULT_LEAGUE_CONFIG, migrateLeagueConfig, serializeLeagueConfig, validateLeagueConfig } from "../config/leagueConfig";
import type { DraftDayBackup, LeagueConfig, Player } from "../types";
import { createInitialDraftState, getDraftProgress, getNextMyPick, validateDraftState } from "./draftState";
import { getSnakeDraftTeamNumber, getTeamOverallPicks } from "./draftOrder";
import { calculateFantasyPoints } from "./fantasyPoints";
import { applyNbaPositionFallbacks, mergePlayerOverrides } from "./playerOverrides";
import { validateNewPlayerOverrides } from "./newPlayerOverrides";
import { calculateDraftCapitalSignal, projectNewPlayer, projectPlayerForRecommendations } from "./newPlayerProjection";
import { assignRosterSlots } from "./rosterAssignment";
import { getRecommendationWeightsForProgress, rankPlayers } from "./recommendationEngine";
import { createDraftDayBackup, validateDraftDayBackup } from "./draftDayBackup";
import { getSuspiciousReturnDateWarnings } from "./injurySnapshot";
import { calculateRecentPositionRuns } from "./draftSignals";

function config(overrides: Partial<LeagueConfig> = {}): LeagueConfig {
  return { ...structuredClone(DEFAULT_LEAGUE_CONFIG), ...overrides };
}
function player(id: string, points = 20, positions: Player["yahooPositions"] = ["G"]): Player {
  return {
    id, name: `Player ${id}`, nbaTeam: "TST", nbaPosition: "Guard", yahooPositions: positions,
    age: 25, injuryStatus: "Healthy", expectedReturnDate: null,
    historicalStats: [{ season: "2025-26", gamesPlayed: 70, minutesPerGame: 30, points, offensiveRebounds: 1, defensiveRebounds: 4, assists: 5, steals: 1, blocks: 0.5, turnovers: 2 }],
    projections: null, injuryRisk: null, opportunityScore: null, breakoutScore: null,
  };
}

describe("draft-day architecture", () => {
  it("validates, serializes, and migrates league settings", () => {
    expect(validateLeagueConfig(DEFAULT_LEAGUE_CONFIG)).toEqual(DEFAULT_LEAGUE_CONFIG);
    expect(DEFAULT_LEAGUE_CONFIG.externalProjectionFallbackThreshold).toBe(DEFAULT_EXTERNAL_PROJECTION_FALLBACK_THRESHOLD);
    expect(migrateLeagueConfig(JSON.parse(serializeLeagueConfig(DEFAULT_LEAGUE_CONFIG)))).toEqual(DEFAULT_LEAGUE_CONFIG);
    expect(migrateLeagueConfig({ schemaVersion: 1, config: { ...DEFAULT_LEAGUE_CONFIG, externalProjectionFallbackThreshold: "invalid" } }).externalProjectionFallbackThreshold).toBe(1.5);
    expect(migrateLeagueConfig({ teamCount: 16, myDraftSlot: 10, rosterSize: 15, rosterSlots: { G: 3, F: 2, C: 2, UTIL: 3, BN: 5 }, scoring: { points: 1, offensiveRebounds: 1.4, defensiveRebounds: 1.2, assists: 1.5, steals: 2, blocks: 2, turnovers: -1, doubleDoubles: 5, tripleDoubles: 5 } })).toEqual(DEFAULT_LEAGUE_CONFIG);
    expect(() => validateLeagueConfig({ ...DEFAULT_LEAGUE_CONFIG, userDraftSlot: 17 })).toThrow(/Draft slot/);
    expect(() => validateLeagueConfig({ ...DEFAULT_LEAGUE_CONFIG, externalProjectionFallbackThreshold: -0.1 })).toThrow(/fallback gap/);
    expect(() => validateLeagueConfig({ ...DEFAULT_LEAGUE_CONFIG, externalProjectionFallbackThreshold: 10.1 })).toThrow(/fallback gap/);
    expect(migrateLeagueConfig({ ...DEFAULT_LEAGUE_CONFIG, externalProjectionFallbackThreshold: Number.NaN }).externalProjectionFallbackThreshold).toBe(1.5);
    expect(migrateLeagueConfig({ ...DEFAULT_LEAGUE_CONFIG, externalProjectionFallbackThreshold: 7.2 }).externalProjectionFallbackThreshold).toBe(7.2);
  });

  it("uses generic snake settings and handles completion", () => {
    expect(getTeamOverallPicks(10, 4, 4)).toEqual([4, 17, 24, 37]);
    expect(getSnakeDraftTeamNumber(20, 10)).toBe(1);
    const custom = config({ teamCount: 10, userDraftSlot: 4, rounds: 4, roster: { G: 1, F: 1, C: 1, UTIL: 1, BN: 0, IL: 0, ILPlus: 0 } });
    expect(getNextMyPick(18, custom)).toBe(24);
    expect(validateDraftState({ picks: [], draftedPlayerIds: [], myPlayerIds: [], currentOverallPick: 1 }, custom)).toEqual(createInitialDraftState());
    expect(getDraftProgress(39, custom)).toBe(1);
  });

  it("uses dynamic scoring while preserving default parity", () => {
    const line = { points: 10, offensiveRebounds: 2, defensiveRebounds: 3, assists: 4, steals: 1, blocks: 1, turnovers: 2, doubleDoubles: 1, tripleDoubles: 0 };
    expect(calculateFantasyPoints(line)).toBeCloseTo(29.4);
    expect(calculateFantasyPoints(line, { ...DEFAULT_LEAGUE_CONFIG.scoring, AST: 3 })).toBeCloseTo(35.4);
  });

  it("assigns multi-position players dynamically and leaves bench position-neutral", () => {
    const custom = config({ rounds: 3, roster: { G: 1, F: 0, C: 1, UTIL: 0, BN: 1, IL: 2, ILPlus: 1 } });
    const result = assignRosterSlots([player("multi", 20, ["G", "C"]), player("guard", 20, ["G"]), player("unknown", 20, [])], custom);
    expect(result.isLegal).toBe(true);
    expect(result.assignments.find((entry) => entry.playerId === "unknown")?.slot).toBe("BN");
  });

  it("imports old V3 newcomer arrays and validates ordered ranges", () => {
    const old = { schemaVersion: 3, overrides: [{ playerId: "r", classification: "Rookie", expectedNbaMinutes: 12 }] };
    expect(validateNewPlayerOverrides(old)[0].expectedNbaMinutes).toBe(12);
    expect(() => validateNewPlayerOverrides([{ playerId: "r", classification: "Rookie", expectedNbaMinutesLow: 20, expectedNbaMinutesBase: 15, expectedNbaMinutesHigh: 25 }])).toThrow(/low <= base <= high/);
  });

  it("keeps stash players at zero MPG and zero production", () => {
    const rookie = { ...player("stash"), historicalStats: [] };
    const metrics = projectNewPlayer(rookie, { playerId: "stash", classification: "International newcomer", nbaAvailabilityStatus: "Overseas / stash", expectedNbaMinutes: 20 });
    expect(metrics.projection.projectedMinutes).toBe(0);
    expect(metrics.projection.projectedFantasyPointsPerGame).toBe(0);
    expect(metrics.projection.projectedMinutesLow).toBe(0);
  });

  it("decays old draft capital and keeps Summer League a low-weight signal", () => {
    expect(calculateDraftCapitalSignal({ playerId: "a", classification: "Rookie", nbaDraftPick: 1, nbaDraftYear: 2022 }, 2026)).toBeLessThan(calculateDraftCapitalSignal({ playerId: "b", classification: "Rookie", nbaDraftPick: 1, nbaDraftYear: 2026 }, 2026));
    const rookie = { ...player("summer"), historicalStats: [] };
    const base = projectNewPlayer(rookie, { playerId: "summer", classification: "Rookie", expectedNbaMinutes: 20 });
    const summer = projectNewPlayer(rookie, { playerId: "summer", classification: "Rookie", expectedNbaMinutes: 20, summerLeagueGames: 8, summerLeagueMinutesPerGame: 24, summerLeaguePointsPerGame: 50 });
    expect(summer.projection.projectedPoints - base.projection.projectedPoints).toBeLessThan(5);
  });

  it("uses manual positions before NBA fallback and keeps unknown neutral", () => {
    const fallback = applyNbaPositionFallbacks([{ ...player("p", 20, []), nbaPosition: "Forward-Center" }, { ...player("u", 20, []), nbaPosition: null }]);
    expect(fallback[0]).toMatchObject({ yahooPositions: ["F", "C"], positionSource: "NBA fallback" });
    expect(fallback[1].positionSource).toBe("unknown");
    expect(mergePlayerOverrides(fallback, [{ playerId: "p", yahooPositions: ["G"], notes: "manual" }])[0]).toMatchObject({ yahooPositions: ["G"], positionSource: "manual Yahoo" });
  });

  it("interpolates weights smoothly and keeps them normalized", () => {
    const a = getRecommendationWeightsForProgress(0.49);
    const b = getRecommendationWeightsForProgress(0.5);
    expect(Math.max(...Object.keys(a).map((key) => Math.abs(a[key as keyof typeof a] - b[key as keyof typeof b])))).toBeLessThan(0.01);
    expect(Object.values(b).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it("returns exactly Top 5, excludes drafted players, and keeps production dominant", () => {
    const players = Array.from({ length: 8 }, (_, index) => player(String(index), 50 - index * 5, index ? ["C"] : ["G"]));
    const result = rankPlayers({ players, draftedPlayerIds: ["1"], myRoster: [], currentRound: 1, currentOverallPick: 10, leagueConfig: DEFAULT_LEAGUE_CONFIG });
    expect(result.topRecommendations).toHaveLength(5);
    expect(result.recommendations.some((entry) => entry.player.id === "1")).toBe(false);
    expect(result.recommendations.findIndex((entry) => entry.player.id === "0")).toBeLessThan(result.recommendations.findIndex((entry) => entry.player.id === "7"));
    expect(result.recommendations[0].tierDropoffExplanation.length).toBeGreaterThan(0);
  });

  it("detects recent position runs without treating them as a primary score", () => {
    const guard = player("g");
    const picks = Array.from({ length: 12 }, (_, index) => ({ overallPick: index + 1, round: 1, pickInRound: index + 1, teamNumber: index + 1, playerId: "g", isMyTeam: false }));
    const run = calculateRecentPositionRuns(picks, [guard]);
    expect(run.G.label).toBe("Strong run");
    expect(RECOMMENDATION_RUN_WEIGHT()).toBeLessThan(0.1);
  });

  it("raises survival urgency when more selections happen before the next user pick", () => {
    const players = Array.from({ length: 20 }, (_, index) => player(String(index), 40 - index));
    const far = rankPlayers({ players, draftedPlayerIds: [], myRoster: [], currentRound: 1, currentOverallPick: 10 }).recommendations[5];
    const near = rankPlayers({ players, draftedPlayerIds: [], myRoster: [], currentRound: 2, currentOverallPick: 22 }).recommendations[5];
    expect(far.urgencyScore).toBeGreaterThan(near.urgencyScore);
  });

  it("changes veteran projections when league scoring changes", () => {
    const candidate = player("v");
    const normal = projectPlayerForRecommendations(candidate)!;
    const assistHeavy = projectPlayerForRecommendations(candidate, undefined, undefined, config({ scoring: { ...DEFAULT_LEAGUE_CONFIG.scoring, AST: 5 } }))!;
    expect(assistHeavy.projection.projectedFantasyPointsPerGame).toBeGreaterThan(normal.projection.projectedFantasyPointsPerGame);
  });

  it("round-trips a complete backup and rejects invalid input before restore", () => {
    const parts = { leagueConfig: DEFAULT_LEAGUE_CONFIG, draftState: createInitialDraftState(), playerOverrides: [], newPlayerOverrides: [], injurySnapshot: { schemaVersion: 1, generatedAt: "2026-09-09T00:00:00Z", season: "2026-27", entries: [] } };
    const backup = createDraftDayBackup(parts, "2026-09-09T00:00:00Z");
    expect(validateDraftDayBackup(backup, new Set())).toEqual(backup);
    const invalid = structuredClone(backup) as DraftDayBackup;
    invalid.draftState.currentOverallPick = 2;
    expect(() => validateDraftDayBackup(invalid, new Set())).toThrow();
    expect(backup.draftState.currentOverallPick).toBe(1);
  });

  it("flags suspicious current-injury return dates", () => {
    expect(getSuspiciousReturnDateWarnings([{ ...player("h"), expectedReturnDate: "2027-01-01" }], new Date("2026-09-09T00:00:00Z"))).toHaveLength(1);
  });
});

function RECOMMENDATION_RUN_WEIGHT(): number {
  return getRecommendationWeightsForProgress(0.5).recentRun;
}
