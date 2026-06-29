import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import type { CommandEnvelope, GameEvent, Seat } from "@twcardgame/shared";
import { describe, expect, it } from "vitest";
import { createInitialMatch, reduce } from "../engine.js";
import { drawCards } from "../effects.js";
import type { MatchState } from "../types.js";

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

let cmdSeq = 0;
function env(seat: Seat, command: CommandEnvelope["command"]): CommandEnvelope {
  cmdSeq += 1;
  return { commandId: `fatigue-${cmdSeq}`, seat, nowMs: 1000 + cmdSeq, command };
}

function startInProgress(seed: number): MatchState {
  let state = createInitialMatch({
    matchId: `fatigue-${seed}`,
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed,
    nowMs: 1000,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: "p1", displayName: "甲", deckIds: legalDeckIds() },
      { seat: "player2", userId: "p2", displayName: "乙", deckIds: legalDeckIds() }
    ]
  }).state;
  state = reduce(state, env("player1", { type: "submitMulligan", replaceHandInstanceIds: [] }), CARD_CATALOG).state;
  state = reduce(state, env("player2", { type: "submitMulligan", replaceHandInstanceIds: [] }), CARD_CATALOG).state;
  return state;
}

function fatigueEvents(events: GameEvent[]): GameEvent[] {
  return events.filter((event) => event.type === "FATIGUE");
}

describe("fatigue (牌庫抽乾)", () => {
  it("does nothing while the deck still has cards", () => {
    const state = startInProgress(1);
    const player = state.players.player1;
    player.deck = [player.deck[0]];
    const before = player.hero.hp;
    const events: GameEvent[] = [];
    drawCards(state, player, 1, events);
    expect(player.fatigue).toBe(0);
    expect(player.hero.hp).toBe(before);
    expect(fatigueEvents(events)).toHaveLength(0);
  });

  it("deals escalating self-damage (1, 2, 3 …) on each empty-deck draw", () => {
    const state = startInProgress(2);
    const player = state.players.player1;
    player.deck = [];
    const start = player.hero.hp;
    const events: GameEvent[] = [];

    drawCards(state, player, 1, events);
    expect(player.fatigue).toBe(1);
    expect(player.hero.hp).toBe(start - 1);

    drawCards(state, player, 1, events);
    expect(player.fatigue).toBe(2);
    expect(player.hero.hp).toBe(start - 1 - 2);

    drawCards(state, player, 1, events);
    expect(player.fatigue).toBe(3);
    expect(player.hero.hp).toBe(start - 1 - 2 - 3);

    const fat = fatigueEvents(events);
    expect(fat.map((event) => event.payload?.amount)).toEqual([1, 2, 3]);
    expect(fat.map((event) => event.payload?.remainingHealth)).toEqual([start - 1, start - 3, start - 6]);
    expect(fat.every((event) => event.payload?.target === "player1:hero")).toBe(true);
  });

  it("escalates within a single multi-card draw (draw 2 from empty = 1 + 2)", () => {
    const state = startInProgress(3);
    const player = state.players.player1;
    player.deck = [];
    const start = player.hero.hp;
    const events: GameEvent[] = [];
    drawCards(state, player, 2, events);
    expect(player.fatigue).toBe(2);
    expect(player.hero.hp).toBe(start - 3);
    expect(fatigueEvents(events).map((event) => event.payload?.amount)).toEqual([1, 2]);
  });

  it("only the drawing player takes fatigue; the opponent is untouched", () => {
    const state = startInProgress(4);
    const player = state.players.player1;
    const enemyHp = state.players.player2.hero.hp;
    player.deck = [];
    drawCards(state, player, 1, []);
    expect(state.players.player2.fatigue).toBe(0);
    expect(state.players.player2.hero.hp).toBe(enemyHp);
  });

  it("lethal fatigue ends the match in the opponent's favour", () => {
    const state = startInProgress(5);
    const player = state.players.player1;
    player.deck = [];
    player.hero.hp = 1; // next draw (1 dmg) is lethal
    const events: GameEvent[] = [];
    drawCards(state, player, 1, events);
    expect(player.hero.hp).toBeLessThanOrEqual(0);
    expect(state.status).toBe("finished");
    expect(state.result).toEqual({ winnerSeat: "player2", reason: "hero_destroyed" });
    expect(events.some((event) => event.type === "GAME_FINISHED")).toBe(true);
  });

  it("the turn-start draw triggers fatigue once the deck is empty", () => {
    const state = startInProgress(6);
    const seat = state.turn.activeSeat;
    const other = seat === "player1" ? "player2" : "player1";
    // Empty the player whose turn comes next, so their start-of-turn draw fatigues.
    state.players[other].deck = [];
    const before = state.players[other].hero.hp;
    const result = reduce(state, env(seat, { type: "endTurn" }), CARD_CATALOG);
    expect(result.state.players[other].fatigue).toBe(1);
    expect(result.state.players[other].hero.hp).toBe(before - 1);
    expect(result.events.some((event) => event.type === "FATIGUE")).toBe(true);
  });

  it("fatigue persists and keeps escalating across turns", () => {
    const state = startInProgress(7);
    const player = state.players.player1;
    player.deck = [];
    drawCards(state, player, 1, []);
    drawCards(state, player, 1, []);
    expect(player.fatigue).toBe(2);
    const cloned = JSON.parse(JSON.stringify(state)) as MatchState;
    drawCards(cloned, cloned.players.player1, 1, []);
    expect(cloned.players.player1.fatigue).toBe(3);
  });
});
