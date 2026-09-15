import { describe, expect, it } from "vitest";
import type { ExpectedGamesProjection, Player, PlayerRecommendation, PlayerRoleHistoryRecord, PlayerRoleMetrics, ProjectionMetrics, SeasonValueProjection } from "../types";
import { buildTeamEcosystem } from "./teamEcosystem";
import { buildRoleScenarioSummary } from "./roleOutcomes";
import { calculateEffectiveAbsenceDependency } from "./roleProjection";
import { calculateAvailabilityDownsideGap, calculateAvailabilityTailPenalty, selectLateAlternatives } from "./recommendationEngine";

const projection = (overrides: Partial<ProjectionMetrics["projection"]> = {}): ProjectionMetrics["projection"] => ({
  projectedGames: 68, projectedMinutes: 32, projectedPoints: 18, projectedOffensiveRebounds: 1.4, projectedDefensiveRebounds: 4.6,
  projectedAssists: 4, projectedSteals: 1, projectedBlocks: .6, projectedTurnovers: 2.2, projectedDoubleDoubles: 10,
  projectedTripleDoubles: 1, projectedFantasyPointsPerGame: 34, ...overrides,
});

const player = (id: string, nbaTeam: string, positions: Player["yahooPositions"] = ["G"]): Player => ({
  id, name: id, nbaTeam, yahooPositions: positions, age: 26, injuryStatus: "Healthy", expectedReturnDate: null,
  historicalStats: [], projections: projection(), injuryRisk: .15, opportunityScore: 55, breakoutScore: 50,
});

const metrics = (overrides: Partial<ProjectionMetrics["projection"]> = {}): ProjectionMetrics => ({
  projection: projection(overrides), projectionSource: "Veteran NBA history", projectedFantasyPointsPerSeason: 2312,
  availabilityAdjustedFantasyPoints: 2200, historicalAvailabilityRisk: .15, currentInjuryPenalty: 0,
  combinedAvailabilityRisk: .15, modelConfidence: .8, opportunityScore: 55, breakoutScore: 50, usedPerGameFallback: false,
});

const role = (playerId: string, team: string, overrides: Partial<PlayerRoleMetrics> = {}): PlayerRoleMetrics => ({
  playerId, team, season: "2025-26", dataCompleteness: 1, dataSourceFlags: ["NBA Advanced"], ...overrides,
});

function ecosystemFor(channel: "usagePct" | "assistPct" | "totalReboundPct") {
  const target = player("target", "CURRENT", channel === "totalReboundPct" ? ["C"] : ["G"]);
  const currentTeammate = player("current", "CURRENT", channel === "totalReboundPct" ? ["C"] : ["G"]);
  const formerTeammate = player("former", "OTHER", channel === "totalReboundPct" ? ["C"] : ["G"]);
  const map = new Map([
    ["target", role("target", "PRIOR", channel === "usagePct" ? { usagePct: 20 } : channel === "assistPct" ? { assistPct: 16 } : { totalReboundPct: 12 })],
    ["current", role("current", "CURRENT", channel === "usagePct" ? { usagePct: 34 } : channel === "assistPct" ? { assistPct: 42 } : { totalReboundPct: 23 })],
    ["former", role("former", "PRIOR", channel === "usagePct" ? { usagePct: 10 } : channel === "assistPct" ? { assistPct: 8 } : { totalReboundPct: 5 })],
  ]);
  return buildTeamEcosystem([
    { player: target, metrics: metrics(channel === "assistPct" ? { projectedAssists: 7 } : channel === "totalReboundPct" ? { projectedOffensiveRebounds: 3, projectedDefensiveRebounds: 8 } : {}) },
    { player: currentTeammate, metrics: metrics() },
    { player: formerTeammate, metrics: metrics() },
  ], undefined, map);
}

describe("Prompt 10.3 team resource shock", () => {
  it("targets scoring when current usage pressure exceeds the prior context", () => {
    const result = ecosystemFor("usagePct");
    expect(result.contextsByPlayerId.get("target")?.resourceShock?.usage).toBeGreaterThan(0);
    expect(result.metricsByPlayerId.get("target")!.projection.projectedPoints).toBeLessThan(18);
  });

  it("targets assists when current creation pressure exceeds the prior context", () => {
    const result = ecosystemFor("assistPct");
    expect(result.contextsByPlayerId.get("target")?.resourceShock?.creation).toBeGreaterThan(0);
    expect(result.metricsByPlayerId.get("target")!.projection.projectedAssists).toBeLessThan(7);
  });

  it("targets rebounds when current frontcourt pressure exceeds the prior context", () => {
    const result = ecosystemFor("totalReboundPct");
    expect(result.contextsByPlayerId.get("target")?.resourceShock?.rebounding).toBeGreaterThan(0);
    expect(result.metricsByPlayerId.get("target")!.projection.projectedDefensiveRebounds).toBeLessThan(8);
  });
});

