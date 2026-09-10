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
  markPlayerUnavailable,
  replaceDraftPick,
  restorePlayerAvailability,
  setPositionIntent as applyPositionIntent,
  updateDraftPreferences as applyDraftPreferences,
  validateDraftState,
} from "../engine";
import type { DraftState, PositionIntent } from "../types";
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
  replacePick: (overallPick: number, playerId: string, knownPlayerIds?: ReadonlySet<string>) => void;
  markUnavailable: (playerId: string) => void;
  restoreAvailability: (playerId: string) => void;
  setPositionIntent: (intent: PositionIntent) => void;
  updatePreferences: (preferences: Partial<Pick<DraftState, "keepPositionPreferenceAfterMyPick" | "teamEcosystemEnabled" | "showTeamContextDetails">>) => void;
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
  const replacePick = useCallback((overallPick: number, playerId: string, knownPlayerIds?: ReadonlySet<string>) => dispatch({ type: "replace", state: replaceDraftPick(state, overallPick, playerId, knownPlayerIds, config) }), [config, state]);
  const markUnavailable = useCallback((playerId: string) => dispatch({ type: "replace", state: markPlayerUnavailable(state, playerId) }), [state]);
  const restoreAvailability = useCallback((playerId: string) => dispatch({ type: "replace", state: restorePlayerAvailability(state, playerId) }), [state]);
  const setPositionIntent = useCallback((intent: PositionIntent) => dispatch({ type: "replace", state: applyPositionIntent(state, intent) }), [state]);
  const updatePreferences = useCallback((preferences: Partial<Pick<DraftState, "keepPositionPreferenceAfterMyPick" | "teamEcosystemEnabled" | "showTeamContextDetails">>) => dispatch({ type: "replace", state: applyDraftPreferences(state, preferences) }), [state]);

  const contextValue = useMemo(
    () => ({
      state,
      draftPlayer,
      undoLastPick,
      resetDraft,
      exportDraft,
      importDraft,
      replaceDraftState,
      replacePick, markUnavailable, restoreAvailability, setPositionIntent, updatePreferences,
    }),
    [draftPlayer, exportDraft, importDraft, markUnavailable, replaceDraftState, replacePick, resetDraft, restoreAvailability, setPositionIntent, state, undoLastPick, updatePreferences],
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
