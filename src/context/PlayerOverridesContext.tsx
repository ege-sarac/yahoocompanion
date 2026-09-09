import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { validatePlayerOverrides } from "../engine/playerOverrides";
import type { PlayerOverride } from "../types";

const STORAGE_KEY = "yahoo-companion:player-overrides:v1";

interface PlayerOverridesContextValue {
  overrides: PlayerOverride[];
  saveOverride: (override: PlayerOverride) => void;
  exportOverrides: () => string;
  importOverrides: (
    value: unknown,
    knownPlayerIds: ReadonlySet<string>,
  ) => void;
  replaceOverrides: (value: PlayerOverride[]) => void;
}

const PlayerOverridesContext =
  createContext<PlayerOverridesContextValue | null>(null);

function loadStoredOverrides(): PlayerOverride[] {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return [];
  }

  try {
    return validatePlayerOverrides(JSON.parse(stored) as unknown);
  } catch (error) {
    console.warn("Ignoring invalid stored player overrides.", error);
    window.localStorage.setItem(`${STORAGE_KEY}:unmigrated`, stored);
    return [];
  }
}

export function PlayerOverridesProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<PlayerOverride[]>(
    loadStoredOverrides,
  );

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  }, [overrides]);

  const saveOverride = useCallback((override: PlayerOverride) => {
    const validated = validatePlayerOverrides([override])[0];
    setOverrides((current) => {
      const withoutPlayer = current.filter(
        (item) => item.playerId !== validated.playerId,
      );
      return [...withoutPlayer, validated].sort((left, right) =>
        left.playerId.localeCompare(right.playerId),
      );
    });
  }, []);

  const exportOverrides = useCallback(
    () => JSON.stringify(overrides, null, 2),
    [overrides],
  );
  const importOverrides = useCallback(
    (value: unknown, knownPlayerIds: ReadonlySet<string>) => {
      const validated = validatePlayerOverrides(value, knownPlayerIds);
      setOverrides(validated);
    },
    [],
  );
  const replaceOverrides = useCallback((value: PlayerOverride[]) => {
    setOverrides(validatePlayerOverrides(value));
  }, []);

  const contextValue = useMemo(
    () => ({ overrides, saveOverride, exportOverrides, importOverrides, replaceOverrides }),
    [exportOverrides, importOverrides, overrides, replaceOverrides, saveOverride],
  );

  return (
    <PlayerOverridesContext.Provider value={contextValue}>
      {children}
    </PlayerOverridesContext.Provider>
  );
}

export function usePlayerOverrides(): PlayerOverridesContextValue {
  const context = useContext(PlayerOverridesContext);
  if (!context) {
    throw new Error(
      "usePlayerOverrides must be used within a PlayerOverridesProvider.",
    );
  }
  return context;
}
