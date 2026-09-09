import { describe, expect, it } from "vitest";

import type {
  InjurySnapshot,
  InjurySnapshotEntry,
  Player,
  PlayerOverride,
} from "../types";
import {
  getInjurySnapshotFreshness,
  matchInjurySnapshot,
  mergeInjurySnapshot,
  prepareInjurySnapshotImport,
  validateInjurySnapshot,
} from "./injurySnapshot";
import { mergePlayerOverrides } from "./playerOverrides";

function player(id: string, name: string): Player {
  return {
    id,
    name,
    nbaTeam: "TST",
    yahooPositions: ["G"],
    age: 25,
    injuryStatus: null,
    expectedReturnDate: null,
    historicalStats: [],
    projections: null,
    injuryRisk: null,
    opportunityScore: null,
    breakoutScore: null,
  };
}

function entry(
  playerName: string,
  overrides: Partial<InjurySnapshotEntry> = {},
): InjurySnapshotEntry {
  return {
    playerName,
    status: "Out",
    injuryDescription: "Lower-body injury",
    expectedReturnDate: null,
    expectedReturnText: "Expected around the start of the season",
    returnConfidence: "medium",
    sourceName: "Example source",
    sourceUrl: "https://example.test/injury-report",
    sourcePublishedAt: "2026-09-08T12:00:00Z",
    fetchedOrReviewedAt: "2026-09-09T08:00:00Z",
    notes: null,
    ...overrides,
  };
}

function snapshot(entries: InjurySnapshotEntry[]): InjurySnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-09T09:00:00Z",
    season: "2026-27",
    entries,
  };
}

describe("injury snapshot validation", () => {
  it("accepts a valid snapshot and preserves return guidance and provenance", () => {
    const valid = validateInjurySnapshot(
      snapshot([
        entry("Test Player", {
          expectedReturnDate: "2026-10-20",
          expectedReturnText: "Expected to be available for training camp",
          returnConfidence: "high",
        }),
      ]),
    );

    expect(valid.entries[0]).toMatchObject({
      expectedReturnDate: "2026-10-20",
      expectedReturnText: "Expected to be available for training camp",
      returnConfidence: "high",
      sourceName: "Example source",
      sourceUrl: "https://example.test/injury-report",
      sourcePublishedAt: "2026-09-08T12:00:00Z",
      fetchedOrReviewedAt: "2026-09-09T08:00:00Z",
    });
  });

  it("rejects invalid versions, statuses, dates, and confidence values", () => {
    expect(() => validateInjurySnapshot({ ...snapshot([]), schemaVersion: 2 }))
      .toThrow("schemaVersion");
    expect(() =>
      validateInjurySnapshot(
        snapshot([entry("Test Player", { status: "Questionable" as never })]),
      ),
    ).toThrow("invalid status");
    expect(() =>
      validateInjurySnapshot(
        snapshot([entry("Test Player", { expectedReturnDate: "2026-02-30" })]),
      ),
    ).toThrow("malformed expectedReturnDate");
    expect(() =>
      validateInjurySnapshot(
        snapshot([
          entry("Test Player", { returnConfidence: "certain" as never }),
        ]),
      ),
    ).toThrow("invalid returnConfidence");
  });
});

