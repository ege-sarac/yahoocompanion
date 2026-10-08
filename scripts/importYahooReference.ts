import { basename, resolve } from "node:path";
import { atomicJson, marketPath, parseYahooInput, readPlayers, rebuildMarket, yahooPath } from "./marketUtils";

const path = process.argv[2];
if (!path) { console.error("Usage: npm.cmd run market:yahoo-import -- <consensus-rankings-points.csv>"); process.exitCode = 1; }
else try {
  const profiles = parseYahooInput(resolve(path), readPlayers());
  atomicJson(yahooPath, {
    schemaVersion: 1,
    importedAt: new Date().toISOString(),
    source: "YAHOO_CONSENSUS_REFERENCE",
    sourceFilename: basename(path),
    season: "2026-27",
    entries: profiles,
  });
  // Rebuilds only the derived market artifact; it does not add this CSV as a mock draft.
  atomicJson(marketPath, rebuildMarket());
  console.log(`Imported ${profiles.length} Yahoo consensus reference rows. Market artifact rebuilt from existing mock history without creating or learning synthetic mocks.`);
} catch (error) { console.error(`Yahoo reference import failed; existing data was preserved. ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
