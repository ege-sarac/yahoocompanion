import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_LEAGUE_CONFIG } from "../src/config/leagueConfig";
import { createInitialDraftState, deriveMyRoster, draftPlayer, getDraftInfo } from "../src/engine/draftState";
import { analyzeRosterFeasibility } from "../src/engine/rosterFeasibility";
import { rankPlayers } from "../src/engine/recommendationEngine";
import { applyNbaPositionFallbacks } from "../src/engine/playerOverrides";
import type { LeagueConfig, Player, YahooPosition } from "../src/types";

const options = Object.fromEntries(process.argv.slice(2).filter((value) => value.startsWith("--")).map((value) => { const [key, raw] = value.slice(2).split("="); return [key, Number(raw)]; }));
const runs = options.runs || 20, seed = options.seed || 20260910;
const rounds = Math.max(10, options.rounds || DEFAULT_LEAGUE_CONFIG.rounds);
const teamCount = options.teams || DEFAULT_LEAGUE_CONFIG.teamCount;
const config: LeagueConfig = { ...DEFAULT_LEAGUE_CONFIG, teamCount, userDraftSlot: Math.min(teamCount, options.slot || DEFAULT_LEAGUE_CONFIG.userDraftSlot), rounds, roster: { ...DEFAULT_LEAGUE_CONFIG.roster, BN: rounds - DEFAULT_LEAGUE_CONFIG.roster.G - DEFAULT_LEAGUE_CONFIG.roster.F - DEFAULT_LEAGUE_CONFIG.roster.C - DEFAULT_LEAGUE_CONFIG.roster.UTIL } };
const players = applyNbaPositionFallbacks(JSON.parse(readFileSync(resolve("data", "processed", "players.json"), "utf8")) as Player[]);
const initialRanking = rankPlayers({ players, draftedPlayerIds: [], myRoster: [], currentRound: 1, leagueConfig: config });
const baseOrder = initialRanking.recommendations.map((entry) => entry.player);
const fp = new Map(initialRanking.recommendations.map((entry) => [entry.player.id, entry.projection.projectedFantasyPointsPerGame]));
let random = seeded(seed);
const summaries = [];
for (let run = 0; run < runs; run++) {
  let state = createInitialDraftState(), criticalPicks = 0, needMatches = 0, impossibleTopFives = 0, preferChangedTopFive = 0, survivalInferiorPicks = 0;
  const teamPositions = new Map<number, Record<YahooPosition, number>>();
  while (state.currentOverallPick <= config.teamCount * config.rounds) {
    const info = getDraftInfo(state.currentOverallPick, config)!;
    let selected: Player | undefined;
    if (info.isMyTeam) {
      const ranking = rankPlayers({ players, draftedPlayerIds: state.draftedPlayerIds, myRoster: deriveMyRoster(state, players), currentRound: info.round, currentOverallPick: info.overallPick, draftPicks: state.picks, leagueConfig: config });
      selected = ranking.topRecommendations[0]?.player;
      const preferredPosition = (["G", "F", "C"] as YahooPosition[]).sort((a, b) => ranking.positionNeedUrgency[b].score - ranking.positionNeedUrgency[a].score)[0];
      const preferred = rankPlayers({ players, draftedPlayerIds: state.draftedPlayerIds, myRoster: deriveMyRoster(state, players), currentRound: info.round, currentOverallPick: info.overallPick, draftPicks: state.picks, leagueConfig: config, positionIntent: { mode: "Prefer", positions: [preferredPosition] } });
      if (preferred.topRecommendations.map((entry) => entry.player.id).join() !== ranking.topRecommendations.map((entry) => entry.player.id).join()) preferChangedTopFive++;
      if (ranking.topRecommendations[0] && ranking.topRecommendations[1] && ranking.topRecommendations[0].urgencyScore > ranking.topRecommendations[1].urgencyScore + 25 && ranking.topRecommendations[0].projection.projectedFantasyPointsPerGame + 5 < ranking.topRecommendations[1].projection.projectedFantasyPointsPerGame) survivalInferiorPicks++;
      if (Object.values(ranking.positionNeedUrgency).some((need) => need.label === "CRITICAL")) criticalPicks++;
      if (selected && selected.yahooPositions.some((position) => ranking.positionNeedUrgency[position].score >= .7)) needMatches++;
      if (ranking.topRecommendations.length && ranking.topRecommendations.every((entry) => !entry.candidateFeasibility.candidateKeepsRosterFeasible)) impossibleTopFives++;
    } else {
      const available = baseOrder.filter((player) => !state.draftedPlayerIds.includes(player.id));
      const target = ((info.teamNumber + run) % 3 === 0 ? "G" : (info.teamNumber + run) % 3 === 1 ? "F" : "C") as YahooPosition;
      const nearby = available.slice(0, 14);
      const preferred = nearby.filter((player) => player.yahooPositions.includes(target));
      const choicePool = preferred.length && random() < .35 ? preferred : nearby;
      selected = choicePool[Math.floor(random() * Math.min(6, choicePool.length))] ?? available[0];
      const counts = teamPositions.get(info.teamNumber) ?? { G: 0, F: 0, C: 0 }; selected?.yahooPositions.forEach((position) => counts[position]++); teamPositions.set(info.teamNumber, counts);
    }
    if (!selected) break;
    state = draftPlayer(state, selected.id, config);
  }
  const roster = deriveMyRoster(state, players);
  const feasibility = analyzeRosterFeasibility(roster, 0, [], config);
  summaries.push({ run: run + 1, feasible: feasibility.canCompleteRoster, averageFpG: roster.reduce((sum, player) => sum + (fp.get(player.id) ?? 0), 0) / Math.max(1, roster.length), criticalPicks, needMatches, impossibleTopFives, preferChangedTopFive, survivalInferiorPicks });
}
console.table(summaries);
console.log(`Runs ${runs} | seed ${seed} | ${config.teamCount} teams | slot ${config.userDraftSlot}`);
console.log(`Feasible rosters: ${summaries.filter((value) => value.feasible).length}/${runs}; mean FP/G ${average(summaries.map((value) => value.averageFpG)).toFixed(2)}; critical picks ${summaries.reduce((sum, value) => sum + value.criticalPicks, 0)}; impossible Top 5 ${summaries.reduce((sum, value) => sum + value.impossibleTopFives, 0)}.`);
console.log("Diagnostic only: simulation does not modify production weights.");

function seeded(initial: number) { let value = initial >>> 0; return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; }; }
function average(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
