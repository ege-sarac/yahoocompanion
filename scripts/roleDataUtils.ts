import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PlayerRoleDataSet } from "../src/types";

export const roleDataPath = resolve("data", "processed", "playerRoleHistory.json");

export function readRoleData(): PlayerRoleDataSet | undefined {
  if (!existsSync(roleDataPath)) return undefined;
  const value = JSON.parse(readFileSync(roleDataPath, "utf8")) as PlayerRoleDataSet;
  if (value.schemaVersion !== 1 || !Array.isArray(value.players) || !value.sourceCoverage) throw new Error(`${roleDataPath} is malformed.`);
  return value;
}
