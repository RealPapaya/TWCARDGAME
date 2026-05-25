import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { createInitialMatch } from "@twcardgame/rules";
import { describe, expect, it } from "vitest";
import { defaultDeckIds } from "./accounts.js";
import { applyDevTestMatchSetup, isDevTestRequestAllowed } from "./devTest.js";

function createMatch() {
  return createInitialMatch({
    matchId: "dev-test-room",
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed: 7,
    nowMs: 1,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: "p1", displayName: "P1", deckIds: defaultDeckIds() },
      { seat: "player2", userId: "p2", displayName: "P2", deckIds: defaultDeckIds() }
    ]
  }).state;
}

describe("developer test mode helpers", () => {
  it("allows only non-production localhost requests", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    expect(isDevTestRequestAllowed({ headers: new Headers({ host: "localhost:2567", origin: "http://localhost:5173" }), ip: "127.0.0.1" })).toBe(true);
    expect(isDevTestRequestAllowed({ headers: new Headers({ host: "example.com", origin: "https://example.com" }), ip: "203.0.113.10" })).toBe(false);
    process.env.NODE_ENV = "production";
    expect(isDevTestRequestAllowed({ headers: new Headers({ host: "localhost:2567", origin: "http://localhost:5173" }), ip: "127.0.0.1" })).toBe(false);
    process.env.NODE_ENV = previous;
  });

  it("applies exact hand, board, HP, mana, and turn setup", () => {
    const handIds = CARD_CATALOG.slice(0, 2).map((card) => card.id);
    const minionIds = CARD_CATALOG.filter((card) => card.type === "MINION").slice(0, 2).map((card) => card.id);
    const state = createMatch();

    applyDevTestMatchSetup(state, {
      handCardIds: handIds,
      playerBoardCardIds: [minionIds[0]],
      opponentBoardCardIds: [minionIds[1]],
      playerHp: 12,
      opponentHp: 8,
      playerMana: { current: 4, max: 6 },
      opponentMana: { current: 2, max: 5 },
      turnNumber: 3,
      activeSeat: "player1"
    }, 1000);

    expect(state.status).toBe("in_progress");
    expect(state.players.player1.hand.map((card) => card.cardId)).toEqual(handIds);
    expect(state.players.player1.deck).toEqual([]);
    expect(state.players.player1.board.map((card) => card.cardId)).toEqual([minionIds[0]]);
    expect(state.players.player2.board.map((card) => card.cardId)).toEqual([minionIds[1]]);
    expect(state.players.player1.hero.hp).toBe(12);
    expect(state.players.player2.hero.hp).toBe(8);
    expect(state.players.player1.mana).toEqual({ current: 4, max: 6 });
    expect(state.players.player2.mana).toEqual({ current: 2, max: 5 });
    expect(state.turn.number).toBe(3);
    expect(state.turn.activeSeat).toBe("player1");
    expect(state.private.eventLog).toEqual([]);
  });

  it("rejects invalid card ids and non-minion board cards", () => {
    expect(() => applyDevTestMatchSetup(createMatch(), { handCardIds: ["NOPE"] })).toThrow(/Unknown dev test card id/);
    const news = CARD_CATALOG.find((card) => card.type === "NEWS");
    if (news) {
      expect(() => applyDevTestMatchSetup(createMatch(), { playerBoardCardIds: [news.id] })).toThrow(/must be a MINION/);
    }
  });
});
