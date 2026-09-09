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
}
