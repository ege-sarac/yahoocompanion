import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { DraftPick, DraftState, LeagueConfig, MarketDataSet, NewPlayerProjectionInput, Player, PlayerRecommendation, PlayerRoleDataSet, PositionNeedUrgency, PositionRunSummary, PositionScarcitySummary, YahooPosition } from "../types";
import { createInitialDraftState, deriveMyRoster, draftPlayer } from "./draftState";
import { rankPlayers } from "./recommendationEngine";

export interface DraftReplaySnapshot {
  overallPick: number;
  rosterBeforePick: string[];
  positionNeedUrgency: Record<YahooPosition, PositionNeedUrgency>;
  feasibilitySlack: number;
  topFive: PlayerRecommendation[];
  selectedPlayerId: string | null;
  selectedRank: number | null;
  selectedRecommendation: PlayerRecommendation | null;
  bestSeasonValue: PlayerRecommendation | null;
  bestByPosition: Partial<Record<YahooPosition, PlayerRecommendation>>;
  scarcityByPosition: Record<YahooPosition, PositionScarcitySummary>;
  recentRuns: Record<YahooPosition, PositionRunSummary>;
  comment: string;
}

export interface DraftReplayResult { snapshots: DraftReplaySnapshot[]; warnings: string[]; finalState: DraftState }

export function replayDraft(
  players: readonly Player[],
  rawPicks: readonly Partial<DraftPick>[],
  config: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
  newPlayerInputs: readonly NewPlayerProjectionInput[] = [],
  manualUnavailablePlayerIds: readonly string[] = [],
  roleData?: PlayerRoleDataSet,
  marketData?: MarketDataSet,
): DraftReplayResult {
  const playerById = new Map(players.map((player) => [player.id, player]));
  let state = { ...createInitialDraftState(), manualUnavailablePlayerIds: manualUnavailablePlayerIds.filter((id) => playerById.has(id)) };
  const snapshots: DraftReplaySnapshot[] = [], warnings: string[] = [];
  for (let overallPick = 1; overallPick <= rawPicks.length; overallPick++) {
    const raw = rawPicks[overallPick - 1];
    const selectedId = typeof raw.playerId === "string" ? raw.playerId : null;
    const isMyPick = ((overallPick - 1) % (config.teamCount * 2) < config.teamCount ? ((overallPick - 1) % config.teamCount) + 1 : config.teamCount - ((overallPick - 1) % config.teamCount)) === config.userDraftSlot;
    if (isMyPick) {
      const ranking = rankPlayers({ players, draftedPlayerIds: state.draftedPlayerIds, manualUnavailablePlayerIds: state.manualUnavailablePlayerIds, myRoster: deriveMyRoster(state, players), currentRound: Math.ceil(overallPick / config.teamCount), currentOverallPick: overallPick, draftPicks: state.picks, leagueConfig: config, newPlayerInputs, teamEcosystemEnabled: true, roleData, marketData });
      const selectedRankIndex = selectedId ? ranking.recommendations.findIndex((entry) => entry.player.id === selectedId) : -1;
      const selectedRecommendation = selectedRankIndex < 0 ? null : ranking.recommendations[selectedRankIndex];
      const bestSeasonValue = [...ranking.recommendations].sort((left, right) => right.seasonValue.seasonVorp - left.seasonValue.seasonVorp)[0] ?? null;
      const bestByPosition = Object.fromEntries((["G", "F", "C"] as YahooPosition[]).flatMap((position) => { const found = ranking.recommendations.find((entry) => entry.player.yahooPositions.includes(position)); return found ? [[position, found]] : []; }));
      const missingCritical = (Object.keys(ranking.positionNeedUrgency) as YahooPosition[]).find((position) => ranking.positionNeedUrgency[position].label === "CRITICAL" && !ranking.topRecommendations.some((entry) => entry.player.yahooPositions.includes(position)));
      snapshots.push({ overallPick, rosterBeforePick: [...state.myPlayerIds], positionNeedUrgency: ranking.positionNeedUrgency, feasibilitySlack: ranking.rosterFeasibility.feasibilitySlack, topFive: ranking.topRecommendations, selectedPlayerId: selectedId, selectedRank: selectedRankIndex < 0 ? null : selectedRankIndex + 1, selectedRecommendation, bestSeasonValue, bestByPosition, scarcityByPosition: ranking.scarcityByPosition, recentRuns: ranking.recentRuns, comment: missingCritical ? `${missingCritical} need was critical but no ${missingCritical} reached Top 5.` : selectedRankIndex < 0 ? "Selected player was unavailable, unknown, or outside the projectable ranking." : selectedRankIndex < 5 ? "Selected player was a Top 5 recommendation." : "Selected player was outside the Top 5." });
    }
    if (!selectedId || !playerById.has(selectedId)) { warnings.push(`Pick ${overallPick}: unknown or missing player; replay continued.`); continue; }
    if (state.draftedPlayerIds.includes(selectedId)) { warnings.push(`Pick ${overallPick}: duplicate ${selectedId}; replay continued.`); continue; }
    while (state.currentOverallPick < overallPick) state = { ...state, currentOverallPick: state.currentOverallPick + 1 };
    try { state = draftPlayer(state, selectedId, config); } catch (error) { warnings.push(`Pick ${overallPick}: ${error instanceof Error ? error.message : "invalid selection"}`); state = { ...state, currentOverallPick: overallPick + 1 }; }
  }
  return { snapshots, warnings, finalState: state };
}
