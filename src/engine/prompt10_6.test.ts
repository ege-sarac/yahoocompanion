import { describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import { calculateMarketTiming, learnMarketProfiles, parseMockDraft, resolveHistoricalMockDraft } from "./marketDraft";
import { getUserPickSchedule } from "./draftOrder";

describe("Prompt 10.6 absolute acquisition timing", () => {
  const config = DEFAULT_LEAGUE_CONFIG;
  const absolute174 = { playerId: "p", normalizedObservations: [{ overallPick: 174, teamCount: 14, rounds: 13, rightCensored: false, source: "USER_MOCK" as const }, { overallPick: 174, teamCount: 14, rounds: 13, rightCensored: false, source: "USER_MOCK" as const }] };
  const censored = { playerId: "p", normalizedObservations: Array.from({ length: 5 }, () => ({ censorThreshold: 182, teamCount: 14, rounds: 13, rightCensored: true, source: "USER_MOCK" as const })) };
  it("keeps a 14x13 exact pick at absolute 174", () => expect(calculateMarketTiming(absolute174, config, 106, 119, 90, 500).marketPickEstimate).toBe(174));
  it("displays absolute 174 as target-league round 11", () => expect(calculateMarketTiming(absolute174, config, 106, 119, 90, 500).marketRoundLow).toBeCloseTo(11.8125));
  it("uses 182, not 240, as a 14x13 censor boundary", () => expect(calculateMarketTiming(censored, config, 106, 119, 90, 500).censoredSurvivalLowerBound).toBe(182));
  it("uses censor evidence before 182 but not after it", () => { const timing = calculateMarketTiming(censored, config, 151, 170, 90, 500); expect(timing.futureUserPickSurvival?.find((x) => x.overallPick === 170)?.evidenceCount).toBeGreaterThan(0); expect(timing.futureUserPickSurvival?.find((x) => x.overallPick === 183)?.evidenceCount).toBe(0); });
  it("maps the canonical slot-10 future schedule", () => expect(getUserPickSchedule(106, config).remainingUserPicks.slice(0, 5)).toEqual([119, 138, 151, 170, 183]));
  it("finds 170 as the last good chance before a 174 market window", () => expect(calculateMarketTiming(absolute174, config, 106, 119, 90, 500).acquisitionFrontierPick).toBe(170));
  it("makes a far frontier defer more than a near frontier", () => { const near = { ...absolute174, normalizedObservations: absolute174.normalizedObservations.map((x) => ({ ...x, overallPick: 119 })) }; expect(calculateMarketTiming(absolute174, config, 106, 119, 90, 500).waitValue).toBeGreaterThan(calculateMarketTiming(near, config, 106, 119, 90, 500).waitValue); });
  it("zeros acquisition timing at the final user pick", () => { const timing = calculateMarketTiming(absolute174, config, 234, null, 90, 500); expect(timing.waitOpportunityCost).toBe(0); expect(timing.acquisitionFrontierPick).toBeNull(); });
  it("rejects synthetic picks from completed market import", () => { const picks = Array.from({ length: 2 }, (_, index) => ({ overallPick: index + 1, round: 1, pickInRound: index + 1, teamNumber: index + 1, playerId: `p${index}`, isMyTeam: false, pickProvenance: index ? "SYNTHETIC_PADDING" : "OBSERVED_ROOM" })); expect(() => resolveHistoricalMockDraft({ teamCount: 2, rounds: 1, picks })).toThrow(/synthetic/i); });
  it("stores learned exact observations with absolute coordinates", () => { const learned = learnMarketProfiles([{ id: "p", name: "P", nbaTeam: null, yahooPositions: [], age: null, injuryStatus: null, expectedReturnDate: null, historicalStats: [], projections: null, injuryRisk: null, opportunityScore: null, breakoutScore: null }], [parseMockDraft({ teamCount: 14, rounds: 13, picks: [{ overallPick: 174, playerId: "p" }] }, 14, 13)], [], config); expect(learned.profiles[0].normalizedObservations?.[0].overallPick).toBe(174); });
});
