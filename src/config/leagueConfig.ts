import type { LeagueConfig, StoredLeagueConfig } from "../types";

export const LEAGUE_CONFIG_STORAGE_KEY = "yahoo-companion:league-config:v1";
export const LEAGUE_CONFIG_SCHEMA_VERSION = 1 as const;

export const DEFAULT_LEAGUE_CONFIG: LeagueConfig = Object.freeze({
  teamCount: 16,
  userDraftSlot: 10,
  rounds: 15,
  roster: Object.freeze({ G: 3, F: 2, C: 2, UTIL: 3, BN: 5, IL: 0, ILPlus: 0 }),
  scoring: Object.freeze({ PTS: 1, OREB: 1.4, DREB: 1.2, AST: 1.5, STL: 2, BLK: 2, TO: -1, DD: 5, TD: 5 }),
});

/** Backward-compatible name for imports that mean application defaults. */
export const LEAGUE_CONFIG = DEFAULT_LEAGUE_CONFIG;

export function getDraftedRosterSize(config: LeagueConfig): number {
  return config.roster.G + config.roster.F + config.roster.C + config.roster.UTIL + config.roster.BN;
}

export function getTotalDraftPicks(config: LeagueConfig): number {
  return config.teamCount * config.rounds;
}

export const TOTAL_DRAFT_PICKS = getTotalDraftPicks(DEFAULT_LEAGUE_CONFIG);

export function validateLeagueConfig(value: unknown): LeagueConfig {
  const raw = unwrapStoredConfig(value);
  if (!isRecord(raw)) throw new Error("League settings must be an object.");
  const teamCount = integer(raw.teamCount, "Team count", 2, 30);
  const userDraftSlot = integer(raw.userDraftSlot, "Draft slot", 1, teamCount);
  const rounds = integer(raw.rounds, "Rounds", 1, 30);
  if (!isRecord(raw.roster)) throw new Error("Roster settings must be an object.");
  if (!isRecord(raw.scoring)) throw new Error("Scoring settings must be an object.");
  const scoringRaw = raw.scoring;
  const roster = {
    G: integer(raw.roster.G, "G slots", 0, 20), F: integer(raw.roster.F, "F slots", 0, 20),
    C: integer(raw.roster.C, "C slots", 0, 20), UTIL: integer(raw.roster.UTIL, "UTIL slots", 0, 20),
    BN: integer(raw.roster.BN, "Bench slots", 0, 20), IL: optionalInteger(raw.roster.IL, "IL slots", 0, 20),
    ILPlus: optionalInteger(raw.roster.ILPlus, "IL+ slots", 0, 20),
  };
  if (getDraftedRosterSize({ teamCount, userDraftSlot, rounds, roster, scoring: DEFAULT_LEAGUE_CONFIG.scoring }) !== rounds) {
    throw new Error("Drafted roster slots (G/F/C/UTIL/BN) must equal the number of rounds.");
  }
  const scoring = Object.fromEntries(
    (["PTS", "OREB", "DREB", "AST", "STL", "BLK", "TO", "DD", "TD"] as const)
      .map((key) => [key, finite(scoringRaw[key], `${key} scoring weight`, -20, 20)]),
  ) as unknown as LeagueConfig["scoring"];
  return { teamCount, userDraftSlot, rounds, roster, scoring };
}

export function serializeLeagueConfig(config: LeagueConfig): string {
  const stored: StoredLeagueConfig = { schemaVersion: LEAGUE_CONFIG_SCHEMA_VERSION, config: validateLeagueConfig(config) };
  return JSON.stringify(stored, null, 2);
}

export function migrateLeagueConfig(value: unknown): LeagueConfig {
  if (value === undefined || value === null) return structuredClone(DEFAULT_LEAGUE_CONFIG);
  if (isRecord(value) && value.schemaVersion === 1) return validateLeagueConfig(value);
  if (isRecord(value) && "myDraftSlot" in value) {
    const slots = isRecord(value.rosterSlots) ? value.rosterSlots : {};
    const scoring = isRecord(value.scoring) ? value.scoring : {};
    return validateLeagueConfig({
      teamCount: value.teamCount, userDraftSlot: value.myDraftSlot, rounds: value.rosterSize,
      roster: { G: slots.G, F: slots.F, C: slots.C, UTIL: slots.UTIL, BN: slots.BN, IL: 0, ILPlus: 0 },
      scoring: { PTS: scoring.points, OREB: scoring.offensiveRebounds, DREB: scoring.defensiveRebounds,
        AST: scoring.assists, STL: scoring.steals, BLK: scoring.blocks, TO: scoring.turnovers,
        DD: scoring.doubleDoubles, TD: scoring.tripleDoubles },
    });
  }
  return validateLeagueConfig(value);
}

function unwrapStoredConfig(value: unknown): unknown {
  return isRecord(value) && value.schemaVersion === 1 && "config" in value ? value.config : value;
}
function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return value;
}
function optionalInteger(value: unknown, label: string, min: number, max: number): number {
  return value === undefined ? 0 : integer(value, label, min, max);
}
function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be a finite number from ${min} to ${max}.`);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
