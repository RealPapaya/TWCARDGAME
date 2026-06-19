import { describe, expect, it } from "vitest";
import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { createInitialMatch, type MatchState } from "@twcardgame/rules";
import {
  finalizeMatch,
  isMatchComplete,
  nextReconnectBudgetMs,
  pendingMulliganSeats,
  requiresActionSeq,
  seedFromString
} from "./finalize.js";

describe("nextReconnectBudgetMs", () => {
  it("spends the disconnected time from the remaining budget", () => {
    // Drop with a full 30s budget, return after 10s → 20s left.
    expect(nextReconnectBudgetMs(30_000, 10_000)).toBe(20_000);
  });

  it("is cumulative across disconnects (one-time budget, not reset)", () => {
    const afterFirst = nextReconnectBudgetMs(30_000, 10_000); // 20s left
    const afterSecond = nextReconnectBudgetMs(afterFirst, 5_000); // 15s left
    expect(afterFirst).toBe(20_000);
    expect(afterSecond).toBe(15_000);
  });

  it("never goes negative when the gap exceeds the remaining budget", () => {
    expect(nextReconnectBudgetMs(20_000, 25_000)).toBe(0);
  });

  it("ignores negative elapsed time defensively", () => {
    expect(nextReconnectBudgetMs(30_000, -1_000)).toBe(30_000);
  });
});

describe("requiresActionSeq", () => {
  it("gates ordinary turn actions", () => {
    expect(requiresActionSeq("endTurn")).toBe(true);
    expect(requiresActionSeq("playCard")).toBe(true);
  });

  it("exempts mulligan / reconnect / concede / special-phase commands", () => {
    for (const type of ["submitMulligan", "reconnect", "concede", "selectAmplification", "rerollAmplification", "submitVote"] as const) {
      expect(requiresActionSeq(type)).toBe(false);
    }
  });
});

describe("finalizeMatch", () => {
  it("sets terminal state and emits a single GAME_FINISHED event, once", () => {
    const state = createMatch();
    const events = finalizeMatch(state, { winnerSeat: "player2", reason: "concede" }, "player1");

    expect(isMatchComplete(state)).toBe(true);
    expect(state.status).toBe("finished");
    expect(state.result).toMatchObject({ winnerSeat: "player2", reason: "concede" });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("GAME_FINISHED");

    // A second finalize is a no-op (already terminal).
    expect(finalizeMatch(state, { winnerSeat: "player1", reason: "abandoned" }, "player2")).toEqual([]);
    expect(state.result?.winnerSeat).toBe("player2");
  });
});

describe("seedFromString", () => {
  it("is deterministic and varies by input", () => {
    expect(seedFromString("room-a")).toBe(seedFromString("room-a"));
    expect(seedFromString("room-a")).not.toBe(seedFromString("room-b"));
  });
});

describe("pendingMulliganSeats", () => {
  it("returns only seats that still need to mulligan", () => {
    const state = createMatch();
    expect(pendingMulliganSeats(state)).toEqual(["player1", "player2"]);
    state.players.player1.mulliganReady = true;
    expect(pendingMulliganSeats(state)).toEqual(["player2"]);
  });
});

function createMatch(): MatchState {
  return createInitialMatch({
    matchId: "finalize-test",
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed: 100,
    nowMs: 1000,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: "p1", displayName: "P1", deckIds: legalDeckIds() },
      { seat: "player2", userId: "p2", displayName: "P2", deckIds: legalDeckIds() }
    ]
  }).state;
}

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}
