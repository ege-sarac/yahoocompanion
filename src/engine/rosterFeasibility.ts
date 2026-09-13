import { POST_MOCK_CONFIG } from "../config/postMockConfig";
import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { CandidateFeasibility, LeagueConfig, Player, PositionNeedUrgency, RosterFeasibility, YahooPosition } from "../types";
import { assignRosterSlots } from "./rosterAssignment";

const POSITIONS: YahooPosition[] = ["G", "F", "C"];

export function analyzeRosterFeasibility(
  roster: readonly Player[],
  remainingUserPicks: number,
  availablePlayers: readonly Player[] = [],
  config: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): RosterFeasibility {
  const assignment = assignRosterSlots(roster, config);
  const filled = { G: 0, F: 0, C: 0 };
  for (const entry of assignment.assignments) if (entry.slot === "G" || entry.slot === "F" || entry.slot === "C") filled[entry.slot]++;
  const restrictiveSlotsRequired = {
    G: Math.max(0, config.roster.G - filled.G),
    F: Math.max(0, config.roster.F - filled.F),
    C: Math.max(0, config.roster.C - filled.C),
  };
  const minimumPicksNeededForRestrictiveSlots = POSITIONS.reduce((sum, position) => sum + restrictiveSlotsRequired[position], 0);
  const feasibilitySlack = remainingUserPicks - minimumPicksNeededForRestrictiveSlots;
  const poolAssignment = availablePlayers.length ? assignRosterSlots([...roster, ...availablePlayers], config) : null;
  const poolCoversNeeds = !poolAssignment || POSITIONS.every((position) =>
    poolAssignment.assignments.filter((entry) => entry.slot === position).length >= config.roster[position],
  );
  return {
    remainingUserPicks,
    restrictiveSlotsRequired,
    minimumPicksNeededForRestrictiveSlots,
    feasibilitySlack,
    canCompleteRoster: feasibilitySlack >= 0 && poolCoversNeeds,
    exposedPositions: POSITIONS.filter((position) => restrictiveSlotsRequired[position] > 0),
    unknownEligibilityCount: availablePlayers.filter((player) => player.yahooPositions.length === 0).length,
  };
}

export function analyzeCandidateFeasibility(
  roster: readonly Player[],
  candidate: Player,
  remainingUserPicks: number,
  availablePlayers: readonly Player[] = [],
  config: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
  baseFeasibility?: RosterFeasibility,
): CandidateFeasibility {
  const current = baseFeasibility ?? analyzeRosterFeasibility(roster, remainingUserPicks, availablePlayers, config);
  const candidateWasAvailable = availablePlayers.some((player) => player.id === candidate.id);
  const candidateRosterOnly = analyzeRosterFeasibility(
    [...roster, candidate],
    Math.max(0, remainingUserPicks - 1),
    [],
    config,
  );
  const resulting = candidateWasAvailable
    ? {
        ...candidateRosterOnly,
        canCompleteRoster: current.canCompleteRoster && candidateRosterOnly.feasibilitySlack >= 0,
        unknownEligibilityCount: Math.max(0, current.unknownEligibilityCount - (candidate.yahooPositions.length === 0 ? 1 : 0)),
      }
    : analyzeRosterFeasibility([...roster, candidate], Math.max(0, remainingUserPicks - 1), availablePlayers, config);
  const relieved = POSITIONS.filter((position) => resulting.restrictiveSlotsRequired[position] < current.restrictiveSlotsRequired[position]);
  return {
    candidateKeepsRosterFeasible: resulting.canCompleteRoster,
    candidateFeasibilityImpact: resulting.feasibilitySlack - current.feasibilitySlack,
    candidateSlotsRelieved: relieved,
    candidateCriticalNeedMatch: relieved.some((position) => current.restrictiveSlotsRequired[position] > 0 && current.feasibilitySlack <= 1),
    resultingFeasibility: resulting,
  };
}

export function calculatePositionNeedUrgency(
  feasibility: RosterFeasibility,
  scarcity: Record<YahooPosition, { score: number }>,
  picksUntilNextUserPick: number | null,
  draftProgress: number,
  marketDepletion: Partial<Record<YahooPosition, number>> = {},
): Record<YahooPosition, PositionNeedUrgency> {
  return Object.fromEntries(POSITIONS.map((position) => {
    const required = feasibility.restrictiveSlotsRequired[position];
    let score = 0;
    if (required > 0) {
      const constraint = clamp(1 - feasibility.feasibilitySlack / Math.max(1, POST_MOCK_CONFIG.feasibility.modestSlack), 0, 1);
      const wait = clamp((picksUntilNextUserPick ?? 0) / 20, 0, 1);
      const requirementPressure = clamp(required / Math.max(1, feasibility.remainingUserPicks), 0, 1);
      score = clamp(requirementPressure * .18 + draftProgress * .16 + constraint * .5 + scarcity[position].score / 100 * .08 * (constraint + draftProgress) + (marketDepletion[position] ?? 0) * .12 * (constraint + draftProgress) + wait * .04 * (constraint + draftProgress), 0, 1);
      if (feasibility.feasibilitySlack <= 0) score = 1;
    }
    return [position, { score, requiredSlots: required, label: urgencyLabel(score) }];
  })) as Record<YahooPosition, PositionNeedUrgency>;
}

function urgencyLabel(score: number): PositionNeedUrgency["label"] {
  if (score >= 0.85) return "CRITICAL";
  if (score >= POST_MOCK_CONFIG.feasibility.highUrgency) return "HIGH";
  if (score >= POST_MOCK_CONFIG.feasibility.moderateUrgency) return "MODERATE";
  return "LOW";
}

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
