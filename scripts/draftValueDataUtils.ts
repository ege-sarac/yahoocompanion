import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { matchInjurySnapshot, mergeInjurySnapshot, validateInjurySnapshot } from "../src/engine/injurySnapshot";
import { validateNewPlayerOverrides } from "../src/engine/newPlayerOverrides";
import { applyNbaPositionFallbacks, mergePlayerOverrides, validatePlayerOverrides } from "../src/engine/playerOverrides";
import type { NewPlayerProjectionInput, Player } from "../src/types";

export function readCalibratedInputs(): { players: Player[]; newPlayerInputs: NewPlayerProjectionInput[] } {
  const raw = JSON.parse(readFileSync(resolve("data", "processed", "players.json"), "utf8")) as Player[];
  const ids = new Set(raw.map((player) => player.id));
  let players = applyNbaPositionFallbacks(raw);
  const injuryPath = resolve("data", "manual", "currentInjuries.json");
  if (existsSync(injuryPath)) { const snapshot = validateInjurySnapshot(JSON.parse(readFileSync(injuryPath, "utf8"))); players = mergeInjurySnapshot(players, matchInjurySnapshot(snapshot, players)); }
  const overridePath = resolve("data", "manual", "playerOverrides.json");
  if (existsSync(overridePath)) players = mergePlayerOverrides(players, validatePlayerOverrides(JSON.parse(readFileSync(overridePath, "utf8")), ids));
  const newcomerPath = resolve("data", "manual", "newPlayerOverrides.json");
  const newPlayerInputs = existsSync(newcomerPath) ? validateNewPlayerOverrides(JSON.parse(readFileSync(newcomerPath, "utf8")), ids) : [];
  return { players, newPlayerInputs };
}
