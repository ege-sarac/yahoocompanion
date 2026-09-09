import { describe, expect, it } from "vitest";

import type {
  HistoricalStats,
  NewPlayerProjectionInput,
  Player,
} from "../types";
import {
  calculateDraftCapitalSignal,
  classifyNewPlayer,
  estimateNewPlayerMinutes,
  hasUsableNbaHistory,
  projectNewPlayer,
  projectPlayerForRecommendations,
} from "./newPlayerProjection";
import { projectPlayerProduction } from "./projectionModel";

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: "new-1",
    name: "New Player",
    nbaTeam: "TST",
    nbaPosition: "F",
    nbaExperience: "R",
    isRookie: true,
    yahooPositions: ["F"],
    age: 19,
    injuryStatus: "Healthy",
    expectedReturnDate: null,
    historicalStats: [],
    projections: null,
    injuryRisk: null,
    opportunityScore: null,
    breakoutScore: null,
    ...overrides,
  };
}

function input(
  overrides: Partial<NewPlayerProjectionInput> = {},
): NewPlayerProjectionInput {
  return {
    playerId: "new-1",
    classification: "Rookie",
    ...overrides,
  };
}

function fullPreviousInput(
  previousLeague: NewPlayerProjectionInput["previousLeague"] = "NCAA",
): NewPlayerProjectionInput {
  return input({
    nbaDraftYear: 2026,
    nbaDraftRound: 1,
    nbaDraftPick: 3,
    previousLeague,
    previousGames: 32,
    previousMinutesPerGame: 30,
    previousPointsPerGame: 20,
    previousOffensiveReboundsPerGame: 2,
    previousDefensiveReboundsPerGame: 6,
    previousAssistsPerGame: 5,
    previousStealsPerGame: 1.5,
    previousBlocksPerGame: 1,
    previousTurnoversPerGame: 2.5,
    expectedNbaMinutes: 30,
    roleExpectation: "Likely starter",
  });
}

function veteranSeason(): HistoricalStats {
  return {
    season: "2025-26",
    gamesPlayed: 72,
    minutesPerGame: 30,
    points: 20,
    offensiveRebounds: 1,
    defensiveRebounds: 5,
    assists: 5,
    steals: 1,
    blocks: 0.5,
    turnovers: 2,
  };
}

describe("new-player routing and classification", () => {
  it("routes zero-history players to the new-player model", () => {
    const candidate = player();
    const metrics = projectPlayerForRecommendations(candidate);

    expect(hasUsableNbaHistory(candidate)).toBe(false);
    expect(metrics?.projectionSource).toBe("Rookie/new-player model");
  });

  it("classifies official experience R as Rookie", () => {
    expect(classifyNewPlayer(player()).classification).toBe("Rookie");
    expect(classifyNewPlayer(player()).confidence).toBe("high");
  });

  it("classifies positive official experience as a returning veteran", () => {
    const result = classifyNewPlayer(
      player({ nbaExperience: "5", isRookie: false, age: 31 }),
    );
    expect(result.classification).toBe("Returning NBA veteran");
  });

  it("keeps classification unknown when official evidence is unclear", () => {
    const result = classifyNewPlayer(
      player({ nbaExperience: null, isRookie: null }),
    );
    expect(result).toMatchObject({ classification: "Unknown", confidence: "low" });
  });
});

describe("expected minutes and draft capital", () => {
  it("gives manual expected MPG precedence over role and draft capital", () => {
    const result = estimateNewPlayerMinutes(
      player(),
      input({
        expectedNbaMinutes: 27,
        roleExpectation: "Bench",
        nbaDraftPick: 1,
      }),
    );
    expect(result.minutes).toBe(27);
    expect(result.source).toBe("manual expected NBA MPG");
  });

  it("uses the configured role range when no manual MPG exists", () => {
    const starter = estimateNewPlayerMinutes(
      player(),
      input({ roleExpectation: "Likely starter" }),
    );
    const bench = estimateNewPlayerMinutes(
      player(),
      input({ roleExpectation: "Bench" }),
    );
    expect(starter.minutes).toBeGreaterThanOrEqual(28);
    expect(starter.minutes).toBeLessThanOrEqual(32);
    expect(bench.minutes).toBeLessThan(starter.minutes);
  });

  it("uses draft capital as an opportunity signal", () => {
    const topFive = input({ nbaDraftPick: 3 });
    const secondRound = input({ nbaDraftPick: 45 });
    expect(calculateDraftCapitalSignal(topFive)).toBeGreaterThan(
      calculateDraftCapitalSignal(secondRound),
    );
    expect(estimateNewPlayerMinutes(player(), topFive).minutes).toBeGreaterThan(
      estimateNewPlayerMinutes(player(), secondRound).minutes,
    );
  });
});

