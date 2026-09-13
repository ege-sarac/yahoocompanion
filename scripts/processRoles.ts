import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeLateSeasonRegime, calculateTeammateDependencies } from "../src/engine/lateSeasonRegime";
import type { Player, PlayerRoleDataSet, PlayerRoleGame, PlayerRoleHistoryRecord, PlayerRoleMetrics, RoleDataSourceFlag, TeamGameParticipation } from "../src/types";

type Row = Record<string, unknown>;
const raw = resolve("data", "raw"), processed = resolve("data", "processed");
const seasons = ["2023-24", "2024-25", "2025-26"];
const latestSeason = seasons.at(-1)!;

try {
  const players = readJson(resolve(processed, "players.json")) as Player[];
  const currentRows = readRows(resolve(raw, "current_players.json"));
  const currentById = new Map(currentRows.map((row) => [String(row.id), row]));
  const advancedBySeason = new Map(seasons.map((season) => [season, indexRows(readRows(resolve(raw, `role_advanced_${season}.json`)))]));
  const traditionalBySeason = new Map(seasons.map((season) => [season, indexRows(readRows(resolve(raw, `player_stats_${season}.json`)))]));
  const trackingSets = ["possessions", "passing", "rebounding"].map((name) => indexRows(readRows(resolve(raw, `role_tracking_${name}_${latestSeason}.json`))));
  const baseGameRows = readRows(resolve(raw, `role_game_logs_base_${latestSeason}.json`));
  const advancedGameRows = indexGameRows(readRows(resolve(raw, `role_game_logs_advanced_${latestSeason}.json`)));
  const teamGameNumbers = buildTeamGameNumbers(baseGameRows);
  const gamesByPlayerId = new Map<string, PlayerRoleGame[]>();
  const participationByTeamGame = new Map<string, TeamGameParticipation>();
  for (const row of baseGameRows) {
    const playerId = text(row.PLAYER_ID), team = text(row.TEAM_ABBREVIATION), gameId = text(row.GAME_ID), gameDate = normalizeDate(row.GAME_DATE);
    if (!playerId || !team || !gameId || !gameDate) continue;
    const advanced = advancedGameRows.get(`${playerId}|${gameId}`);
    const game: PlayerRoleGame = { playerId, team, gameId, gameDate, teamGameNumber: teamGameNumbers.get(`${team}|${gameId}`) ?? 0, minutes: num(row.MIN), points: num(row.PTS), fga: num(row.FGA), fta: num(row.FTA), assists: num(row.AST), turnovers: num(row.TOV), offensiveRebounds: num(row.OREB), defensiveRebounds: num(row.DREB), steals: num(row.STL), blocks: num(row.BLK) };
    assign(game, "usagePct", pct(advanced?.USG_PCT)); assign(game, "trueShootingPct", pct(advanced?.TS_PCT)); assign(game, "pace", optionalNum(advanced?.PACE));
    gamesByPlayerId.set(playerId, [...(gamesByPlayerId.get(playerId) ?? []), game]);
    const key = `${team}|${gameId}`, existing = participationByTeamGame.get(key);
    if (existing) existing.playerIds.push(playerId); else participationByTeamGame.set(key, { team, gameId, gameDate, teamGameNumber: game.teamGameNumber, playerIds: [playerId] });
  }
  const participation = [...participationByTeamGame.values()];
  const preliminary: PlayerRoleHistoryRecord[] = players.map((player) => ({ playerId: player.id, seasons: seasons.flatMap((season) => {
    const advanced = advancedBySeason.get(season)?.get(player.id), traditional = traditionalBySeason.get(season)?.get(player.id);
    if (!advanced && !traditional) return [];
    const tracking = season === latestSeason ? trackingSets.map((set) => set.get(player.id)).filter(Boolean) as Row[] : [];
    return [buildMetrics(player.id, season, advanced, traditional, tracking)];
  }), latestSeasonGames: (gamesByPlayerId.get(player.id) ?? []).sort((a, b) => a.gameDate.localeCompare(b.gameDate)) }));
  const currentTeamIds = new Map<string, Set<string>>();
  for (const player of players) if (player.nbaTeam) currentTeamIds.set(player.nbaTeam, new Set([...(currentTeamIds.get(player.nbaTeam) ?? []), player.id]));
  const recordById = new Map(preliminary.map((record) => [record.playerId, record]));
  for (const record of preliminary) {
    const player = players.find((item) => item.id === record.playerId)!;
    const targetLatest = latestMetrics(record);
    const competitors = player.nbaTeam ? players.filter((other) => other.id !== player.id && other.nbaTeam === player.nbaTeam).map((other) => {
      const otherLatest = latestMetrics(recordById.get(other.id));
      const positionOverlap = positionSimilarity(currentById.get(player.id)?.position, currentById.get(other.id)?.position);
      const roleSimilarity = 1 - Math.min(1, Math.abs((targetLatest?.usagePct ?? targetLatest?.fgaPer36 ?? 0) - (otherLatest?.usagePct ?? otherLatest?.fgaPer36 ?? 0)) / 25);
      return { playerId: other.id, roleOverlap: Math.max(.2, positionOverlap * .6 + roleSimilarity * .4), importance: (otherLatest?.minutesPerGame ?? 0) * (.5 + (otherLatest?.usagePct ?? 15) / 60) };
    }).sort((a, b) => b.importance - a.importance).slice(0, 3) : [];
    record.teammateDependencies = calculateTeammateDependencies(record.latestSeasonGames.filter((game) => !player.nbaTeam || game.team === player.nbaTeam), competitors, participation, currentTeamIds.get(player.nbaTeam ?? "") ?? new Set());
    record.regime = analyzeLateSeasonRegime(record, player.nbaTeam);
  }
  const playersWithGameLogs = preliminary.filter((record) => record.latestSeasonGames.length > 0).length;
  const compactPlayers = preliminary.map((record) => ({ ...record, latestSeasonGames: [] }));
  const allMetrics = preliminary.flatMap((record) => record.seasons);
  const sourceFlags = [...new Set(allMetrics.flatMap((metric) => metric.dataSourceFlags))] as RoleDataSourceFlag[];
  const fetchMetadata = readOptionalJson(resolve(raw, "role_fetch_metadata.json")) as { requestedAt?: string; failures?: string[] } | undefined;
  const dataset: PlayerRoleDataSet = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    seasonsIncluded: seasons,
    sourceCoverage: { advancedPlayerSeasons: allMetrics.filter((metric) => metric.dataSourceFlags.includes("NBA Advanced")).length, trackingPlayerSeasons: allMetrics.filter((metric) => metric.dataSourceFlags.includes("NBA Tracking")).length, playersWithGameLogs, sourceFlags },
    players: compactPlayers,
    teamGames: [],
    warnings: [
      ...(fetchMetadata?.failures ?? []).map((failure) => `Fetch limitation: ${failure}`),
      ...(baseGameRows.length ? ["The participation matrix and game rows were used offline, then omitted from the browser artifact after regime/dependency precomputation."] : ["Official game logs are unavailable; late-season regime analysis is disabled and Prompt #8.2 fallback remains active."]),
      ...(!sourceFlags.includes("NBA Tracking") ? ["Optional NBA tracking data is unavailable; no tracking values were fabricated."] : []),
    ],
  };
  atomicWrite(resolve(processed, "playerRoleHistory.json"), dataset);
  console.log(`Processed ${dataset.players.length} current players; ${dataset.sourceCoverage.advancedPlayerSeasons} advanced player-seasons; ${dataset.sourceCoverage.trackingPlayerSeasons} tracking player-seasons; ${playersWithGameLogs} players with game logs.`);
} catch (error) {
  console.error("Role processing failed:", error instanceof Error ? error.message : error); process.exitCode = 1;
}

