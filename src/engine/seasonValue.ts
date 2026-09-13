import { DRAFT_VALUE_CONFIG } from "../config/draftValueConfig";
import type { LeagueConfig, Player, ReplacementLevelProfile, SeasonValueProjection, YahooPosition } from "../types";

export interface SeasonValueCandidate { player: Player; projectedFantasyPointsPerGame: number }

export function calculateReplacementLevels(candidates: readonly SeasonValueCandidate[], config: LeagueConfig): ReplacementLevelProfile {
  const positions: YahooPosition[] = ["G", "F", "C"];
  const eligibleCounts = Object.fromEntries(positions.map((position) => [position, candidates.filter((candidate) => candidate.player.yahooPositions.includes(position)).length])) as Record<YahooPosition, number>;
  const totalEligible = Math.max(1, Object.values(eligibleCounts).reduce((sum, value) => sum + value, 0));
  const flexibleSlots = config.roster.UTIL * DRAFT_VALUE_CONFIG.replacement.utilityRosterShare + config.roster.BN * DRAFT_VALUE_CONFIG.replacement.benchRosterShare;
  const boundaryByPosition = Object.fromEntries(positions.map((position) => [position, Math.max(DRAFT_VALUE_CONFIG.replacement.minimumBoundary, Math.round(config.teamCount * (config.roster[position] + flexibleSlots * eligibleCounts[position] / totalEligible)))])) as Record<YahooPosition, number>;
  const byPosition = Object.fromEntries(positions.map((position) => {
    const sorted = candidates.filter((candidate) => candidate.player.yahooPositions.includes(position)).map((candidate) => candidate.projectedFantasyPointsPerGame).sort((a, b) => b - a);
    const index = Math.min(Math.max(0, boundaryByPosition[position] - 1), Math.max(0, sorted.length - 1));
    const selected = sorted[index] ?? percentile(candidates.map((candidate) => candidate.projectedFantasyPointsPerGame).sort((a, b) => a - b), DRAFT_VALUE_CONFIG.replacement.fallbackPercentile);
    // A tiny/synthetic pool cannot meaningfully establish its own waiver line.
    // Keep a little VORP separation without affecting full real-player pools.
    return [position, sorted.length < boundaryByPosition[position] ? selected * .95 : selected];
  })) as Record<YahooPosition, number>;
  const poolValues = candidates.map((candidate) => candidate.projectedFantasyPointsPerGame).sort((a, b) => a - b);
  const poolEstimate = percentile(poolValues, DRAFT_VALUE_CONFIG.replacement.fallbackPercentile);
  const pool = candidates.length < config.teamCount * 2 ? poolEstimate * .95 : poolEstimate;
  return { byPosition, pool, boundaryByPosition };
}

export function calculateSeasonValue(player: Player, projectedFantasyPointsPerGame: number, expectedGames: number, replacement: ReplacementLevelProfile): SeasonValueProjection {
  const replacementFantasyPointsPerGame = player.yahooPositions.length ? Math.min(...player.yahooPositions.map((position) => replacement.byPosition[position])) : replacement.pool;
  const perGameVorp = projectedFantasyPointsPerGame - replacementFantasyPointsPerGame;
  const seasonVorp = perGameVorp * expectedGames;
  return { replacementFantasyPointsPerGame, perGameVorp, seasonVorp, availabilityAdjustedFantasyPointsEquivalent: replacementFantasyPointsPerGame + seasonVorp / DRAFT_VALUE_CONFIG.seasonLength, projectedTotalFantasyPoints: projectedFantasyPointsPerGame * expectedGames };
}
function percentile(values: number[], p: number): number { return values.length ? values[Math.floor((values.length - 1) * p)] : 0; }
