import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_LEAGUE_CONFIG } from "../src/config/leagueConfig";
import { calculateFantasyPoints } from "../src/engine/fantasyPoints";
import { analyzeLateSeasonRegime } from "../src/engine/lateSeasonRegime";
import { rankPlayers } from "../src/engine/recommendationEngine";
import { projectPlayerForRecommendations } from "../src/engine/newPlayerProjection";
import { applyRoleIntelligence } from "../src/engine/roleProjection";
import { buildTeamEcosystem } from "../src/engine/teamEcosystem";
import { analyzeCareerStage } from "../src/engine/careerStage";
import type { CareerTrend, LateSeasonRegimeType, Player, PlayerRoleDataSet, PlayerRoleGame, PlayerRoleHistoryRecord } from "../src/types";
import { readRoleData } from "./roleDataUtils";

type Row = Record<string, unknown>;
type Evaluation = { id: string; actual: number; predicted: number; actualGames: number; predictedGames: number; actualTotal: number; predictedTotal: number; actualSeasonVorp: number; predictedSeasonVorp: number; confidence: number; regime: LateSeasonRegimeType; teamChanger: boolean; usage?: number; age: number | null; trend: CareerTrend };
const targetSeason = "2025-26", priorSeason = "2024-25";
const rawTarget = index(readArray(resolve("data", "raw", `player_stats_${targetSeason}.json`)));
const rawPrior = index(readArray(resolve("data", "raw", `player_stats_${priorSeason}.json`)));
const allPlayers = JSON.parse(readFileSync(resolve("data", "processed", "players.json"), "utf8")) as Player[];
const roleData = readRoleData();
const priorGames = buildPriorGames();
const roleRecords: PlayerRoleHistoryRecord[] = [];
for (const player of allPlayers) {
  const seasons = roleData?.players.find((record) => record.playerId === player.id)?.seasons.filter((metric) => metric.season <= priorSeason) ?? [];
  const record: PlayerRoleHistoryRecord = { playerId: player.id, seasons, latestSeasonGames: priorGames.get(player.id) ?? [] };
  if (record.latestSeasonGames.length) record.regime = analyzeLateSeasonRegime(record, text(rawPrior.get(player.id)?.TEAM_ABBREVIATION) || null, DEFAULT_LEAGUE_CONFIG, null, player.age === null ? null : player.age - 1);
  roleRecords.push(record);
}
const priorRoleData: PlayerRoleDataSet = { schemaVersion: 1, generatedAt: roleData?.generatedAt ?? null, seasonsIncluded: ["2023-24", priorSeason], sourceCoverage: roleData?.sourceCoverage ?? { advancedPlayerSeasons: 0, trackingPlayerSeasons: 0, playersWithGameLogs: 0, sourceFlags: [] }, players: roleRecords, teamGames: [], warnings: [] };
const trainingPlayers = allPlayers.flatMap((player): Player[] => {
  const target = rawTarget.get(player.id), prior = rawPrior.get(player.id);
  if (!target || !prior) return [];
  return [{ ...player, nbaTeam: text(prior.TEAM_ABBREVIATION) || null, age: player.age === null ? null : Math.max(18, player.age - 1), injuryStatus: "Healthy", expectedReturnDate: null, historicalStats: player.historicalStats.filter((season) => season.season < targetSeason), projections: null }];
});
const common = { players: trainingPlayers, draftedPlayerIds: [] as string[], myRoster: [] as Player[], currentRound: 1, asOfDate: new Date("2025-09-01T00:00:00Z"), leagueConfig: DEFAULT_LEAGUE_CONFIG };
const recordById = new Map(priorRoleData.players.map((record) => [record.playerId, record]));
const baseline = trainingPlayers.flatMap((player) => { const metrics = projectPlayerForRecommendations(player, undefined, common.asOfDate, DEFAULT_LEAGUE_CONFIG); return metrics ? [{ player, metrics }] : []; });
const roleAdjusted = baseline.map(({ player, metrics }) => ({ player, metrics: applyRoleIntelligence(player, metrics, recordById.get(player.id), DEFAULT_LEAGUE_CONFIG).metrics }));
const prompt9Ecosystem = buildTeamEcosystem(roleAdjusted, DEFAULT_LEAGUE_CONFIG);
const prompt10 = rankPlayers({ ...common, teamEcosystemEnabled: true, roleData: priorRoleData });
const evaluations = new Map<string, Evaluation[]>();
evaluations.set("A Prompt #8.2 baseline", baseline.map(({ player, metrics }) => evaluation(player, metrics.projection.projectedFantasyPointsPerGame, metrics.projection.projectedGames, metrics.modelConfidence, 0)));
evaluations.set("D Prompt #9 role + ecosystem", roleAdjusted.map(({ player, metrics }) => { const adjusted = prompt9Ecosystem.metricsByPlayerId.get(player.id) ?? metrics; return evaluation(player, adjusted.projection.projectedFantasyPointsPerGame, adjusted.projection.projectedGames, adjusted.modelConfidence, 0); }));
evaluations.set("E Prompt #10 draft-value calibration", prompt10.recommendations.map((recommendation) => evaluation(recommendation.player, recommendation.projection.projectedFantasyPointsPerGame, recommendation.expectedGamesProjection.expectedGames, recommendation.modelConfidence, recommendation.seasonValue.replacementFantasyPointsPerGame, recommendation.seasonValue.seasonVorp)));
console.log(`Leakage guard: predictions use only 2023-24 and 2024-25 inputs; ${targetSeason} is evaluation-only.`);
console.table([...evaluations].map(([Variant, rows]) => ({ Variant, ...metrics(rows) })));
const regimeRows = evaluations.get("E Prompt #10 draft-value calibration")!;
console.log("Cohort diagnostics (Prompt #10; Prompt #9 MAE shown for comparison):");
const prompt9Rows = evaluations.get("D Prompt #9 role + ecosystem")!;
const cohorts: Record<string, Evaluation[]> = {
  "stable role": regimeRows.filter((row) => row.regime === "NO_MEANINGFUL_CHANGE"),
  "team changers": regimeRows.filter((row) => row.teamChanger),
  "final-third risers": regimeRows.filter((row) => row.regime === "SUSTAINED_ROLE_GAIN" || row.regime === "LATE_SEASON_DEVELOPMENT_ROLE" || row.regime === "TRADE_ROLE_CHANGE"),
  "final-third decliners": regimeRows.filter((row) => row.regime === "SUSTAINED_ROLE_LOSS"),
  "absence-dependent": regimeRows.filter((row) => row.regime === "ABSENCE_DEPENDENT_BOOST"),
  "injury-return": regimeRows.filter((row) => row.regime === "RETURN_FROM_INJURY_RAMP"),
  "high usage": regimeRows.filter((row) => (row.usage ?? 0) >= 27),
  "low confidence": regimeRows.filter((row) => row.confidence < .55),
  "age 33+": regimeRows.filter((row) => (row.age ?? 0) >= 33),
  "age 36+": regimeRows.filter((row) => (row.age ?? 0) >= 36),
  "structural decliners": regimeRows.filter((row) => row.trend === "STRUCTURAL_DECLINE"),
  "repeated low-GP": regimeRows.filter((row) => trainingPlayers.find((player) => player.id === row.id)!.historicalStats.filter((season) => season.gamesPlayed < 55).length >= 2),
  "stable healthy stars": regimeRows.filter((row) => row.trend === "STABLE" && row.predicted >= 38 && row.predictedGames >= 65),
};
console.table(Object.entries(cohorts).map(([Cohort, rows]) => { const previous = prompt9Rows.filter((row) => rows.some((item) => item.id === row.id)); return { Cohort, N: rows.length, "Prompt9 FP/G MAE": previous.length ? mean(previous.filter(fpEligible).map(error)).toFixed(3) : "n/a", "Prompt10 FP/G MAE": rows.filter(fpEligible).length ? mean(rows.filter(fpEligible).map(error)).toFixed(3) : "n/a", "Expected GP MAE": rows.length ? mean(rows.map(gamesError)).toFixed(2) : "n/a" }; }));
console.log("Confidence calibration (confidence is a heuristic score, not a probability):");
console.table([[0, .5], [.5, .7], [.7, 1.01]].map(([low, high]) => { const rows = regimeRows.filter((row) => row.confidence >= low && row.confidence < high); return { Bucket: `${low.toFixed(1)}-${Math.min(1, high).toFixed(1)}`, N: rows.length, MAE: rows.length ? mean(rows.map(error)).toFixed(3) : "n/a" }; }));
if (!priorGames.size) console.warn("WARNING: 2024-25 game-log cache is unavailable, so C is equivalent to B and role-change cohorts are unavailable. No future 2025-26 logs were used as inputs.");
console.log("Diagnostic only: no weights were optimized or rewritten.");

