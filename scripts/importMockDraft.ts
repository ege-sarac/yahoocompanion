import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMockDraftFingerprint, resolveHistoricalMockDraft } from "../src/engine/marketDraft";
import { atomicJson, mockHistoryPath } from "./marketUtils";

const args = process.argv.slice(2);
const path = args.find((argument) => !argument.startsWith("--"));
if (!path) { console.error("Usage: npm.cmd run market:mock-import -- <completed-draft.json> [--teams=<number>] [--rounds=<number>]"); process.exitCode = 1; }
else try {
  const overrides = { teamCount: readOverride(args, "teams"), rounds: readOverride(args, "rounds") };
  const resolved = resolve(path);
  const result = resolveHistoricalMockDraft(JSON.parse(readFileSync(resolved, "utf8")), overrides);
  const fingerprint = createMockDraftFingerprint(result.draft);
  const target = resolve(mockHistoryPath, `${fingerprint}.json`);
  console.log(`Configuration source: ${result.configurationSource}`);
  console.log(`Teams: ${result.draft.teamCount} (${result.teamCountSource})`);
  console.log(`Rounds: ${result.draft.rounds} (${result.roundsSource})`);
  console.log(`Expected picks: ${result.expectedPicks}`);
  console.log(`Observed picks: ${result.observedPicks}`);
  console.log("Status: COMPLETE");
  if (existsSync(target)) {
    console.log(`Import: ALREADY_IMPORTED (${fingerprint}); market history was not duplicated.`);
  } else {
    atomicJson(target, { ...result.draft, fingerprint });
    console.log(`Import: SUCCESS (${fingerprint}) -> ${target}. Run npm.cmd run market:learn next.`);
  }
} catch (error) { console.error(`Mock import failed; history was preserved. ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }

function readOverride(args: string[], name: string): number | undefined {
  const prefix = `--${name}=`;
  const values = args.filter((argument) => argument.startsWith(prefix)).map((argument) => Number(argument.slice(prefix.length)));
  if (values.length > 1 || values.some((value) => !Number.isInteger(value) || value < 1)) throw new Error(`--${name} must be supplied once as a positive integer.`);
  return values[0];
}
