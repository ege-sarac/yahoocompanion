import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { DraftPick, DraftState, LeagueConfig, MarketDataSet, NewPlayerProjectionInput, Player, PlayerRecommendation, PlayerRoleDataSet, PositionNeedUrgency, PositionRunSummary, PositionScarcitySummary, YahooPosition } from "../types";
import { createInitialDraftState, deriveMyRoster, draftPlayer } from "./draftState";
import { createDecisionSnapshot, upsertDecisionSnapshot } from "./decisionLog";
import { rankPlayers } from "./recommendationEngine";
import { getSnakeDraftTeamNumber, getUserPickSchedule } from "./draftOrder";

export interface DraftReplaySnapshot {
  overallPick: number;
  rosterBeforePick: string[];
  positionNeedUrgency: Record<YahooPosition, PositionNeedUrgency>;
  feasibilitySlack: number;
  topFive: PlayerRecommendation[];
  selectedPlayerId: string | null;
  availableAtDecision: boolean;
  selectedRank: number | null;
  selectedRecommendation: PlayerRecommendation | null;
  bestSeasonValue: PlayerRecommendation | null;
  bestByPosition: Partial<Record<YahooPosition, PlayerRecommendation>>;
  scarcityByPosition: Record<YahooPosition, PositionScarcitySummary>;
  recentRuns: Record<YahooPosition, PositionRunSummary>;
  topFiveSurvivalToNextTurn: number | null;
  nextWindowRecallAt5: number | null;
  nextWindowRecallAt10: number | null;
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
    const isMyPick = getSnakeDraftTeamNumber(overallPick, config.teamCount) === config.userDraftSlot;
    if (isMyPick) {
      const ranking = rankPlayers({ players, draftedPlayerIds: state.draftedPlayerIds, manualUnavailablePlayerIds: state.manualUnavailablePlayerIds, myRoster: deriveMyRoster(state, players), currentRound: Math.ceil(overallPick / config.teamCount), currentOverallPick: overallPick, draftPicks: state.picks, leagueConfig: config, newPlayerInputs, teamEcosystemEnabled: true, roleData, marketData, decisionLog: state.decisionLog });
      const selectedRankIndex = selectedId ? ranking.recommendations.findIndex((entry) => entry.player.id === selectedId) : -1;
      const selectedRecommendation = selectedRankIndex < 0 ? null : ranking.recommendations[selectedRankIndex];
      const bestSeasonValue = [...ranking.recommendations].sort((left, right) => right.seasonValue.seasonVorp - left.seasonValue.seasonVorp)[0] ?? null;
      const bestByPosition = Object.fromEntries((["G", "F", "C"] as YahooPosition[]).flatMap((position) => { const found = ranking.recommendations.find((entry) => entry.player.yahooPositions.includes(position)); return found ? [[position, found]] : []; }));
      const missingCritical = (Object.keys(ranking.positionNeedUrgency) as YahooPosition[]).find((position) => ranking.positionNeedUrgency[position].label === "CRITICAL" && !ranking.topRecommendations.some((entry) => entry.player.yahooPositions.includes(position)));
      const nextUserPick = getUserPickSchedule(overallPick, config).nextUserPick;
      const nextWindow = nextUserPick === null ? null : rawPicks.slice(overallPick, nextUserPick - 1).map((pick) => typeof pick.playerId === "string" ? pick.playerId : null).filter((id): id is string => id !== null);
      const topFiveIds = ranking.topRecommendations.map((entry) => entry.player.id);
      const topFiveSurvivalToNextTurn = nextWindow === null ? null : topFiveIds.filter((id) => !nextWindow.includes(id)).length;
      const nextWindowRecallAt5 = nextWindow === null || nextWindow.length === 0 ? null : nextWindow.filter((id) => topFiveIds.includes(id)).length / nextWindow.length;
      const topTenIds = ranking.recommendations.slice(0, 10).map((entry) => entry.player.id);
      const nextWindowRecallAt10 = nextWindow === null || nextWindow.length === 0 ? null : nextWindow.filter((id) => topTenIds.includes(id)).length / nextWindow.length;
      const availableAtDecision = selectedId !== null && playerById.has(selectedId) && !state.draftedPlayerIds.includes(selectedId) && !state.manualUnavailablePlayerIds.includes(selectedId);
      snapshots.push({ overallPick, rosterBeforePick: [...state.myPlayerIds], positionNeedUrgency: ranking.positionNeedUrgency, feasibilitySlack: ranking.rosterFeasibility.feasibilitySlack, topFive: ranking.topRecommendations, selectedPlayerId: selectedId, availableAtDecision, selectedRank: selectedRankIndex < 0 ? null : selectedRankIndex + 1, selectedRecommendation, bestSeasonValue, bestByPosition, scarcityByPosition: ranking.scarcityByPosition, recentRuns: ranking.recentRuns, topFiveSurvivalToNextTurn, nextWindowRecallAt5, nextWindowRecallAt10, comment: missingCritical ? `${missingCritical} need was critical but no ${missingCritical} reached Top 5.` : !availableAtDecision ? "Selected player was unavailable at this decision." : selectedRankIndex < 0 ? "Selected player was unknown or outside the projectable ranking." : selectedRankIndex < 5 ? "Selected player was a Top 5 recommendation." : "Selected player was outside the Top 5." });
      state = { ...state, decisionLog: upsertDecisionSnapshot(state.decisionLog, createDecisionSnapshot(overallPick, state.myPlayerIds, { mode: "Normal", positions: [] }, ranking.topRecommendations)) };
    }
    if (!selectedId || !playerById.has(selectedId)) { warnings.push(`Pick ${overallPick}: unknown or missing player; replay continued.`); continue; }
    if (state.draftedPlayerIds.includes(selectedId)) { warnings.push(`Pick ${overallPick}: duplicate ${selectedId}; replay continued.`); continue; }
    while (state.currentOverallPick < overallPick) state = { ...state, currentOverallPick: state.currentOverallPick + 1 };
    try { state = draftPlayer(state, selectedId, config); } catch (error) { warnings.push(`Pick ${overallPick}: ${error instanceof Error ? error.message : "invalid selection"}`); state = { ...state, currentOverallPick: overallPick + 1 }; }
  }
  return { snapshots, warnings, finalState: state };
}
