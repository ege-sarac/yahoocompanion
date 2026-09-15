import { DEFAULT_LEAGUE_CONFIG } from "../config/leagueConfig";
import type { LeagueConfig } from "../types";

/**
 * The one authoritative view of the user's remaining snake turns.  `currentOverallPick`
 * is the pick presently being decided/just recorded, so "next" is always strictly later.
 */
export interface UserPickSchedule {
  currentUserPick: number | null;
  nextUserPick: number | null;
  secondNextUserPick: number | null;
  picksUntilNextUserPick: number | null;
  picksUntilSecondNextUserPick: number | null;
}

export function getUserPickSchedule(
  currentOverallPick: number,
  config: LeagueConfig = DEFAULT_LEAGUE_CONFIG,
): UserPickSchedule {
  const picks = getMyOverallPicks(config);
  const currentUserPick = picks.find((pick) => pick === currentOverallPick) ?? null;
  const nextIndex = picks.findIndex((pick) => pick > currentOverallPick);
  const nextUserPick = nextIndex < 0 ? null : picks[nextIndex];
  const secondNextUserPick = nextIndex < 0 ? null : picks[nextIndex + 1] ?? null;
  return {
    currentUserPick,
    nextUserPick,
    secondNextUserPick,
    picksUntilNextUserPick: nextUserPick === null ? null : nextUserPick - currentOverallPick - 1,
    picksUntilSecondNextUserPick: secondNextUserPick === null ? null : secondNextUserPick - currentOverallPick - 1,
  };
}

export function getSnakeDraftTeamNumber(
  overallPick: number,
  teamCount: number,
): number {
  if (!Number.isInteger(overallPick) || overallPick < 1) {
    throw new RangeError("overallPick must be a positive integer");
  }

  if (!Number.isInteger(teamCount) || teamCount < 2) {
    throw new RangeError("teamCount must be an integer of at least 2");
  }

  const zeroBasedPick = overallPick - 1;
  const zeroBasedRound = Math.floor(zeroBasedPick / teamCount);
  const pickInRound = (zeroBasedPick % teamCount) + 1;

  return zeroBasedRound % 2 === 0
    ? pickInRound
    : teamCount - pickInRound + 1;
}

export function getTeamOverallPicks(
  teamCount: number,
  draftSlot: number,
  roundCount: number,
): number[] {
  if (!Number.isInteger(teamCount) || teamCount < 2) {
    throw new RangeError("teamCount must be an integer of at least 2");
  }

  if (
    !Number.isInteger(draftSlot) ||
    draftSlot < 1 ||
    draftSlot > teamCount
  ) {
    throw new RangeError("draftSlot must be a valid team number");
  }

  if (!Number.isInteger(roundCount) || roundCount < 1) {
    throw new RangeError("roundCount must be a positive integer");
  }

  return Array.from({ length: roundCount }, (_, roundIndex) => {
    const pickInRound =
      roundIndex % 2 === 0 ? draftSlot : teamCount - draftSlot + 1;

    return roundIndex * teamCount + pickInRound;
  });
}

export function getMyOverallPicks(config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): number[] {
  return getTeamOverallPicks(
    config.teamCount,
    config.userDraftSlot,
    config.rounds,
  );
}
