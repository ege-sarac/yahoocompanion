import { describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";

import {
  getMyOverallPicks,
  getSnakeDraftTeamNumber,
  getUserPickSchedule,
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

describe("getUserPickSchedule", () => {
  it.each([
    [14, 1, 1, 28, 29, 26, 27],
    [14, 8, 8, 21, 36, 12, 27],
    [14, 14, 14, 15, 42, 0, 27],
    [16, 1, 1, 32, 33, 30, 31],
    [16, 10, 10, 23, 42, 12, 31],
    [16, 16, 16, 17, 48, 0, 31],
  ])("uses strict future-pick distance for %i teams, slot %i", (teamCount, slot, current, next, second, untilNext, untilSecond) => {
    const schedule = getUserPickSchedule(current, { ...DEFAULT_LEAGUE_CONFIG, teamCount, userDraftSlot: slot, rounds: 15 });
    expect(schedule.nextUserPick).toBe(next);
    expect(schedule.secondNextUserPick).toBe(second);
    expect(schedule.picksUntilNextUserPick).toBe(untilNext);
    expect(schedule.picksUntilSecondNextUserPick).toBe(untilSecond);
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
