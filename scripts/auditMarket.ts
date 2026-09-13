import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_LEAGUE_CONFIG } from "../src/config/leagueConfig";
import { calculateMarketTiming, learnMarketProfiles, parseMockDraft } from "../src/engine/marketDraft";
import { getTeamOverallPicks } from "../src/engine/draftOrder";
import { readMockDrafts, readPlayers, readYahooProfiles } from "./marketUtils";

const path = process.argv[2];
if (!path) { console.error("Usage: npm.cmd run market:audit -- <draft-file>"); process.exitCode = 1; }
else try {
  const target = parseMockDraft(JSON.parse(readFileSync(resolve(path), "utf8")), DEFAULT_LEAGUE_CONFIG.teamCount, DEFAULT_LEAGUE_CONFIG.rounds);
  const config = { ...structuredClone(DEFAULT_LEAGUE_CONFIG), teamCount: target.teamCount, rounds: target.rounds, userDraftSlot: Math.min(DEFAULT_LEAGUE_CONFIG.userDraftSlot, target.teamCount) };
  const completedPickCount = target.teamCount * target.rounds;
  const isCompleteDraft = target.picks.length >= completedPickCount;
  const players = readPlayers(), history = readMockDrafts(config);
  const training = history.length ? history : [target];
  const market = learnMarketProfiles(players, training, readYahooProfiles(), config);
  const profileById = new Map(market.profiles.map((profile) => [profile.playerId, profile]));
  const actualPick = new Map(target.picks.map((pick) => [pick.playerId, pick.overallPick]));
  const userPicks = getTeamOverallPicks(config.teamCount, config.userDraftSlot, config.rounds);
  let correct = 0, count = 0; const errors: number[] = [];
  for (const current of userPicks) {
    if (current > target.picks.length) break;
    const next = userPicks.find((pick) => pick > current) ?? null;
    if (!next) continue;
    for (const player of players) {
      const pick = actualPick.get(player.id);
      if (pick !== undefined && pick < current) continue;
      const profile = profileById.get(player.id); if (!profile) continue;
      const timing = calculateMarketTiming(profile, config, current, next, 999, players.length, target.picks.slice(0, current - 1), player, players);
      const survived = pick === undefined || pick >= next;
      if ((timing.survivalEstimate >= 50) === survived) correct++;
      count++;
      if (pick !== undefined && timing.marketPickEstimate !== null) errors.push(Math.abs(timing.marketPickEstimate - pick));
    }
  }
  errors.sort((a, b) => a - b);
  console.log(`Market audit: ${count} survival decisions; ${isCompleteDraft ? "out-of-turn survival accuracy" : "partial-fixture survival agreement"} ${count ? (correct / count * 100).toFixed(1) : "n/a"}%.`);
  console.log(`Market-pick error: mean ${errors.length ? (errors.reduce((sum, value) => sum + value, 0) / errors.length).toFixed(1) : "n/a"}; median ${errors.length ? errors[Math.floor(errors.length / 2)].toFixed(1) : "n/a"}; mean rounds ${errors.length ? (errors.reduce((sum, value) => sum + value, 0) / errors.length / config.teamCount).toFixed(2) : "n/a"}.`);
  if (!history.length) console.warn("No separate mock-history corpus was found; this small audit is in-sample and is not probabilistic calibration.");
  if (!isCompleteDraft) console.warn(`The target contains ${target.picks.length}/${completedPickCount} picks. Treat timing results as a smoke diagnostic, not market accuracy.`);
} catch (error) { console.error("Market audit failed:", error instanceof Error ? error.message : error); process.exitCode = 1; }