describe("previous-league translation and sample protection", () => {
  it("uses distinct NCAA, international, G League, and prior-NBA translations", () => {
    const ncaa = projectNewPlayer(player(), fullPreviousInput("NCAA"));
    const international = projectNewPlayer(
      player(),
      fullPreviousInput("International"),
    );
    const gLeague = projectNewPlayer(player(), fullPreviousInput("G League"));
    const priorNba = projectNewPlayer(
      player({ nbaExperience: "3", isRookie: false }),
      { ...fullPreviousInput("Prior NBA"), classification: "Returning NBA veteran" },
    );

    expect(international.projection.projectedPoints).toBeGreaterThan(
      ncaa.projection.projectedPoints,
    );
    expect(gLeague.projection.projectedPoints).toBeGreaterThan(
      international.projection.projectedPoints,
    );
    expect(priorNba.projection.projectedPoints).toBeGreaterThan(
      gLeague.projection.projectedPoints,
    );
  });

  it("regresses an extreme tiny sample harder than a strong sample", () => {
    const tiny = projectNewPlayer(
      player(),
      input({
        previousLeague: "G League",
        previousGames: 2,
        previousMinutesPerGame: 5,
        previousPointsPerGame: 20,
        expectedNbaMinutes: 25,
      }),
    );
    const strong = projectNewPlayer(
      player(),
      input({
        previousLeague: "G League",
        previousGames: 30,
        previousMinutesPerGame: 30,
        previousPointsPerGame: 30,
        expectedNbaMinutes: 25,
      }),
    );

    expect(tiny.newPlayerDetails!.sampleSizeAdjustment).toBeLessThan(0.1);
    expect(tiny.projection.projectedPoints).toBeLessThan(
      strong.projection.projectedPoints,
    );
  });
});

describe("new-player confidence, opportunity, and breakout", () => {
  it("keeps a complete new-player projection below its confidence ceiling", () => {
    const fallback = projectNewPlayer(player());
    const documented = projectNewPlayer(player(), fullPreviousInput());

    expect(documented.modelConfidence).toBeGreaterThan(fallback.modelConfidence);
    expect(documented.modelConfidence).toBeLessThanOrEqual(0.66);
    expect(fallback.modelConfidence).toBeLessThan(0.3);
  });

  it("provides a conservative low-data fallback instead of excluding the player", () => {
    const metrics = projectNewPlayer(player());
    expect(metrics.newPlayerDetails?.usedConservativeFallback).toBe(true);
    expect(metrics.projection.projectedMinutes).toBe(15);
    expect(metrics.projection.projectedFantasyPointsPerGame).toBeGreaterThan(0);
  });

  it("gives 30 expected MPG more opportunity than 12 MPG", () => {
    const high = projectNewPlayer(
      player(),
      input({ expectedNbaMinutes: 30, roleExpectation: "Likely starter" }),
    );
    const low = projectNewPlayer(
      player(),
      input({ expectedNbaMinutes: 12, roleExpectation: "Bench" }),
    );
    expect(high.opportunityScore).toBeGreaterThan(low.opportunityScore);
  });

  it("does not give a returning veteran the rookie youth breakout bonus", () => {
    const shared = {
      expectedNbaMinutes: 24,
      previousLeague: "Prior NBA" as const,
      previousGames: 25,
      previousMinutesPerGame: 24,
      previousPointsPerGame: 16,
      roleExpectation: "Rotation" as const,
    };
    const rookie = projectNewPlayer(player({ age: 19 }), input(shared));
    const returning = projectNewPlayer(
      player({ age: 31, nbaExperience: "5", isRookie: false }),
      input({ ...shared, classification: "Returning NBA veteran", age: 31 }),
    );
    expect(rookie.breakoutScore).toBeGreaterThan(returning.breakoutScore);
  });

  it("leaves the veteran projection pathway unchanged", () => {
    const veteran = player({ historicalStats: [veteranSeason()] });
    const direct = projectPlayerProduction(veteran)!;
    const routed = projectPlayerForRecommendations(veteran)!;
    expect(hasUsableNbaHistory(veteran)).toBe(true);
    expect(routed.projectionSource).toBe("Veteran NBA history");
    expect(routed.projection).toEqual(direct.projection);
  });
});
