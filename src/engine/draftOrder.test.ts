import { describe, expect, it } from "vitest";

import {
  getMyOverallPicks,
  getSnakeDraftTeamNumber,
} from "./draftOrder";

describe("getSnakeDraftTeamNumber", () => {
  it("runs forward in odd-numbered rounds", () => {
    expect(getSnakeDraftTeamNumber(1, 16)).toBe(1);
    expect(getSnakeDraftTeamNumber(10, 16)).toBe(10);
    expect(getSnakeDraftTeamNumber(16, 16)).toBe(16);
  });

  it("reverses direction in even-numbered rounds", () => {
    expect(getSnakeDraftTeamNumber(17, 16)).toBe(16);
    expect(getSnakeDraftTeamNumber(23, 16)).toBe(10);
    expect(getSnakeDraftTeamNumber(32, 16)).toBe(1);
  });

  it("continues alternating after round two", () => {
    expect(getSnakeDraftTeamNumber(33, 16)).toBe(1);
    expect(getSnakeDraftTeamNumber(48, 16)).toBe(16);
  });
});

describe("getMyOverallPicks", () => {
  it("returns slot 10's picks for all 15 rounds", () => {
    expect(getMyOverallPicks()).toEqual([
      10, 23, 42, 55, 74, 87, 106, 119, 138, 151, 170, 183, 202, 215,
      234,
    ]);
  });
});
