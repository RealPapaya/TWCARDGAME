import { CARD_CATALOG, CARD_CATALOG_VERSION, type CardDefinition } from "@twcardgame/cards";
import type { CommandEnvelope, Seat } from "@twcardgame/shared";
import { describe, expect, it } from "vitest";
import { createInitialMatch } from "../engine.js";
import { effectHandlers, getCardActualCost, reduce, resolveEffect, resolvePostAction } from "../index.js";
import type { EffectContext, MatchState, RuntimeCard, RuntimeMinion } from "../types.js";

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

let cmdSeq = 0;
function env(id: string, seat: Seat, command: CommandEnvelope["command"]): CommandEnvelope {
  cmdSeq += 1;
  return { commandId: `${id}-${cmdSeq}`, seat, nowMs: 2000 + cmdSeq, command };
}

function startMatch(seed: number): MatchState {
  let state = createInitialMatch({
    matchId: `vote-${seed}`,
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed,
    nowMs: 1000,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: "p1", displayName: "甲", deckIds: legalDeckIds() },
      { seat: "player2", userId: "p2", displayName: "乙", deckIds: legalDeckIds() }
    ]
  }).state;
  state = reduce(state, env("m1", "player1", { type: "submitMulligan", replaceHandInstanceIds: [] }), CARD_CATALOG).state;
  state = reduce(state, env("m2", "player2", { type: "submitMulligan", replaceHandInstanceIds: [] }), CARD_CATALOG).state;
  return state;
}

const CATALOG_MAP = new Map<string, CardDefinition>(CARD_CATALOG.map((card) => [card.id, card]));
const MINION_DEF = CARD_CATALOG.find((card) => card.type === "MINION")!;

function ctx(state: MatchState): EffectContext {
  return { state, activeSeat: state.turn.activeSeat, events: [], catalog: CATALOG_MAP };
}

function graveMinion(seat: Seat, suffix: string): RuntimeCard {
  return {
    instanceId: `grave-${suffix}`,
    cardId: MINION_DEF.id,
    ownerSeat: seat,
    name: MINION_DEF.name,
    category: MINION_DEF.category,
    cost: MINION_DEF.cost,
    type: "MINION",
    rarity: MINION_DEF.rarity,
    description: MINION_DEF.description ?? "",
    image: MINION_DEF.image ?? "",
    attack: MINION_DEF.attack,
    health: MINION_DEF.health,
    keywords: {}
  };
}

function boardMinion(instanceId: string): RuntimeMinion {
  return {
    instanceId,
    cardId: MINION_DEF.id,
    ownerSeat: instanceId.startsWith("p2") ? "player2" : "player1",
    name: MINION_DEF.name,
    category: MINION_DEF.category,
    cost: MINION_DEF.cost,
    type: "MINION",
    rarity: MINION_DEF.rarity,
    attack: MINION_DEF.attack ?? 1,
    baseAttack: MINION_DEF.attack ?? 1,
    health: MINION_DEF.health ?? 1,
    currentHealth: MINION_DEF.health ?? 1,
    keywords: {},
    sleeping: false,
    canAttack: true,
    isEnraged: false,
    lockedTurns: 0,
    auraAttack: 0,
    auraHealth: 0,
    auraTaunt: false,
    tempBuffs: []
  };
}

