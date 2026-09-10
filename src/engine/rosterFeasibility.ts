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
): CandidateFeasibility {
  const current = analyzeRosterFeasibility(roster, remainingUserPicks, availablePlayers, config);
  const resulting = analyzeRosterFeasibility(
    [...roster, candidate],
    Math.max(0, remainingUserPicks - 1),
    availablePlayers.filter((player) => player.id !== candidate.id),
    config,
  );
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
): Record<YahooPosition, PositionNeedUrgency> {
  return Object.fromEntries(POSITIONS.map((position) => {
    const required = feasibility.restrictiveSlotsRequired[position];
    let score = 0;
    if (required > 0) {
      const constraint = clamp(1 - feasibility.feasibilitySlack / Math.max(1, POST_MOCK_CONFIG.feasibility.modestSlack), 0, 1);
      const wait = clamp((picksUntilNextUserPick ?? 0) / 20, 0, 1);
      score = clamp(0.12 + required * 0.14 + draftProgress * 0.2 + constraint * 0.42 + scarcity[position].score / 100 * 0.12 + wait * 0.05, 0, 1);
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
