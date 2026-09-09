import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import defaultOverridesJson from "../../data/manual/newPlayerOverrides.json";
import {
  prepareNewPlayerOverridesImport,
  validateNewPlayerOverrides,
} from "../engine/newPlayerOverrides";
import type { NewPlayerProjectionInput } from "../types";

const STORAGE_KEY = "yahoo-companion:new-player-overrides:v1";
const DEFAULT_OVERRIDES = validateNewPlayerOverrides(defaultOverridesJson);

interface NewPlayerOverridesContextValue {
  newPlayerOverrides: NewPlayerProjectionInput[];
  saveNewPlayerOverride: (value: NewPlayerProjectionInput) => void;
  exportNewPlayerOverrides: () => string;
  importNewPlayerOverrides: (
    value: unknown,
    knownPlayerIds: ReadonlySet<string>,
  ) => void;
  replaceNewPlayerOverrides: (value: NewPlayerProjectionInput[]) => void;
}

const NewPlayerOverridesContext =
  createContext<NewPlayerOverridesContextValue | null>(null);

function loadStoredOverrides(): NewPlayerProjectionInput[] {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_OVERRIDES;
  try {
    return validateNewPlayerOverrides(JSON.parse(stored) as unknown);
  } catch (error) {
    console.warn("Ignoring invalid stored new-player overrides.", error);
    window.localStorage.setItem(`${STORAGE_KEY}:unmigrated`, stored);
    return DEFAULT_OVERRIDES;
  }
}

export function NewPlayerOverridesProvider({ children }: { children: ReactNode }) {
  const [newPlayerOverrides, setNewPlayerOverrides] =
    useState<NewPlayerProjectionInput[]>(loadStoredOverrides);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(newPlayerOverrides));
  }, [newPlayerOverrides]);

  const saveNewPlayerOverride = useCallback(
    (value: NewPlayerProjectionInput) => {
      const validated = validateNewPlayerOverrides([value])[0];
      setNewPlayerOverrides((current) => [
        ...current.filter((entry) => entry.playerId !== validated.playerId),
        validated,
      ].sort((left, right) => left.playerId.localeCompare(right.playerId)));
    },
    [],
  );
  const exportNewPlayerOverrides = useCallback(
    () => JSON.stringify(newPlayerOverrides, null, 2),
    [newPlayerOverrides],
  );
  const importNewPlayerOverrides = useCallback(
    (value: unknown, knownPlayerIds: ReadonlySet<string>) => {
      setNewPlayerOverrides((current) =>
        prepareNewPlayerOverridesImport(current, value, knownPlayerIds),
      );
    },
    [],
  );
  const replaceNewPlayerOverrides = useCallback((value: NewPlayerProjectionInput[]) => {
    setNewPlayerOverrides(validateNewPlayerOverrides(value));
  }, []);
  const contextValue = useMemo(
    () => ({
      newPlayerOverrides,
      saveNewPlayerOverride,
      exportNewPlayerOverrides,
      importNewPlayerOverrides,
      replaceNewPlayerOverrides,
    }),
    [
      exportNewPlayerOverrides,
      importNewPlayerOverrides,
      newPlayerOverrides,
      replaceNewPlayerOverrides,
      saveNewPlayerOverride,
    ],
  );

  return (
    <NewPlayerOverridesContext.Provider value={contextValue}>
      {children}
    </NewPlayerOverridesContext.Provider>
  );
}

export function useNewPlayerOverrides(): NewPlayerOverridesContextValue {
  const context = useContext(NewPlayerOverridesContext);
  if (!context) {
    throw new Error(
      "useNewPlayerOverrides must be used within a NewPlayerOverridesProvider.",
    );
  }
  return context;
}
