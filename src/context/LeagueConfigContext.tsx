import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LEAGUE_CONFIG, LEAGUE_CONFIG_STORAGE_KEY, migrateLeagueConfig, serializeLeagueConfig, validateLeagueConfig } from "../config/leagueConfig";
import type { LeagueConfig } from "../types";

interface LeagueConfigContextValue {
  config: LeagueConfig;
  applyConfig: (value: unknown) => void;
  restoreDefaults: () => void;
  exportConfig: () => string;
}
const LeagueConfigContext = createContext<LeagueConfigContextValue | null>(null);

function loadConfig(): LeagueConfig {
  const stored = window.localStorage.getItem(LEAGUE_CONFIG_STORAGE_KEY);
  if (!stored) return structuredClone(DEFAULT_LEAGUE_CONFIG);
  try { return migrateLeagueConfig(JSON.parse(stored) as unknown); }
  catch (error) {
    console.warn("Saved league settings could not be migrated; the original value was preserved.", error);
    window.localStorage.setItem(`${LEAGUE_CONFIG_STORAGE_KEY}:unmigrated`, stored);
    return structuredClone(DEFAULT_LEAGUE_CONFIG);
  }
}

export function LeagueConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<LeagueConfig>(loadConfig);
  useEffect(() => { window.localStorage.setItem(LEAGUE_CONFIG_STORAGE_KEY, serializeLeagueConfig(config)); }, [config]);
  const applyConfig = useCallback((value: unknown) => setConfig(validateLeagueConfig(value)), []);
  const restoreDefaults = useCallback(() => setConfig(structuredClone(DEFAULT_LEAGUE_CONFIG)), []);
  const exportConfig = useCallback(() => serializeLeagueConfig(config), [config]);
  const contextValue = useMemo(() => ({ config, applyConfig, restoreDefaults, exportConfig }), [applyConfig, config, exportConfig, restoreDefaults]);
  return <LeagueConfigContext.Provider value={contextValue}>{children}</LeagueConfigContext.Provider>;
}

export function useLeagueConfig(): LeagueConfigContextValue {
  const value = useContext(LeagueConfigContext);
  if (!value) throw new Error("useLeagueConfig must be used within LeagueConfigProvider.");
  return value;
}
