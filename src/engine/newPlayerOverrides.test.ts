import { describe, expect, it } from "vitest";

import {
  prepareNewPlayerOverridesImport,
  validateNewPlayerOverrides,
} from "./newPlayerOverrides";

const valid = {
  playerId: "1",
  classification: "Rookie",
  age: 19,
  nbaDraftYear: 2026,
  nbaDraftRound: 1,
  nbaDraftPick: 4,
  previousLeague: "NCAA",
  previousGames: 32,
  previousMinutesPerGame: 30,
  previousPointsPerGame: 20,
  expectedNbaMinutes: 28,
  roleExpectation: "Likely starter",
  notes: "Optional context",
};

describe("new-player override validation", () => {
  it("accepts valid partial metadata", () => {
    expect(validateNewPlayerOverrides([valid], new Set(["1"]))[0]).toMatchObject(
      valid,
    );
  });

  it("rejects malformed enums, ranges, negatives, IDs, and duplicates", () => {
    expect(() =>
      validateNewPlayerOverrides([{ ...valid, classification: "Prospect" }]),
    ).toThrow("classification");
    expect(() =>
      validateNewPlayerOverrides([{ ...valid, previousLeague: "EuroLeague" }]),
    ).toThrow("previous league");
    expect(() =>
      validateNewPlayerOverrides([{ ...valid, expectedNbaMinutes: -1 }]),
    ).toThrow("expectedNbaMinutes");
    expect(() =>
      validateNewPlayerOverrides([{ ...valid, nbaDraftPick: 61 }]),
    ).toThrow("nbaDraftPick");
    expect(() => validateNewPlayerOverrides([valid], new Set(["2"]))).toThrow(
      "Unknown player ID",
    );
    expect(() => validateNewPlayerOverrides([valid, valid])).toThrow("Duplicate");
  });

  it("preserves the previous value when import preparation throws", () => {
    const current = validateNewPlayerOverrides([valid]);
    expect(() =>
      prepareNewPlayerOverridesImport(
        current,
        [{ ...valid, roleExpectation: "Superstar" }],
        new Set(["1"]),
      ),
    ).toThrow("role expectation");
    expect(current).toHaveLength(1);
    expect(current[0].nbaDraftPick).toBe(4);
  });
});
