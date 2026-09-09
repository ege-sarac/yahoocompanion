import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";

import {
  createInitialDraftState,
  draftPlayer as applyDraftPick,
  draftReducer,
  serializeDraftState,
  validateDraftState,
} from "../engine";
import type { DraftState } from "../types";
import { useLeagueConfig } from "./LeagueConfigContext";

const STORAGE_KEY = "yahoo-companion:draft-state:v1";

interface DraftContextValue {
  state: DraftState;
  draftPlayer: (playerId: string) => void;
  undoLastPick: () => void;
  resetDraft: () => void;
  exportDraft: () => string;
  importDraft: (value: unknown) => void;
  replaceDraftState: (state: DraftState, config?: import("../types").LeagueConfig) => void;
}

const DraftContext = createContext<DraftContextValue | null>(null);

function loadStoredDraft(config: import("../types").LeagueConfig): DraftState {
  const storedDraft = window.localStorage.getItem(STORAGE_KEY);
  if (!storedDraft) {
    return createInitialDraftState();
  }

  try {
    return validateDraftState(JSON.parse(storedDraft) as unknown, config);
  } catch (error) {
    console.warn("Ignoring invalid saved YahooCompanion draft state.", error);
    window.localStorage.setItem(`${STORAGE_KEY}:unmigrated`, storedDraft);
    return createInitialDraftState();
  }
}

export function DraftProvider({ children }: { children: ReactNode }) {
  const { config } = useLeagueConfig();
  const [state, dispatch] = useReducer(
    draftReducer,
    undefined,
    () => loadStoredDraft(config),
  );

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, serializeDraftState(state));
  }, [state]);

  const draftPlayer = useCallback((playerId: string) => {
    const nextState = applyDraftPick(state, playerId, config);
    dispatch({ type: "replace", state: nextState });
  }, [config, state]);
  const undoLastPick = useCallback(() => {
    dispatch({ type: "undo-last-pick", config });
  }, [config]);
  const resetDraft = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);
  const exportDraft = useCallback(() => serializeDraftState(state), [state]);
  const importDraft = useCallback((value: unknown) => {
    const importedState = validateDraftState(value, config);
    dispatch({ type: "replace", state: importedState });
  }, [config]);
  const replaceDraftState = useCallback((nextState: DraftState, targetConfig = config) => {
    dispatch({ type: "replace", state: validateDraftState(nextState, targetConfig) });
  }, [config]);

  const contextValue = useMemo(
    () => ({
      state,
      draftPlayer,
      undoLastPick,
      resetDraft,
      exportDraft,
      importDraft,
      replaceDraftState,
    }),
    [draftPlayer, exportDraft, importDraft, replaceDraftState, resetDraft, state, undoLastPick],
  );

  return (
    <DraftContext.Provider value={contextValue}>
      {children}
    </DraftContext.Provider>
  );
}

export function useDraft(): DraftContextValue {
  const context = useContext(DraftContext);
  if (!context) {
    throw new Error("useDraft must be used within a DraftProvider.");
  }
  return context;
}
