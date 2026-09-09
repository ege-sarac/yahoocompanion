import { NEW_PLAYER_PROJECTION_CONFIG } from "../config/newPlayerProjectionConfig";
import type {
  NewPlayerClass,
  NbaAvailabilityStatus,
  NewPlayerPreviousLeague,
  NewPlayerProjectionInput,
  NewPlayerRoleExpectation,
} from "../types";

export const NEW_PLAYER_CLASSES: NewPlayerClass[] = [
  "Rookie",
  "International newcomer",
  "Returning NBA veteran",
  "G League / developmental",
  "Other newcomer",
  "Unknown",
];
export const NEW_PLAYER_PREVIOUS_LEAGUES: NewPlayerPreviousLeague[] = [
  "NCAA",
  "International",
  "G League",
  "Prior NBA",
  "Other",
  "Unknown",
];
export const NEW_PLAYER_ROLE_EXPECTATIONS: NewPlayerRoleExpectation[] = [
  "Likely starter",
  "Rotation",
  "Bench",
  "Unclear",
];
export const NBA_AVAILABILITY_STATUSES: NbaAvailabilityStatus[] = [
  "NBA roster", "Two-way contract", "G League assignment", "Unsigned",
  "Overseas / stash", "Not expected to play", "Unknown",
];

const NUMERIC_FIELDS: ReadonlyArray<{
  key: keyof NewPlayerProjectionInput;
  minimum: number;
  maximum: number;
  integer?: boolean;
}> = [
  {
    key: "age",
    minimum: NEW_PLAYER_PROJECTION_CONFIG.validation.minimumAge,
    maximum: NEW_PLAYER_PROJECTION_CONFIG.validation.maximumAge,
  },
  {
    key: "nbaDraftYear",
    minimum: NEW_PLAYER_PROJECTION_CONFIG.validation.minimumDraftYear,
    maximum: NEW_PLAYER_PROJECTION_CONFIG.validation.maximumDraftYear,
    integer: true,
  },
  { key: "nbaDraftRound", minimum: 1, maximum: 2, integer: true },
  { key: "nbaDraftPick", minimum: 1, maximum: 60, integer: true },
  {
    key: "previousGames",
    minimum: 0,
    maximum: NEW_PLAYER_PROJECTION_CONFIG.validation.maximumPreviousGames,
    integer: true,
  },
  {
    key: "previousMinutesPerGame",
    minimum: 0,
    maximum: NEW_PLAYER_PROJECTION_CONFIG.validation.maximumPreviousMinutes,
  },
  {
    key: "previousPointsPerGame",
    minimum: 0,
    maximum: NEW_PLAYER_PROJECTION_CONFIG.validation.maximumPoints,
  },
  {
    key: "previousOffensiveReboundsPerGame",
    minimum: 0,
    maximum: NEW_PLAYER_PROJECTION_CONFIG.validation.maximumRebounds,
  },
  {
    key: "previousDefensiveReboundsPerGame",
    minimum: 0,
    maximum: NEW_PLAYER_PROJECTION_CONFIG.validation.maximumRebounds,
  },
  {
    key: "previousAssistsPerGame",
    minimum: 0,
    maximum: NEW_PLAYER_PROJECTION_CONFIG.validation.maximumAssists,
  },
  {
    key: "previousStealsPerGame",
    minimum: 0,
    maximum: NEW_PLAYER_PROJECTION_CONFIG.validation.maximumSteals,
  },
  {
    key: "previousBlocksPerGame",
    minimum: 0,
    maximum: NEW_PLAYER_PROJECTION_CONFIG.validation.maximumBlocks,
  },
  {
    key: "previousTurnoversPerGame",
    minimum: 0,
    maximum: NEW_PLAYER_PROJECTION_CONFIG.validation.maximumTurnovers,
  },
  { key: "expectedNbaMinutes", minimum: 0, maximum: 48 },
  { key: "expectedNbaMinutesLow", minimum: 0, maximum: 48 },
  { key: "expectedNbaMinutesBase", minimum: 0, maximum: 48 },
  { key: "expectedNbaMinutesHigh", minimum: 0, maximum: 48 },
  { key: "summerLeagueGames", minimum: 0, maximum: 20, integer: true },
  { key: "summerLeagueMinutesPerGame", minimum: 0, maximum: 48 },
  { key: "summerLeaguePointsPerGame", minimum: 0, maximum: 60 },
  { key: "summerLeagueReboundsPerGame", minimum: 0, maximum: 30 },
  { key: "summerLeagueAssistsPerGame", minimum: 0, maximum: 30 },
  { key: "summerLeagueStealsPerGame", minimum: 0, maximum: 10 },
  { key: "summerLeagueBlocksPerGame", minimum: 0, maximum: 10 },
  { key: "summerLeagueTurnoversPerGame", minimum: 0, maximum: 15 },
];

