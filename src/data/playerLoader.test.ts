import { afterEach, describe, expect, it, vi } from "vitest";

import { isPlayerRecord, loadPlayers } from "./playerLoader";

const noHistoryPlayer = {
  id: "1643407",
  name: "AJ Dybantsa",
  nbaTeam: "WAS",
  nbaPosition: "F",
  nbaExperience: "R",
  isRookie: true,
  yahooPositions: [],
  age: 19,
  injuryStatus: null,
  expectedReturnDate: null,
  historicalStats: [],
  projections: null,
  injuryRisk: null,
  opportunityScore: null,
  breakoutScore: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("player catalog loading", () => {
  it("accepts and returns a current-catalog player with zero history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [noHistoryPlayer],
      }),
    );

    const result = await loadPlayers();

    expect(isPlayerRecord(noHistoryPlayer)).toBe(true);
    expect(result.source).toBe("processed");
    expect(result.players[0].historicalStats).toEqual([]);
    expect(result.players[0].projections).toBeNull();
  });
});
