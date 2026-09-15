import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import type { LeagueConfig, NewPlayerProjectionInput, Player, Projection, ProjectionMetrics } from "../types";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import { calculateFantasyPoints } from "./fantasyPoints";
import { estimateProjectedBonusCounts } from "./projectionModel";

interface Candidate { player: Player; metrics: ProjectionMetrics; newPlayerInput?: NewPlayerProjectionInput }
export interface TeamMinutesBudgetResult {
  metricsByPlayerId: Map<string, ProjectionMetrics>;
  adjustmentByPlayerId: Map<string, number>;
  teams: Array<{ team: string; before: number; after: number; outsideTolerance: boolean }>;
  capViolations: number;
  minutesOutsideRoleRangePlayerIds: string[];
}

export function reconcileTeamMinutes(candidates: readonly Candidate[], leagueConfig: LeagueConfig = DEFAULT_LEAGUE_CONFIG): TeamMinutesBudgetResult {
  const grouped = new Map<string, Candidate[]>();
  for (const candidate of candidates) if (candidate.player.nbaTeam) grouped.set(candidate.player.nbaTeam, [...(grouped.get(candidate.player.nbaTeam) ?? []), candidate]);
  const metricsByPlayerId = new Map(candidates.map((candidate) => [candidate.player.id, candidate.metrics]));
  const adjustmentByPlayerId = new Map<string, number>();
  const teams: TeamMinutesBudgetResult["teams"] = [];
  const minutesOutsideRoleRangePlayerIds: string[] = [];
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
        const declineFactor = member.metrics.careerStageProjection?.careerTrend === "STRUCTURAL_DECLINE" ? 1.35 : member.metrics.careerStageProjection?.careerTrend === "MILD_DECLINE" ? 1.15 : 1;
        const capacity = Math.max(0, current - normalRoleFloor(member));
        return { member, capacity, priority: compressionPriority(member, protectedRotation.has(member.player.id), rotationCore.has(member.player.id), members) * declineFactor };
      }).filter((item) => item.capacity > 0);
      const weightedPriority = adjustable.reduce((sum, item) => sum + item.priority, 0);
      if (!weightedPriority) break;
      for (const item of adjustable) {
        const reduction = Math.min(item.capacity, excess * item.priority / weightedPriority);
        allocation.set(item.member.player.id, allocation.get(item.member.player.id)! - reduction);
      }
      excess = Math.max(0, [...allocation.values()].reduce((sum, value) => sum + value, 0) - target);
    }
    if (excess > DRAFT_VALUE_CONFIG.minutesBudget.tolerance) {
      const fallback = members.filter((member) => !protectedRotation.has(member.player.id)).map((member) => ({ member, capacity: allocation.get(member.player.id)!, priority: compressionPriority(member, false, rotationCore.has(member.player.id), members) })).filter((item) => item.capacity > 0);
      const weightedPriority = fallback.reduce((sum, item) => sum + item.priority, 0);
      for (const item of fallback) {
        const reduction = Math.min(item.capacity, excess * item.priority / Math.max(.001, weightedPriority));
        allocation.set(item.member.player.id, allocation.get(item.member.player.id)! - reduction);
      }
      excess = Math.max(0, [...allocation.values()].reduce((sum, value) => sum + value, 0) - target);
      if (excess > DRAFT_VALUE_CONFIG.minutesBudget.tolerance) {
        for (const member of [...members].filter((member) => protectedRotation.has(member.player.id)).sort((left, right) => rotationPriority(left) - rotationPriority(right))) {
          const current = allocation.get(member.player.id)!;
          const reduction = Math.min(excess, Math.max(0, current - normalRoleFloor(member)));
          allocation.set(member.player.id, current - reduction);
          excess -= reduction;
          if (excess <= DRAFT_VALUE_CONFIG.minutesBudget.tolerance) break;
        }
      }
    }
    for (const member of members) {
      const nextMinutes = allocation.get(member.player.id)!;
      const base = member.metrics.projection;
      const latentAdjustment = base.projectedMinutes > 0 ? nextMinutes / base.projectedMinutes - 1 : 0;
      const adjustment = Math.max(-maximumAppliedCompression(member), latentAdjustment);
      if (nextMinutes + .01 < (base.projectedMinutesLow ?? 0)) minutesOutsideRoleRangePlayerIds.push(member.player.id);
      adjustmentByPlayerId.set(member.player.id, adjustment);
      if (Math.abs(adjustment) > DRAFT_VALUE_CONFIG.minutesBudget.maximumCompression + 1e-8) capViolations++;
      if (Math.abs(adjustment) > 1e-8) metricsByPlayerId.set(member.player.id, scaleProjection(member.metrics, adjustment, leagueConfig));
    }
    const after = [...allocation.values()].reduce((sum, value) => sum + value, 0);
    teams.push({ team, before, after, outsideTolerance: after > target + DRAFT_VALUE_CONFIG.minutesBudget.tolerance });
  }
  return { metricsByPlayerId, adjustmentByPlayerId, teams, capViolations, minutesOutsideRoleRangePlayerIds };
}

