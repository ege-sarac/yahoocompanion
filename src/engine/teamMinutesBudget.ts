import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import type { LeagueConfig, Player, Projection, ProjectionMetrics } from "../types";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import { calculateFantasyPoints } from "./fantasyPoints";

interface Candidate { player: Player; metrics: ProjectionMetrics }
export interface TeamMinutesBudgetResult {
  metricsByPlayerId: Map<string, ProjectionMetrics>;
  adjustmentByPlayerId: Map<string, number>;
  teams: Array<{ team: string; before: number; after: number; outsideTolerance: boolean }>;
  capViolations: number;
}

export function reconcileTeamMinutes(candidates: readonly Candidate[], leagueConfig: LeagueConfig = DEFAULT_LEAGUE_CONFIG): TeamMinutesBudgetResult {
  const grouped = new Map<string, Candidate[]>();
  for (const candidate of candidates) if (candidate.player.nbaTeam) grouped.set(candidate.player.nbaTeam, [...(grouped.get(candidate.player.nbaTeam) ?? []), candidate]);
  const metricsByPlayerId = new Map(candidates.map((candidate) => [candidate.player.id, candidate.metrics]));
  const adjustmentByPlayerId = new Map<string, number>();
  const teams: TeamMinutesBudgetResult["teams"] = [];
  let capViolations = 0;
  for (const [team, members] of grouped) {
    const before = members.reduce((sum, member) => sum + member.metrics.projection.projectedMinutes, 0);
    const target = DRAFT_VALUE_CONFIG.minutesBudget.totalTeamMinutes;
    let excess = Math.max(0, before - target);
    const allocation = new Map(members.map((member) => [member.player.id, member.metrics.projection.projectedMinutes]));
    const orderedRotation = [...members].sort((left, right) => rotationPriority(right) - rotationPriority(left));
    const protectedRotation = new Set(orderedRotation
      .slice(0, Math.min(5, members.length))
      .map((member) => member.player.id));
    const rotationCore = new Set(orderedRotation.slice(0, Math.min(10, members.length)).map((member) => member.player.id));
    for (let pass = 0; pass < 4 && excess > .01; pass++) {
      const adjustable = members.map((member) => {
        const current = allocation.get(member.player.id)!;
        const security = member.metrics.roleAssessment?.currentRoleSecurity ?? .5;
        const flex = protectedRotation.has(member.player.id) ? DRAFT_VALUE_CONFIG.minutesBudget.highSecurityFlex : rotationCore.has(member.player.id) ? .45 : security >= .75 ? .6 : security >= .5 ? DRAFT_VALUE_CONFIG.minutesBudget.mediumSecurityFlex : DRAFT_VALUE_CONFIG.minutesBudget.lowSecurityFlex;
        const declineFactor = member.metrics.careerStageProjection?.careerTrend === "STRUCTURAL_DECLINE" ? 1.35 : member.metrics.careerStageProjection?.careerTrend === "MILD_DECLINE" ? 1.15 : 1;
        const capacity = Math.max(0, member.metrics.projection.projectedMinutes * Math.min(DRAFT_VALUE_CONFIG.minutesBudget.maximumCompression, flex * declineFactor) - Math.max(0, member.metrics.projection.projectedMinutes - current));
        return { member, capacity, priority: Math.max(.05, (1 - security) * declineFactor) };
      }).filter((item) => item.capacity > 0);
      const weightedCapacity = adjustable.reduce((sum, item) => sum + item.capacity * item.priority, 0);
      if (!weightedCapacity) break;
      for (const item of adjustable) {
        const reduction = Math.min(item.capacity, excess * item.capacity * item.priority / weightedCapacity);
        allocation.set(item.member.player.id, allocation.get(item.member.player.id)! - reduction);
      }
      excess = Math.max(0, [...allocation.values()].reduce((sum, value) => sum + value, 0) - target);
    }
    if (excess > DRAFT_VALUE_CONFIG.minutesBudget.tolerance) {
      for (const member of [...members].sort((left, right) => rotationPriority(left) - rotationPriority(right))) {
        const current = allocation.get(member.player.id)!;
        const minimum = protectedRotation.has(member.player.id) ? member.metrics.projection.projectedMinutes * .85 : 0;
        const reduction = Math.min(excess, Math.max(0, current - minimum));
        allocation.set(member.player.id, current - reduction);
        excess -= reduction;
        if (excess <= DRAFT_VALUE_CONFIG.minutesBudget.tolerance) break;
      }
    }
    for (const member of members) {
      const nextMinutes = allocation.get(member.player.id)!;
      const base = member.metrics.projection;
      const latentAdjustment = base.projectedMinutes > 0 ? nextMinutes / base.projectedMinutes - 1 : 0;
      const adjustment = Math.max(-maximumAppliedCompression(member), latentAdjustment);
      adjustmentByPlayerId.set(member.player.id, adjustment);
      if (Math.abs(adjustment) > DRAFT_VALUE_CONFIG.minutesBudget.maximumCompression + 1e-8) capViolations++;
      if (Math.abs(adjustment) > 1e-8) metricsByPlayerId.set(member.player.id, scaleProjection(member.metrics, adjustment, leagueConfig));
    }
    const after = [...allocation.values()].reduce((sum, value) => sum + value, 0);
    teams.push({ team, before, after, outsideTolerance: after > target + DRAFT_VALUE_CONFIG.minutesBudget.tolerance });
  }
  return { metricsByPlayerId, adjustmentByPlayerId, teams, capViolations };
}

