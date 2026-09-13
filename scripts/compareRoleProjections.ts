import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyNbaPositionFallbacks } from "../src/engine/playerOverrides";
import { rankPlayers } from "../src/engine/recommendationEngine";
import type { Player } from "../src/types";
import { readRoleData } from "./roleDataUtils";

const players = applyNbaPositionFallbacks(JSON.parse(readFileSync(resolve("data", "processed", "players.json"), "utf8")) as Player[]);
const roleData = readRoleData();
if (!roleData) throw new Error("Role data is missing. Run roles:process first.");
const base = rankPlayers({ players, draftedPlayerIds: [], myRoster: [], currentRound: 1, teamEcosystemEnabled: false });
const upgraded = rankPlayers({ players, draftedPlayerIds: [], myRoster: [], currentRound: 1, teamEcosystemEnabled: false, roleData });
const baseline = new Map(base.recommendations.map((entry) => [entry.player.id, entry]));
const changes = upgraded.recommendations.flatMap((entry) => { const old = baseline.get(entry.player.id); if (!old || !entry.player.historicalStats.length) return []; return [{ Player: entry.player.name, "Before FP/G": old.projection.projectedFantasyPointsPerGame.toFixed(2), "After FP/G": entry.projection.projectedFantasyPointsPerGame.toFixed(2), "Change FP/G": (entry.projection.projectedFantasyPointsPerGame - old.projection.projectedFantasyPointsPerGame).toFixed(2), Regime: entry.roleContextSummary?.lateSeasonRegime ?? "fallback", Reason: entry.roleContextSummary?.roleReasons[0] ?? "No measured regime adjustment" }]; }).sort((a, b) => Number(b["Change FP/G"]) - Number(a["Change FP/G"]));
console.log("Largest 15 positive Prompt #9 role changes versus the Prompt #8.2-compatible no-role fallback:"); console.table(changes.slice(0, 15));
console.log("Largest 15 negative Prompt #9 role changes versus the Prompt #8.2-compatible no-role fallback:"); console.table(changes.slice(-15).reverse());
console.log(`Compared ${changes.length} NBA-history players. Adjustments exclude Team Ecosystem so the diagnostic isolates role/regime effects.`);
