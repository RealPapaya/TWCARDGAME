import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { describe, expect, it } from "vitest";
import { createInitialMatch } from "./engine.js";
import { reduce } from "./engine.js";
import { legalMoves } from "./legalMoves.js";
import { decide } from "./bot.js";
import { getCardActualCost } from "./state.js";
import type { MatchState } from "./types.js";

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

function startedMatch(seed: number): MatchState {
  let state = createInitialMatch({
    matchId: `bot-${seed}`,
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed,
    nowMs: 1000,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: "p1", displayName: "P1", deckIds: legalDeckIds() },
      { seat: "player2", userId: "p2", displayName: "P2", deckIds: legalDeckIds() }
    ]
  }).state;
  state = reduce(state, { commandId: "m1", seat: "player1", nowMs: 1100, command: { type: "submitMulligan", replaceHandInstanceIds: [] } }, CARD_CATALOG).state;
  state = reduce(state, { commandId: "m2", seat: "player2", nowMs: 1200, command: { type: "submitMulligan", replaceHandInstanceIds: [] } }, CARD_CATALOG).state;
  return state;
}

describe("legalMoves", () => {
  it("always offers endTurn during the active player's turn", () => {
    const state = startedMatch(7);
    const moves = legalMoves(state, state.turn.activeSeat);
    expect(moves.some((m) => m.type === "endTurn")).toBe(true);
  });

  it("returns no moves for the inactive seat during an active turn", () => {
    const state = startedMatch(7);
    const inactive = state.turn.activeSeat === "player1" ? "player2" : "player1";
    expect(legalMoves(state, inactive)).toEqual([]);
  });

  it("excludes unaffordable card plays", () => {
    const state = startedMatch(11);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    const moves = legalMoves(state, seat);
    for (const move of moves) {
      if (move.type !== "playCard") continue;
      const card = player.hand.find((c) => c.instanceId === move.handInstanceId);
      expect(card).toBeTruthy();
      const cost = getCardActualCost(state, seat, card!);
      expect(cost).toBeLessThanOrEqual(player.mana.current);
    }
  });

  it("offers two mulligan options when high-cost cards are in hand", () => {
    let state = createInitialMatch({
      matchId: "mull",
      cardCatalogVersion: CARD_CATALOG_VERSION,
      seed: 42,
      nowMs: 1000,
      catalog: CARD_CATALOG,
      players: [
        { seat: "player1", userId: "p1", displayName: "P1", deckIds: legalDeckIds() },
        { seat: "player2", userId: "p2", displayName: "P2", deckIds: legalDeckIds() }
      ]
    }).state;
    // Force-insert a high-cost card into player1's hand so the "replace high" option appears.
    state.players.player1.hand[0] = { ...state.players.player1.hand[0], cost: 7 };
    const moves = legalMoves(state, "player1");
    const mulliganMoves = moves.filter((m) => m.type === "submitMulligan");
    expect(mulliganMoves.length).toBe(2);
  });
});

describe("bot.decide", () => {
  it("returns deterministic moves for difficulty=easy with a fixed RNG seed", () => {
    const stateA = startedMatch(101);
    const stateB = startedMatch(101);
    const seatA = stateA.turn.activeSeat;
    const seatB = stateB.turn.activeSeat;
    const moveA = decide(stateA, seatA, "easy", { state: 12345 }, CARD_CATALOG, 2000);
    const moveB = decide(stateB, seatB, "easy", { state: 12345 }, CARD_CATALOG, 2000);
    expect(JSON.stringify(moveA)).toEqual(JSON.stringify(moveB));
  });

  it("prefers a non-end-turn move when legal plays exist (normal difficulty)", () => {
    const state = startedMatch(202);
    const seat = state.turn.activeSeat;
    // Skip the test if the bot has nothing to do but end turn.
    const moves = legalMoves(state, seat);
    const hasPlay = moves.some((m) => m.type === "playCard");
    if (!hasPlay) return;
    const move = decide(state, seat, "normal", { state: 1 }, CARD_CATALOG, 2000);
    expect(move?.type).not.toBe("endTurn");
  });

  it("falls back gracefully when no legal moves exist", () => {
    const state = startedMatch(303);
    const inactive = state.turn.activeSeat === "player1" ? "player2" : "player1";
    const move = decide(state, inactive, "normal", { state: 1 }, CARD_CATALOG, 2000);
    expect(move).toBeUndefined();
  });

  it("hard difficulty still returns a legal command", () => {
    const state = startedMatch(404);
    const seat = state.turn.activeSeat;
    const move = decide(state, seat, "hard", { state: 1 }, CARD_CATALOG, 2000);
    expect(move).toBeDefined();
    // Round-trip the move through reduce — it should not be rejected.
    const result = reduce(
      state,
      { commandId: "bot-hard-1", seat, nowMs: 2000, command: move! },
      CARD_CATALOG
    );
    const rejected = result.events.some((e) => e.type === "COMMAND_REJECTED");
    expect(rejected).toBe(false);
  });

  it("plays a card and ends its turn when driven in a loop", () => {
    // Walks the same loop BotRoom.runBotTurnStep performs: legalMoves -> decide
    // -> reduce, capped at 20 iterations. The test passes if within that
    // budget the bot plays at least one card AND ends its turn.
    let state = startedMatch(505);
    const botSeat = state.turn.activeSeat;
    let playedCount = 0;
    let endedTurn = false;
    const rng: { state: number } = { state: 7 };
    let nowMs = 2000;
    for (let i = 0; i < 20; i++) {
      if (state.turn.activeSeat !== botSeat) break;
      const move = decide(state, botSeat, "normal", rng, CARD_CATALOG, nowMs);
      if (!move) break;
      const result = reduce(
        state,
        { commandId: `bot-loop-${i}`, seat: botSeat, nowMs, command: move },
        CARD_CATALOG
      );
      state = result.state;
      if (move.type === "playCard") playedCount += 1;
      if (move.type === "endTurn") {
        endedTurn = true;
        break;
      }
      nowMs += 100;
    }
    expect(endedTurn).toBe(true);
    expect(playedCount).toBeGreaterThanOrEqual(1);
  });
});
