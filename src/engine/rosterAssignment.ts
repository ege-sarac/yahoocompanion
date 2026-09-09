import { DEFAULT_LEAGUE_CONFIG, getDraftedRosterSize } from "../config/leagueConfig";
import type {
  Player,
  RosterAssignmentEntry,
  RosterAssignmentResult,
  RosterSlot,
  YahooPosition,
  LeagueConfig,
} from "../types";

interface RestrictiveSlot {
  key: string;
  slot: YahooPosition;
  slotIndex: number;
}

const RESTRICTIVE_ORDER: YahooPosition[] = ["C", "F", "G"];

export function assignRosterSlots(
  roster: readonly Player[],
  leagueConfig: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): RosterAssignmentResult {
  const restrictiveSlots: RestrictiveSlot[] = RESTRICTIVE_ORDER.flatMap(
    (slot) =>
      Array.from({ length: leagueConfig.roster[slot] }, (_, index) => ({
        key: `${slot}-${index + 1}`,
        slot,
        slotIndex: index + 1,
      })),
  );
  const playerById = new Map(roster.map((player) => [player.id, player]));
  const playerOrder = [...roster]
    .map((player, originalIndex) => ({ player, originalIndex }))
    .sort(
      (left, right) =>
        left.player.yahooPositions.length -
          right.player.yahooPositions.length ||
        left.originalIndex - right.originalIndex ||
        left.player.id.localeCompare(right.player.id),
    );
  const matchedPlayerBySlot = new Map<string, string>();

  function tryAssign(playerId: string, visitedSlots: Set<string>): boolean {
    const player = playerById.get(playerId);
    if (!player) return false;

    for (const slot of restrictiveSlots) {
      if (
        !player.yahooPositions.includes(slot.slot) ||
        visitedSlots.has(slot.key)
      ) {
        continue;
      }
      visitedSlots.add(slot.key);
      const occupyingPlayerId = matchedPlayerBySlot.get(slot.key);
      if (
        !occupyingPlayerId ||
        tryAssign(occupyingPlayerId, visitedSlots)
      ) {
        matchedPlayerBySlot.set(slot.key, playerId);
        return true;
      }
    }
    return false;
  }

  for (const { player } of playerOrder) {
    tryAssign(player.id, new Set());
  }

  const assignments: RosterAssignmentEntry[] = restrictiveSlots.flatMap(
    (slot) => {
      const playerId = matchedPlayerBySlot.get(slot.key);
      return playerId
        ? [{ playerId, slot: slot.slot, slotIndex: slot.slotIndex }]
        : [];
    },
  );
  const assignedIds = new Set(assignments.map(({ playerId }) => playerId));
  const remainingPlayers = roster.filter((player) => !assignedIds.has(player.id));
  const universalSlots: Array<{ slot: RosterSlot; slotIndex: number }> = [
    ...Array.from(
      { length: leagueConfig.roster.UTIL },
      (_, index) => ({ slot: "UTIL" as const, slotIndex: index + 1 }),
    ),
    ...Array.from(
      { length: leagueConfig.roster.BN },
      (_, index) => ({ slot: "BN" as const, slotIndex: index + 1 }),
    ),
  ];

  for (const [index, player] of remainingPlayers.entries()) {
    const slot = universalSlots[index];
    if (slot) {
      assignments.push({ playerId: player.id, ...slot });
      assignedIds.add(player.id);
    }
  }

  const unassignedPlayerIds = roster
    .filter((player) => !assignedIds.has(player.id))
    .map((player) => player.id);
  const insufficientPositions = RESTRICTIVE_ORDER.filter((position) =>
    restrictiveSlots.some(
      (slot) =>
        slot.slot === position && !matchedPlayerBySlot.has(slot.key),
    ),
  );
  const isLegal = unassignedPlayerIds.length === 0;
  const explanation = isLegal
    ? "The current roster fits into the configured G/F/C, UTIL, and bench slots."
    : insufficientPositions.length > 0
      ? `The roster needs additional ${insufficientPositions.join(" or ")}-eligible coverage to fit legally.`
      : `The roster exceeds the configured ${getDraftedRosterSize(leagueConfig)}-player capacity.`;

  return {
    assignments,
    unassignedPlayerIds,
    isLegal,
    insufficientPositions,
    explanation,
  };
}
