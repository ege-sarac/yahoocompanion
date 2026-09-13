import { resolve } from "node:path";
import { atomicJson, parseYahooInput, readPlayers, yahooPath } from "./marketUtils";

const path = process.argv[2];
if (!path) { console.error("Usage: npm.cmd run market:import -- <yahoo-rank-or-adp.json|csv>"); process.exitCode = 1; }
else try { const profiles = parseYahooInput(resolve(path), readPlayers()); atomicJson(yahooPath, profiles); console.log(`Atomically imported ${profiles.length} Yahoo rank/ADP profiles to data/manual/yahooMarket.json.`); } catch (error) { console.error(`Market import failed; existing data was preserved. ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
