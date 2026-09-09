import { describe, expect, it } from "vitest";

import type { HistoricalStats, Player, PlayerOverride } from "../types";
import { calculateFlexibilityScore, calculateRosterFitScore } from "./rosterFit";
import {
  mergePlayerOverrides,
  validatePlayerOverrides,
} from "./playerOverrides";
import {
  calculatePlayerScarcityScore,
  calculatePositionScarcity,
} from "./scarcity";
import { rankPlayers } from "./recommendationEngine";

function makePlayer(id: string, positions: Player["yahooPositions"] = []): Player {
  const stats: HistoricalStats = {
    season: "2025-26",
    gamesPlayed: 72,
    minutesPerGame: 30,
    points: 20,
    offensiveRebounds: 1,
    defensiveRebounds: 4,
    assists: 5,
    steals: 1,
    blocks: 0.5,
    turnovers: 2,
  };
  return {
    id,
    name: `Player ${id}`,
    nbaTeam: "TST",
    yahooPositions: positions,
    age: 25,
    injuryStatus: "Healthy",
    expectedReturnDate: null,
    historicalStats: [stats],
    projections: null,
    injuryRisk: null,
    opportunityScore: null,
    breakoutScore: null,
  };
}

function override(
  playerId: string,
  values: Partial<PlayerOverride> = {},
): PlayerOverride {
  return {
    playerId,
    yahooPositions: ["F", "C"],
    injuryStatus: "Healthy",
    expectedReturnDate: null,
    notes: "",
    ...values,
  };
}

describe("player override validation and merge", () => {
  it("validates and merges multi-position eligibility and injury fields", () => {
    const players = [makePlayer("1")];
    const imported = validatePlayerOverrides(
      [
        override("1", {
          yahooPositions: ["G", "F"],
          injuryStatus: "Returning soon",
          expectedReturnDate: "2026-11-03",
          notes: "minutes restriction possible",
        }),
      ],
      new Set(["1"]),
    );
    const merged = mergePlayerOverrides(players, imported)[0];

    expect(merged.yahooPositions).toEqual(["G", "F"]);
    expect(merged.injuryStatus).toBe("Returning soon");
    expect(merged.expectedReturnDate).toBe("2026-11-03");
    expect(merged.notes).toBe("minutes restriction possible");
  });

  it("rejects invalid eligibility, dates, statuses, IDs, and duplicates", () => {
    expect(() =>
      validatePlayerOverrides([
        { ...override("1"), yahooPositions: ["PF"] },
      ]),
    ).toThrow("invalid Yahoo position");
    expect(() =>
      validatePlayerOverrides([
        { ...override("1"), expectedReturnDate: "2026-02-30" },
      ]),
    ).toThrow("malformed return date");
    expect(() =>
      validatePlayerOverrides([
        { ...override("1"), injuryStatus: "Questionable" },
      ]),
    ).toThrow("invalid injury status");
    expect(() =>
      validatePlayerOverrides([override("999")], new Set(["1"])),
    ).toThrow("Unknown player ID");
    expect(() =>
      validatePlayerOverrides([override("1"), override("1")]),
    ).toThrow("Duplicate override");
  });

  it("changes fit, scarcity, and flexibility after an eligibility edit", () => {
    const base = makePlayer("1");
    const edited = mergePlayerOverrides(
      [base],
      [override("1", { yahooPositions: ["F", "C"] })],
    )[0];
    const unknownScarcity = calculatePositionScarcity([
      { player: base, projectedFantasyPointsPerGame: 40 },
    ]);
    const editedScarcity = calculatePositionScarcity([
      { player: edited, projectedFantasyPointsPerGame: 40 },
    ]);

    expect(calculateRosterFitScore(edited, [])).toBeGreaterThan(
      calculateRosterFitScore(base, []),
    );
    expect(calculateFlexibilityScore(edited)).toBeGreaterThan(
      calculateFlexibilityScore(base),
    );
    expect(calculatePlayerScarcityScore(edited, editedScarcity)).toBeGreaterThan(
      calculatePlayerScarcityScore(base, unknownScarcity),
    );
  });

  it("preserves manual eligibility for a zero-history catalog player", () => {
    const noHistoryPlayer = {
      ...makePlayer("rookie"),
      historicalStats: [],
    };
    const merged = mergePlayerOverrides(
      [noHistoryPlayer],
      [override("rookie", { yahooPositions: ["F"] })],
    )[0];

    expect(merged.id).toBe("rookie");
    expect(merged.yahooPositions).toEqual(["F"]);
    expect(merged.historicalStats).toEqual([]);
  });

  it("updates ranking immediately after an injury override", () => {
    const first = makePlayer("a");
    const second = makePlayer("b");
    const initial = rankPlayers({
      players: [first, second],
      draftedPlayerIds: [],
      myRoster: [],
      currentRound: 1,
      asOfDate: new Date("2026-10-01T00:00:00Z"),
    });
    const editedPlayers = mergePlayerOverrides(
      [first, second],
      [override("a", { injuryStatus: "Injured" })],
    );
    const updated = rankPlayers({
      players: editedPlayers,
      draftedPlayerIds: [],
      myRoster: [],
      currentRound: 1,
      asOfDate: new Date("2026-10-01T00:00:00Z"),
    });

    expect(initial.recommendations[0].player.id).toBe("a");
    expect(updated.recommendations[0].player.id).toBe("b");
  });
});
