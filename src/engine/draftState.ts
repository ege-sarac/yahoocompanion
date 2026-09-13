import { DEFAULT_LEAGUE_CONFIG, getTotalDraftPicks } from "../config/leagueConfig";
import type { DraftDecisionSnapshot, DraftExportEnvelope, DraftPick, DraftState, LeagueConfig, Player, PositionIntent } from "../types";
import { getMyOverallPicks, getSnakeDraftTeamNumber } from "./draftOrder";
import { createRosterFingerprint, createScoringFingerprint } from "./marketDraft";
import { upsertDecisionSnapshot } from "./decisionLog";

export type DraftAction =
  | { type: "undo-last-pick"; config?: LeagueConfig }
  | { type: "reset" }
  | { type: "replace"; state: DraftState };

export interface CurrentDraftInfo {
  overallPick: number;
  round: number;
  pickInRound: number;
  teamNumber: number;
  isMyTeam: boolean;
}

export function createInitialDraftState(): DraftState {
  return {
    picks: [],
    draftedPlayerIds: [],
    myPlayerIds: [],
    currentOverallPick: 1,
    manualUnavailablePlayerIds: [],
    positionIntent: { mode: "Normal", positions: [] },
    keepPositionPreferenceAfterMyPick: false,
    teamEcosystemEnabled: true,
    showTeamContextDetails: true,
    teamDiversificationMode: "Strong soft cap",
    preferredMaxSameTeam: 2,
    decisionLoggingEnabled: true,
    decisionLog: [],
  };
}

export function getDraftInfo(overallPick: number, config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): CurrentDraftInfo | null {
  if (overallPick < 1 || overallPick > getTotalDraftPicks(config)) {
    return null;
  }

  const round = Math.ceil(overallPick / config.teamCount);
  const pickInRound =
    ((overallPick - 1) % config.teamCount) + 1;
  const teamNumber = getSnakeDraftTeamNumber(
    overallPick,
    config.teamCount,
  );

  return {
    overallPick,
    round,
    pickInRound,
    teamNumber,
    isMyTeam: teamNumber === config.userDraftSlot,
  };
}

export function getNextMyPick(currentOverallPick: number, config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): number | null {
  return getMyOverallPicks(config).find((pick) => pick >= currentOverallPick) ?? null;
}

export function getPreviousMyPick(currentOverallPick: number, config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): number | null {
  return [...getMyOverallPicks(config)].reverse().find((pick) => pick < currentOverallPick) ?? null;
}

export function getPicksUntilMyNextPick(
  currentOverallPick: number, config: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): number | null {
  const nextPick = getNextMyPick(currentOverallPick, config);
  return nextPick === null ? null : nextPick - currentOverallPick;
}

export function getDraftProgress(completedPicks: number, config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): number {
  return Math.min(1, Math.max(0, completedPicks / Math.max(1, getTotalDraftPicks(config) - 1)));
}

export function draftPlayer(state: DraftState, playerId: string, config: LeagueConfig = DEFAULT_LEAGUE_CONFIG, decisionSnapshot?: DraftDecisionSnapshot): DraftState {
  const normalizedPlayerId = playerId.trim();
  if (!normalizedPlayerId) {
    throw new Error("A player ID is required.");
  }

  if (state.currentOverallPick > getTotalDraftPicks(config)) {
    throw new Error("The draft is already complete.");
  }

  if (state.draftedPlayerIds.includes(normalizedPlayerId)) {
    throw new Error("That player has already been drafted.");
  }
  if (state.manualUnavailablePlayerIds.includes(normalizedPlayerId)) {
    throw new Error("That player is marked unavailable.");
  }

  const draftInfo = getDraftInfo(state.currentOverallPick, config);
  if (!draftInfo) {
    throw new Error("The current draft pick is invalid.");
  }

  const pick: DraftPick = {
    ...draftInfo,
    playerId: normalizedPlayerId,
  };

  const shouldClearIntent = draftInfo.isMyTeam && !state.keepPositionPreferenceAfterMyPick;
  return {
    ...state,
    picks: [...state.picks, pick],
    draftedPlayerIds: [...state.draftedPlayerIds, normalizedPlayerId],
    myPlayerIds: draftInfo.isMyTeam
      ? [...state.myPlayerIds, normalizedPlayerId]
      : state.myPlayerIds,
    currentOverallPick: state.currentOverallPick + 1,
    positionIntent: shouldClearIntent ? { mode: "Normal", positions: [] } : state.positionIntent,
    decisionLog: decisionSnapshot && state.decisionLoggingEnabled ? upsertDecisionSnapshot(state.decisionLog, decisionSnapshot) : state.decisionLog,
  };
}

export function draftRecommendedPlayer(
  state: DraftState,
  playerId: string,
  config: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): DraftState {
  return draftPlayer(state, playerId, config);
}