function metrics(rows: Evaluation[]) { const fpRows = rows.filter(fpEligible), errors = fpRows.map(error).sort((a, b) => a - b), gpErrors = rows.map(gamesError).sort((a, b) => a - b), vorpErrors = rows.map((row) => Math.abs(row.predictedSeasonVorp - row.actualSeasonVorp)); return { N: rows.length, "FP/G MAE": mean(errors).toFixed(3), "Median AE": percentile(errors, .5).toFixed(3), RMSE: Math.sqrt(mean(fpRows.map((row) => (row.predicted - row.actual) ** 2))).toFixed(3), "Expected GP MAE": mean(gpErrors).toFixed(2), "GP Median AE": percentile(gpErrors, .5).toFixed(2), "Season VORP MAE": mean(vorpErrors).toFixed(1), "Availability rank rho": seasonSpearman(rows).toFixed(3), Spearman: spearman(fpRows).toFixed(3), "Top 50 recall": recall(fpRows, 50).toFixed(3), "Top 100 recall": recall(fpRows, 100).toFixed(3) }; }
function evaluation(player: Player, predicted: number, predictedGames: number, confidence: number, replacement: number, predictedSeasonVorp = (predicted - replacement) * predictedGames): Evaluation { const target = rawTarget.get(player.id)!, prior = rawPrior.get(player.id), actual = actualFantasy(target), actualGames = num(target.GP), role = recordById.get(player.id); return { id: player.id, actual, predicted, actualGames, predictedGames, actualTotal: actual * actualGames, predictedTotal: predicted * predictedGames, actualSeasonVorp: (actual - replacement) * actualGames, predictedSeasonVorp, confidence, regime: role?.regime?.type ?? "UNKNOWN_INSUFFICIENT_SAMPLE", teamChanger: Boolean(prior && text(prior.TEAM_ABBREVIATION) !== text(target.TEAM_ABBREVIATION)), usage: role?.seasons.find((metric) => metric.season === priorSeason)?.usagePct, age: player.age, trend: analyzeCareerStage(player, role).careerTrend }; }
function actualFantasy(row: Row): number { const gp = Math.max(1, num(row.GP)); return calculateFantasyPoints({ points: num(row.PTS), offensiveRebounds: num(row.OREB), defensiveRebounds: num(row.DREB), assists: num(row.AST), steals: num(row.STL), blocks: num(row.BLK), turnovers: num(row.TOV), doubleDoubles: num(row.DD2) / gp, tripleDoubles: num(row.TD3) / gp }, DEFAULT_LEAGUE_CONFIG.scoring); }
function error(row: Evaluation): number { return Math.abs(row.predicted - row.actual); }
function gamesError(row: Evaluation): number { return Math.abs(row.predictedGames - row.actualGames); }
function fpEligible(row: Evaluation): boolean { return row.actualGames >= 10; }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function percentile(sorted: number[], p: number): number { return sorted[Math.floor(Math.max(0, sorted.length - 1) * p)] ?? 0; }
function recall(rows: Evaluation[], n: number): number { const count = Math.min(n, rows.length), actual = new Set([...rows].sort((a, b) => b.actual - a.actual).slice(0, count).map((row) => row.id)), predicted = new Set([...rows].sort((a, b) => b.predicted - a.predicted).slice(0, count).map((row) => row.id)); return [...actual].filter((id) => predicted.has(id)).length / Math.max(1, count); }
function spearman(rows: Evaluation[]): number { const actual = ranks(rows, (row) => row.actual), predicted = ranks(rows, (row) => row.predicted), n = rows.length; if (n < 2) return 0; const sum = rows.reduce((total, row) => total + (actual.get(row.id)! - predicted.get(row.id)!) ** 2, 0); return 1 - 6 * sum / (n * (n * n - 1)); }
function seasonSpearman(rows: Evaluation[]): number { const actual = ranks(rows, (row) => row.actualSeasonVorp), predicted = ranks(rows, (row) => row.predictedSeasonVorp), n = rows.length; if (n < 2) return 0; const sum = rows.reduce((total, row) => total + (actual.get(row.id)! - predicted.get(row.id)!) ** 2, 0); return 1 - 6 * sum / (n * (n * n - 1)); }
function ranks(rows: Evaluation[], selector: (row: Evaluation) => number): Map<string, number> { return new Map([...rows].sort((a, b) => selector(b) - selector(a)).map((row, index) => [row.id, index + 1])); }
function buildPriorGames(): Map<string, PlayerRoleGame[]> { const base = readRows(resolve("data", "raw", `role_game_logs_base_${priorSeason}.json`)), advanced = new Map(readRows(resolve("data", "raw", `role_game_logs_advanced_${priorSeason}.json`)).map((row) => [`${text(row.PLAYER_ID)}|${text(row.GAME_ID)}`, row])), sequence = new Map<string, number>(), teamGames = new Map<string, Array<{ id: string; date: string }>>(); for (const row of base) { const team = text(row.TEAM_ABBREVIATION), id = text(row.GAME_ID), date = dateText(row.GAME_DATE); if (team && id && !teamGames.get(team)?.some((game) => game.id === id)) teamGames.set(team, [...(teamGames.get(team) ?? []), { id, date }]); } for (const [team, games] of teamGames) games.sort((a, b) => a.date.localeCompare(b.date)).forEach((game, index) => sequence.set(`${team}|${game.id}`, index + 1)); const result = new Map<string, PlayerRoleGame[]>(); for (const row of base) { const playerId = text(row.PLAYER_ID), team = text(row.TEAM_ABBREVIATION), gameId = text(row.GAME_ID), gameDate = dateText(row.GAME_DATE), extra = advanced.get(`${playerId}|${gameId}`); if (!playerId || !team || !gameId || !gameDate) continue; const game: PlayerRoleGame = { playerId, team, gameId, gameDate, teamGameNumber: sequence.get(`${team}|${gameId}`) ?? 0, minutes: num(row.MIN), points: num(row.PTS), fga: num(row.FGA), fta: num(row.FTA), assists: num(row.AST), turnovers: num(row.TOV), offensiveRebounds: num(row.OREB), defensiveRebounds: num(row.DREB), steals: num(row.STL), blocks: num(row.BLK), usagePct: pct(extra?.USG_PCT), trueShootingPct: pct(extra?.TS_PCT), pace: optionalNum(extra?.PACE) }; result.set(playerId, [...(result.get(playerId) ?? []), game]); } return result; }
function readArray(path: string): Row[] { return JSON.parse(readFileSync(path, "utf8")) as Row[]; }
function readRows(path: string): Row[] { if (!existsSync(path)) return []; const value = JSON.parse(readFileSync(path, "utf8")) as Row[] | { rows: Row[] }; return Array.isArray(value) ? value : value.rows; }
function index(rows: Row[]): Map<string, Row> { return new Map(rows.map((row) => [text(row.PLAYER_ID), row])); }
function text(value: unknown): string { return value === undefined || value === null ? "" : String(value).trim(); }
function num(value: unknown): number { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function optionalNum(value: unknown): number | undefined { const result = Number(value); return value === undefined || value === null || value === "" || !Number.isFinite(result) ? undefined : result; }
function pct(value: unknown): number | undefined { const result = optionalNum(value); return result === undefined ? undefined : result <= 1.5 ? result * 100 : result; }
function dateText(value: unknown): string { const date = new Date(text(value)); return Number.isNaN(date.valueOf()) ? "" : date.toISOString().slice(0, 10); }
