import { useEffect, useState } from "react";

import type { Player } from "../types";

export type PlayerDataSource = "processed" | "unavailable";

export interface PlayerDataResult {
  players: Player[];
  source: PlayerDataSource;
}

export async function loadPlayers(): Promise<PlayerDataResult> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}players.json`, {
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(`Player data request failed with status ${response.status}.`);
      }
      return { players: [], source: "unavailable" };
    }

    const value = (await response.json()) as unknown;
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      !value.every(isPlayerRecord)
    ) {
      console.warn("Processed player data is empty or malformed.");
      return { players: [], source: "unavailable" };
    }

    return { players: value, source: "processed" };
  } catch (error) {
    console.warn("Processed player data is unavailable.", error);
    return { players: [], source: "unavailable" };
  }
}

export function usePlayerData(): PlayerDataResult {
  const [result, setResult] = useState<PlayerDataResult>({
    players: [],
    source: "unavailable",
  });

  useEffect(() => {
    let active = true;
    void loadPlayers().then((loaded) => {
      if (active) {
        setResult(loaded);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  return result;
}

export function isPlayerRecord(value: unknown): value is Player {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    (typeof value.nbaTeam === "string" || value.nbaTeam === null) &&
    Array.isArray(value.yahooPositions) &&
    Array.isArray(value.historicalStats) &&
    (value.projections === null || isRecord(value.projections))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