export function undoLastPick(state: DraftState, config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): DraftState {
  if (state.picks.length === 0) {
    return state;
  }

  const picks = state.picks.slice(0, -1);
  return stateFromPicks(picks, config, state);
}

export function replaceDraftPick(
  state: DraftState,
  overallPick: number,
  playerId: string,
  knownPlayerIds?: ReadonlySet<string>,
  config: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): DraftState {
  const normalized = playerId.trim();
  if (knownPlayerIds && !knownPlayerIds.has(normalized)) throw new Error("Replacement player does not exist.");
  const index = state.picks.findIndex((pick) => pick.overallPick === overallPick);
  if (index < 0) throw new Error("That historical pick was not found.");
  if (state.picks.some((pick, pickIndex) => pickIndex !== index && pick.playerId === normalized)) throw new Error("That player is already drafted at another pick.");
  const picks = state.picks.map((pick, pickIndex) => pickIndex === index ? { ...pick, playerId: normalized } : pick);
  return stateFromPicks(picks, config, {
    ...state,
    manualUnavailablePlayerIds: state.manualUnavailablePlayerIds.filter((id) => id !== normalized),
  });
}

export function markPlayerUnavailable(state: DraftState, playerId: string): DraftState {
  const normalized = playerId.trim();
  if (!normalized) throw new Error("A player ID is required.");
  if (state.draftedPlayerIds.includes(normalized)) throw new Error("That player already has a recorded draft pick.");
  if (state.manualUnavailablePlayerIds.includes(normalized)) return state;
  return { ...state, manualUnavailablePlayerIds: [...state.manualUnavailablePlayerIds, normalized] };
}

export function restorePlayerAvailability(state: DraftState, playerId: string): DraftState {
  return { ...state, manualUnavailablePlayerIds: state.manualUnavailablePlayerIds.filter((id) => id !== playerId) };
}

export function setPositionIntent(state: DraftState, intent: PositionIntent): DraftState {
  const positions = [...new Set(intent.positions)].filter((position) => position === "G" || position === "F" || position === "C");
  return { ...state, positionIntent: { mode: intent.mode, positions } };
}

export function updateDraftPreferences(state: DraftState, preferences: Partial<Pick<DraftState, "keepPositionPreferenceAfterMyPick" | "teamEcosystemEnabled" | "showTeamContextDetails" | "teamDiversificationMode" | "preferredMaxSameTeam" | "decisionLoggingEnabled">>): DraftState {
  return { ...state, ...preferences };
}

export function deriveMyRoster(
  state: DraftState,
  players: readonly Player[],
): Player[] {
  const playerById = new Map(players.map((player) => [player.id, player]));

  return state.myPlayerIds.flatMap((playerId) => {
    const player = playerById.get(playerId);
    return player ? [player] : [];
  });
}

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "undo-last-pick":
      return undoLastPick(state, action.config);
    case "reset":
      return { ...createInitialDraftState(), keepPositionPreferenceAfterMyPick: state.keepPositionPreferenceAfterMyPick, teamEcosystemEnabled: state.teamEcosystemEnabled, showTeamContextDetails: state.showTeamContextDetails, teamDiversificationMode: state.teamDiversificationMode, preferredMaxSameTeam: state.preferredMaxSameTeam, decisionLoggingEnabled: state.decisionLoggingEnabled };
    case "replace":
      return action.state;
  }
}

export function serializeDraftState(state: DraftState): string {
  return JSON.stringify(state, null, 2);
}

export function serializeDraftExport(state: DraftState, config: LeagueConfig, createdAt = new Date().toISOString()): string {
  const envelope: DraftExportEnvelope = { schemaVersion: 2, metadata: { teamCount: config.teamCount, rounds: config.rounds, userDraftSlot: config.userDraftSlot, scoringFingerprint: createScoringFingerprint(config.scoring), rosterFingerprint: createRosterFingerprint(config), createdAt }, draftState: structuredClone(state) };
  return JSON.stringify(envelope, null, 2);
}