export function validateNewPlayerOverrides(
  value: unknown,
  knownPlayerIds?: ReadonlySet<string>,
): NewPlayerProjectionInput[] {
  const rawValue = isRecord(value) && Array.isArray(value.overrides) ? value.overrides : value;
  if (!Array.isArray(rawValue)) {
    throw new Error("New-player overrides must be a JSON array.");
  }
  const seen = new Set<string>();
  return rawValue.map((item, index) => {
    const label = `New-player override ${index + 1}`;
    if (!isRecord(item)) throw new Error(`${label} must be an object.`);
    if (typeof item.playerId !== "string" || !item.playerId.trim()) {
      throw new Error(`${label} has an invalid playerId.`);
    }
    const playerId = item.playerId.trim();
    if (seen.has(playerId)) {
      throw new Error(`Duplicate new-player override for player ID ${playerId}.`);
    }
    if (knownPlayerIds && !knownPlayerIds.has(playerId)) {
      throw new Error(`Unknown player ID ${playerId}.`);
    }
    seen.add(playerId);

    if (
      typeof item.classification !== "string" ||
      !NEW_PLAYER_CLASSES.includes(item.classification as NewPlayerClass)
    ) {
      throw new Error(`${label} has an invalid classification.`);
    }
    if (item.nbaAvailabilityStatus !== undefined && !NBA_AVAILABILITY_STATUSES.includes(item.nbaAvailabilityStatus as NbaAvailabilityStatus)) {
      throw new Error(`${label} has an invalid NBA availability status.`);
    }
    if (
      item.previousLeague !== undefined &&
      !NEW_PLAYER_PREVIOUS_LEAGUES.includes(
        item.previousLeague as NewPlayerPreviousLeague,
      )
    ) {
      throw new Error(`${label} has an invalid previous league.`);
    }
    const range = [item.expectedNbaMinutesLow, item.expectedNbaMinutesBase, item.expectedNbaMinutesHigh];
    const presentRange = range.filter((entry) => entry !== undefined && entry !== null);
    if (presentRange.length > 0 && presentRange.length !== 3) throw new Error(`${label} must provide low, base, and high expected MPG together.`);
    if (presentRange.length === 3 && !((range[0] as number) <= (range[1] as number) && (range[1] as number) <= (range[2] as number))) {
      throw new Error(`${label} expected MPG range must satisfy low <= base <= high.`);
    }
    for (const textField of ["previousTeamOrSchool"] as const) {
      const raw = item[textField];
      if (raw !== undefined && raw !== null && typeof raw !== "string") throw new Error(`${label} ${textField} must be text or null.`);
    }
    if (item.source !== undefined) {
      if (!isRecord(item.source)) throw new Error(`${label} source must be an object.`);
      for (const field of ["sourceName", "sourceUrl", "reviewedAt"]) {
        const raw = item.source[field];
        if (raw !== undefined && raw !== null && typeof raw !== "string") throw new Error(`${label} source.${field} must be text or null.`);
      }
    }
    if (
      item.roleExpectation !== undefined &&
      !NEW_PLAYER_ROLE_EXPECTATIONS.includes(
        item.roleExpectation as NewPlayerRoleExpectation,
      )
    ) {
      throw new Error(`${label} has an invalid role expectation.`);
    }
    if (
      item.notes !== undefined &&
      item.notes !== null &&
      typeof item.notes !== "string"
    ) {
      throw new Error(`${label} notes must be text or null.`);
    }
    for (const field of NUMERIC_FIELDS) {
      const raw = item[field.key];
      if (raw === undefined || raw === null) continue;
      if (
        typeof raw !== "number" ||
        !Number.isFinite(raw) ||
        raw < field.minimum ||
        raw > field.maximum ||
        (field.integer && !Number.isInteger(raw))
      ) {
        throw new Error(
          `${label} has an invalid ${String(field.key)}; expected ${field.minimum}–${field.maximum}${field.integer ? " as an integer" : ""}.`,
        );
      }
    }
    if (
      item.nbaDraftRound === 1 &&
      typeof item.nbaDraftPick === "number" &&
      item.nbaDraftPick > 30
    ) {
      throw new Error(`${label} has a first-round draft pick above 30.`);
    }
    if (
      item.nbaDraftRound === 2 &&
      typeof item.nbaDraftPick === "number" &&
      item.nbaDraftPick <= 30
    ) {
      throw new Error(`${label} has a second-round draft pick at or below 30.`);
    }

    const validated: NewPlayerProjectionInput = {
      playerId,
      classification: item.classification as NewPlayerClass,
    };
    for (const field of NUMERIC_FIELDS) {
      if (Object.hasOwn(item, field.key)) {
        (validated as unknown as Record<string, unknown>)[field.key] =
          item[field.key];
      }
    }
    if (item.previousLeague !== undefined) {
      validated.previousLeague = item.previousLeague as NewPlayerPreviousLeague;
    }
    if (item.nbaAvailabilityStatus !== undefined) validated.nbaAvailabilityStatus = item.nbaAvailabilityStatus as NbaAvailabilityStatus;
    if (Object.hasOwn(item, "previousTeamOrSchool")) validated.previousTeamOrSchool = item.previousTeamOrSchool as string | null;
    if (item.source !== undefined) validated.source = item.source as NewPlayerProjectionInput["source"];
    if (item.roleExpectation !== undefined) {
      validated.roleExpectation =
        item.roleExpectation as NewPlayerRoleExpectation;
    }
    if (Object.hasOwn(item, "notes")) {
      validated.notes = item.notes as string | null;
    }
    return validated;
  });
}

export function prepareNewPlayerOverridesImport(
  current: readonly NewPlayerProjectionInput[],
  value: unknown,
  knownPlayerIds: ReadonlySet<string>,
): NewPlayerProjectionInput[] {
  void current;
  return validateNewPlayerOverrides(value, knownPlayerIds);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
