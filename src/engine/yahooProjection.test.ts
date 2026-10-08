import { describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { Player, ProjectionMetrics, YahooDefaultProjection } from "../types";
import { applyYahooProjectionBaseline } from "./yahooProjection";

const player = (oreb = 2, dreb = 6): Player => ({ id: "p", name: "Player", nbaTeam: "TST", yahooPositions: [], age: 25, injuryStatus: "Healthy", expectedReturnDate: null, historicalStats: [{ season: "2025-26", gamesPlayed: 70, minutesPerGame: 30, points: 20, offensiveRebounds: oreb, defensiveRebounds: dreb, assists: 5, steals: 1, blocks: 1, turnovers: 2 }], projections: null, injuryRisk: null, opportunityScore: null, breakoutScore: null });
const metrics = (fpg: number): ProjectionMetrics => ({ projection: { projectedGames: 70, projectedMinutes: 30, projectedPoints: 20, projectedOffensiveRebounds: 2, projectedDefensiveRebounds: 6, projectedAssists: 5, projectedSteals: 1, projectedBlocks: 1, projectedTurnovers: 2, projectedDoubleDoubles: 10, projectedTripleDoubles: 1, projectedFantasyPointsPerGame: fpg }, projectionSource: "Veteran NBA history", projectedFantasyPointsPerSeason: fpg * 70, availabilityAdjustedFantasyPoints: fpg * 70, historicalAvailabilityRisk: 0, currentInjuryPenalty: 0, combinedAvailabilityRisk: 0, modelConfidence: .8, opportunityScore: 50, breakoutScore: 50, usedPerGameFallback: false });
const yahoo = (points = 20): YahooDefaultProjection => ({ playerId: "p", playerName: "Player", team: "TST", rank: 1, yahooSourceSlotFppg: 99, gp: 70, mpg: 32, points, rebounds: 10, assists: 5, steals: 1, blocks: 1, turnovers: 2 });

describe("Yahoo default projection baseline", () => {
  it("uses active scoring and player-specific historical OREB share", () => {
    const result = applyYahooProjectionBaseline(player(), metrics(0), yahoo(), DEFAULT_LEAGUE_CONFIG);
    expect(result.yahooProjectionComparison?.derivedOffensiveRebounds).toBe(2.5);
    expect(result.yahooProjectionComparison?.derivedDefensiveRebounds).toBe(7.5);
    const altered = { ...DEFAULT_LEAGUE_CONFIG, scoring: { ...DEFAULT_LEAGUE_CONFIG.scoring, PTS: 2 } };
    expect(applyYahooProjectionBaseline(player(), metrics(0), yahoo(), altered).yahooProjectionComparison?.leagueAdjustedYahooFantasyPPG).not.toBe(result.yahooProjectionComparison?.leagueAdjustedYahooFantasyPPG);
  });
  it.each([[1.49, "INTERNAL"], [1.5, "INTERNAL"], [1.51, "YAHOO_EXTERNAL"], [-1.51, "YAHOO_EXTERNAL"]] as const)("uses strict > active threshold selection for gap %s", (gap, source) => {
    const baseline = applyYahooProjectionBaseline(player(), metrics(0), yahoo(), DEFAULT_LEAGUE_CONFIG).yahooProjectionComparison!.leagueAdjustedYahooFantasyPPG!;
    expect(applyYahooProjectionBaseline(player(), metrics(baseline + gap), yahoo(), DEFAULT_LEAGUE_CONFIG).yahooProjectionComparison?.sourceSelected).toBe(source);
  });
  it("uses Yahoo symmetrically above and below the internal baseline", () => {
    const baseline = applyYahooProjectionBaseline(player(), metrics(0), yahoo(), DEFAULT_LEAGUE_CONFIG).yahooProjectionComparison!.leagueAdjustedYahooFantasyPPG!;
    expect(applyYahooProjectionBaseline(player(), metrics(baseline + 4), yahoo(), DEFAULT_LEAGUE_CONFIG).projectionSource).toBe("Yahoo external baseline");
    expect(applyYahooProjectionBaseline(player(), metrics(baseline - 4), yahoo(), DEFAULT_LEAGUE_CONFIG).projectionSource).toBe("Yahoo external baseline");
  });
  it("uses the configured threshold rather than a fixed fallback gap", () => {
    const baseline = applyYahooProjectionBaseline(player(), metrics(0), yahoo(), DEFAULT_LEAGUE_CONFIG).yahooProjectionComparison!.leagueAdjustedYahooFantasyPPG!;
    const internal = metrics(baseline + 2);
    expect(applyYahooProjectionBaseline(player(), internal, yahoo(), { ...DEFAULT_LEAGUE_CONFIG, externalProjectionFallbackThreshold: 1.5 }).projectionSource).toBe("Yahoo external baseline");
    expect(applyYahooProjectionBaseline(player(), internal, yahoo(), { ...DEFAULT_LEAGUE_CONFIG, externalProjectionFallbackThreshold: 2 }).projectionSource).toBe("Veteran NBA history");
  });
  it("evaluates the active league scoring before applying the configured threshold", () => {
    const standard = applyYahooProjectionBaseline(player(), metrics(0), yahoo(), DEFAULT_LEAGUE_CONFIG).yahooProjectionComparison!.leagueAdjustedYahooFantasyPPG!;
    const alteredConfig = { ...DEFAULT_LEAGUE_CONFIG, scoring: { ...DEFAULT_LEAGUE_CONFIG.scoring, PTS: 2 }, externalProjectionFallbackThreshold: 1.5 };
    expect(applyYahooProjectionBaseline(player(), metrics(standard), yahoo(), DEFAULT_LEAGUE_CONFIG).projectionSource).toBe("Veteran NBA history");
    expect(applyYahooProjectionBaseline(player(), metrics(standard), yahoo(), alteredConfig).projectionSource).toBe("Yahoo external baseline");
  });
});
