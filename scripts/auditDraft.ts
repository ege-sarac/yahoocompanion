import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_LEAGUE_CONFIG } from "../src/config/leagueConfig";
import { parseMockDraft } from "../src/engine/marketDraft";
import { getMyOverallPicks } from "../src/engine/draftOrder";
import { applyNbaPositionFallbacks } from "../src/engine/playerOverrides";
import { replayDraft } from "../src/engine/draftReplay";
import type { Player } from "../src/types";
import { readMarketData } from "./marketUtils";
import { readRoleData } from "./roleDataUtils";

const path = process.argv[2];
if (!path) { console.error("Usage: npm.cmd run draft:audit -- <draft-export>"); process.exitCode = 1; }
else try {
  const raw = JSON.parse(readFileSync(resolve(path), "utf8"));
  const parsed = parseMockDraft(raw, DEFAULT_LEAGUE_CONFIG.teamCount, DEFAULT_LEAGUE_CONFIG.rounds);
  const config = { ...structuredClone(DEFAULT_LEAGUE_CONFIG), teamCount: parsed.teamCount, rounds: parsed.rounds, userDraftSlot: Math.min(DEFAULT_LEAGUE_CONFIG.userDraftSlot, parsed.teamCount) };
  const players = applyNbaPositionFallbacks(JSON.parse(readFileSync(resolve("data", "processed", "players.json"), "utf8")) as Player[]);
  const newcomersPath = resolve("data", "manual", "newPlayerOverrides.json");
  const replay = replayDraft(players, parsed.picks, config, existsSync(newcomersPath) ? JSON.parse(readFileSync(newcomersPath, "utf8")) : [], [], readRoleData(), readMarketData());
  const playerById = new Map(players.map((player) => [player.id, player]));
  const userPicks = getMyOverallPicks(config);
  for (const snapshot of replay.snapshots) {
    const selected = snapshot.selectedRecommendation ?? undefined;
    const bestNow = snapshot.topFive[0], bestSeason = snapshot.bestSeasonValue;
    const nextUserPick = userPicks.find((pick) => pick > snapshot.overallPick) ?? null;
    const skipped = snapshot.topFive.filter((entry) => entry.player.id !== snapshot.selectedPlayerId);
    const skippedOutcomes = skipped.map((entry) => {
      const futurePick = nextUserPick === null ? undefined : parsed.picks.find((pick) => pick.overallPick > snapshot.overallPick && pick.overallPick < nextUserPick && pick.playerId === entry.player.id);
      const fullyObserved = nextUserPick !== null && parsed.picks.length >= nextUserPick - 1;
      return { entry, futurePick, outcome: futurePick ? `drafted #${futurePick.overallPick}` : fullyObserved ? "survived" : "not observable" };
    });
    const flags: string[] = [];
    if (selected?.marketTiming.reachCost && selected.marketTiming.reachCost >= 5) flags.push("EARLY REACH");
    if (bestNow?.marketTiming.waitValue >= 4) flags.push("WAIT OPPORTUNITY");
    if (skippedOutcomes.some(({ entry, futurePick }) => Boolean(futurePick) && entry.marketTiming.survivalEstimate >= 62)) flags.push("SURVIVAL MISS");
    if (selected && selected.expectedGamesProjection.expectedGames < 58 && snapshot.overallPick <= config.teamCount * 5) flags.push("RISKY EARLY PICK");
    if (bestNow?.positionContextComposite.contribution >= bestNow.positionContextComposite.cap * .9 && !bestNow.positionContextComposite.criticalOverride) flags.push("POSITION OVERWEIGHT");
    console.log(`Pick ${snapshot.overallPick}: selected ${playerById.get(snapshot.selectedPlayerId ?? "")?.name ?? snapshot.selectedPlayerId ?? "unknown"}; recommendation rank ${snapshot.selectedRank ?? "n/a"}.`);
    console.log(`Best Pick-Now: ${bestNow?.player.name ?? "n/a"}; best season value: ${bestSeason?.player.name ?? "n/a"}; market ${bestNow?.marketTiming.marketPickEstimate ?? "n/a"}; expected GP ${bestNow?.expectedGamesProjection.expectedGames ?? "n/a"}. ${flags.join(", ")}`);
    console.log(`Skipped Top 5 to next turn: ${skippedOutcomes.length ? skippedOutcomes.map(({ entry, outcome }) => `${entry.player.name} ${outcome}`).join("; ") : "none"}.`);
  }
  console.log(`Draft audit complete: ${replay.snapshots.length} user decisions; ${replay.warnings.length} source warnings.`);
} catch (error) { console.error("Draft audit failed:", error instanceof Error ? error.message : error); process.exitCode = 1; }
