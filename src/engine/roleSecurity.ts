import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import type { CareerStageProjection, CurrentRoleAssessment, Player, PlayerRoleHistoryRecord, ProjectionMetrics } from "../types";

export function assessCurrentRole(player: Player, metrics: ProjectionMetrics, career: CareerStageProjection, record?: PlayerRoleHistoryRecord): CurrentRoleAssessment {
  const weights = DRAFT_VALUE_CONFIG.roleSecurity;
  const roles = [...(record?.seasons ?? [])].sort((a, b) => b.season.localeCompare(a.season));
  const latestRole = roles[0];
  const currentTeamStintMinutes = record?.regime?.windows.currentTeamStint.minutesPerGame;
  const continuity = player.nbaTeam && latestRole?.team ? latestRole.team === player.nbaTeam : null;
  const continuityScore = continuity === true ? 1 : continuity === false ? weights.noContinuityScore : weights.unknownContinuityScore;
  const recentMinutes = currentTeamStintMinutes ?? latestRole?.minutesPerGame ?? metrics.projection.projectedMinutes;
  const minutesScore = clamp(recentMinutes / 32);
  const starterScore = latestRole?.starterRate === undefined ? minutesScore : clamp(latestRole.starterRate);
  const stability = roles.length > 1 && roles[0].minutesPerGame !== undefined && roles[1].minutesPerGame !== undefined ? 1 - clamp(Math.abs(roles[0].minutesPerGame - roles[1].minutesPerGame) / 10) : .5;
  const range = Math.max(0, (metrics.projection.projectedMinutesHigh ?? metrics.projection.projectedMinutes + 3) - (metrics.projection.projectedMinutesLow ?? metrics.projection.projectedMinutes - 3));
  const rangeScore = 1 - clamp(range / 16);
  const careerScore = career.careerTrend === "STRUCTURAL_DECLINE" ? .2 : career.careerTrend === "MILD_DECLINE" ? .55 : .9;
  let security = continuityScore * weights.currentTeamContinuity + starterScore * weights.currentTeamStarterRate + minutesScore * weights.recentMinutes + stability * weights.recentStability + rangeScore * weights.projectedRange + careerScore * weights.careerTrend;
  if (metrics.projectionSource === "Rookie/new-player model") security = Math.min(weights.newcomerCeiling, security);
  if (player.injuryStatus === "Out" || player.injuryStatus === "Injured" || metrics.expectedGamesProjection?.majorInjuryComeback) security *= weights.injuryMultiplier;
  const reasons: string[] = [];
  if (continuity === false) reasons.push("Current-team role is less secure after a team change.");
  if (currentTeamStintMinutes !== undefined && currentTeamStintMinutes + 4 < metrics.projection.projectedMinutes) reasons.push("Latest current-team stint minutes constrain the role estimate.");
  if (security < .55) reasons.push("Current role is uncertain despite historical skill evidence.");
  return { skillConfidence: metrics.modelConfidence, currentRoleSecurity: clamp(security), currentTeamContinuity: continuity, latestTeamStintMinutes: currentTeamStintMinutes, reasons };
}
function clamp(value: number): number { return Math.min(1, Math.max(0, value)); }
