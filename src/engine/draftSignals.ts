import { RECOMMENDATION_CONFIG } from "../config/recommendationConfig";
import type { DraftPick, Player, PositionRunSummary, YahooPosition } from "../types";

const POSITIONS: YahooPosition[] = ["G", "F", "C"];

export function calculateRecentPositionRuns(
  picks: readonly DraftPick[],
  players: readonly Player[],
  windowSize = RECOMMENDATION_CONFIG.draftSignals.recentWindow,
): Record<YahooPosition, PositionRunSummary> {
  const byId = new Map(players.map((player) => [player.id, player]));
  const genuine = picks.filter((pick) => pick.pickProvenance !== "SYNTHETIC_PADDING" && pick.pickProvenance !== "MANUAL_EXTENSION");
  const recent = genuine.slice(-windowSize);
  const earlier = genuine.slice(0, -windowSize);
  return Object.fromEntries(POSITIONS.map((position) => {
    const recentCount = fractionalCount(recent, byId, position);
    const recentRate = recent.length ? recentCount / recent.length : 0;
    const baselineCount = fractionalCount(earlier, byId, position);
    const baselineRate = earlier.length >= windowSize ? baselineCount / earlier.length : 1 / 3;
    const runPressure = clamp((recentRate - baselineRate) * RECOMMENDATION_CONFIG.draftSignals.recentRunScale, 0, 1);
    return [position, { position, recentCount, runPressure, label: runPressure >= 0.65 ? "Strong run" : runPressure >= 0.3 ? "Mild run" : "No run" }];
  })) as Record<YahooPosition, PositionRunSummary>;
}

function fractionalCount(picks: readonly DraftPick[], byId: Map<string, Player>, position: YahooPosition): number {
  return picks.reduce((total, pick) => {
    const positions = byId.get(pick.playerId)?.yahooPositions ?? [];
    return total + (positions.includes(position) ? 1 / Math.max(1, positions.length) : 0);
  }, 0);
}
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
