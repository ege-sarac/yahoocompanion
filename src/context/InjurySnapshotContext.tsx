import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import defaultSnapshotJson from "../../data/manual/currentInjuries.json";
import {
  prepareInjurySnapshotImport,
  validateInjurySnapshot,
} from "../engine/injurySnapshot";
import type { InjuryMatchingReport, InjurySnapshot, Player } from "../types";

const STORAGE_KEY = "yahoo-companion:current-injury-snapshot:v1";
const DEFAULT_SNAPSHOT = validateInjurySnapshot(defaultSnapshotJson as unknown);

interface InjurySnapshotContextValue {
  snapshot: InjurySnapshot;
  importSnapshot: (
    value: unknown,
    players: readonly Player[],
  ) => InjuryMatchingReport;
  exportSnapshot: () => string;
  replaceSnapshot: (value: InjurySnapshot) => void;
}

const InjurySnapshotContext =
  createContext<InjurySnapshotContextValue | null>(null);

function loadStoredSnapshot(): InjurySnapshot {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_SNAPSHOT;
  try {
    return validateInjurySnapshot(JSON.parse(stored) as unknown);
  } catch (error) {
    console.warn("Ignoring invalid stored injury snapshot.", error);
    window.localStorage.setItem(`${STORAGE_KEY}:unmigrated`, stored);
    return DEFAULT_SNAPSHOT;
  }
}

export function InjurySnapshotProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<InjurySnapshot>(loadStoredSnapshot);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }, [snapshot]);

  const importSnapshot = useCallback(
    (value: unknown, players: readonly Player[]) => {
      const prepared = prepareInjurySnapshotImport(snapshot, value, players);
      setSnapshot(prepared.snapshot);
      return prepared.report;
    },
    [snapshot],
  );
  const exportSnapshot = useCallback(
    () => JSON.stringify(snapshot, null, 2),
    [snapshot],
  );
  const replaceSnapshot = useCallback((value: InjurySnapshot) => setSnapshot(validateInjurySnapshot(value)), []);
  const contextValue = useMemo(
    () => ({ snapshot, importSnapshot, exportSnapshot, replaceSnapshot }),
    [exportSnapshot, importSnapshot, replaceSnapshot, snapshot],
  );

  return (
    <InjurySnapshotContext.Provider value={contextValue}>
      {children}
    </InjurySnapshotContext.Provider>
  );
}

export function useInjurySnapshot(): InjurySnapshotContextValue {
  const context = useContext(InjurySnapshotContext);
  if (!context) {
    throw new Error(
      "useInjurySnapshot must be used within an InjurySnapshotProvider.",
    );
  }
  return context;
}