function buildMetrics(playerId: string, season: string, advanced: Row | undefined, traditional: Row | undefined, tracking: Row[]): PlayerRoleMetrics {
  const sourceFlags: RoleDataSourceFlag[] = [];
  if (advanced) sourceFlags.push("NBA Advanced");
  if (tracking.length) sourceFlags.push("NBA Tracking");
  if (traditional) sourceFlags.push("derived traditional-box-score proxy");
  if (!sourceFlags.length) sourceFlags.push("missing");
  const minutes = optionalNum(advanced?.MIN) ?? optionalNum(traditional?.MIN);
  const metric: PlayerRoleMetrics = { playerId, season, team: text(advanced?.TEAM_ABBREVIATION ?? traditional?.TEAM_ABBREVIATION) || undefined, games: optionalNum(advanced?.GP ?? traditional?.GP), minutesPerGame: minutes, starterRate: ratio(optionalNum(traditional?.GS), optionalNum(traditional?.GP)), usagePct: pct(advanced?.USG_PCT), trueShootingPct: pct(advanced?.TS_PCT), turnoverPct: pct(advanced?.TM_TOV_PCT ?? advanced?.TOV_PCT), assistPct: pct(advanced?.AST_PCT), offensiveReboundPct: pct(advanced?.OREB_PCT), defensiveReboundPct: pct(advanced?.DREB_PCT), totalReboundPct: pct(advanced?.REB_PCT), fgaPer36: per36(traditional?.FGA, minutes), ftaPer36: per36(traditional?.FTA, minutes), turnoversPer36: per36(traditional?.TOV, minutes), pointsPer36: per36(traditional?.PTS, minutes), assistsPer36: per36(traditional?.AST, minutes), offensiveReboundsPer36: per36(traditional?.OREB, minutes), defensiveReboundsPer36: per36(traditional?.DREB, minutes), stealsPer36: per36(traditional?.STL, minutes), blocksPer36: per36(traditional?.BLK, minutes), pace: optionalNum(advanced?.PACE), dataCompleteness: 0, dataSourceFlags: sourceFlags };
  for (const row of tracking) {
    assign(metric, "potentialAssistsPer36", per36(row.POTENTIAL_AST, minutes)); assign(metric, "touchesPer36", per36(row.TOUCHES, minutes)); assign(metric, "timeOfPossessionPer36", per36(row.TIME_OF_POSS, minutes)); assign(metric, "timeOfPossessionPctOfMinutes", ratio(optionalNum(row.TIME_OF_POSS), minutes, 100)); assign(metric, "passesMadePer36", per36(row.PASSES_MADE, minutes)); assign(metric, "passesReceivedPer36", per36(row.PASSES_RECEIVED, minutes)); assign(metric, "reboundChancesPer36", per36(row.REB_CHANCES, minutes));
  }
  const optionalFields = Object.entries(metric).filter(([key]) => !["playerId", "season", "team", "dataCompleteness", "dataSourceFlags"].includes(key));
  metric.dataCompleteness = optionalFields.filter(([, value]) => value !== undefined).length / Math.max(1, optionalFields.length);
  return roundMetrics(metric);
}
function readRows(path: string): Row[] { if (!existsSync(path)) return []; const value = readJson(path); if (Array.isArray(value)) return value as Row[]; return value && typeof value === "object" && Array.isArray((value as { rows?: unknown }).rows) ? (value as { rows: Row[] }).rows : []; }
function readJson(path: string): unknown { return JSON.parse(readFileSync(path, "utf8")); }
function readOptionalJson(path: string): unknown { return existsSync(path) ? readJson(path) : undefined; }
function indexRows(rows: Row[]): Map<string, Row> { const result = new Map<string, Row>(); for (const row of rows) { const id = text(row.PLAYER_ID); if (id) result.set(id, row); } return result; }
function indexGameRows(rows: Row[]): Map<string, Row> { return new Map(rows.map((row) => [`${text(row.PLAYER_ID)}|${text(row.GAME_ID)}`, row])); }
function buildTeamGameNumbers(rows: Row[]): Map<string, number> { const gamesByTeam = new Map<string, Array<{ id: string; date: string }>>(); for (const row of rows) { const team = text(row.TEAM_ABBREVIATION), id = text(row.GAME_ID), date = normalizeDate(row.GAME_DATE); if (team && id && !gamesByTeam.get(team)?.some((game) => game.id === id)) gamesByTeam.set(team, [...(gamesByTeam.get(team) ?? []), { id, date }]); } const result = new Map<string, number>(); for (const [team, games] of gamesByTeam) games.sort((a, b) => a.date.localeCompare(b.date)).forEach((game, index) => result.set(`${team}|${game.id}`, index + 1)); return result; }
function latestMetrics(record?: PlayerRoleHistoryRecord): PlayerRoleMetrics | undefined { return record?.seasons.slice().sort((a, b) => b.season.localeCompare(a.season))[0]; }
function positionSimilarity(a: unknown, b: unknown): number { const left = new Set(text(a).split("-").filter(Boolean)), right = new Set(text(b).split("-").filter(Boolean)); return [...left].some((value) => right.has(value)) ? 1 : .35; }
function normalizeDate(value: unknown): string { const date = new Date(text(value)); return Number.isNaN(date.valueOf()) ? "" : date.toISOString().slice(0, 10); }
function text(value: unknown): string { return value === undefined || value === null ? "" : String(value).trim(); }
function optionalNum(value: unknown): number | undefined { const number = Number(value); return value === undefined || value === null || value === "" || !Number.isFinite(number) ? undefined : number; }
function num(value: unknown): number { return optionalNum(value) ?? 0; }
function pct(value: unknown): number | undefined { const number = optionalNum(value); return number === undefined ? undefined : number <= 1.5 ? number * 100 : number; }
function per36(value: unknown, minutes?: number): number | undefined { const number = optionalNum(value); return number === undefined || !minutes ? undefined : number / minutes * 36; }
function ratio(value?: number, denominator?: number, scale = 1): number | undefined { return value === undefined || !denominator ? undefined : value / denominator * scale; }
function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void { if (value !== undefined) target[key] = value; }
function roundMetrics(value: PlayerRoleMetrics): PlayerRoleMetrics { const mutable = value as unknown as Record<string, unknown>; for (const [key, item] of Object.entries(mutable)) if (typeof item === "number") mutable[key] = Math.round(item * 10000) / 10000; return value; }
function atomicWrite(path: string, value: unknown): void { const temporary = `${path}.tmp`; writeFileSync(temporary, `${JSON.stringify(value)}\n`, "utf8"); try { renameSync(temporary, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; copyFileSync(temporary, path); unlinkSync(temporary); } }
