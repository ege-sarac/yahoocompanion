import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { DEFAULT_LEAGUE_CONFIG } from "../src/config/leagueConfig";
import { createMockDraftFingerprint, learnMarketProfiles, parseMockDraft, validateMarketDataSet, validateMarketProfile } from "../src/engine/marketDraft";
import type { LeagueConfig, MarketDataSet, MarketPlayerProfile, MockDraftRecord, Player } from "../src/types";

export const playersPath = resolve("data", "processed", "players.json");
export const marketPath = resolve("data", "processed", "marketProfiles.json");
export const yahooPath = resolve("data", "manual", "yahooMarket.json");
export const mockHistoryPath = resolve("data", "manual", "mockDraftHistory");
export function readPlayers(): Player[] { return JSON.parse(readFileSync(playersPath, "utf8")) as Player[]; }
export function readMarketData(): MarketDataSet | undefined { return existsSync(marketPath) ? validateMarketDataSet(JSON.parse(readFileSync(marketPath, "utf8"))) : undefined; }
export function readYahooProfiles(): MarketPlayerProfile[] { if (!existsSync(yahooPath)) return []; const value = JSON.parse(readFileSync(yahooPath, "utf8")) as unknown; const entries = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { entries?: unknown }).entries) ? (value as { entries: unknown[] }).entries : null; if (!entries) throw new Error("Yahoo market file must be an array or a reference envelope with entries."); return entries.map(validateMarketProfile); }
export function readMockDrafts(config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): MockDraftRecord[] {
  if (!existsSync(mockHistoryPath)) return [];
  const unique = new Map<string, MockDraftRecord>();
  for (const name of readdirSync(mockHistoryPath).filter((entry) => extname(entry).toLowerCase() === ".json").sort()) {
    const draft = parseMockDraft(JSON.parse(readFileSync(resolve(mockHistoryPath, name), "utf8")), config.teamCount, config.rounds);
    unique.set(createMockDraftFingerprint(draft), draft);
  }
  return [...unique.values()];
}
export function rebuildMarket(config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): MarketDataSet { return learnMarketProfiles(readPlayers(), readMockDrafts(config), readYahooProfiles(), config); }
export function atomicJson(path: string, value: unknown): void { const temporary = `${path}.tmp`; writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); try { renameSync(temporary, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; copyFileSync(temporary, path); unlinkSync(temporary); } }

export function parseYahooInput(path: string, players: readonly Player[]): MarketPlayerProfile[] {
  const raw = readFileSync(resolve(path), "utf8");
  const rows = extname(path).toLowerCase() === ".csv" ? parseCsv(raw) : jsonRows(JSON.parse(raw));
  const byId = new Map(players.map((player) => [player.id, player]));
  const byName = new Map<string, Player[]>();
  for (const player of players) { const key = normalize(player.name); byName.set(key, [...(byName.get(key) ?? []), player]); }
  const profiles = rows.map((row, index) => {
    let playerId = text(row.playerId);
    if (playerId && !byId.has(playerId)) throw new Error(`Row ${index + 1}: unknown playerId ${playerId}.`);
    if (!playerId) { const playerName = text(row.playerName ?? row.Player); const matches = byName.get(normalize(playerName)) ?? []; if (matches.length !== 1) throw new Error(`Row ${index + 1}: ${playerName || "playerName"} must have one exact normalized match.`); playerId = matches[0].id; }
    const rank = optionalNumber(row.rank ?? row.Rank), adp = optionalNumber(row.adp ?? row["Yahoo ADP"]);
    if (rank === undefined && adp === undefined) throw new Error(`Row ${index + 1}: rank or adp is required.`);
    return validateMarketProfile({ playerId, yahooPreRank: rank, yahooADP: adp, externalHistoricalFantasyPointsPerGame: optionalNumber(row.historicalFantasyPointsPerGame ?? row["'25-26 FPPG"]), externalConsensusRank: optionalNumber(row.consensusRank ?? row["Avg rank"]), externalRank: rank, externalRankChangeVsPrior: text(row.rankChangeVsPrior ?? row["vs '25"]) || undefined, updatedAt: text(row.sourceDate) || new Date().toISOString(), source: "YAHOO_CONSENSUS_REFERENCE", format: "points" });
  });
  if (new Set(profiles.map((profile) => profile.playerId)).size !== profiles.length) throw new Error("Import contains duplicate players.");
  return profiles;
}
function parseCsv(input: string): Record<string, string>[] { const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()); if (!lines.length) return []; const rows = lines.map(parseCsvLine), headers = rows[0].map((value) => value.trim()); return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))); }
function parseCsvLine(line: string): string[] { const result: string[] = []; let current = "", quoted = false; for (let index = 0; index < line.length; index++) { const char = line[index]; if (char === '"' && quoted && line[index + 1] === '"') { current += '"'; index++; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { result.push(current); current = ""; } else current += char; } result.push(current); return result; }
function jsonRows(value: unknown): Record<string, unknown>[] { const rows = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { players?: unknown }).players) ? (value as { players: unknown[] }).players : null; if (!rows || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Yahoo JSON must be an array or { players: [] }."); return rows as Record<string, unknown>[]; }
function normalize(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim().replace(/\b(jr|sr|ii|iii|iv)$/, "").trim(); }
function text(value: unknown): string { return value === undefined || value === null ? "" : String(value).trim(); }
function optionalNumber(value: unknown): number | undefined { if (value === undefined || value === null || value === "") return undefined; const parsed = Number(value); if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid positive number: ${String(value)}`); return parsed; }
