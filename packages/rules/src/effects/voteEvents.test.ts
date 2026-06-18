import { CARD_CATALOG, CARD_CATALOG_VERSION, type CardDefinition } from "@twcardgame/cards";
import type { CommandEnvelope, Seat } from "@twcardgame/shared";
import { describe, expect, it } from "vitest";
import { createInitialMatch } from "../engine.js";
import {
  applyEnvironmentTick,
  createCardForHand,
  createMinionFromCard,
  drawCards,
  effectHandlers,
  getCardActualCost,
  reduce,
  resolveEffect,
  resolvePostAction,
  startTurn,
  toHandView,
  toPublicState,
  updateAuras
} from "../index.js";
import { summonCard } from "./core.js";
import { boardLimit, environmentBoardLimit } from "./environment.js";
import { enforceBoardLimit } from "./voteEvents.js";
import { DEFAULT_TURN_TIME_LIMIT_MS } from "../timing.js";
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
const KEYWORD_MINION_DEF = CARD_CATALOG.find(
  (card) =>
    card.type === "MINION" &&
    Boolean(
      card.keywords?.battlecry ||
        card.keywords?.deathrattle ||
        card.keywords?.ongoing ||
        card.keywords?.taunt ||
        card.keywords?.charge ||
        card.keywords?.divineShield ||
        card.keywords?.quest
    )
)!;

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

