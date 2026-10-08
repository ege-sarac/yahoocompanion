import { describe, expect, it } from "vitest";

import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import { approximateRoundFromPick, formatYahooAdp } from "./marketDisplay";
import { calculateMarketTiming } from "./marketDraft";

describe("Yahoo market reference timing", () => {
  it("uses Yahoo ADP as a timing-only market estimate when local history is absent", () => {
    const timing = calculateMarketTiming({ playerId: "p", yahooADP: 165 }, DEFAULT_LEAGUE_CONFIG, 106, 119, 90, 500);
    expect(timing.yahooAdp).toBe(165);
    expect(timing.marketPickEstimate).toBe(165);
    expect(timing.survivalSource).toBe("YAHOO_ADP");
  });

  it("blends a thin local observation toward Yahoo instead of treating either source as certain", () => {
    const timing = calculateMarketTiming({ playerId: "p", yahooADP: 100, normalizedObservations: [{ overallPick: 150, teamCount: 16, rounds: 15, rightCensored: false, source: "USER_MOCK" }] }, DEFAULT_LEAGUE_CONFIG, 74, 87, 90, 500);
    expect(timing.marketPickEstimate).toBeGreaterThan(100);
    expect(timing.marketPickEstimate).toBeLessThan(150);
    expect(timing.marketSourceGap).toBe(50);
    expect(timing.survivalSource).toBe("BLENDED_MARKET");
  });

  it("uses the one-indexed continuous display round convention", () => {
    expect(approximateRoundFromPick(1, 16)).toBe(1);
    expect(approximateRoundFromPick(1.7, 16)).toBeCloseTo(1.04375);
    expect(approximateRoundFromPick(3.4, 16)).toBeCloseTo(1.15);
    expect(approximateRoundFromPick(16, 16)).toBeCloseTo(1.9375);
    expect(approximateRoundFromPick(17, 16)).toBe(2);
    expect(approximateRoundFromPick(160, 16)).toBeCloseTo(10.9375);
    expect(approximateRoundFromPick(161, 16)).toBe(11);
    expect(approximateRoundFromPick(165, 16)).toBeCloseTo(11.25);
    expect(approximateRoundFromPick(165, 14)).toBeCloseTo(12.7142857);
    expect(approximateRoundFromPick(null, 16)).toBeNull();
    expect(approximateRoundFromPick(Number.NaN, 16)).toBeNull();
  });

  it("formats compact recommendation-card CADP labels", () => {
    expect(formatYahooAdp(1.7, 16)).toBe("CADP #1.7 · ~R1.0");
    expect(formatYahooAdp(165, 16)).toBe("CADP #165.0 · ~R11.3");
    expect(formatYahooAdp(null, 16)).toBe("CADP —");
  });
});
