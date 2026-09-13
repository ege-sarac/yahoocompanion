import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import type { CandidateFeasibility, PositionContextBreakdown } from "../types";

export interface PositionContextInput {
  draftProgress: number;
  feasibility: CandidateFeasibility;
  needUrgency: number;
  scarcity: number;
  tierDropoff: number;
  recentRun: number;
  flexibility: number;
  marketDepletion: number;
}

export function calculatePositionContextComposite(input: PositionContextInput): PositionContextBreakdown {
  const weights = DRAFT_VALUE_CONFIG.positionComposite.weights;
  const feasibility = input.feasibility.candidateKeepsRosterFeasible ? input.feasibility.candidateSlotsRelieved.length ? 100 : 50 : 0;
  const parts = { feasibility, needUrgency: input.needUrgency, scarcity: input.scarcity, tierDropoff: input.tierDropoff, recentRun: input.recentRun, flexibility: input.flexibility, marketDepletion: input.marketDepletion };
  const uncappedComposite = Object.entries(parts).reduce((sum, [key, value]) => sum + value * weights[key as keyof typeof weights], 0);
  const criticalOverride = input.feasibility.candidateCriticalNeedMatch || !input.feasibility.candidateKeepsRosterFeasible;
  const normalCap = lerp(DRAFT_VALUE_CONFIG.positionComposite.earlyContributionCap, DRAFT_VALUE_CONFIG.positionComposite.lateContributionCap, input.draftProgress);
  const cap = criticalOverride ? DRAFT_VALUE_CONFIG.positionComposite.criticalOverrideCap : normalCap;
  const rawContribution = (uncappedComposite - DRAFT_VALUE_CONFIG.positionComposite.neutralComponent) / 50 * cap;
  const contribution = Math.max(-cap, Math.min(cap, criticalOverride && !input.feasibility.candidateKeepsRosterFeasible ? -cap : rawContribution));
  return { ...parts, uncappedComposite, composite: DRAFT_VALUE_CONFIG.positionComposite.neutralComponent + contribution / Math.max(1, cap) * 50, contribution, cap, criticalOverride };
}
function lerp(a: number, b: number, t: number): number { return a + (b - a) * Math.min(1, Math.max(0, t)); }
