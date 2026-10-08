import { existsSync, readFileSync } from "node:fs";

import { readYahooProfiles, yahooPath } from "./marketUtils";

try {
  if (!existsSync(yahooPath)) {
    console.log("Yahoo reference is optional and currently unavailable.");
  } else {
    const raw = JSON.parse(readFileSync(yahooPath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray((raw as { entries?: unknown }).entries)) {
      throw new Error("Yahoo reference must use the schemaVersion 1 reference envelope.");
    }
    const envelope = raw as { schemaVersion?: unknown; importedAt?: unknown; source?: unknown };
    if (envelope.schemaVersion !== 1 || typeof envelope.importedAt !== "string" || envelope.source !== "YAHOO_CONSENSUS_REFERENCE") {
      throw new Error("Yahoo reference metadata is invalid.");
    }
    const profiles = readYahooProfiles();
    const withoutAdp = profiles.filter((profile) => profile.yahooADP === undefined);
    console.log(`Yahoo reference: ${profiles.length} matched entries; ${profiles.length - withoutAdp.length} with ADP; imported ${envelope.importedAt}.`);
  }
} catch (error) {
  console.error("Yahoo reference validation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
