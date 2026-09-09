import { describe, expect, it } from "vitest";

import type {
  HistoricalStats,
  NewPlayerProjectionInput,
  Player,
} from "../types";
import {
  getRecommendationWeights,
  rankPlayers,
} from "./recommendationEngine";
import {
  calculateFlexibilityScore,
  calculateRosterFitScore,
  getRosterCoverage,
} from "./rosterFit";
import {
  calculatePlayerScarcityScore,
  calculatePositionScarcity,
} from "./scarcity";

function makePlayer(
  id: string,
  points: number,
  positions: Player["yahooPositions"] = [],
  overrides: Partial<Player> = {},
): Player {
  const historicalStats: HistoricalStats[] = [
    {
      season: "2025-26",
      gamesPlayed: 72,
      minutesPerGame: 30,
      points,
      offensiveRebounds: 1,
      defensiveRebounds: 4,
      assists: 4,
      steals: 1,
      blocks: 0.5,
      turnovers: 2,
    },
  ];
  return {
    id,
    name: `Player ${id}`,
    nbaTeam: "TST",
    yahooPositions: positions,
    age: 25,
    injuryStatus: "Healthy",
    expectedReturnDate: null,
    historicalStats,
    projections: null,
    injuryRisk: null,
    opportunityScore: null,
    breakoutScore: null,
    ...overrides,
  };
}

describe("roster fit", () => {
  it("counts overlapping eligibility for every covered group", () => {
    const roster = [makePlayer("gf", 15, ["G", "F"]), makePlayer("fc", 15, ["F", "C"])];

    expect(getRosterCoverage(roster)).toEqual({ G: 1, F: 2, C: 1 });
    expect(calculateFlexibilityScore(roster[0])).toBeGreaterThan(
      calculateFlexibilityScore(makePlayer("g", 15, ["G"])),
    );
  });

  it("softly favors a candidate at an uncovered position", () => {
    const guardHeavyRoster = Array.from({ length: 6 }, (_, index) =>
      makePlayer(`g-${index}`, 15, ["G"]),
    );

    expect(
      calculateRosterFitScore(makePlayer("center", 15, ["C"]), guardHeavyRoster),
    ).toBeGreaterThan(
      calculateRosterFitScore(makePlayer("guard", 15, ["G"]), guardHeavyRoster),
    );
  });
});

describe("scarcity", () => {
  it("scores a thin position above an abundant position", () => {
    const candidates = [
      ...Array.from({ length: 8 }, (_, index) => ({
        player: makePlayer(`g-${index}`, 25 - index, ["G"]),
        projectedFantasyPointsPerGame: 45 - index,
      })),
      {
        player: makePlayer("c-only", 22, ["C"]),
        projectedFantasyPointsPerGame: 42,
      },
    ];
    const scarcity = calculatePositionScarcity(candidates);

    expect(scarcity.C.score).toBeGreaterThan(scarcity.G.score);
    expect(
      calculatePlayerScarcityScore(candidates[8].player, scarcity),
    ).toBe(scarcity.C.score);
  });
});

describe("round-aware ranking", () => {
  it("shifts weight from raw production toward fit and upside later", () => {
    const early = getRecommendationWeights(3);
    const late = getRecommendationWeights(13);

    expect(early.projectedValue).toBeGreaterThan(late.projectedValue);
    expect(late.rosterFit).toBeGreaterThan(early.rosterFit);
    expect(late.breakout).toBeGreaterThan(early.breakout);
    expect(Object.values(early).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(Object.values(late).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it("excludes drafted players", () => {
    const best = makePlayer("best", 30, ["G"]);
    const next = makePlayer("next", 20, ["F"]);
    const result = rankPlayers({
      players: [best, next],
      draftedPlayerIds: [best.id],
      myRoster: [],
      currentRound: 1,
    });

    expect(result.recommendations.map(({ player }) => player.id)).toEqual([
      next.id,
    ]);
  });

  it("ranks stronger controlled production first", () => {
    const result = rankPlayers({
      players: [
        makePlayer("bench", 8, ["G"]),
        makePlayer("star", 28, ["G"]),
        makePlayer("starter", 18, ["F"]),
      ],
      draftedPlayerIds: [],
      myRoster: [],
      currentRound: 1,
    });

    expect(result.recommendations[0].player.id).toBe("star");
    expect(result.recommendations.at(-1)?.player.id).toBe("bench");
  });

  it("respects low-confidence newcomer uncertainty in early rounds", () => {
    const veteran = makePlayer("veteran-star", 28, ["F"]);
    const newcomer = makePlayer("newcomer", 0, ["F"], {
      historicalStats: [],
      nbaExperience: "R",
      isRookie: true,
      age: 19,
    });
    const result = rankPlayers({
      players: [newcomer, veteran],
      draftedPlayerIds: [],
      myRoster: [],
      currentRound: 2,
    });

    expect(result.recommendations[0].player.id).toBe("veteran-star");
    expect(result.newPlayerModelCount).toBe(1);
    expect(result.excludedForNoHistory).toBe(0);
  });

  it("increases the relative influence of newcomer upside late", () => {
    const veteran = makePlayer("steady", 18, ["F"]);
    const newcomer = makePlayer("upside", 0, ["F"], {
      historicalStats: [],
      nbaExperience: "R",
      isRookie: true,
      age: 19,
    });
    const metadata: NewPlayerProjectionInput = {
      playerId: "upside",
      classification: "Rookie",
      nbaDraftRound: 1,
      nbaDraftPick: 4,
      previousLeague: "NCAA",
      previousGames: 30,
      previousMinutesPerGame: 30,
      previousPointsPerGame: 20,
      previousOffensiveReboundsPerGame: 2,
      previousDefensiveReboundsPerGame: 6,
      previousAssistsPerGame: 5,
      previousStealsPerGame: 1.5,
      previousBlocksPerGame: 1,
      previousTurnoversPerGame: 2.5,
      expectedNbaMinutes: 28,
      roleExpectation: "Likely starter",
    };
    const early = rankPlayers({
      players: [veteran, newcomer],
      draftedPlayerIds: [],
      myRoster: [],
      currentRound: 3,
      newPlayerInputs: [metadata],
    });
    const late = rankPlayers({
      players: [veteran, newcomer],
      draftedPlayerIds: [],
      myRoster: [],
      currentRound: 13,
      newPlayerInputs: [metadata],
    });
    const relativeScore = (result: typeof early) => {
      const rookieScore = result.recommendations.find(
        ({ player }) => player.id === "upside",
      )!.finalScore;
      const veteranScore = result.recommendations.find(
        ({ player }) => player.id === "steady",
      )!.finalScore;
      return rookieScore - veteranScore;
    };

    expect(relativeScore(late)).toBeGreaterThan(relativeScore(early));
  });
});
