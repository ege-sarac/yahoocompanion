import { describe, expect, it } from "vitest";

import type { Player, YahooPosition } from "../types";
import { draftRecommendedPlayer, createInitialDraftState } from "./draftState";
import { assignRosterSlots } from "./rosterAssignment";

function player(id: string, positions: YahooPosition[]): Player {
  return {
    id,
    name: id,
    nbaTeam: "TST",
    yahooPositions: positions,
    age: 25,
    injuryStatus: "Healthy",
    expectedReturnDate: null,
    historicalStats: [],
    projections: null,
    injuryRisk: null,
    opportunityScore: null,
    breakoutScore: null,
  };
}

describe("roster assignment", () => {
  it("handles G/F, F/C, and G/F/C players deterministically", () => {
    const roster = [
      player("gf", ["G", "F"]),
      player("fc", ["F", "C"]),
      player("gfc", ["G", "F", "C"]),
      player("g1", ["G"]),
      player("g2", ["G"]),
      player("f1", ["F"]),
      player("c1", ["C"]),
    ];
    const result = assignRosterSlots(roster);

    expect(result.isLegal).toBe(true);
    expect(result.assignments).toHaveLength(7);
    expect(result.assignments.filter(({ slot }) => slot === "G")).toHaveLength(3);
    expect(result.assignments.filter(({ slot }) => slot === "F")).toHaveLength(2);
    expect(result.assignments.filter(({ slot }) => slot === "C")).toHaveLength(2);
  });

  it("fits a complete balanced roster into all configured slots", () => {
    const roster = [
      ...Array.from({ length: 3 }, (_, index) => player(`g${index}`, ["G"])),
      ...Array.from({ length: 2 }, (_, index) => player(`f${index}`, ["F"])),
      ...Array.from({ length: 2 }, (_, index) => player(`c${index}`, ["C"])),
      ...Array.from({ length: 8 }, (_, index) => player(`any${index}`, [])),
    ];
    const result = assignRosterSlots(roster);

    expect(result.isLegal).toBe(true);
    expect(result.assignments).toHaveLength(15);
    expect(result.unassignedPlayerIds).toEqual([]);
  });

  it("detects a roster that cannot cover enough restrictive slots", () => {
    const roster = Array.from({ length: 12 }, (_, index) =>
      player(`g${index}`, ["G"]),
    );
    const result = assignRosterSlots(roster);

    expect(result.isLegal).toBe(false);
    expect(result.unassignedPlayerIds).toHaveLength(1);
    expect(result.insufficientPositions).toEqual(expect.arrayContaining(["C", "F"]));
  });
});

describe("draft recommendation action", () => {
  it("drafts the recommendation and still prevents duplicate selection", () => {
    const state = draftRecommendedPlayer(createInitialDraftState(), "recommended");

    expect(state.picks[0].playerId).toBe("recommended");
    expect(() => draftRecommendedPlayer(state, "recommended")).toThrow(
      "already been drafted",
    );
  });
});
