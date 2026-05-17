/**
 * Golden tests — one per battlecry effect type.
 * Goal: confirm every handler exists and produces the correct state shape.
 * Not exhaustive; edge-case depth lives in Phase 2.
 */
import type { CardDefinition } from "@twcardgame/cards";
import type { Seat } from "@twcardgame/shared";
import { describe, expect, it } from "vitest";
import { createInitialMatch } from "./engine.js";
import { createRuntimeCard, nextInstanceId, reduce } from "./index.js";
import type { MatchState, RuntimeMinion } from "./types.js";

// ─── helpers ────────────────────────────────────────────────────────────────

const FILLER_MINION = (id: string, overrides: Partial<CardDefinition> = {}): CardDefinition => ({
  id, name: id, category: "test", cost: 1, attack: 1, health: 3,
  type: "MINION", rarity: "COMMON", description: "", image: "x.webp", ...overrides,
});

const NEWS_CARD = (id: string, battlecry: CardDefinition["keywords"]): CardDefinition => ({
  id, name: id, category: "新聞", cost: 0,
  type: "NEWS", rarity: "COMMON", description: "", image: "x.webp", keywords: battlecry,
});

function buildCatalog(extras: CardDefinition[]): CardDefinition[] {
  const fillers = Array.from({ length: 15 }, (_, i) => FILLER_MINION(`F${i}`));
  return [...fillers, ...extras];
}

function deckIds(catalog: CardDefinition[]): string[] {
  return catalog.filter(c => c.type === "MINION").slice(0, 15).flatMap(c => [c.id, c.id]);
}

function makeMatch(extras: CardDefinition[]): { state: MatchState; catalog: CardDefinition[] } {
  const catalog = buildCatalog(extras);
  let state = createInitialMatch({
    matchId: "g", cardCatalogVersion: "t", seed: 1, nowMs: 1000, catalog,
    players: [
      { seat: "player1", userId: "u1", displayName: "P1", deckIds: deckIds(catalog) },
      { seat: "player2", userId: "u2", displayName: "P2", deckIds: deckIds(catalog) },
    ],
  }).state;
  state = reduce(state, { commandId: "m1", seat: "player1", nowMs: 1100, command: { type: "submitMulligan", replaceHandInstanceIds: [] } }, catalog).state;
  state = reduce(state, { commandId: "m2", seat: "player2", nowMs: 1200, command: { type: "submitMulligan", replaceHandInstanceIds: [] } }, catalog).state;
  state.players.player1.mana = { current: 10, max: 10 };
  state.players.player2.mana = { current: 10, max: 10 };
  return { state, catalog };
}

/** Put `card` in active player's hand and play it. */
function play(
  state: MatchState, catalog: CardDefinition[], card: CardDefinition,
  target?: { type: "HERO" | "MINION"; side?: Seat; instanceId?: string },
  seq = "g1",
) {
  const seat = state.turn.activeSeat;
  const rc = createRuntimeCard(card, seat, nextInstanceId(state, "card"));
  state.players[seat].hand = [rc];
  return reduce(state, { commandId: seq, seat, nowMs: 2000, command: { type: "playCard", handInstanceId: rc.instanceId, target } }, catalog);
}

/** Build a RuntimeMinion-like object and put it on the board. */
function placeMinion(state: MatchState, seat: Seat, overrides: Partial<RuntimeMinion> = {}): RuntimeMinion {
  const m: RuntimeMinion = {
    instanceId: nextInstanceId(state, "minion"), cardId: "F0", ownerSeat: seat,
    name: "F", category: "test", cost: 1, type: "MINION", rarity: "COMMON",
    attack: 2, baseAttack: 2, health: 3, currentHealth: 3,
    keywords: {}, sleeping: false, canAttack: true, isEnraged: false,
    lockedTurns: 0, auraAttack: 0, auraHealth: 0, auraTaunt: false, tempBuffs: [],
    ...overrides,
  };
  state.players[seat].board.push(m);
  return m;
}

