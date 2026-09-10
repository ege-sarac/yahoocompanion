import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_LEAGUE_CONFIG, validateLeagueConfig } from "../src/config/leagueConfig";
import { replayDraft } from "../src/engine/draftReplay";
import { applyNbaPositionFallbacks } from "../src/engine/playerOverrides";
import type { DraftPick, Player } from "../src/types";

const inputPath = process.argv[2];
if (!inputPath) { console.error("Usage: npm.cmd run draft:replay -- <path-to-draft-json>"); process.exitCode = 1; }
else {
  const players = applyNbaPositionFallbacks(JSON.parse(readFileSync(resolve("data", "processed", "players.json"), "utf8")) as Player[]);
  const value = JSON.parse(readFileSync(resolve(inputPath), "utf8")) as Record<string, unknown>;
  const backup = value.draftState && typeof value.draftState === "object" ? value : null;
  const state = (backup?.draftState ?? value) as Record<string, unknown>;
  const config = backup?.leagueConfig ? validateLeagueConfig(backup.leagueConfig) : DEFAULT_LEAGUE_CONFIG;
  const newcomerPath = resolve("data", "manual", "newPlayerOverrides.json");
  const result = replayDraft(players, (state.picks ?? []) as Partial<DraftPick>[], config, existsSync(newcomerPath) ? JSON.parse(readFileSync(newcomerPath, "utf8")) : [], (state.manualUnavailablePlayerIds ?? []) as string[]);
  for (const snapshot of result.snapshots) {
    console.log(`\nPick ${snapshot.overallPick} | slack ${snapshot.feasibilitySlack} | need G ${snapshot.positionNeedUrgency.G.label}, F ${snapshot.positionNeedUrgency.F.label}, C ${snapshot.positionNeedUrgency.C.label}`);
    console.table(snapshot.topFive.map((entry, index) => ({ rank: index + 1, player: entry.player.name, positions: entry.player.yahooPositions.join("/"), fpG: entry.projection.projectedFantasyPointsPerGame.toFixed(1), context: entry.teamContextSummary?.label ?? "n/a" })));
    console.log(`Selected: ${players.find((player) => player.id === snapshot.selectedPlayerId)?.name ?? snapshot.selectedPlayerId ?? "missing"} (rank ${snapshot.selectedRank ?? "n/a"})`);
    console.log(snapshot.comment);
  }
  if (result.warnings.length) console.warn(`Replay warnings (${result.warnings.length}):\n${result.warnings.join("\n")}`);
  console.log(`\nReplay complete: ${result.snapshots.length} user-pick snapshots.`);
}
