export type RosterSlot = "G" | "F" | "C" | "UTIL" | "BN";
export type DisplayRosterSlot = RosterSlot | "IL" | "ILPlus";

export interface ScoringSettings {
  PTS: number;
  OREB: number;
  DREB: number;
  AST: number;
  STL: number;
  BLK: number;
  TO: number;
  DD: number;
  TD: number;
}

export interface RosterSettings extends Record<RosterSlot, number> {
  IL: number;
  ILPlus: number;
}

export interface LeagueConfig {
  teamCount: number;
  userDraftSlot: number;
  rounds: number;
  roster: RosterSettings;
  scoring: ScoringSettings;
  externalProjectionFallbackThreshold: number;
}

export interface StoredLeagueConfig {
  schemaVersion: 1;
  config: LeagueConfig;
}