function boardMinion(instanceId: string, overrides: Partial<RuntimeMinion> = {}): RuntimeMinion {
  const minion: RuntimeMinion = {
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
  return { ...minion, ...overrides };
}

describe("turn-20 vote-event handlers", () => {
  it("registers all new effect types as handlers", () => {
    for (const type of [
      "SUMMON_FROM_GRAVEYARD",
      "RESET_MANA_ALL",
      "FULL_HEAL_BOTH_HEROES",
      "GIVE_DIVINE_SHIELD_ALL_BOARD",
      "DESTROY_RIGHTMOST_MINIONS",
      "KEEP_RANDOM_HIGHEST_COST_PER_SIDE",
      "KEEP_RANDOM_ONE_BOARD_MINION",
      "MARTIAL_LAW_BOUNCE_ALL_COST_10",
      "ENV_COST_ZERO",
      "ENV_TURN_TIME_LIMIT_MS",
      "ENV_BOARD_LIMIT",
      "ENV_DISABLE_ALL_MINION_EFFECTS",
      "ENV_ATTACKER_TAKES_DAMAGE"
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

  it("黨內鬥爭 KEEP_RANDOM_HIGHEST_COST_PER_SIDE keeps one highest-cost minion per side", () => {
    const state = startMatch(30);
    state.players.player1.board = [
      boardMinion("p1-low", { cost: 1 }),
      boardMinion("p1-high-a", { cost: 5 }),
      boardMinion("p1-high-b", { cost: 5 })
    ];
    state.players.player2.board = [boardMinion("p2-high", { cost: 4 }), boardMinion("p2-low", { cost: 2 })];

    const context = ctx(state);
    resolveEffect({ type: "KEEP_RANDOM_HIGHEST_COST_PER_SIDE" }, context);
    resolvePostAction(state, context.events, CATALOG_MAP);

    expect(state.players.player1.board).toHaveLength(1);
    expect(state.players.player1.board[0].cost).toBe(5);
    expect(["p1-high-a", "p1-high-b"]).toContain(state.players.player1.board[0].instanceId);
    expect(state.players.player2.board.map((m) => m.instanceId)).toEqual(["p2-high"]);
    expect(context.events.filter((e) => e.type === "DESTROY")).toHaveLength(3);
  });

  it("黨內鬥爭 tie choice is deterministic for the same seed", () => {
    const setup = (state: MatchState) => {
      state.players.player1.board = [
        boardMinion("p1-a", { cost: 5 }),
        boardMinion("p1-b", { cost: 5 }),
        boardMinion("p1-c", { cost: 1 })
      ];
      state.players.player2.board = [];
    };
    const a = startMatch(31);
    const b = startMatch(31);
    setup(a);
    setup(b);

    const ca = ctx(a);
    const cb = ctx(b);
    resolveEffect({ type: "KEEP_RANDOM_HIGHEST_COST_PER_SIDE" }, ca);
    resolveEffect({ type: "KEEP_RANDOM_HIGHEST_COST_PER_SIDE" }, cb);
    resolvePostAction(a, ca.events, CATALOG_MAP);
    resolvePostAction(b, cb.events, CATALOG_MAP);

    expect(a.players.player1.board.map((m) => m.instanceId)).toEqual(b.players.player1.board.map((m) => m.instanceId));
  });

  it("議會明星大亂鬥 KEEP_RANDOM_ONE_BOARD_MINION keeps one minion across the whole board", () => {
    const state = startMatch(32);
    state.players.player1.board = [boardMinion("p1-a"), boardMinion("p1-b")];
    state.players.player2.board = [boardMinion("p2-a"), boardMinion("p2-b")];

    const context = ctx(state);
    resolveEffect({ type: "KEEP_RANDOM_ONE_BOARD_MINION" }, context);
    resolvePostAction(state, context.events, CATALOG_MAP);

    const survivors = [...state.players.player1.board, ...state.players.player2.board];
    expect(survivors).toHaveLength(1);
    expect(["p1-a", "p1-b", "p2-a", "p2-b"]).toContain(survivors[0].instanceId);
    expect(context.events.filter((e) => e.type === "DESTROY")).toHaveLength(3);
  });

  it("議會明星大亂鬥 skips empty and single-minion boards", () => {
    const state = startMatch(33);
    state.players.player1.board = [boardMinion("p1-only")];
    state.players.player2.board = [];

    const context = ctx(state);
    resolveEffect({ type: "KEEP_RANDOM_ONE_BOARD_MINION" }, context);
    resolvePostAction(state, context.events, CATALOG_MAP);

    expect(state.players.player1.board.map((m) => m.instanceId)).toEqual(["p1-only"]);
    expect(context.events.filter((e) => e.type === "DESTROY")).toHaveLength(0);
  });

  it("戒嚴 MARTIAL_LAW_BOUNCE_ALL_COST_10 bounces board minions at cost 10 and kills overflow", () => {
    const state = startMatch(34);
    state.players.player1.hand = Array.from({ length: 9 }, (_, i) => graveMinion("player1", `hand-${i}`));
    state.players.player1.board = [boardMinion("p1-bounce"), boardMinion("p1-overflow-a"), boardMinion("p1-overflow-b")];
    state.players.player2.hand = [];
    state.players.player2.board = [boardMinion("p2-bounce-a", { cost: 2 }), boardMinion("p2-bounce-b", { cost: 4 })];
    const p1GraveBefore = state.players.player1.graveyard.length;

    const context = ctx(state);
    resolveEffect({ type: "MARTIAL_LAW_BOUNCE_ALL_COST_10" }, context);
    resolvePostAction(state, context.events, CATALOG_MAP);

    expect(state.players.player1.board).toHaveLength(0);
    expect(state.players.player2.board).toHaveLength(0);
    expect(state.players.player1.hand).toHaveLength(10);
    expect(state.players.player1.hand.at(-1)?.cost).toBe(10);
    expect(state.players.player2.hand).toHaveLength(2);
    expect(state.players.player2.hand.every((card) => card.cost === 10)).toBe(true);
    expect(state.players.player1.graveyard.length).toBe(p1GraveBefore + 2);
    expect(context.events.filter((e) => e.type === "BOUNCE")).toHaveLength(3);
    expect(context.events.filter((e) => e.type === "DESTROY").map((e) => e.payload?.target)).toEqual(["p1-overflow-b", "p1-overflow-a"]);
  });

  describe("社交距離 ENV_BOARD_LIMIT", () => {
    function installSocialDistancing(state: MatchState): void {
      state.currentEnvironment = {
        id: "VE_SOCIAL_DISTANCING",
        name: "社交距離",
        appliedTurn: state.turn.number,
        expiresTurn: undefined,
        effect: { type: "ENV_BOARD_LIMIT", value: 3 }
      };
    }

    it("trims each side to the cap, bouncing the rightmost surplus to hand", () => {
      const state = startMatch(50);
      state.players.player1.hand = [];
      state.players.player1.board = Array.from({ length: 5 }, (_, i) => boardMinion(`p1-${i}`));
      state.players.player2.board = Array.from({ length: 3 }, (_, i) => boardMinion(`p2-${i}`));
      installSocialDistancing(state);

      const context = ctx(state);
      enforceBoardLimit({ type: "ENV_BOARD_LIMIT", value: 3 }, context);
      resolvePostAction(state, context.events, CATALOG_MAP);

      expect(state.players.player1.board.map((m) => m.instanceId)).toEqual(["p1-0", "p1-1", "p1-2"]);
      expect(state.players.player1.hand).toHaveLength(2);
      // Already within the cap → untouched.
      expect(state.players.player2.board).toHaveLength(3);
      expect(context.events.filter((e) => e.type === "BOUNCE")).toHaveLength(2);
    });

    it("kills the surplus instead of bouncing when the owner's hand is full", () => {
      const state = startMatch(51);
      state.players.player1.hand = Array.from({ length: 10 }, (_, i) => graveMinion("player1", `h-${i}`));
      state.players.player1.board = Array.from({ length: 5 }, (_, i) => boardMinion(`p1-${i}`));
      const graveBefore = state.players.player1.graveyard.length;
      installSocialDistancing(state);

      const context = ctx(state);
      enforceBoardLimit({ type: "ENV_BOARD_LIMIT", value: 3 }, context);
      resolvePostAction(state, context.events, CATALOG_MAP);

      expect(state.players.player1.board).toHaveLength(3);
      expect(state.players.player1.hand).toHaveLength(10);
      expect(state.players.player1.graveyard.length).toBe(graveBefore + 2);
      const destroyed = context.events.filter((e) => e.type === "DESTROY").map((e) => String(e.payload?.target));
      expect(destroyed.sort()).toEqual(["p1-3", "p1-4"]);
      expect(context.events.filter((e) => e.type === "BOUNCE")).toHaveLength(0);
    });

    it("caps further summons at the lowered limit", () => {
      const state = startMatch(52);
      state.players.player1.board = Array.from({ length: 3 }, (_, i) => boardMinion(`p1-${i}`));
      installSocialDistancing(state);

      const summoned = summonCard(state, state.players.player1, MINION_DEF, []);
      expect(summoned).toBeUndefined();
      expect(state.players.player1.board).toHaveLength(3);
    });

    it("exposes the lowered cap publicly but exempts referendum-immune seats", () => {
      const state = startMatch(53);
      installSocialDistancing(state);

      expect(environmentBoardLimit(state)).toBe(3);
      expect(toPublicState(state).boardLimit).toBe(3);
      expect(boardLimit(state, "player1")).toBe(3);

      state.players.player1.augmentFlags.referendumImmune = true;
      expect(boardLimit(state, "player1")).toBe(7);
      expect(boardLimit(state, "player2")).toBe(3);
    });
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

  describe("宵禁時間 ENV_TURN_TIME_LIMIT_MS", () => {
    it("sets non-immune normal turn deadlines to 15 seconds", () => {
      const state = startMatch(40);
      state.turn.activeSeat = "player1";
      state.currentEnvironment = {
        id: "VE_CURFEW_TIME",
        name: "宵禁時間",
        appliedTurn: state.turn.number,
        effect: { type: "ENV_TURN_TIME_LIMIT_MS", value: 15000 }
      };

      startTurn(state, 9000, []);

      expect(state.turn.deadlineAtMs).toBe(24000);
    });

    it("keeps the default turn limit for referendum-immune players", () => {
      const state = startMatch(41);
      state.turn.activeSeat = "player2";
      state.players.player2.augmentFlags.referendumImmune = true;
      state.currentEnvironment = {
        id: "VE_CURFEW_TIME",
        name: "宵禁時間",
        appliedTurn: state.turn.number,
        effect: { type: "ENV_TURN_TIME_LIMIT_MS", value: 15000 }
      };

      startTurn(state, 9000, []);

      expect(state.turn.deadlineAtMs).toBe(9000 + DEFAULT_TURN_TIME_LIMIT_MS);
    });
  });

  describe("人人平等 ENV_DISABLE_ALL_MINION_EFFECTS", () => {
    it("clears minion effects from every non-immune zone and removes active aura bonuses", () => {
      const state = startMatch(42);
      const source = boardMinion("p1-aura", { keywords: { ongoing: { type: "ADJACENT_BUFF_STATS", value: 2 } } });
      const target = boardMinion("p1-target", { keywords: { taunt: true } });
      const targetBaseAttack = target.attack;
      const targetBaseHealth = target.health;
      state.players.player1.board = [source, target];
      state.players.player1.hand = [graveMinion("player1", "hand")];
      state.players.player1.deck = [graveMinion("player1", "deck")];
      state.players.player1.graveyard = [graveMinion("player1", "grave")];
      state.players.player1.hand[0].keywords = { battlecry: { type: "DRAW", value: 1 }, taunt: true };
      state.players.player1.deck[0].keywords = { deathrattle: { type: "DRAW", value: 1 } };
      state.players.player1.graveyard[0].keywords = { divineShield: true };

      state.players.player2.augmentFlags.referendumImmune = true;
      state.players.player2.board = [boardMinion("p2-immune", { keywords: { taunt: true } })];
      state.players.player2.hand = [graveMinion("player2", "immune-hand")];
      state.players.player2.hand[0].keywords = { battlecry: { type: "DRAW", value: 1 } };

      updateAuras(state, []);
      expect(target.attack).toBe(targetBaseAttack + 2);
      expect(target.health).toBe(targetBaseHealth + 2);

      state.currentEnvironment = {
        id: "VE_EQUALITY_FOR_ALL",
        name: "人人平等",
        appliedTurn: state.turn.number,
        effect: { type: "ENV_DISABLE_ALL_MINION_EFFECTS" }
      };
      applyEnvironmentTick(state, []);

      expect(state.players.player1.board.every((minion) => Object.keys(minion.keywords).length === 0)).toBe(true);
      expect(state.players.player1.hand[0].keywords).toEqual({});
      expect(state.players.player1.deck[0].keywords).toEqual({});
      expect(state.players.player1.graveyard[0].keywords).toEqual({});
      expect(target.attack).toBe(targetBaseAttack);
      expect(target.health).toBe(targetBaseHealth);
      expect(target.auraAttack).toBe(0);
      expect(target.auraHealth).toBe(0);

      expect(state.players.player2.board[0].keywords.taunt).toBe(true);
      expect(state.players.player2.hand[0].keywords.battlecry?.type).toBe("DRAW");
    });

    it("also suppresses future drawn, created, generated, summoned, and played minions", () => {
      let state = startMatch(43);
      state.turn.activeSeat = "player1";
      state.currentEnvironment = {
        id: "VE_EQUALITY_FOR_ALL",
        name: "人人平等",
        appliedTurn: state.turn.number,
        effect: { type: "ENV_DISABLE_ALL_MINION_EFFECTS" }
      };

      const deckCard = graveMinion("player1", "future-deck");
      deckCard.keywords = { battlecry: { type: "DRAW", value: 1 }, taunt: true };
      state.players.player1.deck = [deckCard];
      state.players.player1.hand = [];
      drawCards(state, state.players.player1, 1, []);
      expect(state.players.player1.hand[0].keywords).toEqual({});

      const created = createCardForHand(state, KEYWORD_MINION_DEF, "player1");
      expect(created.keywords).toEqual({});
      const minion = createMinionFromCard(
        state,
        {
          ...created,
          keywords: { charge: true, taunt: true, battlecry: { type: "DRAW", value: 1 } }
        },
        "player1"
      );
      expect(minion.keywords).toEqual({});
      expect(minion.sleeping).toBe(true);
      expect(minion.canAttack).toBe(false);

      const context = ctx(state);
      resolveEffect({ type: "ADD_CARD_TO_HAND", cardId: KEYWORD_MINION_DEF.id }, context);
      expect(state.players.player1.hand.at(-1)?.keywords).toEqual({});

      const boardBeforeSummon = state.players.player1.board.length;
      resolveEffect({ type: "SUMMON_MULTIPLE", cardId: KEYWORD_MINION_DEF.id, count: 1 }, context);
      expect(state.players.player1.board).toHaveLength(boardBeforeSummon + 1);
      expect(state.players.player1.board.at(-1)?.keywords).toEqual({});

      const battlecryCard = graveMinion("player1", "play");
      battlecryCard.instanceId = "card-equality-play";
      battlecryCard.cost = 0;
      battlecryCard.keywords = { battlecry: { type: "DRAW", value: 1 }, taunt: true };
      state.players.player1.hand = [battlecryCard];
      state.players.player1.deck = [graveMinion("player1", "would-draw")];
      state.players.player1.mana = { current: 10, max: 10 };

      state = reduce(
        state,
        env("equality-play", "player1", { type: "playCard", handInstanceId: battlecryCard.instanceId }),
        CARD_CATALOG
      ).state;

      expect(state.players.player1.hand).toHaveLength(0);
      expect(state.players.player1.board.at(-1)?.keywords).toEqual({});
    });

    it("marks targeted hand minions as not needing targets in the private hand view", () => {
      const state = startMatch(44);
      const targeted = createCardForHand(state, KEYWORD_MINION_DEF, "player1");
      targeted.keywords = { battlecry: { type: "DAMAGE", value: 1, target: { side: "ENEMY", type: "MINION" } } };
      state.players.player1.hand = [targeted];
      expect(toHandView(state, "player1")[0].needsTarget).toBe(true);

      state.currentEnvironment = {
        id: "VE_EQUALITY_FOR_ALL",
        name: "人人平等",
        appliedTurn: state.turn.number,
        effect: { type: "ENV_DISABLE_ALL_MINION_EFFECTS" }
      };
      applyEnvironmentTick(state, []);

      expect(toHandView(state, "player1")[0].needsTarget).toBe(false);
    });
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
        expiresTurn: appliedTurn + 3,
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
