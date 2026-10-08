import { useEffect, useState } from "react";
import type { YahooDefaultProjectionDataSet } from "../types";

export async function loadYahooDefaultProjections(): Promise<YahooDefaultProjectionDataSet | undefined> {
  try { const response = await fetch(`${import.meta.env.BASE_URL}yahooDefaultProjections.json`, { cache: "no-store" }); if (!response.ok) return undefined; const data = await response.json() as YahooDefaultProjectionDataSet; return data.schemaVersion === 1 && Array.isArray(data.entries) ? data : undefined; } catch { return undefined; }
}
export function useYahooDefaultProjections(): YahooDefaultProjectionDataSet | undefined {
  const [data, setData] = useState<YahooDefaultProjectionDataSet>();
  useEffect(() => { let active = true; void loadYahooDefaultProjections().then((value) => { if (active) setData(value); }); return () => { active = false; }; }, []);
  return data;
}