export function validateDraftState(input: unknown, config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): DraftState {
  if (isRecord(input) && input.schemaVersion === 2 && isRecord(input.draftState)) input = input.draftState;
  if (!isRecord(input)) {
    throw new Error("Imported draft must be a JSON object.");
  }

  if (!Array.isArray(input.picks)) {
    throw new Error("Imported draft picks must be an array.");
  }
  if (input.picks.length > getTotalDraftPicks(config)) {
    throw new Error(`A draft cannot contain more than ${getTotalDraftPicks(config)} picks.`);
  }

  const picks = input.picks.map((value, index) => validatePick(value, index, config));
  const playerIds = picks.map((pick) => pick.playerId);
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error("Imported draft contains a player more than once.");
  }

  const migrated = {
    manualUnavailablePlayerIds: input.manualUnavailablePlayerIds ?? [],
    positionIntent: input.positionIntent ?? { mode: "Normal", positions: [] },
    keepPositionPreferenceAfterMyPick: input.keepPositionPreferenceAfterMyPick ?? false,
    teamEcosystemEnabled: input.teamEcosystemEnabled ?? true,
    showTeamContextDetails: input.showTeamContextDetails ?? true,
    teamDiversificationMode: input.teamDiversificationMode ?? "Strong soft cap",
    preferredMaxSameTeam: input.preferredMaxSameTeam ?? 2,
    decisionLoggingEnabled: input.decisionLoggingEnabled ?? true,
    decisionLog: input.decisionLog ?? [],
  };
  validateStringArray(migrated.manualUnavailablePlayerIds, "manualUnavailablePlayerIds");
  if (new Set(migrated.manualUnavailablePlayerIds).size !== migrated.manualUnavailablePlayerIds.length) throw new Error("manualUnavailablePlayerIds contains duplicates.");
  if (migrated.manualUnavailablePlayerIds.some((id) => playerIds.includes(id))) throw new Error("A manually unavailable player also has a recorded draft pick.");
  if (!isRecord(migrated.positionIntent) || !["Normal", "Prefer", "Filter"].includes(String(migrated.positionIntent.mode)) || !Array.isArray(migrated.positionIntent.positions) || migrated.positionIntent.positions.some((position) => !["G", "F", "C"].includes(String(position)))) throw new Error("positionIntent is invalid.");
  if (typeof migrated.keepPositionPreferenceAfterMyPick !== "boolean" || typeof migrated.teamEcosystemEnabled !== "boolean" || typeof migrated.showTeamContextDetails !== "boolean" || !["Off", "Strong soft cap", "Strict"].includes(String(migrated.teamDiversificationMode)) || typeof migrated.preferredMaxSameTeam !== "number" || !Number.isInteger(migrated.preferredMaxSameTeam) || migrated.preferredMaxSameTeam < 1 || migrated.preferredMaxSameTeam > 15 || typeof migrated.decisionLoggingEnabled !== "boolean" || !Array.isArray(migrated.decisionLog)) throw new Error("Draft preferences are invalid.");
  for (const item of migrated.decisionLog) if (!isRecord(item) || typeof item.overallPick !== "number" || !Array.isArray(item.topFive) || !Array.isArray(item.rosterPlayerIds)) throw new Error("Decision log is invalid.");
  const expected = stateFromPicks(picks, config, migrated as Partial<DraftState>);
  validateStringArray(input.draftedPlayerIds, "draftedPlayerIds");
  validateStringArray(input.myPlayerIds, "myPlayerIds");

  if (!arraysEqual(input.draftedPlayerIds, expected.draftedPlayerIds)) {
    throw new Error("draftedPlayerIds does not match the imported picks.");
  }
  if (!arraysEqual(input.myPlayerIds, expected.myPlayerIds)) {
    throw new Error("myPlayerIds does not match the imported picks.");
  }
  if (input.currentOverallPick !== expected.currentOverallPick) {
    throw new Error("currentOverallPick does not follow the imported picks.");
  }

  return expected;
}

function stateFromPicks(picks: DraftPick[], config: LeagueConfig = DEFAULT_LEAGUE_CONFIG, preserved: Partial<DraftState> = {}): DraftState {
  return {
    ...createInitialDraftState(),
    ...preserved,
    picks: [...picks],
    draftedPlayerIds: picks.map((pick) => pick.playerId),
    myPlayerIds: picks
      .filter((pick) => pick.teamNumber === config.userDraftSlot)
      .map((pick) => pick.playerId),
    currentOverallPick: picks.length + 1,
  };
}

function validatePick(value: unknown, index: number, config: LeagueConfig): DraftPick {
  if (!isRecord(value)) {
    throw new Error(`Pick ${index + 1} must be an object.`);
  }

  const expected = getDraftInfo(index + 1, config);
  if (!expected) {
    throw new Error(`Pick ${index + 1} is outside the configured draft.`);
  }

  if (typeof value.playerId !== "string" || !value.playerId.trim()) {
    throw new Error(`Pick ${index + 1} has an invalid playerId.`);
  }

  const fields: Array<keyof CurrentDraftInfo> = [
    "overallPick",
    "round",
    "pickInRound",
    "teamNumber",
    "isMyTeam",
  ];
  for (const field of fields) {
    if (value[field] !== expected[field]) {
      throw new Error(`Pick ${index + 1} has an invalid ${field}.`);
    }
  }

  return { ...expected, playerId: value.playerId.trim() };
}

function validateStringArray(
  value: unknown,
  fieldName: string,
): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${fieldName} must be an array of player IDs.`);
  }
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
