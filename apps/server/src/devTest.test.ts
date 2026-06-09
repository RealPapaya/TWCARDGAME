import { AMPLIFICATION_DB, CARD_CATALOG, CARD_CATALOG_VERSION, VOTE_EVENT_DB } from "@twcardgame/cards";
import { createInitialMatch, reduce } from "@twcardgame/rules";
import { AMPLIFICATION_TIERS } from "@twcardgame/shared";
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
    const opponentHandIds = CARD_CATALOG.slice(2, 4).map((card) => card.id);
    const playerDeckIds = CARD_CATALOG.slice(4, 6).map((card) => card.id);
    const opponentDeckIds = CARD_CATALOG.slice(6, 8).map((card) => card.id);
    const minionIds = CARD_CATALOG.filter((card) => card.type === "MINION").slice(0, 2).map((card) => card.id);
    const state = createMatch();

    applyDevTestMatchSetup(state, {
      handCardIds: handIds,
      opponentHandCardIds: opponentHandIds,
      playerDeckCardIds: playerDeckIds,
      opponentDeckCardIds: opponentDeckIds,
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
    expect(state.players.player2.hand.map((card) => card.cardId)).toEqual(opponentHandIds);
    expect(state.players.player1.deck.map((card) => card.cardId)).toEqual(playerDeckIds);
    expect(state.players.player2.deck.map((card) => card.cardId)).toEqual(opponentDeckIds);
    expect(state.players.player1.board.map((card) => card.cardId)).toEqual([minionIds[0]]);
    expect(state.players.player2.board.map((card) => card.cardId)).toEqual([minionIds[1]]);
    expect(state.players.player1.hero.hp).toBe(12);
    expect(state.players.player2.hero.hp).toBe(8);
    expect(state.players.player1.mana).toEqual({ current: 4, max: 6 });
    expect(state.players.player2.mana).toEqual({ current: 2, max: 5 });
    expect(state.private.devTestInfiniteMana).toEqual({ player1: false, player2: false });
    expect(state.turn.number).toBe(3);
    expect(state.turn.activeSeat).toBe("player1");
    expect(state.private.eventLog).toEqual([]);
  });

  it("can open a requested amplification phase with exact tier setup", () => {
    const state = createMatch();
    const events: any[] = [];
    const requested = AMPLIFICATION_DB.find((entry) => entry.tier === AMPLIFICATION_TIERS[2]);
    expect(requested).toBeDefined();

    applyDevTestMatchSetup(state, {
      turnNumber: 14,
      phase: "AMPLIFICATION_PHASE",
      amplificationTiers: {
        turn6: AMPLIFICATION_TIERS[0],
        turn14: AMPLIFICATION_TIERS[2]
      },
      amplificationIds: {
        turn14: requested!.id
      },
      activeSeat: "player1"
    }, 1000, events);

    expect(state.status).toBe("in_progress");
    expect(state.phase).toBe("AMPLIFICATION_PHASE");
    expect(state.augmentTiers).toEqual([AMPLIFICATION_TIERS[0], AMPLIFICATION_TIERS[2]]);
    expect(state.specialPhase?.amplificationOptions?.player1.every((option) => option.tier === AMPLIFICATION_TIERS[2])).toBe(true);
    expect(state.specialPhase?.amplificationOptions?.player1[0]?.id).toBe(requested!.id);
    expect(state.specialPhase?.amplificationOptions?.player2[0]?.id).toBe(requested!.id);
    expect(events.map((event) => event.type)).toContain("PHASE_STARTED");
  });

  it("can open voting with a requested event first", () => {
    const state = createMatch();
    const selected = VOTE_EVENT_DB[2]!.id;

    applyDevTestMatchSetup(state, {
      turnNumber: 20,
      phase: "VOTING_PHASE",
      voteEventId: selected,
      activeSeat: "player1"
    }, 1000, []);

    expect(state.phase).toBe("VOTING_PHASE");
    expect(state.specialPhase?.voteEvents?.[0]?.id).toBe(selected);
    expect(state.specialPhase?.voteEvents).toHaveLength(3);
  });

  it("lets each dev-test seat opt into infinite mana independently", () => {
    const card = CARD_CATALOG.find((candidate) =>
      candidate.type === "MINION" &&
      candidate.cost > 0 &&
      !candidate.keywords?.battlecry
    );
    expect(card).toBeDefined();

    const infinite = createMatch();
    applyDevTestMatchSetup(infinite, {
      handCardIds: [card!.id],
      playerMana: { current: 0, max: 0 },
      infiniteMana: { player1: true, player2: false },
      activeSeat: "player1"
    }, 1000);

    const playable = infinite.players.player1.hand[0]!;
    const played = reduce(infinite, {
      commandId: "infinite-mana-play",
      seat: "player1",
      nowMs: 1100,
      command: { type: "playCard", handInstanceId: playable.instanceId }
    }, CARD_CATALOG).state;

    expect(played.private.devTestInfiniteMana).toEqual({ player1: true, player2: false });
    expect(played.players.player1.hand).toHaveLength(0);
    expect(played.players.player1.board.map((minion) => minion.cardId)).toEqual([card!.id]);
    expect(played.players.player1.mana).toEqual({ current: 0, max: 0 });

    const finite = createMatch();
    applyDevTestMatchSetup(finite, {
      handCardIds: [card!.id],
      playerMana: { current: 0, max: 0 },
      infiniteMana: { player1: false },
      activeSeat: "player1"
    }, 1000);

    const blockedCard = finite.players.player1.hand[0]!;
    const blocked = reduce(finite, {
      commandId: "finite-mana-play",
      seat: "player1",
      nowMs: 1100,
      command: { type: "playCard", handInstanceId: blockedCard.instanceId }
    }, CARD_CATALOG);

    expect(blocked.state.players.player1.hand).toHaveLength(1);
    expect(blocked.state.players.player1.board).toHaveLength(0);
    expect(blocked.events.map((event) => event.type)).toContain("COMMAND_REJECTED");
  });

  it("rejects invalid card ids and non-minion board cards", () => {
    expect(() => applyDevTestMatchSetup(createMatch(), { handCardIds: ["NOPE"] })).toThrow(/Unknown dev test card id/);
    const news = CARD_CATALOG.find((card) => card.type === "NEWS");
    if (news) {
      expect(() => applyDevTestMatchSetup(createMatch(), { playerBoardCardIds: [news.id] })).toThrow(/must be a MINION/);
    }
    expect(() => applyDevTestMatchSetup(createMatch(), { voteEventIds: ["NOPE"] })).toThrow(/Unknown dev test vote event id/);
    expect(() => applyDevTestMatchSetup(createMatch(), { amplificationIds: { turn6: "NOPE" } })).toThrow(/Unknown dev test amplification id/);
  });
});
