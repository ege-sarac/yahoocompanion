import { describe, expect, it } from "vitest";

import { SAMPLE_PLAYERS } from "../data/samplePlayers";
import {
  createInitialDraftState,
  deriveMyRoster,
  draftPlayer,
  serializeDraftState,
  undoLastPick,
  validateDraftState,
} from "./draftState";

describe("draft state progression", () => {
  it("advances the pick and assigns the snake-draft team", () => {
    let state = createInitialDraftState();
    state = draftPlayer(state, "player-1");

    expect(state.currentOverallPick).toBe(2);
    expect(state.picks[0]).toMatchObject({
      overallPick: 1,
      round: 1,
      pickInRound: 1,
      teamNumber: 1,
      isMyTeam: false,
    });

    for (let pick = 2; pick <= 17; pick += 1) {
      state = draftPlayer(state, `player-${pick}`);
    }

    expect(state.picks[16]).toMatchObject({
      overallPick: 17,
      round: 2,
      pickInRound: 1,
      teamNumber: 16,
    });
  });

  it("prevents drafting the same player twice", () => {
    const state = draftPlayer(createInitialDraftState(), "duplicate-player");

    expect(() => draftPlayer(state, "duplicate-player")).toThrow(
      "already been drafted",
    );
  });

  it("does not allow a 241st pick", () => {
    let state = createInitialDraftState();
    for (let pick = 1; pick <= 240; pick += 1) {
      state = draftPlayer(state, `player-${pick}`);
    }

    expect(state.currentOverallPick).toBe(241);
    expect(() => draftPlayer(state, "player-241")).toThrow(
      "already complete",
    );
  });

  it("undoes the last pick and restores all derived ID lists", () => {
    let state = createInitialDraftState();
    for (let pick = 1; pick <= 10; pick += 1) {
      state = draftPlayer(state, `player-${pick}`);
    }

    expect(state.myPlayerIds).toEqual(["player-10"]);
    state = undoLastPick(state);

    expect(state.currentOverallPick).toBe(10);
    expect(state.picks).toHaveLength(9);
    expect(state.draftedPlayerIds).not.toContain("player-10");
    expect(state.myPlayerIds).toEqual([]);
  });
});

describe("my roster derivation", () => {
  it("returns catalog players selected by team 10", () => {
    let state = createInitialDraftState();
    for (let pick = 1; pick <= 9; pick += 1) {
      state = draftPlayer(state, `other-player-${pick}`);
    }
    state = draftPlayer(state, SAMPLE_PLAYERS[0].id);

    expect(deriveMyRoster(state, SAMPLE_PLAYERS)).toEqual([SAMPLE_PLAYERS[0]]);
  });
});

describe("draft import validation", () => {
  it("accepts a valid serialized draft", () => {
    const state = draftPlayer(createInitialDraftState(), "player-1");

    expect(validateDraftState(JSON.parse(serializeDraftState(state)))).toEqual(
      state,
    );
  });

  it("rejects inconsistent team assignments", () => {
    const state = draftPlayer(createInitialDraftState(), "player-1");
    const malformed = {
      ...state,
      picks: [{ ...state.picks[0], teamNumber: 10 }],
    };

    expect(() => validateDraftState(malformed)).toThrow("invalid teamNumber");
  });

  it("rejects duplicated player IDs", () => {
    let state = createInitialDraftState();
    state = draftPlayer(state, "player-1");
    state = draftPlayer(state, "player-2");
    const malformed = {
      ...state,
      picks: [state.picks[0], { ...state.picks[1], playerId: "player-1" }],
      draftedPlayerIds: ["player-1", "player-1"],
    };

    expect(() => validateDraftState(malformed)).toThrow("more than once");
  });
});
