import type { LeagueConfig, Player, ProjectionMetrics, YahooDefaultProjection, YahooProjectionComparison } from "../types";
import { calculateFantasyPoints } from "./fantasyPoints";

/** Chooses a healthy production baseline before role, injury, minutes-budget, and team-context passes. */
export function applyYahooProjectionBaseline(player: Player, metrics: ProjectionMetrics, external: YahooDefaultProjection | undefined, config: LeagueConfig): ProjectionMetrics {
  const internal = metrics.projection.projectedFantasyPointsPerGame;
  const threshold = config.externalProjectionFallbackThreshold;
  const unavailable = (): ProjectionMetrics => ({ ...metrics, yahooProjectionComparison: { available: false, internalComparableFantasyPPG: internal, threshold, sourceSelected: "INTERNAL", selectionReason: "YAHOO_UNAVAILABLE_OR_PARTIAL" } });
  if (!external || !valid(external)) return unavailable();
  const split = reboundSplit(player, metrics);
  if (!split) return unavailable();
  const adjusted = calculateFantasyPoints({ points: external.points, offensiveRebounds: external.rebounds * split.share, defensiveRebounds: external.rebounds * (1 - split.share), assists: external.assists, steals: external.steals, blocks: external.blocks, turnovers: external.turnovers, doubleDoubles: metrics.projection.projectedDoubleDoubles / Math.max(1, metrics.projection.projectedGames), tripleDoubles: metrics.projection.projectedTripleDoubles / Math.max(1, metrics.projection.projectedGames) }, config.scoring);
  const gap = internal - adjusted;
  const overrides = Math.abs(gap) > threshold;
  const comparison: YahooProjectionComparison = { available: true, yahooSourceSlotFppg: external.yahooSourceSlotFppg, leagueAdjustedYahooFantasyPPG: adjusted, internalComparableFantasyPPG: internal, projectionGap: gap, absoluteProjectionGap: Math.abs(gap), threshold, sourceSelected: overrides ? "YAHOO_EXTERNAL" : "INTERNAL", selectionReason: overrides ? "YAHOO_EXTERNAL_OVERRIDE_GT_CONFIGURED_THRESHOLD" : "INTERNAL_WITHIN_EXTERNAL_TOLERANCE", reboundSplitSource: split.source, derivedOffensiveRebounds: external.rebounds * split.share, derivedDefensiveRebounds: external.rebounds * (1 - split.share), ddTdSource: "INTERNAL_GENERIC_ESTIMATE" };
  if (comparison.sourceSelected === "INTERNAL") return { ...metrics, yahooProjectionComparison: comparison };
  const old = metrics.projection;
  const projection = { ...old, projectedMinutes: external.mpg, projectedPoints: external.points, projectedOffensiveRebounds: comparison.derivedOffensiveRebounds!, projectedDefensiveRebounds: comparison.derivedDefensiveRebounds!, projectedAssists: external.assists, projectedSteals: external.steals, projectedBlocks: external.blocks, projectedTurnovers: external.turnovers, projectedFantasyPointsPerGame: adjusted, projectedFantasyPointsPerGameLow: Math.max(0, adjusted - Math.max(0, old.projectedFantasyPointsPerGame - (old.projectedFantasyPointsPerGameLow ?? old.projectedFantasyPointsPerGame))), projectedFantasyPointsPerGameHigh: adjusted + Math.max(0, (old.projectedFantasyPointsPerGameHigh ?? old.projectedFantasyPointsPerGame) - old.projectedFantasyPointsPerGame) };
  return { ...metrics, projection, projectionSource: "Yahoo external baseline", projectedFantasyPointsPerSeason: adjusted * old.projectedGames, availabilityAdjustedFantasyPoints: adjusted * old.projectedGames, yahooProjectionComparison: comparison };
}

function reboundSplit(player: Player, metrics: ProjectionMetrics): { share: number; source: YahooProjectionComparison["reboundSplitSource"] } | null {
  const weighted = player.historicalStats.slice(0, 3).map((season, index) => ({ season, weight: [.6, .25, .15][index] ?? .1 })).filter(({ season }) => season.offensiveRebounds + season.defensiveRebounds > 0);
  if (weighted.length) {
    const oreb = weighted.reduce((sum, entry) => sum + entry.season.offensiveRebounds * entry.weight, 0), total = weighted.reduce((sum, entry) => sum + (entry.season.offensiveRebounds + entry.season.defensiveRebounds) * entry.weight, 0);
    if (total > 0) return { share: oreb / total, source: "HISTORICAL_WEIGHTED" };
  }
  const total = metrics.projection.projectedOffensiveRebounds + metrics.projection.projectedDefensiveRebounds;
  return total > 0 ? { share: metrics.projection.projectedOffensiveRebounds / total, source: "INTERNAL_PROJECTION_RATIO" } : null;
}
function valid(row: YahooDefaultProjection): boolean { return [row.gp, row.mpg, row.points, row.rebounds, row.assists, row.steals, row.blocks, row.turnovers].every((value) => Number.isFinite(value) && value >= 0); }
