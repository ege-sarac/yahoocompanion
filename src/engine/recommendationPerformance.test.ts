import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { Player } from "../types";
import { matchesPlayerName } from "./textSearch";
import { analyzeCandidateFeasibility, analyzeRosterFeasibility } from "./rosterFeasibility";
import { rankPlayers } from "./recommendationEngine";

function player(id: string, position: "G" | "F" | "C", points: number): Player {
  return { id, name: id, nbaTeam: `T-${position}`, yahooPositions: [position], positionSource: "manual Yahoo", age: 25, injuryStatus: "Healthy", expectedReturnDate: null, historicalStats: [{ season: "2025-26", gamesPlayed: 70, minutesPerGame: 30, points, offensiveRebounds: 1, defensiveRebounds: 4, assists: position === "G" ? 6 : 2, steals: 1, blocks: position === "C" ? 1.5 : .3, turnovers: 2 }], projections: null, injuryRisk: null, opportunityScore: null, breakoutScore: null };
}

const players = [player("Alpha Guard", "G", 25), player("Bravo Forward", "F", 22), player("Charlie Center", "C", 21), player("Delta Guard", "G", 18), player("Echo Forward", "F", 17), player("Foxtrot Center", "C", 16)];
const baseInput = { players, draftedPlayerIds: [] as string[], myRoster: [] as Player[], currentRound: 3, currentOverallPick: 35, leagueConfig: DEFAULT_LEAGUE_CONFIG };

describe("recommendation performance regression", () => {
  it("keeps search text outside the expensive Draft recommendation dependencies", () => {
    const source = readFileSync(resolve("src/pages/DraftPage.tsx"), "utf8");
    const memoStart = source.indexOf("const draftRecommendationResult = useMemo");
    const memoEnd = source.indexOf("const topDraftRecommendations", memoStart);
    const memo = source.slice(memoStart, memoEnd);
    expect(memo).not.toContain("query");
    expect(memo).not.toContain("currentInfo,");
    expect(memo).toContain("currentRound");
  });

  it("search filtering does not change cached recommendation output", () => {
    const ranking = rankPlayers(baseInput);
    for (const query of ["a", "al", "alp", "alpha", "center"]) players.filter((candidate) => matchesPlayerName(candidate.name, query));
    expect(rankPlayers(baseInput).recommendations.map((entry) => [entry.player.id, entry.finalScore])).toEqual(ranking.recommendations.map((entry) => [entry.player.id, entry.finalScore]));
  });

  it("a draft pick and manual unavailable change the recommendation pool", () => {
    const initial = rankPlayers(baseInput);
    const selected = initial.topRecommendations[0].player;
    expect(rankPlayers({ ...baseInput, draftedPlayerIds: [selected.id] }).recommendations.some((entry) => entry.player.id === selected.id)).toBe(false);
    expect(rankPlayers({ ...baseInput, manualUnavailablePlayerIds: [selected.id] }).recommendations.some((entry) => entry.player.id === selected.id)).toBe(false);
  });

  it("scoring configuration still changes projections and ranking inputs", () => {
    const normal = rankPlayers(baseInput).recommendations.find((entry) => entry.player.id === "Alpha Guard")!;
    const assistHeavy = rankPlayers({ ...baseInput, leagueConfig: { ...DEFAULT_LEAGUE_CONFIG, scoring: { ...DEFAULT_LEAGUE_CONFIG.scoring, AST: 4 } } }).recommendations.find((entry) => entry.player.id === "Alpha Guard")!;
    expect(assistHeavy.projection.projectedFantasyPointsPerGame).toBeGreaterThan(normal.projection.projectedFantasyPointsPerGame);
  });

  it("optimized candidate feasibility equals the uncached calculation", () => {
    const roster = [player("G1", "G", 10), player("G2", "G", 10), player("G3", "G", 10), player("F1", "F", 10), player("F2", "F", 10)];
    const pool = [player("C1", "C", 10), player("C2", "C", 10), player("X", "G", 10)];
    const base = analyzeRosterFeasibility(roster, 2, pool);
    expect(analyzeCandidateFeasibility(roster, pool[0], 2, pool, DEFAULT_LEAGUE_CONFIG, base)).toEqual(analyzeCandidateFeasibility(roster, pool[0], 2, pool));
    expect(analyzeCandidateFeasibility(roster, pool[2], 2, pool, DEFAULT_LEAGUE_CONFIG, base)).toEqual(analyzeCandidateFeasibility(roster, pool[2], 2, pool));
  });
});