describe("deterministic injury matching", () => {
  const players = [
    player("101", "Nikola Jokić"),
    player("102", "Anne-Marie O'Neil"),
  ];

  it("matches by player ID before considering a different name", () => {
    const report = matchInjurySnapshot(
      snapshot([entry("Different Name", { playerId: "101" })]),
      players,
    );
    expect(report.matchedEntries[0]).toMatchObject({
      playerId: "101",
      matchMethod: "playerId",
    });
  });

  it("matches normalized punctuation, capitalization, and whitespace", () => {
    const report = matchInjurySnapshot(
      snapshot([entry("  ANNE MARIE O.NEIL ")]),
      players,
    );
    expect(report.matchedEntries[0]).toMatchObject({
      playerId: "102",
      matchMethod: "exact-name",
    });
  });

  it("matches accents only in the accent-insensitive fallback", () => {
    const report = matchInjurySnapshot(snapshot([entry("Nikola Jokic")]), players);
    expect(report.matchedEntries[0]).toMatchObject({
      playerId: "101",
      matchMethod: "accent-insensitive-name",
    });
  });

  it("reports an unknown player without attaching the entry", () => {
    const report = matchInjurySnapshot(
      snapshot([entry("Unknown Person")]),
      players,
    );
    expect(report.matchedEntries).toHaveLength(0);
    expect(report.unmatchedEntries[0].playerName).toBe("Unknown Person");
  });

  it("reports duplicate and conflicting entries for the same player", () => {
    const same = matchInjurySnapshot(
      snapshot([entry("Nikola Jokic"), entry("Nikola Jokić")]),
      players,
    );
    const conflicting = matchInjurySnapshot(
      snapshot([
        entry("Nikola Jokic"),
        entry("Nikola Jokić", { status: "Healthy" }),
      ]),
      players,
    );

    expect(same.duplicateMatches).toHaveLength(1);
    expect(same.conflictingEntries).toHaveLength(0);
    expect(conflicting.duplicateMatches).toHaveLength(1);
    expect(conflicting.conflictingEntries).toHaveLength(1);
  });
});

describe("injury snapshot merge and import", () => {
  it("preserves dated and narrative return fields and source metadata", () => {
    const players = [player("101", "Test Player")];
    const report = matchInjurySnapshot(
      snapshot([
        entry("Test Player", {
          expectedReturnDate: "2026-10-20",
          expectedReturnText: "Expected for training camp",
          returnConfidence: "low",
        }),
      ]),
      players,
    );
    const merged = mergeInjurySnapshot(players, report)[0];

    expect(merged).toMatchObject({
      expectedReturnDate: "2026-10-20",
      expectedReturnText: "Expected for training camp",
      returnConfidence: "low",
      currentInjurySource: "snapshot",
      injurySource: {
        sourceName: "Example source",
        fetchedOrReviewedAt: "2026-09-09T08:00:00Z",
      },
    });
  });

  it("applies manual status and date after the snapshot", () => {
    const players = [player("101", "Test Player")];
    const report = matchInjurySnapshot(
      snapshot([entry("Test Player", { expectedReturnDate: "2026-12-01" })]),
      players,
    );
    const manual: PlayerOverride = {
      playerId: "101",
      yahooPositions: ["G", "F"],
      injuryStatus: "Returning soon",
      expectedReturnDate: "2026-10-01",
      notes: "Emergency correction",
    };
    const merged = mergePlayerOverrides(
      mergeInjurySnapshot(players, report),
      [manual],
    )[0];

    expect(merged.injuryStatus).toBe("Returning soon");
    expect(merged.expectedReturnDate).toBe("2026-10-01");
    expect(merged.currentInjurySource).toBe("manual");
  });

  it("does not replace the current snapshot when preparation fails", () => {
    const current = snapshot([entry("Test Player")]);
    const invalid = { ...snapshot([]), schemaVersion: 99 };

    expect(() =>
      prepareInjurySnapshotImport(
        current,
        invalid,
        [player("101", "Test Player")],
      ),
    ).toThrow("schemaVersion");
    expect(current.entries).toHaveLength(1);
    expect(current.entries[0].playerName).toBe("Test Player");
  });
});

describe("snapshot freshness", () => {
  it("classifies fresh, acceptable, and stale snapshots", () => {
    const asOf = new Date("2026-09-10T00:00:00Z");
    expect(
      getInjurySnapshotFreshness("2026-09-08T00:00:00Z", asOf).freshness,
    ).toBe("fresh");
    expect(
      getInjurySnapshotFreshness("2026-09-05T00:00:00Z", asOf).freshness,
    ).toBe("acceptable");
    expect(
      getInjurySnapshotFreshness("2026-09-01T00:00:00Z", asOf).freshness,
    ).toBe("stale");
  });
});
