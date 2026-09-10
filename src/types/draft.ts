export interface DraftPick {
  overallPick: number;
  round: number;
  pickInRound: number;
  teamNumber: number;
  playerId: string;
  isMyTeam: boolean;
}

export interface DraftState {
  picks: DraftPick[];
  draftedPlayerIds: string[];
  myPlayerIds: string[];
  currentOverallPick: number;
  manualUnavailablePlayerIds: string[];
  positionIntent: PositionIntent;
  keepPositionPreferenceAfterMyPick: boolean;
  teamEcosystemEnabled: boolean;
  showTeamContextDetails: boolean;
}

export type PositionIntentMode = "Normal" | "Prefer" | "Filter";

export interface PositionIntent {
  mode: PositionIntentMode;
  positions: import("./player").YahooPosition[];
}
