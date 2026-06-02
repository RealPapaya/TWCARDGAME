import { describe, expect, it } from "vitest";
import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { createInitialMatch, reduce, type MatchState } from "@twcardgame/rules";
import { nextReconnectBudgetMs, pendingMulliganSeats, shouldApplyTimeoutPenalty } from "./GameRoom.js";

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

describe("action deadline helpers", () => {
  it("returns only seats that still need automatic mulligan submission", () => {
    const state = createMatch();
    state.players.player1.mulliganReady = true;

    expect(pendingMulliganSeats(state)).toEqual(["player2"]);
  });

  it("applies turn timeout penalty only before a valid turn action", () => {
    let state = startMatch();
    expect(shouldApplyTimeoutPenalty(state)).toBe(true);

    const activeSeat = state.turn.activeSeat;
    state.players[activeSeat].mana = { current: 10, max: 10 };
    const playable = state.players[activeSeat].hand.find((card) => card.type === "MINION" && card.cost <= 10)!;
    state = reduce(
      state,
      { commandId: "server-helper-play", seat: activeSeat, nowMs: 2000, command: { type: "playCard", handInstanceId: playable.instanceId } },
      CARD_CATALOG
    ).state;

    expect(shouldApplyTimeoutPenalty(state)).toBe(false);
  });
});

function createMatch(): MatchState {
  return createInitialMatch({
    matchId: "deadline-helper-test",
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

function startMatch(): MatchState {
  let state = createMatch();
  state = reduce(state, { commandId: "m1", seat: "player1", nowMs: 1100, command: { type: "submitMulligan", replaceHandInstanceIds: [] } }, CARD_CATALOG).state;
  state = reduce(state, { commandId: "m2", seat: "player2", nowMs: 1200, command: { type: "submitMulligan", replaceHandInstanceIds: [] } }, CARD_CATALOG).state;
  return state;
}

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}
