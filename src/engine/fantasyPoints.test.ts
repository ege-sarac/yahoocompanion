import { describe, expect, it } from "vitest";

import { calculateFantasyPoints } from "./fantasyPoints";

describe("calculateFantasyPoints", () => {
  it("applies every league scoring weight", () => {
    const result = calculateFantasyPoints({
      points: 20,
      offensiveRebounds: 2,
      defensiveRebounds: 5,
      assists: 6,
      steals: 2,
      blocks: 1,
      turnovers: 3,
      doubleDoubles: 1,
      tripleDoubles: 0,
    });

    expect(result).toBeCloseTo(45.8);
  });

  it("adds both double-double and triple-double bonuses", () => {
    const result = calculateFantasyPoints({
      points: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      doubleDoubles: 1,
      tripleDoubles: 1,
    });

    expect(result).toBe(10);
  });
});