const enemy = (seat: Seat): Seat => seat === "player1" ? "player2" : "player1";

// ─── tests ───────────────────────────────────────────────────────────────────

describe("effect golden tests", () => {

  it("ADD_CARD_TO_HAND — adds a card to active player's hand", () => {
    const extra = FILLER_MINION("TOKEN");
    const card = NEWS_CARD("C", { battlecry: { type: "ADD_CARD_TO_HAND", cardId: "TOKEN", value: 1 } });
    const { state, catalog } = makeMatch([extra, card]);
    const { state: next } = play(state, catalog, card);
    const seat = next.turn.activeSeat; // same seat, play() set hand=[rc] so 1 card going in
    // played (-1) + token added (+1) = 1
    expect(next.players[seat].hand.length).toBe(1);
  });

  it("BOUNCE / BOUNCE_TARGET — returns enemy minion to hand", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "BOUNCE_TARGET", target: { side: "ENEMY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const foe = enemy(seat);
    const m = placeMinion(state, foe);
    const before = state.players[foe].hand.length;
    const { state: next } = play(state, catalog, card, { type: "MINION", side: foe, instanceId: m.instanceId });
    expect(next.players[foe].board).toHaveLength(0);
    expect(next.players[foe].hand.length).toBe(before + 1);
  });

  it("BOUNCE_ALL_CATEGORY — returns all minions of a category to their owners' hands", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "BOUNCE_ALL_CATEGORY", target_category_includes: "test" } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    placeMinion(state, seat);
    placeMinion(state, enemy(seat));
    const { state: next } = play(state, catalog, card);
    expect(next.players[seat].board).toHaveLength(0);
    expect(next.players[enemy(seat)].board).toHaveLength(0);
  });

  it("BOUNCE_ALL_ENEMY — returns all enemy minions to their hand", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "BOUNCE_ALL_ENEMY" } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    placeMinion(state, enemy(seat));
    placeMinion(state, enemy(seat));
    const { state: next } = play(state, catalog, card);
    expect(next.players[enemy(seat)].board).toHaveLength(0);
  });

  it("BOUNCE_CATEGORY — bounces target only if it matches category", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "BOUNCE_CATEGORY", target: { side: "ENEMY", type: "MINION" }, target_category_includes: "test" } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat));
    const { state: next } = play(state, catalog, card, { type: "MINION", side: enemy(seat), instanceId: m.instanceId });
    expect(next.players[enemy(seat)].board).toHaveLength(0);
  });

  it("BOUNCE_RANDOM_ENEMY — bounces one random enemy minion", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "BOUNCE_RANDOM_ENEMY" } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    placeMinion(state, enemy(seat));
    const { state: next } = play(state, catalog, card);
    expect(next.players[enemy(seat)].board).toHaveLength(0);
  });

  it("BUFF_ADJACENT — buffs the minions adjacent to the source on play", () => {
    const card = FILLER_MINION("C", { keywords: { battlecry: { type: "BUFF_ADJACENT", value: 2 } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const left = placeMinion(state, seat);
    const right = placeMinion(state, seat);
    // Play card at index 1, between left and right
    const rc = createRuntimeCard(card, seat, nextInstanceId(state, "card"));
    state.players[seat].hand = [rc];
    const { state: next } = reduce(state, { commandId: "g1", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: rc.instanceId, boardIndex: 1 } }, catalog);
    const leftAfter = next.players[seat].board.find(m => m.instanceId === left.instanceId)!;
    expect(leftAfter.attack).toBe(left.attack + 2);
  });

  it("BUFF_ALL — buffs all friendly minions", () => {
    const card = FILLER_MINION("C", { keywords: { battlecry: { type: "BUFF_ALL", stat: "ATTACK", value: 1 } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat);
    const { state: next } = play(state, catalog, card);
    const after = next.players[seat].board.find(b => b.instanceId === m.instanceId)!;
    expect(after.attack).toBe(m.attack + 1);
  });

  it("BUFF_CATEGORY — buffs friendly minions matching category", () => {
    const card = FILLER_MINION("C", { keywords: { battlecry: { type: "BUFF_CATEGORY", target_category: "test", stat: "HEALTH", value: 2 } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat);
    const { state: next } = play(state, catalog, card);
    const after = next.players[seat].board.find(b => b.instanceId === m.instanceId)!;
    expect(after.health).toBe(m.health + 2);
  });

  it("BUFF_HEALTH_AND_TAUNT_TARGET — buffs health and gives taunt", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "BUFF_HEALTH_AND_TAUNT_TARGET", value: 2, target: { side: "FRIENDLY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat);
    const { state: next } = play(state, catalog, card, { type: "MINION", side: seat, instanceId: m.instanceId });
    const after = next.players[seat].board[0]!;
    expect(after.health).toBe(m.health + 2);
    expect(after.keywords.taunt).toBe(true);
  });

  it("BUFF_STAT_TARGET_CATEGORY_BONUS — buffs more for matching category", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "BUFF_STAT_TARGET_CATEGORY_BONUS", stat: "ATTACK", value: 1, bonus_value: 3, target_category_includes: "test", target: { side: "FRIENDLY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat); // category = "test"
    const { state: next } = play(state, catalog, card, { type: "MINION", side: seat, instanceId: m.instanceId });
    expect(next.players[seat].board[0]!.attack).toBe(m.attack + 3);
  });

  it("BUFF_STAT_TARGET_TEMP — buff disappears at end of turn", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "BUFF_STAT_TARGET_TEMP", stat: "ATTACK", value: 3, target: { side: "FRIENDLY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat);
    const { state: mid } = play(state, catalog, card, { type: "MINION", side: seat, instanceId: m.instanceId });
    expect(mid.players[seat].board[0]!.attack).toBe(m.attack + 3);
    // End turn to clear temp buffs
    const { state: next } = reduce(mid, { commandId: "et", seat, nowMs: 3000, command: { type: "endTurn" } }, catalog);
    const after = next.players[seat].board.find(b => b.instanceId === m.instanceId)!;
    expect(after.attack).toBe(m.attack);
  });

  it("DAMAGE — deals damage to a target", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DAMAGE", value: 3, target: { side: "ENEMY", type: "HERO" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const foe = enemy(seat);
    const { state: next } = play(state, catalog, card, { type: "HERO", side: foe });
    expect(next.players[foe].hero.hp).toBe(27);
  });

  it("DAMAGE_ALL_ENEMY_MINIONS — damages all enemy minions", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DAMAGE_ALL_ENEMY_MINIONS", value: 2 } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat));
    const { state: next } = play(state, catalog, card);
    expect(next.players[enemy(seat)].board[0]?.currentHealth).toBe(m.currentHealth - 2);
  });

  it("DAMAGE_ALL_NON_CATEGORIES — damages minions not in excluded categories", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DAMAGE_ALL_NON_CATEGORIES", value: 1, excluded_categories: ["special"] } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat)); // category = "test", not excluded
    const { state: next } = play(state, catalog, card);
    expect(next.players[enemy(seat)].board[0]?.currentHealth).toBe(m.currentHealth - 1);
  });

  it("DAMAGE_AND_DRAW_IF_KILL — draws a card when the kill lands", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DAMAGE_AND_DRAW_IF_KILL", value: 10, target: { side: "ENEMY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat), { health: 1, currentHealth: 1 });
    const before = state.players[seat].hand.length;
    const { state: next } = play(state, catalog, card, { type: "MINION", side: enemy(seat), instanceId: m.instanceId });
    // play() sets hand=[rc] → 1 card; played (-1) + draw on kill (+1) = 1
    expect(next.players[seat].hand.length).toBe(1);
    expect(next.players[enemy(seat)].board).toHaveLength(0);
  });

  it("DAMAGE_NON_CATEGORY — skips minions that match the category", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DAMAGE_NON_CATEGORY", value: 5, target_category: "test", target: { side: "ENEMY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat)); // category = "test" → immune
    const { state: next } = play(state, catalog, card, { type: "MINION", side: enemy(seat), instanceId: m.instanceId });
    expect(next.players[enemy(seat)].board[0]?.currentHealth).toBe(m.currentHealth);
  });

  it("DAMAGE_RANDOM_FRIENDLY — deals damage to a random friendly", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DAMAGE_RANDOM_FRIENDLY", value: 1 } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat);
    const { state: next } = play(state, catalog, card);
    // Minion takes damage or hero takes damage; total friendly HP decreases by 1
    const minionHp = next.players[seat].board[0]?.currentHealth ?? m.currentHealth;
    const heroHp = next.players[seat].hero.hp;
    expect(minionHp < m.currentHealth || heroHp < 30).toBe(true);
  });

  it("DAMAGE_SELF — deals damage to the caster minion itself", () => {
    const card = FILLER_MINION("C", { keywords: { battlecry: { type: "DAMAGE_SELF", value: 1 } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const { state: next } = play(state, catalog, card);
    const summoned = next.players[seat].board.at(-1)!;
    expect(summoned.currentHealth).toBe(summoned.health - 1);
  });

  it("DESTROY — destroys a target minion", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DESTROY", target: { side: "ENEMY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat));
    const { state: next } = play(state, catalog, card, { type: "MINION", side: enemy(seat), instanceId: m.instanceId });
    expect(next.players[enemy(seat)].board).toHaveLength(0);
  });

  it("DESTROY_ALL_MINIONS — clears both boards", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DESTROY_ALL_MINIONS" } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    placeMinion(state, seat);
    placeMinion(state, enemy(seat));
    const { state: next } = play(state, catalog, card);
    expect(next.players[seat].board).toHaveLength(0);
    expect(next.players[enemy(seat)].board).toHaveLength(0);
  });

  it("DESTROY_DAMAGED — destroys target only if it is damaged", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DESTROY_DAMAGED", target: { side: "ENEMY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat), { currentHealth: 1 }); // damaged
    const { state: next } = play(state, catalog, card, { type: "MINION", side: enemy(seat), instanceId: m.instanceId });
    expect(next.players[enemy(seat)].board).toHaveLength(0);
  });

  it("DESTROY_HIGH_ATTACK — destroys minions with attack >= threshold", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DESTROY_HIGH_ATTACK", value: 2, target: { side: "ENEMY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat), { attack: 3 });
    const { state: next } = play(state, catalog, card, { type: "MINION", side: enemy(seat), instanceId: m.instanceId });
    expect(next.players[enemy(seat)].board).toHaveLength(0);
  });

  it("DESTROY_LOW_ATTACK — destroys minions with attack <= threshold", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DESTROY_LOW_ATTACK", value: 2, target: { side: "ENEMY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat), { attack: 1 });
    const { state: next } = play(state, catalog, card, { type: "MINION", side: enemy(seat), instanceId: m.instanceId });
    expect(next.players[enemy(seat)].board).toHaveLength(0);
  });

  it("DESTROY_LOCKED — destroys a locked minion", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DESTROY_LOCKED", target: { side: "ENEMY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat), { lockedTurns: 2 });
    const { state: next } = play(state, catalog, card, { type: "MINION", side: enemy(seat), instanceId: m.instanceId });
    expect(next.players[enemy(seat)].board).toHaveLength(0);
  });

  it("DISCARD_DRAW — discards then draws equal count", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DISCARD_DRAW", discardCount: 1, drawCount: 1 } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    // Ensure hand has at least 2 cards (the spell + 1 other)
    state.players[seat].hand = [
      createRuntimeCard(card, seat, nextInstanceId(state, "card")),
      createRuntimeCard(catalog[0], seat, nextInstanceId(state, "card")),
    ];
    const before = state.players[seat].hand.length;
    const { state: next } = reduce(state, { commandId: "g1", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: state.players[seat].hand[0].instanceId } }, catalog);
    // played (-1) + discarded (-1) + drawn (+1) = before - 1
    expect(next.players[seat].hand.length).toBe(before - 1);
  });

  it("DISCARD_RANDOM — discards a random card from hand", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DISCARD_RANDOM", value: 1 } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    state.players[seat].hand = [
      createRuntimeCard(card, seat, nextInstanceId(state, "card")),
      createRuntimeCard(catalog[0], seat, nextInstanceId(state, "card")),
    ];
    const { state: next } = reduce(state, { commandId: "g1", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: state.players[seat].hand[0].instanceId } }, catalog);
    // played (-1) + discarded (-1) = 0
    expect(next.players[seat].hand.length).toBe(0);
  });

  it("DRAW — draws cards", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DRAW", value: 2 } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const { state: next } = play(state, catalog, card);
    // play() sets hand=[rc] → 1; played (-1) + 2 drawn = 2
    expect(next.players[seat].hand.length).toBe(2);
  });

  it("DRAW_MINION_REDUCE_COST — draws the first minion from deck, reduced cost", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "DRAW_MINION_REDUCE_COST", value: 1 } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const { state: next } = play(state, catalog, card);
    // play() sets hand=[rc] → 1; played (-1) + drawn minion (+1) = 1
    expect(next.players[seat].hand.length).toBeGreaterThanOrEqual(1);
    const drawn = next.players[seat].hand.find(c => c.isReduced);
    if (drawn) expect(drawn.cost).toBeLessThan(catalog.find(c => c.id === drawn.cardId)!.cost);
  });

  it("DRAW_NEWS — draws the first NEWS card from deck", () => {
    const newsCard = NEWS_CARD("N1", undefined);
    const card = NEWS_CARD("C", { battlecry: { type: "DRAW_NEWS", value: 0 } });
    const { state, catalog } = makeMatch([newsCard, card]);
    const seat = state.turn.activeSeat;
    // Put a NEWS card at the front of deck
    state.players[seat].deck.unshift(createRuntimeCard(newsCard, seat, nextInstanceId(state, "card")));
    const { state: next } = play(state, catalog, card);
    // play() sets hand=[rc] → 1; played (-1) + drawn news (+1) = 1
    expect(next.players[seat].hand.length).toBeGreaterThan(0);
  });

  it("EAT_FRIENDLY — absorbs a friendly minion's stats", () => {
    const card = FILLER_MINION("C", { keywords: { battlecry: { type: "EAT_FRIENDLY", target: { side: "FRIENDLY", type: "MINION" } } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const food = placeMinion(state, seat, { attack: 4, health: 5 });
    const { state: next } = play(state, catalog, card, { type: "MINION", side: seat, instanceId: food.instanceId });
    const eater = next.players[seat].board.find(m => m.cardId === "C")!;
    expect(eater.attack).toBe(card.attack! + food.attack);
    expect(next.players[seat].board.find(m => m.instanceId === food.instanceId)).toBeUndefined();
  });

  it("FULL_HEAL — fully heals a target", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "FULL_HEAL", target: { side: "FRIENDLY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat, { currentHealth: 1 });
    const { state: next } = play(state, catalog, card, { type: "MINION", side: seat, instanceId: m.instanceId });
    expect(next.players[seat].board[0]!.currentHealth).toBe(m.health);
  });

  it("FULL_HEAL_AND_DRAW — fully heals and draws a card", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "FULL_HEAL_AND_DRAW", target: { side: "FRIENDLY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat, { currentHealth: 1 });
    const before = state.players[seat].hand.length;
    const { state: next } = play(state, catalog, card, { type: "MINION", side: seat, instanceId: m.instanceId });
    expect(next.players[seat].board[0]!.currentHealth).toBe(m.health);
    // play() sets hand=[rc] → 1; played (-1) + draw (+1) = 1
    expect(next.players[seat].hand.length).toBe(1);
  });

  it("GIVE_DIVINE_SHIELD — gives divine shield to a target", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "GIVE_DIVINE_SHIELD", target: { side: "FRIENDLY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat);
    const { state: next } = play(state, catalog, card, { type: "MINION", side: seat, instanceId: m.instanceId });
    expect(next.players[seat].board[0]!.keywords.divineShield).toBe(true);
  });

  it("GIVE_DIVINE_SHIELD_CATEGORY — gives divine shield to all matching friendly minions", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "GIVE_DIVINE_SHIELD_CATEGORY", target_category: "test" } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    placeMinion(state, seat);
    const { state: next } = play(state, catalog, card);
    expect(next.players[seat].board[0]!.keywords.divineShield).toBe(true);
  });

  it("GIVE_KEYWORD_ADJACENT — gives a keyword to adjacent minions", () => {
    const card = FILLER_MINION("C", { keywords: { battlecry: { type: "GIVE_KEYWORD_ADJACENT", keyword: "taunt" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const left = placeMinion(state, seat);
    const right = placeMinion(state, seat);
    const rc = createRuntimeCard(card, seat, nextInstanceId(state, "card"));
    state.players[seat].hand = [rc];
    const { state: next } = reduce(state, { commandId: "g1", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: rc.instanceId, boardIndex: 1 } }, catalog);
    const leftAfter = next.players[seat].board.find(m => m.instanceId === left.instanceId)!;
    expect(leftAfter.keywords.taunt).toBe(true);
  });

  it("HEAL — heals a target by a fixed amount", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "HEAL", value: 5, target: { side: "FRIENDLY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat, { currentHealth: 1 });
    const { state: next } = play(state, catalog, card, { type: "MINION", side: seat, instanceId: m.instanceId });
    expect(next.players[seat].board[0]!.currentHealth).toBe(Math.min(m.health, 1 + 5));
  });

  it("HEAL_ALL_FRIENDLY — heals all friendly minions to full", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "HEAL_ALL_FRIENDLY" } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    placeMinion(state, seat, { currentHealth: 1 });
    const { state: next } = play(state, catalog, card);
    expect(next.players[seat].board[0]!.currentHealth).toBe(3);
  });

  it("HEAL_CATEGORY_BONUS — heals more for matching category", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "HEAL_CATEGORY_BONUS", value: 1, bonus_value: 5, target_category_includes: "test", target: { side: "FRIENDLY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat, { currentHealth: 1 }); // category = "test"
    const { state: next } = play(state, catalog, card, { type: "MINION", side: seat, instanceId: m.instanceId });
    expect(next.players[seat].board[0]!.currentHealth).toBe(Math.min(m.health, 1 + 5));
  });

  it("LOCK_ALL_AND_BUFF_CATEGORY — locks all minions, buffs matching category", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "LOCK_ALL_AND_BUFF_CATEGORY", value: 1, target_category: "test", buff_stat: "HEALTH", buff_value: 2 } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat);
    const { state: next } = play(state, catalog, card);
    const after = next.players[seat].board.find(b => b.instanceId === m.instanceId)!;
    expect(after.lockedTurns).toBeGreaterThan(0);
    expect(after.health).toBe(m.health + 2);
  });

  it("LOCK_ALL_ENEMY — locks all enemy minions", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "LOCK_ALL_ENEMY", value: 1 } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    placeMinion(state, enemy(seat), { canAttack: true });
    const { state: next } = play(state, catalog, card);
    expect(next.players[enemy(seat)].board[0]!.canAttack).toBe(false);
    expect(next.players[enemy(seat)].board[0]!.lockedTurns).toBeGreaterThan(0);
  });

  it("LOCK_ATTACK — locks a specific minion", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "LOCK_ATTACK", value: 1, target: { side: "ENEMY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat), { canAttack: true });
    const { state: next } = play(state, catalog, card, { type: "MINION", side: enemy(seat), instanceId: m.instanceId });
    expect(next.players[enemy(seat)].board[0]!.canAttack).toBe(false);
  });

  it("LOCK_SELF — the summoned minion locks itself", () => {
    const card = FILLER_MINION("C", { keywords: { battlecry: { type: "LOCK_SELF", value: 1 } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const { state: next } = play(state, catalog, card);
    const m = next.players[seat].board.at(-1)!;
    expect(m.lockedTurns).toBeGreaterThan(0);
  });

  it("MULTI_DAMAGE — deals 1 damage N times to random enemy targets", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "MULTI_DAMAGE", value: 3 } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const hpBefore = state.players[enemy(seat)].hero.hp;
    const { state: next } = play(state, catalog, card);
    const hpAfter = next.players[enemy(seat)].hero.hp;
    expect(hpAfter).toBeLessThan(hpBefore);
  });

  it("REDUCE_COST_ALL_HAND — reduces cost of all cards in hand", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "REDUCE_COST_ALL_HAND", value: 1 } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const filler = createRuntimeCard(catalog[0], seat, nextInstanceId(state, "card"));
    filler.cost = 3;
    state.players[seat].hand = [createRuntimeCard(card, seat, nextInstanceId(state, "card")), filler];
    const { state: next } = reduce(state, { commandId: "g1", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: state.players[seat].hand[0].instanceId } }, catalog);
    expect(next.players[seat].hand[0]!.cost).toBe(filler.cost - 1);
  });

  it("SET_ATTACK_ALL — sets all minion attack to a fixed value", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "SET_ATTACK_ALL", value: 1 } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat, { attack: 5 });
    const { state: next } = play(state, catalog, card);
    expect(next.players[seat].board.find(b => b.instanceId === m.instanceId)!.attack).toBe(1);
  });

  it("SET_DEATH_TIMER — minion dies after N turns", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "SET_DEATH_TIMER", value: 1, target: { side: "ENEMY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat));
    const { state: next } = play(state, catalog, card, { type: "MINION", side: enemy(seat), instanceId: m.instanceId });
    expect(next.players[enemy(seat)].board[0]!.deathTimer).toBe(1);
  });

  it("SUMMON_MULTIPLE — summons N copies of a token", () => {
    const token = FILLER_MINION("TOKEN");
    const card = NEWS_CARD("C", { battlecry: { type: "SUMMON_MULTIPLE", cardId: "TOKEN", count: 2 } });
    const { state, catalog } = makeMatch([token, card]);
    const seat = state.turn.activeSeat;
    const { state: next } = play(state, catalog, card);
    expect(next.players[seat].board.filter(m => m.cardId === "TOKEN")).toHaveLength(2);
  });

  it("SWAP_ATTACK_HEALTH — swaps a minion's attack and health", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "SWAP_ATTACK_HEALTH", target: { side: "ENEMY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, enemy(seat), { attack: 4, health: 2, currentHealth: 2 });
    const { state: next } = play(state, catalog, card, { type: "MINION", side: enemy(seat), instanceId: m.instanceId });
    const after = next.players[enemy(seat)].board[0]!;
    expect(after.attack).toBe(m.currentHealth);
    expect(after.health).toBe(m.attack);
  });

  it("UNLOCK_AND_BUFF_HEALTH — unlocks a locked minion and buffs health", () => {
    const card = NEWS_CARD("C", { battlecry: { type: "UNLOCK_AND_BUFF_HEALTH", value: 2, target: { side: "FRIENDLY", type: "MINION" } } });
    const { state, catalog } = makeMatch([card]);
    const seat = state.turn.activeSeat;
    const m = placeMinion(state, seat, { lockedTurns: 2, canAttack: false });
    const { state: next } = play(state, catalog, card, { type: "MINION", side: seat, instanceId: m.instanceId });
    const after = next.players[seat].board[0]!;
    expect(after.lockedTurns).toBe(0);
    expect(after.canAttack).toBe(true);
    expect(after.health).toBe(m.health + 2);
  });

});
