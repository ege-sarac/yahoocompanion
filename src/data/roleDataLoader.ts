import { useEffect, useState } from "react";
import type { PlayerRoleDataSet } from "../types";

export interface RoleDataResult { data?: PlayerRoleDataSet; source: "processed" | "unavailable" }

export async function loadRoleData(): Promise<RoleDataResult> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}playerRoleHistory.json`, { cache: "no-store" });
    if (!response.ok) return { source: "unavailable" };
    const value = await response.json() as unknown;
    if (!isRoleDataSet(value)) { console.warn("Processed role data is malformed; Prompt #8.2 fallback remains active."); return { source: "unavailable" }; }
    return { data: value, source: "processed" };
  } catch (error) { console.warn("Processed role data is unavailable; Prompt #8.2 fallback remains active.", error); return { source: "unavailable" }; }
}

export function useRoleData(): RoleDataResult {
  const [result, setResult] = useState<RoleDataResult>({ source: "unavailable" });
  useEffect(() => { let active = true; void loadRoleData().then((loaded) => { if (active) setResult(loaded); }); return () => { active = false; }; }, []);
  return result;
}

export function isRoleDataSet(value: unknown): value is PlayerRoleDataSet {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && Array.isArray(record.players) && Array.isArray(record.seasonsIncluded) && Boolean(record.sourceCoverage && typeof record.sourceCoverage === "object");
}
