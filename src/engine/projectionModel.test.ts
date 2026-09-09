import { describe, expect, it } from "vitest";

import type { HistoricalStats, Player } from "../types";
import { calculateFantasyPoints } from "./fantasyPoints";
import {
  calculateCurrentInjuryPenalty,
  calculateHistoricalAvailabilityRisk,
  calculateModelConfidence,
  combineAvailabilityRisks,
  projectPlayerProduction,
} from "./projectionModel";

function season(
  seasonName: string,
  overrides: Partial<HistoricalStats> = {},
): HistoricalStats {
  return {
    season: seasonName,
    gamesPlayed: 70,
    minutesPerGame: 30,
    points: 18,
    offensiveRebounds: 1.5,
    defensiveRebounds: 4.5,
    assists: 5,
    steals: 1,
    blocks: 0.5,
    turnovers: 2,
    ...overrides,
  };
}

function player(
  historicalStats: HistoricalStats[],
  overrides: Partial<Player> = {},
): Player {
  return {
    id: "test-player",
    name: "Test Player",
    nbaTeam: "TST",
    yahooPositions: ["G"],
    age: 25,
    injuryStatus: null,
    expectedReturnDate: null,
    historicalStats,
    projections: null,
    injuryRisk: null,
    opportunityScore: null,
    breakoutScore: null,
    ...overrides,
  };
}

describe("projectPlayerProduction", () => {
  it("uses 60/25/15 recency weights for projected games", () => {
    const result = projectPlayerProduction(
      player([
        season("2023-24", { gamesPlayed: 60 }),
        season("2024-25", { gamesPlayed: 70 }),
        season("2025-26", { gamesPlayed: 82 }),
      ]),
    );

    expect(result?.projection.projectedGames).toBeCloseTo(75.7);
  });

  it("projects production from per-minute rates and trended minutes", () => {
    const result = projectPlayerProduction(
      player([
        season("2024-25", { minutesPerGame: 15, points: 9 }),
        season("2025-26", { minutesPerGame: 30, points: 15 }),
      ]),
    );

    expect(result).not.toBeNull();
    expect(result!.projection.projectedMinutes).toBeGreaterThan(25);
    expect(result!.projection.projectedPoints).not.toBeCloseTo(13.5);
    expect(
      result!.projection.projectedPoints /
        result!.projection.projectedMinutes,
    ).toBeGreaterThan(0.5);
  });

  it("uses the league utility for projected fantasy points", () => {
    const result = projectPlayerProduction(player([season("2025-26")]))!;
    const projection = result.projection;

    expect(projection.projectedFantasyPointsPerGame).toBeCloseTo(
      calculateFantasyPoints({
        points: projection.projectedPoints,
        offensiveRebounds: projection.projectedOffensiveRebounds,
        defensiveRebounds: projection.projectedDefensiveRebounds,
        assists: projection.projectedAssists,
        steals: projection.projectedSteals,
        blocks: projection.projectedBlocks,
        turnovers: projection.projectedTurnovers,
        doubleDoubles:
          projection.projectedDoubleDoubles / projection.projectedGames,
        tripleDoubles:
          projection.projectedTripleDoubles / projection.projectedGames,
      }),
    );
  });

  it("returns no projection rather than fabricating missing history", () => {
    expect(projectPlayerProduction(player([]))).toBeNull();
  });
});

describe("availability and confidence", () => {
  it("assigns healthy players risk from games-played history", () => {
    const durableRisk = calculateHistoricalAvailabilityRisk([
      season("2024-25", { gamesPlayed: 78 }),
      season("2025-26", { gamesPlayed: 80 }),
    ]);
    const repeatedLowGamesRisk = calculateHistoricalAvailabilityRisk([
      season("2024-25", { gamesPlayed: 38 }),
      season("2025-26", { gamesPlayed: 42 }),
    ]);

    expect(durableRisk).toBeGreaterThan(0);
    expect(repeatedLowGamesRisk).toBeGreaterThan(durableRisk);
  });

  it("applies status risk while allowing a near return date to moderate it", () => {
    const asOfDate = new Date("2026-10-01T00:00:00Z");
    const injuredWithoutDate = calculateCurrentInjuryPenalty(
      "Injured",
      null,
      asOfDate,
    );
    const injuredReturningSoon = calculateCurrentInjuryPenalty(
      "Injured",
      "2026-10-08",
      asOfDate,
    );

    expect(calculateCurrentInjuryPenalty("Healthy", null, asOfDate)).toBe(0);
    expect(calculateCurrentInjuryPenalty("Unknown", null, asOfDate)).toBe(0);
    expect(injuredWithoutDate).toBeGreaterThan(0.25);
    expect(injuredReturningSoon).toBeLessThan(injuredWithoutDate);
  });

  it("uses proportionate penalties across current injury statuses", () => {
    const asOfDate = new Date("2026-10-01T00:00:00Z");
    const healthy = calculateCurrentInjuryPenalty("Healthy", null, asOfDate);
    const dayToDay = calculateCurrentInjuryPenalty("Day-to-day", null, asOfDate);
    const returningSoon = calculateCurrentInjuryPenalty(
      "Returning soon",
      null,
      asOfDate,
    );
    const injured = calculateCurrentInjuryPenalty("Injured", null, asOfDate);

    expect(healthy).toBe(0);
    expect(dayToDay).toBeGreaterThan(healthy);
    expect(returningSoon).toBeGreaterThan(dayToDay);
    expect(injured).toBeGreaterThan(returningSoon);
  });

  it("moderates near returns and penalizes distant and unknown returns", () => {
    const asOfDate = new Date("2026-10-01T00:00:00Z");
    const near = calculateCurrentInjuryPenalty(
      "Out",
      "2026-10-08",
      asOfDate,
      null,
      "high",
    );
    const distant = calculateCurrentInjuryPenalty(
      "Out",
      "2027-02-01",
      asOfDate,
      null,
      "high",
    );
    const unknown = calculateCurrentInjuryPenalty(
      "Out",
      null,
      asOfDate,
      null,
      "unknown",
    );
    const guided = calculateCurrentInjuryPenalty(
      "Out",
      null,
      asOfDate,
      "Expected around the start of the season",
      "medium",
    );

    expect(near).toBeLessThan(distant);
    expect(near).toBeLessThan(unknown);
    expect(guided).toBeLessThan(unknown);
  });

  it("caps and overlaps historical and current risk instead of blindly stacking", () => {
    const historicalRisk = 0.7;
    const currentRisk = 0.5;
    const combined = combineAvailabilityRisks(historicalRisk, currentRisk);

    expect(combined).toBeLessThan(historicalRisk + currentRisk);
    expect(combined).toBeLessThanOrEqual(0.75);
    expect(combined).toBeGreaterThanOrEqual(historicalRisk);
  });

  it("gives a deep, stable sample more confidence than one tiny season", () => {
    const deepSample = player([
      season("2023-24", { gamesPlayed: 75 }),
      season("2024-25", { gamesPlayed: 76 }),
      season("2025-26", { gamesPlayed: 74 }),
    ]);
    const tinySample = player([
      season("2025-26", {
        gamesPlayed: 4,
        minutesPerGame: 3,
      }),
    ]);

    expect(calculateModelConfidence(deepSample)).toBeGreaterThan(
      calculateModelConfidence(tinySample, true),
    );
  });
});
