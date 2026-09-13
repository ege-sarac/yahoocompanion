import { useEffect, useState } from "react";
import { validateMarketDataSet } from "../engine/marketDraft";
import type { MarketDataSet } from "../types";

export interface MarketDataResult { data?: MarketDataSet; source: "processed" | "unavailable" }
export async function loadMarketData(): Promise<MarketDataResult> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}marketProfiles.json`, { cache: "no-store" });
    if (!response.ok) return { source: "unavailable" };
    return { source: "processed", data: validateMarketDataSet(await response.json()) };
  } catch (error) { console.warn("Optional market profiles are unavailable; low-confidence model-only survival remains active.", error); return { source: "unavailable" }; }
}
export function useMarketData(): MarketDataResult { const [result, setResult] = useState<MarketDataResult>({ source: "unavailable" }); useEffect(() => { let active = true; void loadMarketData().then((next) => { if (active) setResult(next); }); return () => { active = false; }; }, []); return result; }
