import { RECOMMENDATION_CONFIG } from "../config/recommendationConfig";
import type { Player, YahooPosition } from "../types";
import type { LeagueConfig } from "../types";
import { DEFAULT_LEAGUE_CONFIG, getDraftedRosterSize } from "../config/leagueConfig";
import { assignRosterSlots } from "./rosterAssignment";

const POSITIONS: YahooPosition[] = ["G", "F", "C"];

export function getRosterCoverage(
  roster: readonly Player[],
): Record<YahooPosition, number> {
  return {
    G: roster.filter((player) => player.yahooPositions.includes("G")).length,
    F: roster.filter((player) => player.yahooPositions.includes("F")).length,
    C: roster.filter((player) => player.yahooPositions.includes("C")).length,
  };
}

export function calculateRosterFitScore(
  player: Player,
  currentRoster: readonly Player[],
  leagueConfig: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): number {
  const config = RECOMMENDATION_CONFIG.rosterFit;
  if (player.yahooPositions.length === 0) {
    return config.neutralScore;
  }

  if (currentRoster.length >= getDraftedRosterSize(leagueConfig)) return config.neutralScore;
  const assigned = assignRosterSlots(currentRoster, leagueConfig);
  const filled = { G: 0, F: 0, C: 0 };
  for (const entry of assigned.assignments) if (entry.slot === "G" || entry.slot === "F" || entry.slot === "C") filled[entry.slot] += 1;
  const open = {
    G: Math.max(0, leagueConfig.roster.G - filled.G),
    F: Math.max(0, leagueConfig.roster.F - filled.F),
    C: Math.max(0, leagueConfig.roster.C - filled.C),
  };
  const remainingDraftedSlots = getDraftedRosterSize(leagueConfig) - currentRoster.length;
  const positionScores = player.yahooPositions.map((position) => {
    if (open[position] === 0) return config.neutralScore - 5;
    const urgency = open[position] / Math.max(1, remainingDraftedSlots);
    return config.neutralScore + config.deficitBonusRange * Math.min(1, 0.35 + urgency);
  });

  return clamp(
    positionScores.reduce((total, value) => total + value, 0) /
      positionScores.length,
    0,
    100,
  );
}

export function calculateFlexibilityScore(player: Player): number {
  const count = new Set(
    player.yahooPositions.filter((position) => POSITIONS.includes(position)),
  ).size;
  const scores = RECOMMENDATION_CONFIG.flexibilityScores;

  if (count === 0) return scores.unknown;
  if (count === 1) return scores.onePosition;
  if (count === 2) return scores.twoPositions;
  return scores.threePositions;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