describe("turn-20 vote-event handlers", () => {
  it("registers all new effect types as handlers", () => {
    for (const type of [
      "SUMMON_FROM_GRAVEYARD",
      "RESET_MANA_ALL",
      "FULL_HEAL_BOTH_HEROES",
      "GIVE_DIVINE_SHIELD_ALL_BOARD",
      "DESTROY_RIGHTMOST_MINIONS",
      "ENV_COST_ZERO"
    ]) {
      expect(effectHandlers[type]).toBeTypeOf("function");
    }
  });

  it("高雄氣爆 DESTROY_RIGHTMOST_MINIONS destroys only each side's rightmost minion", () => {
    const state = startMatch(13);
    state.players.player1.board = [boardMinion("p1-left"), boardMinion("p1-right")];
    state.players.player2.board = [boardMinion("p2-left"), boardMinion("p2-middle"), boardMinion("p2-right")];

    const context = ctx(state);
    resolveEffect({ type: "DESTROY_RIGHTMOST_MINIONS" }, context);
    resolvePostAction(state, context.events, CATALOG_MAP);

    expect(state.players.player1.board.map((m) => m.instanceId)).toEqual(["p1-left"]);
    expect(state.players.player2.board.map((m) => m.instanceId)).toEqual(["p2-left", "p2-middle"]);
    const destroyedTargets = context.events.filter((e) => e.type === "DESTROY").map((e) => e.payload?.target);
    expect(destroyedTargets).toEqual(["p1-right", "p2-right"]);
  });

  it("高雄氣爆 DESTROY_RIGHTMOST_MINIONS skips sides with no minions", () => {
    const state = startMatch(14);
    state.players.player1.board = [];
    state.players.player2.board = [boardMinion("p2-only")];

    const context = ctx(state);
    resolveEffect({ type: "DESTROY_RIGHTMOST_MINIONS" }, context);
    resolvePostAction(state, context.events, CATALOG_MAP);

    expect(state.players.player1.board).toHaveLength(0);
    expect(state.players.player2.board).toHaveLength(0);
    expect(context.events.filter((e) => e.type === "DESTROY").map((e) => e.payload?.target)).toEqual(["p2-only"]);
  });

  describe("鬼門開 SUMMON_FROM_GRAVEYARD", () => {
    it("revives up to 2 minions per side from each own graveyard, removing them", () => {
      const state = startMatch(10);
      state.players.player1.board = [];
      state.players.player2.board = [];
      state.players.player1.graveyard = [graveMinion("player1", "a"), graveMinion("player1", "b"), graveMinion("player1", "c")];
      state.players.player2.graveyard = [graveMinion("player2", "d"), graveMinion("player2", "e")];

      const context = ctx(state);
      resolveEffect({ type: "SUMMON_FROM_GRAVEYARD", count: 2 }, context);

      expect(state.players.player1.board).toHaveLength(2);
      expect(state.players.player2.board).toHaveLength(2);
      expect(state.players.player1.graveyard).toHaveLength(1); // 3 - 2
      expect(state.players.player2.graveyard).toHaveLength(0); // 2 - 2
      // player1 is processed before player2 (determinism): its summon events come first.
      const summons = context.events.filter((e) => e.type === "MINION_SUMMONED");
      expect(summons.every((e) => e.seat !== undefined)).toBe(true);
      expect(summons.slice(0, 2).every((e) => e.seat === "player1")).toBe(true);
    });

    it("only revives as many as the graveyard holds", () => {
      const state = startMatch(11);
      state.players.player1.board = [];
      state.players.player2.board = [];
      state.players.player1.graveyard = [graveMinion("player1", "a")];
      state.players.player2.graveyard = [];

      resolveEffect({ type: "SUMMON_FROM_GRAVEYARD", count: 2 }, ctx(state));

      expect(state.players.player1.board).toHaveLength(1);
      expect(state.players.player2.board).toHaveLength(0);
    });

    it("skips a full board (7) and emits an EVENT_NOTICE reminder", () => {
      const state = startMatch(12);
      state.players.player1.board = Array.from({ length: 7 }, (_, i) => boardMinion(`p1-${i}`));
      state.players.player1.graveyard = [graveMinion("player1", "a"), graveMinion("player1", "b")];
      state.players.player2.board = [];
      state.players.player2.graveyard = [graveMinion("player2", "c")];

      const context = ctx(state);
      resolveEffect({ type: "SUMMON_FROM_GRAVEYARD", count: 2 }, context);

      // Full side untouched; its graveyard kept; a notice was emitted for it.
      expect(state.players.player1.board).toHaveLength(7);
      expect(state.players.player1.graveyard).toHaveLength(2);
      const notice = context.events.find((e) => e.type === "EVENT_NOTICE");
      expect(notice?.seat).toBe("player1");
      expect(String(notice?.payload?.text)).toContain("甲");
      // The other side still revives.
      expect(state.players.player2.board).toHaveLength(1);
    });
  });

  it("金融海嘯 RESET_MANA_ALL resets both pools to 1", () => {
    const state = startMatch(20);
    state.players.player1.mana = { current: 8, max: 9 };
    state.players.player2.mana = { current: 3, max: 6 };

    resolveEffect({ type: "RESET_MANA_ALL" }, ctx(state));

    expect(state.players.player1.mana).toEqual({ current: 1, max: 1 });
    expect(state.players.player2.mana).toEqual({ current: 1, max: 1 });
  });

  it("歡慶 12 強 FULL_HEAL_BOTH_HEROES restores both heroes to max", () => {
    const state = startMatch(21);
    state.players.player1.hero.hp = 5;
    state.players.player2.hero.hp = 12;

    const context = ctx(state);
    resolveEffect({ type: "FULL_HEAL_BOTH_HEROES" }, context);

    expect(state.players.player1.hero.hp).toBe(state.players.player1.hero.maxHp);
    expect(state.players.player2.hero.hp).toBe(state.players.player2.hero.maxHp);
    expect(context.events.filter((e) => e.type === "HEAL")).toHaveLength(2);
  });

  it("媽祖大繞境 GIVE_DIVINE_SHIELD_ALL_BOARD shields every minion on both boards", () => {
    const state = startMatch(22);
    state.players.player1.board = [boardMinion("p1-0"), boardMinion("p1-1")];
    state.players.player2.board = [boardMinion("p2-0")];

    resolveEffect({ type: "GIVE_DIVINE_SHIELD_ALL_BOARD" }, ctx(state));

    expect(state.players.player1.board.every((m) => m.keywords.divineShield)).toBe(true);
    expect(state.players.player2.board.every((m) => m.keywords.divineShield)).toBe(true);
  });

  describe("普發現金 ENV_COST_ZERO", () => {
    it("forces card cost to 0 over the next full round, not the vote turn itself", () => {
      const state = startMatch(23);
      const seat = state.turn.activeSeat;
      const card = state.players[seat].hand[0];
      card.cost = 3;
      const base = getCardActualCost(state, seat, card);
      expect(base).toBe(3);

      const appliedTurn = state.turn.number;
      state.currentEnvironment = {
        id: "VE_CASH_HANDOUT",
        name: "普發現金",
        appliedTurn,
        expiresTurn: appliedTurn + 2,
        effect: { type: "ENV_COST_ZERO" }
      };

      // Vote turn (== appliedTurn): cost unchanged.
      expect(getCardActualCost(state, seat, card)).toBe(base);

      // Next full round (both players): cost 0.
      state.turn.number = appliedTurn + 1;
      expect(getCardActualCost(state, seat, card)).toBe(0);
      state.turn.number = appliedTurn + 2;
      expect(getCardActualCost(state, seat, card)).toBe(0);

      // After the window: back to normal.
      state.turn.number = appliedTurn + 3;
      expect(getCardActualCost(state, seat, card)).toBe(base);
    });
  });
});
