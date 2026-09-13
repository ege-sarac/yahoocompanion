import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyNbaPositionFallbacks } from "../src/engine/playerOverrides";
import { rankPlayers } from "../src/engine/recommendationEngine";
import { matchesPlayerName } from "../src/engine/textSearch";
import type { Player } from "../src/types";
import { readRoleData } from "./roleDataUtils";

const players = applyNbaPositionFallbacks(JSON.parse(readFileSync(resolve("data", "processed", "players.json"), "utf8")) as Player[]);
const roleData = readRoleData();
const input = { players, draftedPlayerIds: [] as string[], myRoster: [] as Player[], currentRound: 1, currentOverallPick: 10, roleData, teamEcosystemEnabled: true };
const coldStart = performance.now(); rankPlayers(input); const coldMs = performance.now() - coldStart;
const repeated: number[] = [];
for (let index = 0; index < 20; index++) { const start = performance.now(); rankPlayers({ ...input, currentOverallPick: 10 + index }); repeated.push(performance.now() - start); }
const searchStart = performance.now();
for (const query of ["a", "jo", "will", "alex", "smith", "zzzz"]) players.filter((player) => matchesPlayerName(player.name, query)).slice(0, 12);
const searchMs = (performance.now() - searchStart) / 6;
console.log(`Players ${players.length}; role records ${roleData?.players.length ?? 0}`);
console.log(`Cold ranking ${coldMs.toFixed(2)} ms; repeated mean ${mean(repeated).toFixed(2)} ms; repeated max ${Math.max(...repeated).toFixed(2)} ms; average search query ${searchMs.toFixed(3)} ms.`);
console.log("Draft search filters the stable player list only; recommendation/regime processing is not query-dependent.");
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
