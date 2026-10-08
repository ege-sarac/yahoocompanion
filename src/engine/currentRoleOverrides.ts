import type { CurrentRoleOverride, Player, ProjectionMetrics } from "../types";

export function roleOverrideFreshness(override: CurrentRoleOverride, asOfDate = new Date()): number {
  const stamp = override.sourceDate ?? override.generatedAt;
  const ageDays = stamp ? Math.max(0, (asOfDate.getTime() - Date.parse(stamp)) / 86_400_000) : 30;
  return Math.max(.15, Math.min(1, (override.confidence ?? .65) * Math.exp(-ageDays / 28)));
}

export function applyCurrentRoleOverride(player: Player, metrics: ProjectionMetrics, overrides: readonly CurrentRoleOverride[] = [], asOfDate = new Date()): ProjectionMetrics {
  const override = overrides.find((entry) => (entry.playerId === player.id || normalize(entry.playerName) === normalize(player.name)) && (!entry.nbaTeam || !player.nbaTeam || entry.nbaTeam === player.nbaTeam));
  if (!override || override.minutesBase === undefined) return metrics;
  const authority = roleOverrideFreshness(override, asOfDate);
  const base = metrics.projection.projectedMinutes;
  const minutes = base + (override.minutesBase - base) * authority;
  const scale = base > 0 ? minutes / base : 1;
  const projection = { ...metrics.projection, projectedMinutes: minutes, projectedPoints: metrics.projection.projectedPoints * scale, projectedOffensiveRebounds: metrics.projection.projectedOffensiveRebounds * scale, projectedDefensiveRebounds: metrics.projection.projectedDefensiveRebounds * scale, projectedAssists: metrics.projection.projectedAssists * scale, projectedSteals: metrics.projection.projectedSteals * scale, projectedBlocks: metrics.projection.projectedBlocks * scale, projectedTurnovers: metrics.projection.projectedTurnovers * scale, projectedFantasyPointsPerGame: metrics.projection.projectedFantasyPointsPerGame * scale, projectedMinutesLow: override.minutesLow ?? metrics.projection.projectedMinutesLow, projectedMinutesHigh: override.minutesHigh ?? metrics.projection.projectedMinutesHigh };
  return { ...metrics, projection, roleAssessment: metrics.roleAssessment ? { ...metrics.roleAssessment, currentRoleSecurity: override.roleSecurity === undefined ? metrics.roleAssessment.currentRoleSecurity : metrics.roleAssessment.currentRoleSecurity + (override.roleSecurity - metrics.roleAssessment.currentRoleSecurity) * authority, reasons: [...metrics.roleAssessment.reasons, `Fresh role override (${Math.round(authority * 100)}% authority) adjusted current minutes only.`] } : metrics.roleAssessment };
}
function normalize(value: string): string { return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, ""); }
