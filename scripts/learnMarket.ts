import { atomicJson, marketPath, readMockDrafts, readPlayers, readYahooProfiles } from "./marketUtils";
import { learnMarketProfiles } from "../src/engine/marketDraft";
import { DEFAULT_LEAGUE_CONFIG } from "../src/config/leagueConfig";

try { const drafts = readMockDrafts(), yahoo = readYahooProfiles(); const data = learnMarketProfiles(readPlayers(), drafts, yahoo, DEFAULT_LEAGUE_CONFIG); atomicJson(marketPath, data); console.log(`Learned ${data.profiles.length} market profiles from ${drafts.length} mock drafts and ${yahoo.length} Yahoo entries.`); } catch (error) { console.error("Market learning failed:", error instanceof Error ? error.message : error); process.exitCode = 1; }
