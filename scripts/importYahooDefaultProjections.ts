import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { atomicJson, playersPath, readPlayers } from "./marketUtils";
import type { YahooDefaultProjection, YahooDefaultProjectionDataSet } from "../src/types";

const outputPath = resolve("data", "processed", "yahooDefaultProjections.json");
const input = process.argv[2];
if (!input) { console.error("Usage: npm.cmd run projections:yahoo-import -- <yahoo-default-projections.csv>"); process.exitCode = 1; }
else {
  try {
    void playersPath;
    const players = readPlayers(); const byName = new Map<string, typeof players>();
    for (const player of players) { const key = normalize(player.name); byName.set(key, [...(byName.get(key) ?? []), player]); }
    const rows = csv(readFileSync(resolve(input), "utf8")); const unmatched: string[] = [], ambiguous: string[] = [], entries: YahooDefaultProjection[] = [];
    for (const row of rows) {
      const name = row.Player?.trim() ?? "", matches = (byName.get(normalize(name)) ?? []).filter((player) => !row.Team || !player.nbaTeam || player.nbaTeam === row.Team);
      if (!matches.length) { unmatched.push(name); continue; }
      if (matches.length !== 1) { ambiguous.push(name); continue; }
      const values = ["Rank", "Slot FPPG", "GP", "MPG", "PTS", "REB", "AST", "STL", "BLK", "TO"].map((key) => number(row[key]));
      if (values.some((value) => value === null || value! < 0)) { unmatched.push(`${name} (invalid stat row)`); continue; }
      entries.push({ playerId: matches[0].id, playerName: name, team: row.Team || null, rank: values[0]!, yahooSourceSlotFppg: values[1]!, gp: values[2]!, mpg: values[3]!, points: values[4]!, rebounds: values[5]!, assists: values[6]!, steals: values[7]!, blocks: values[8]!, turnovers: values[9]!, usagePct: number(row["USG%"]) ?? undefined });
    }
    if (ambiguous.length) throw new Error(`Ambiguous player matches: ${ambiguous.join(", ")}`);
    const dataset: YahooDefaultProjectionDataSet = { schemaVersion: 1, importedAt: new Date().toISOString(), sourceFilename: basename(input), entries, matchingReport: { totalRows: rows.length, matched: entries.length, unmatched, ambiguous } };
    atomicJson(outputPath, dataset);
    console.log(`Yahoo default projections: ${rows.length} rows; ${entries.length} matched; ${unmatched.length} unmatched; ${ambiguous.length} ambiguous.`);
  } catch (error) { console.error(`Yahoo default projection import failed: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
}
function csv(input: string): Record<string, string>[] { const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()); const parse = (line: string) => line.split(","); const headers = parse(lines[0]).map((value) => value.trim()); return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, parse(line)[index]?.trim() ?? ""]))); }
function number(value: string | undefined): number | null { if (!value?.trim()) return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function normalize(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\b(jr|sr|ii|iii|iv)$/, "").trim(); }