describe("Prompt 10.3 absence dependency", () => {
  const record = (gamesWith: number, gamesWithout: number, stillCurrent = true): PlayerRoleHistoryRecord => ({
    playerId: "target", seasons: [], latestSeasonGames: [], regime: { absenceDependencyScore: .9 } as PlayerRoleHistoryRecord["regime"],
    teammateDependencies: [{ teammatePlayerId: "teammate", gamesWith, gamesWithout, roleChangeWhenAbsent: 4, dependencyScore: .9, teammateStillOnCurrentTeam: stillCurrent }],
  });

  it("shrinks a dependency when either absence state has fewer than eight games", () => {
    expect(calculateEffectiveAbsenceDependency(record(4, 8), record(4, 8).regime)).toBeLessThan(.9);
  });

  it("drops a dependency for a teammate who is no longer on the current team", () => {
    expect(calculateEffectiveAbsenceDependency(record(12, 12, false), record(12, 12, false).regime)).toBe(0);
  });

  it("reduces the high-role scenario when a role gain depends on teammate absence", () => {
    const seasonValue: SeasonValueProjection = { replacementFantasyPointsPerGame: 25, perGameVorp: 9, seasonVorp: 612, availabilityAdjustedFantasyPointsEquivalent: 612, projectedTotalFantasyPoints: 2312 };
    const input = { player: player("target", "CURRENT"), metrics: metrics(), seasonValue, draftProgress: .7 };
    const stable = buildRoleScenarioSummary({ ...input, roleContextSummary: { adjustmentPercent: 0, roleSustainability: .7, lateSeasonMinutesChange: 4, roleReasons: [] } });
    const dependent = buildRoleScenarioSummary({ ...input, roleContextSummary: { adjustmentPercent: 0, roleSustainability: .7, lateSeasonMinutesChange: 4, absenceDependencyScore: .9, roleReasons: [] } });
    expect(dependent.scenarios[2].probability).toBeLessThan(stable.scenarios[2].probability);
    expect(dependent.scenarios[1].healthyGameMPG).toBeLessThan(stable.scenarios[1].healthyGameMPG);
  });
});

describe("Prompt 10.3 availability tail risk", () => {
  const seasonValue: SeasonValueProjection = { replacementFantasyPointsPerGame: 24, perGameVorp: 12, seasonVorp: 720, availabilityAdjustedFantasyPointsEquivalent: 720, projectedTotalFantasyPoints: 2600 };
  const uncertain: ExpectedGamesProjection = { expectedGamesLow: 26, expectedGames: 60, expectedGamesHigh: 75, availabilityConfidence: .3, availabilityRiskLabel: "HIGH RISK", currentHealthVerified: true, reasons: [] };

  it("detects the low-games season-value downside without changing the season projection", () => {
    expect(calculateAvailabilityDownsideGap(seasonValue, uncertain)).toBeGreaterThan(0);
  });

  it("makes the tail penalty materially smaller later in the draft", () => {
    const gap = calculateAvailabilityDownsideGap(seasonValue, uncertain);
    expect(calculateAvailabilityTailPenalty(gap, uncertain, .1)).toBeGreaterThan(calculateAvailabilityTailPenalty(gap, uncertain, .9));
  });
});

describe("Prompt 10.3 late-draft alternatives", () => {
  const recommendation = (id: string, score: number, upside = 0, opportunity = 50, urgency = 0, confidence = .7) => ({
    player: { id, name: id, yahooPositions: ["G"] }, finalScore: score, breakoutScore: upside,
    roleScenarioSummary: { optionScoreAdjustment: upside, roleSustainability: opportunity / 100 },
    opportunityScore: opportunity, marketTiming: { draftNowUrgency: urgency }, expectedGamesProjection: { availabilityConfidence: confidence },
  }) as PlayerRecommendation;
  const pool = Array.from({ length: 12 }, (_, index) => recommendation(`rank-${index + 1}`, 120 - index, index === 10 ? 99 : 0));
  const top = pool.slice(0, 5);

  it("returns ranks six through nine after a five-player primary display", () => {
    expect(selectLateAlternatives(pool, top, 4).map((item) => item.recommendation.player.id)).toEqual(["rank-6", "rank-7", "rank-8", "rank-9"]);
  });

  it("does not let a lower-ranked upside archetype replace the next-best candidates", () => {
    const alternatives = selectLateAlternatives(pool, top, 4);
    expect(alternatives.map((item) => pool.indexOf(item.recommendation) + 1)).toEqual([6, 7, 8, 9]);
    expect(alternatives.some((item) => item.recommendation.player.id === "rank-11")).toBe(false);
  });

  it("does not let continuity history displace a better-ranked visible candidate", () => {
    const primary = pool.slice(0, 5);
    expect(selectLateAlternatives(pool, primary, 2).map((item) => item.recommendation.player.id)).toEqual(["rank-6", "rank-7"]);
  });
});
