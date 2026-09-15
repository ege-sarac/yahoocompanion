import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import type { LeagueConfig, Player, Projection, ProjectionMetrics, RoleContextSummary, TeamContextSummary } from "../types";
import { calculateFantasyPoints } from "./fantasyPoints";
import { estimateProjectedBonusCounts } from "./projectionModel";

const historicalBaselineCache = new WeakMap<Player, { scoringKey: string; latest: Player["historicalStats"][number] | undefined; latestFantasy: number | null; previousFantasy: number | null; weightedFantasy: number | null }>();
const projectionSanityCache = new WeakMap<Player, Map<string, ProjectionSanitySummary>>();

export interface ProjectionSanitySummary {
  latestSeasonFantasyPPG: number | null;
  previousSeasonFantasyPPG: number | null;
  weightedHistoricalFantasyPPG: number | null;
  projectionCompressionRatio: number | null;
  unexplainedProjectionCompression: boolean;
  unexplainedProjectionInflation: boolean;
  projectionChangeReasons: string[];
}

export function calculateRecentSeasonFantasyPPG(player: Player, config: LeagueConfig): number | null {
  return historicalBaseline(player, config).latestFantasy;
}

export function calculateProjectionSanity(player: Player, base: Projection, final: Projection, config: LeagueConfig, metrics: ProjectionMetrics, role?: RoleContextSummary, team?: TeamContextSummary): ProjectionSanitySummary {
  const cacheKey = [base.projectedFantasyPointsPerGame, base.projectedMinutes, final.projectedFantasyPointsPerGame, final.projectedMinutes, player.injuryStatus, metrics.careerStageProjection?.careerTrend, metrics.roleAssessment?.currentTeamContinuity, role?.absenceDependencyScore, role?.lateSeasonRegime, team?.adjustmentPercent, Object.values(config.scoring).join("|")].join("|");
  const cache = projectionSanityCache.get(player);
  const cached = cache?.get(cacheKey);
  if (cached) return cached;
  const historical = historicalBaseline(player, config);
  const latest = historical.latest;
  const latestSeasonFantasyPPG = historical.latestFantasy;
  const previousSeasonFantasyPPG = historical.previousFantasy;
  const weightedHistoricalFantasyPPG = historical.weightedFantasy;
  const anchor = latestSeasonFantasyPPG ?? weightedHistoricalFantasyPPG;
  const ratio = anchor && anchor > 0 ? final.projectedFantasyPointsPerGame / anchor : null;
  const reasons: string[] = [];
  const minutesDrop = latest ? final.projectedMinutes - latest.minutesPerGame : final.projectedMinutes - base.projectedMinutes;
  if (minutesDrop <= -4) reasons.push("Major projected minutes reduction.");
  if (player.injuryStatus === "Out" || player.injuryStatus === "Injured" || metrics.expectedGamesProjection?.majorInjuryComeback) reasons.push("Current injury/return limitation.");
  if (metrics.careerStageProjection?.careerTrend === "STRUCTURAL_DECLINE") reasons.push("Structural career decline.");
  if (metrics.roleAssessment?.currentTeamContinuity === false) reasons.push("Current team change reduces role continuity.");
  if ((team?.adjustmentPercent ?? 0) <= -.04) reasons.push("Current team context compresses the projection.");
  if ((role?.absenceDependencyScore ?? 0) >= .35) reasons.push("Prior role gain was teammate-absence dependent.");
  if ((role?.lateSeasonRegime === "SUSTAINED_ROLE_LOSS")) reasons.push("Recent role evidence indicates a sustained loss.");
  const substantialEvidence = reasons.length > 0;
  const unexplainedProjectionCompression = ratio !== null && ratio < DRAFT_VALUE_CONFIG.projectionSanity.strongCompressionRatio && !substantialEvidence;
  const unexplainedProjectionInflation = ratio !== null && ratio > DRAFT_VALUE_CONFIG.projectionSanity.strongInflationRatio && !substantialEvidence;
  if (unexplainedProjectionCompression) reasons.push("UNEXPLAINED_PROJECTION_COMPRESSION");
  if (unexplainedProjectionInflation) reasons.push("UNEXPLAINED_PROJECTION_INFLATION");
  const summary = { latestSeasonFantasyPPG, previousSeasonFantasyPPG, weightedHistoricalFantasyPPG, projectionCompressionRatio: ratio, unexplainedProjectionCompression, unexplainedProjectionInflation, projectionChangeReasons: reasons };
  const entries = cache ?? new Map<string, ProjectionSanitySummary>();
  entries.set(cacheKey, summary);
  projectionSanityCache.set(player, entries);
  return summary;
}

function historicalBaseline(player: Player, config: LeagueConfig) {
  const scoringKey = Object.values(config.scoring).join("|");
  const cached = historicalBaselineCache.get(player);
  if (cached?.scoringKey === scoringKey) return cached;
  const seasons = [...player.historicalStats].sort((left, right) => right.season.localeCompare(left.season));
  const latest = seasons[0];
  const latestFantasy = latest && latest.gamesPlayed >= DRAFT_VALUE_CONFIG.projectionSanity.meaningfulRecentGames ? seasonFantasyPPG(latest, config) : null;
  const previousFantasy = seasons[1] ? seasonFantasyPPG(seasons[1], config) : null;
  const weights = [.6, .25, .15];
  const weighted = seasons.slice(0, 3).map((season, index) => ({ value: seasonFantasyPPG(season, config), weight: weights[index] })).filter((entry) => entry.value > 0);
  const weightedFantasy = weighted.length ? weighted.reduce((total, entry) => total + entry.value * entry.weight, 0) / weighted.reduce((total, entry) => total + entry.weight, 0) : null;
  const baseline = { scoringKey, latest, latestFantasy, previousFantasy, weightedFantasy };
  historicalBaselineCache.set(player, baseline);
  return baseline;
}

function seasonFantasyPPG(season: Player["historicalStats"][number], config: LeagueConfig): number {
  const projection = { projectedPoints: season.points, projectedOffensiveRebounds: season.offensiveRebounds, projectedDefensiveRebounds: season.defensiveRebounds, projectedAssists: season.assists, projectedSteals: season.steals, projectedBlocks: season.blocks, projectedTurnovers: season.turnovers };
  const bonuses = estimateProjectedBonusCounts(projection, season.gamesPlayed);
  return calculateFantasyPoints({ points: season.points, offensiveRebounds: season.offensiveRebounds, defensiveRebounds: season.defensiveRebounds, assists: season.assists, steals: season.steals, blocks: season.blocks, turnovers: season.turnovers, doubleDoubles: bonuses.projectedDoubleDoubles / Math.max(1, season.gamesPlayed), tripleDoubles: bonuses.projectedTripleDoubles / Math.max(1, season.gamesPlayed) }, config.scoring);
}