function rotationPriority(member: Candidate): number { return member.metrics.projection.projectedMinutes * .4 + member.metrics.projection.projectedFantasyPointsPerGame * .35 + (member.metrics.roleAssessment?.skillConfidence ?? member.metrics.modelConfidence) * 8 + (member.metrics.roleAssessment?.currentRoleSecurity ?? .5) * 3 + (isLikelyStarter(member) ? 12 : 0); }
function roleTier(member: Candidate): "LOCKED" | "LIKELY" | "CORE" | "UNCERTAIN" { const role = member.metrics.roleAssessment; if (role?.currentTeamContinuity === true && (role.currentRoleSecurity >= .78 || isEstablishedIncumbent(member))) return "LOCKED"; if (isLikelyStarter(member)) return "LIKELY"; if ((role?.currentRoleSecurity ?? .5) >= .58 && member.metrics.projection.projectedMinutes >= 20) return "CORE"; return "UNCERTAIN"; }
function isEstablishedIncumbent(member: Candidate): boolean { const security = member.metrics.roleAssessment?.currentRoleSecurity ?? 0; const latestMinutes = member.player.historicalStats[0]?.minutesPerGame ?? 0; return security >= .45 && latestMinutes >= 28 && member.metrics.projectionSource !== "Rookie/new-player model"; }
function isLikelyStarter(member: Candidate): boolean { return member.metrics.projectionSource === "Rookie/new-player model" && member.newPlayerInput?.roleExpectation === "Likely starter" && (member.metrics.newPlayerDetails?.draftCapitalContribution ?? 0) >= .55 && member.metrics.projection.projectedMinutes >= 24; }
function maximumAppliedCompression(member: Candidate): number { const cap = DRAFT_VALUE_CONFIG.minutesBudget; const tier = roleTier(member); return tier === "LOCKED" ? cap.lockedStarterCompression : tier === "LIKELY" ? cap.likelyStarterCompression : tier === "CORE" ? cap.coreRotationCompression : cap.uncertainCompression; }
function normalRoleFloor(member: Candidate): number { const base = member.metrics.projection.projectedMinutes; return Math.max(0, member.metrics.projection.projectedMinutesLow ?? 0, base * (1 - maximumAppliedCompression(member))); }
function compressionPriority(member: Candidate, protectedRotation: boolean, rotationCore: boolean, teammates: readonly Candidate[]): number { const tier = roleTier(member); const rolePriority = tier === "LOCKED" ? (protectedRotation ? .04 : .1) : tier === "LIKELY" ? (protectedRotation ? .12 : .22) : tier === "CORE" ? (rotationCore ? .35 : .55) : 1.2 + (1 - (member.metrics.roleAssessment?.currentRoleSecurity ?? .5)); return rolePriority * positionalCongestion(member, teammates); }
function positionalCongestion(member: Candidate, teammates: readonly Candidate[]): number { if (!member.player.yahooPositions.length) return 1; const compatibleCount = member.player.yahooPositions.reduce((sum, position) => sum + teammates.filter((candidate) => candidate.player.yahooPositions.includes(position)).length, 0) / member.player.yahooPositions.length; return Math.min(1.35, Math.max(.8, .8 + compatibleCount / 10)); }

function scaleProjection(metrics: ProjectionMetrics, adjustment: number, config: LeagueConfig): ProjectionMetrics {
  const base = metrics.projection;
  const scale = 1 + adjustment;
  const projection: Projection = { ...base, projectedMinutes: base.projectedMinutes * scale, projectedMinutesLow: (base.projectedMinutesLow ?? base.projectedMinutes) * scale, projectedMinutesHigh: (base.projectedMinutesHigh ?? base.projectedMinutes) * scale, projectedPoints: base.projectedPoints * scale, projectedOffensiveRebounds: base.projectedOffensiveRebounds * scale, projectedDefensiveRebounds: base.projectedDefensiveRebounds * scale, projectedAssists: base.projectedAssists * scale, projectedSteals: base.projectedSteals * scale, projectedBlocks: base.projectedBlocks * scale, projectedTurnovers: base.projectedTurnovers * scale };
  Object.assign(projection, estimateProjectedBonusCounts(projection, projection.projectedGames));
  projection.projectedFantasyPointsPerGame = calculateFantasyPoints({ points: projection.projectedPoints, offensiveRebounds: projection.projectedOffensiveRebounds, defensiveRebounds: projection.projectedDefensiveRebounds, assists: projection.projectedAssists, steals: projection.projectedSteals, blocks: projection.projectedBlocks, turnovers: projection.projectedTurnovers, doubleDoubles: projection.projectedDoubleDoubles / Math.max(1, projection.projectedGames), tripleDoubles: projection.projectedTripleDoubles / Math.max(1, projection.projectedGames) }, config.scoring);
  projection.projectedFantasyPointsPerGameLow = (base.projectedFantasyPointsPerGameLow ?? base.projectedFantasyPointsPerGame) * scale;
  projection.projectedFantasyPointsPerGameHigh = (base.projectedFantasyPointsPerGameHigh ?? base.projectedFantasyPointsPerGame) * scale;
  return { ...metrics, projection };
}
