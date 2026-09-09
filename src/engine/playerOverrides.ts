import type {
  InjuryStatus,
  Player,
  PlayerOverride,
  YahooPosition,
} from "../types";

export const ALLOWED_YAHOO_POSITIONS: YahooPosition[] = ["G", "F", "C"];
export const ALLOWED_INJURY_STATUSES: InjuryStatus[] = [
  "Healthy",
  "Day-to-day",
  "Out",
  "Injured",
  "Returning soon",
  "Unknown",
];

export function mergePlayerOverrides(
  players: readonly Player[],
  overrides: readonly PlayerOverride[],
): Player[] {
  const overrideById = new Map(
    overrides.map((override) => [override.playerId, override]),
  );

  return players.map((player) => {
    const override = overrideById.get(player.id);
    if (!override) {
      return { ...player, notes: player.notes ?? "", positionSource: player.positionSource ?? (player.yahooPositions.length ? "NBA fallback" : "unknown") };
    }

    return {
      ...player,
      yahooPositions: [...override.yahooPositions],
      positionSource: "manual Yahoo",
      injuryStatus: override.injuryStatus ?? player.injuryStatus,
      expectedReturnDate: Object.hasOwn(override, "expectedReturnDate")
        ? (override.expectedReturnDate ?? null)
        : player.expectedReturnDate,
      notes: override.notes,
      currentInjurySource:
        override.injuryStatus !== undefined ||
        Object.hasOwn(override, "expectedReturnDate")
          ? "manual"
          : player.currentInjurySource,
    };
  });
}

export function applyNbaPositionFallbacks(players: readonly Player[]): Player[] {
  return players.map((player) => {
    if (player.yahooPositions.length > 0) return { ...player, positionSource: player.positionSource ?? "NBA fallback" };
    const raw = (player.nbaPosition ?? "").toLocaleLowerCase();
    const positions: YahooPosition[] = [];
    if (raw.includes("guard") || /(^|[-/ ])g($|[-/ ])/.test(raw)) positions.push("G");
    if (raw.includes("forward") || /(^|[-/ ])f($|[-/ ])/.test(raw)) positions.push("F");
    if (raw.includes("center") || /(^|[-/ ])c($|[-/ ])/.test(raw)) positions.push("C");
    return { ...player, yahooPositions: positions, positionSource: positions.length ? "NBA fallback" : "unknown" };
  });
}

export function playerToOverride(player: Player): PlayerOverride {
  return {
    playerId: player.id,
    yahooPositions: [...player.yahooPositions],
    notes: player.notes ?? "",
  };
}

export function validatePlayerOverrides(
  value: unknown,
  knownPlayerIds?: ReadonlySet<string>,
): PlayerOverride[] {
  if (!Array.isArray(value)) {
    throw new Error("Player overrides must be a JSON array.");
  }

  const seenPlayerIds = new Set<string>();
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Override ${index + 1} must be an object.`);
    }
    if (typeof item.playerId !== "string" || !item.playerId.trim()) {
      throw new Error(`Override ${index + 1} has an invalid playerId.`);
    }
    const playerId = item.playerId.trim();
    if (seenPlayerIds.has(playerId)) {
      throw new Error(`Duplicate override for player ID ${playerId}.`);
    }
    if (knownPlayerIds && !knownPlayerIds.has(playerId)) {
      throw new Error(`Unknown player ID ${playerId}.`);
    }
    seenPlayerIds.add(playerId);

    if (!Array.isArray(item.yahooPositions)) {
      throw new Error(`Override ${index + 1} has invalid Yahoo positions.`);
    }
    const yahooPositions = item.yahooPositions.map((position) => {
      if (
        typeof position !== "string" ||
        !ALLOWED_YAHOO_POSITIONS.includes(position as YahooPosition)
      ) {
        throw new Error(
          `Override ${index + 1} contains invalid Yahoo position ${String(position)}.`,
        );
      }
      return position as YahooPosition;
    });
    if (new Set(yahooPositions).size !== yahooPositions.length) {
      throw new Error(`Override ${index + 1} repeats a Yahoo position.`);
    }

    if (item.injuryStatus !== undefined) {
      if (
        typeof item.injuryStatus !== "string" ||
        !ALLOWED_INJURY_STATUSES.includes(item.injuryStatus as InjuryStatus)
      ) {
        throw new Error(`Override ${index + 1} has an invalid injury status.`);
      }
    }
    if (
      Object.hasOwn(item, "expectedReturnDate") &&
      !isValidOptionalIsoDate(item.expectedReturnDate)
    ) {
      throw new Error(`Override ${index + 1} has a malformed return date.`);
    }
    if (typeof item.notes !== "string") {
      throw new Error(`Override ${index + 1} notes must be text.`);
    }

    const validated: PlayerOverride = {
      playerId,
      yahooPositions,
      notes: item.notes,
    };
    if (item.injuryStatus !== undefined) {
      validated.injuryStatus = item.injuryStatus as InjuryStatus;
    }
    if (Object.hasOwn(item, "expectedReturnDate")) {
      validated.expectedReturnDate = item.expectedReturnDate as string | null;
    }
    return validated;
  });
}

export function isValidOptionalIsoDate(value: unknown): value is string | null {
  if (value === null) {
    return true;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