function rotationPriority(member: Candidate): number { return member.metrics.projection.projectedMinutes * .4 + member.metrics.projection.projectedFantasyPointsPerGame * .35 + (member.metrics.roleAssessment?.skillConfidence ?? member.metrics.modelConfidence) * 8 + (member.metrics.roleAssessment?.currentRoleSecurity ?? .5) * 3; }
function maximumAppliedCompression(member: Candidate): number { const role = member.metrics.roleAssessment; if (member.metrics.projectionSource === "Rookie/new-player model") return .4; if (role?.currentTeamContinuity === false) return .35; if (role?.currentTeamContinuity === true) return role.currentRoleSecurity >= .75 ? .05 : role.currentRoleSecurity >= .5 ? .08 : .15; return role && role.currentRoleSecurity >= .7 ? .12 : .25; }

function scaleProjection(metrics: ProjectionMetrics, adjustment: number, config: LeagueConfig): ProjectionMetrics {
  const base = metrics.projection;
  const scale = 1 + adjustment;
  const projection: Projection = { ...base, projectedMinutes: base.projectedMinutes * scale, projectedMinutesLow: (base.projectedMinutesLow ?? base.projectedMinutes) * scale, projectedMinutesHigh: (base.projectedMinutesHigh ?? base.projectedMinutes) * scale, projectedPoints: base.projectedPoints * scale, projectedOffensiveRebounds: base.projectedOffensiveRebounds * scale, projectedDefensiveRebounds: base.projectedDefensiveRebounds * scale, projectedAssists: base.projectedAssists * scale, projectedSteals: base.projectedSteals * scale, projectedBlocks: base.projectedBlocks * scale, projectedTurnovers: base.projectedTurnovers * scale };
  projection.projectedFantasyPointsPerGame = calculateFantasyPoints({ points: projection.projectedPoints, offensiveRebounds: projection.projectedOffensiveRebounds, defensiveRebounds: projection.projectedDefensiveRebounds, assists: projection.projectedAssists, steals: projection.projectedSteals, blocks: projection.projectedBlocks, turnovers: projection.projectedTurnovers, doubleDoubles: projection.projectedDoubleDoubles / Math.max(1, projection.projectedGames), tripleDoubles: projection.projectedTripleDoubles / Math.max(1, projection.projectedGames) }, config.scoring);
  projection.projectedFantasyPointsPerGameLow = (base.projectedFantasyPointsPerGameLow ?? base.projectedFantasyPointsPerGame) * scale;
  projection.projectedFantasyPointsPerGameHigh = (base.projectedFantasyPointsPerGameHigh ?? base.projectedFantasyPointsPerGame) * scale;
  return { ...metrics, projection };
}
