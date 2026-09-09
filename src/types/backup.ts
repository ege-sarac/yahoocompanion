import type { DraftState } from "./draft";
import type { InjurySnapshot } from "./injurySnapshot";
import type { LeagueConfig } from "./league";
import type { NewPlayerProjectionInput } from "./newPlayer";
import type { PlayerOverride } from "./playerOverride";

export interface DraftDayBackup {
  schemaVersion: 1;
  exportedAt: string;
  appVersion: string;
  leagueConfig: LeagueConfig;
  draftState: DraftState;
  playerOverrides: PlayerOverride[];
  newPlayerOverrides: NewPlayerProjectionInput[];
  injurySnapshot: InjurySnapshot;
}
