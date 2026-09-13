import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { LeagueConfig, Player, PlayerRoleHistoryRecord, Projection, ProjectionMetrics } from "../types";
import { calculateFantasyPoints } from "./fantasyPoints";
import { analyzeCareerStage } from "./careerStage";
import { projectExpectedGames } from "./expectedGames";
import { assessCurrentRole } from "./roleSecurity";
import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import type { ExpectedGamesProjection } from "../types";

export function applyDraftValueProjection(player: Player, metrics: ProjectionMetrics, record?: PlayerRoleHistoryRecord, config: LeagueConfig = DEFAULT_LEAGUE_CONFIG, referenceSeason?: string): ProjectionMetrics {
  const career = analyzeCareerStage(player, record, config);
  let projection = scaleMinutes(metrics.projection, career.minutesAdjustment, config);
  const preliminaryExpected = player.historicalStats.length ? projectExpectedGames(player, projection, career, referenceSeason) : projectNewcomerExpectedGames(player, projection, metrics.modelConfidence);
  if (preliminaryExpected.majorInjuryComeback) {
    const target = preliminaryExpected.majorInjuryComeback.expectedMinutes;
    projection = scaleMinutes(projection, projection.projectedMinutes > 0 ? target / projection.projectedMinutes - 1 : 0, config);
    projection.projectedMinutesLow = preliminaryExpected.majorInjuryComeback.expectedMinutesLow;
    projection.projectedMinutesHigh = preliminaryExpected.majorInjuryComeback.expectedMinutesHigh;
  }
  const preliminaryMetrics: ProjectionMetrics = { ...metrics, projection, expectedGamesProjection: preliminaryExpected, careerStageProjection: career, modelConfidence: Math.max(0, Math.min(1, metrics.modelConfidence + (preliminaryExpected.majorInjuryComeback?.confidenceAdjustment ?? 0))) };
  const role = assessCurrentRole(player, preliminaryMetrics, career, record);
  if (role.currentTeamContinuity === true && role.latestTeamStintMinutes !== undefined && role.latestTeamStintMinutes + 3 < projection.projectedMinutes) {
    const target = projection.projectedMinutes * .35 + role.latestTeamStintMinutes * .65;
    projection = scaleMinutes(projection, target / projection.projectedMinutes - 1, config);
  }
  const expected = player.historicalStats.length ? projectExpectedGames(player, projection, career, referenceSeason) : projectNewcomerExpectedGames(player, projection, metrics.modelConfidence);
  projection.projectedGames = expected.expectedGames;
  const finalMetrics = { ...preliminaryMetrics, projection, expectedGamesProjection: expected };
  return { ...finalMetrics, roleAssessment: assessCurrentRole(player, finalMetrics, career, record), projectedFantasyPointsPerSeason: projection.projectedFantasyPointsPerGame * expected.expectedGames, availabilityAdjustedFantasyPoints: projection.projectedFantasyPointsPerGame * expected.expectedGames };
}

function projectNewcomerExpectedGames(player: Player, projection: Projection, confidence: number): ExpectedGamesProjection {
  if (projection.projectedMinutes <= 0) return { expectedGamesLow: 0, expectedGames: 0, expectedGamesHigh: 0, availabilityConfidence: confidence, availabilityRiskLabel: "HIGH RISK", currentHealthVerified: Boolean(player.injuryStatus && player.injuryStatus !== "Unknown"), reasons: ["Newcomer is not currently expected to play NBA minutes."] };
  const status = player.injuryStatus ?? "Unknown";
  const expected = Math.min(DRAFT_VALUE_CONFIG.expectedGames.maximumGames, Math.max(DRAFT_VALUE_CONFIG.expectedGames.minimumGames, projection.projectedGames - DRAFT_VALUE_CONFIG.expectedGames.currentStatusMissedGames[status]));
  const spread = 10 + (1 - confidence) * 8 + (status === "Unknown" ? 3 : 0);
  return { expectedGamesLow: Math.max(0, Math.round((expected - spread) * 10) / 10), expectedGames: Math.round(expected * 10) / 10, expectedGamesHigh: Math.min(DRAFT_VALUE_CONFIG.expectedGames.maximumGames, Math.round((expected + spread * .65) * 10) / 10), availabilityConfidence: Math.min(.65, confidence), availabilityRiskLabel: expected < 55 ? "HIGH RISK" : expected < 66 ? "MODERATE" : "STABLE", currentHealthVerified: Boolean(player.injuryStatus && player.injuryStatus !== "Unknown"), reasons: ["Newcomer expected games retain the separate classification and role prior."] };
}

function scaleMinutes(base: Projection, adjustment: number, config: LeagueConfig): Projection {
  if (Math.abs(adjustment) < 1e-9) return { ...base };
  const scale = Math.max(.5, Math.min(1.15, 1 + adjustment));
  const projection: Projection = { ...base, projectedMinutes: base.projectedMinutes * scale, projectedMinutesLow: (base.projectedMinutesLow ?? base.projectedMinutes) * scale, projectedMinutesHigh: (base.projectedMinutesHigh ?? base.projectedMinutes) * scale, projectedPoints: base.projectedPoints * scale, projectedOffensiveRebounds: base.projectedOffensiveRebounds * scale, projectedDefensiveRebounds: base.projectedDefensiveRebounds * scale, projectedAssists: base.projectedAssists * scale, projectedSteals: base.projectedSteals * scale, projectedBlocks: base.projectedBlocks * scale, projectedTurnovers: base.projectedTurnovers * scale };
  projection.projectedFantasyPointsPerGame = calculateFantasyPoints({ points: projection.projectedPoints, offensiveRebounds: projection.projectedOffensiveRebounds, defensiveRebounds: projection.projectedDefensiveRebounds, assists: projection.projectedAssists, steals: projection.projectedSteals, blocks: projection.projectedBlocks, turnovers: projection.projectedTurnovers, doubleDoubles: projection.projectedDoubleDoubles / Math.max(1, projection.projectedGames), tripleDoubles: projection.projectedTripleDoubles / Math.max(1, projection.projectedGames) }, config.scoring);
  projection.projectedFantasyPointsPerGameLow = (base.projectedFantasyPointsPerGameLow ?? base.projectedFantasyPointsPerGame) * scale;
  projection.projectedFantasyPointsPerGameHigh = (base.projectedFantasyPointsPerGameHigh ?? base.projectedFantasyPointsPerGame) * scale;
  return projection;
}
