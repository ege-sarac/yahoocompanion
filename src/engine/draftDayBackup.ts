import type { DraftDayBackup, DraftState, InjurySnapshot, LeagueConfig, NewPlayerProjectionInput, PlayerOverride } from "../types";
import { validateLeagueConfig } from "../config/leagueConfig";
import { validateDraftState } from "./draftState";
import { validatePlayerOverrides } from "./playerOverrides";
import { validateNewPlayerOverrides } from "./newPlayerOverrides";
import { validateInjurySnapshot } from "./injurySnapshot";

export interface DraftDayBackupParts {
  leagueConfig: LeagueConfig;
  draftState: DraftState;
  playerOverrides: PlayerOverride[];
  newPlayerOverrides: NewPlayerProjectionInput[];
  injurySnapshot: InjurySnapshot;
}

export function createDraftDayBackup(parts: DraftDayBackupParts, exportedAt = new Date().toISOString()): DraftDayBackup {
  return { schemaVersion: 1, exportedAt, appVersion: "0.1.0", ...structuredClone(parts) };
}

export function serializeDraftDayBackup(parts: DraftDayBackupParts): string {
  return JSON.stringify(createDraftDayBackup(parts), null, 2);
}

export function validateDraftDayBackup(value: unknown, knownPlayerIds: ReadonlySet<string>): DraftDayBackup {
  if (!isRecord(value)) throw new Error("Draft-day backup must be a JSON object.");
  if (value.schemaVersion !== 1) throw new Error("Unsupported draft-day backup schema version.");
  if (typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt))) throw new Error("Backup exportedAt is invalid.");
  const leagueConfig = validateLeagueConfig(value.leagueConfig);
  const draftState = validateDraftState(value.draftState, leagueConfig);
  const playerOverrides = validatePlayerOverrides(value.playerOverrides, knownPlayerIds);
  const newPlayerOverrides = validateNewPlayerOverrides(value.newPlayerOverrides, knownPlayerIds);
  const injurySnapshot = validateInjurySnapshot(value.injurySnapshot);
  return { schemaVersion: 1, exportedAt: value.exportedAt, appVersion: typeof value.appVersion === "string" ? value.appVersion : "unknown", leagueConfig, draftState, playerOverrides, newPlayerOverrides, injurySnapshot };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
