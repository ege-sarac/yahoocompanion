import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_LEAGUE_CONFIG } from "../src/config/leagueConfig";
import { projectPlayerForRecommendations } from "../src/engine/newPlayerProjection";
import { applyYahooProjectionBaseline } from "../src/engine/yahooProjection";
import type { Player, YahooDefaultProjectionDataSet } from "../src/types";

const file = resolve("data", "processed", "yahooDefaultProjections.json");
if (!existsSync(file)) throw new Error("Run projections:yahoo-import first.");
const players = JSON.parse(readFileSync(resolve("data", "processed", "players.json"), "utf8")) as Player[];
const dataset = JSON.parse(readFileSync(file, "utf8")) as YahooDefaultProjectionDataSet;
const byId = new Map(dataset.entries.map((entry) => [entry.playerId, entry]));
let within = 0, up = 0, down = 0, unable = 0;
const largest: Array<{ name: string; gap: number }> = [];
for (const player of players) { const metrics = projectPlayerForRecommendations(player, undefined, undefined, DEFAULT_LEAGUE_CONFIG); if (!metrics) { unable++; continue; } const result = applyYahooProjectionBaseline(player, metrics, byId.get(player.id), DEFAULT_LEAGUE_CONFIG).yahooProjectionComparison!; if (!result.available) { unable++; continue; } if (result.sourceSelected === "INTERNAL") within++; else if ((result.projectionGap ?? 0) < 0) up++; else down++; largest.push({ name: player.name, gap: result.projectionGap ?? 0 }); }
console.log(`Yahoo projection report: available ${dataset.entries.length}; within tolerance ${within}; overridden upward ${up}; overridden downward ${down}; unavailable/partial ${unable}.`);
console.log("Largest disagreements:", largest.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 10).map((item) => `${item.name} ${item.gap >= 0 ? "+" : ""}${item.gap.toFixed(1)}`).join(" | "));
