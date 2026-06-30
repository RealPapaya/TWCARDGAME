import { CARD_CATALOG, CARD_CATALOG_VERSION, type CardDefinition } from "@twcardgame/cards";
import { describe, expect, it } from "vitest";
import {
  createRuntimeCard,
  DEFAULT_MULLIGAN_TIME_LIMIT_MS,
  DEFAULT_TURN_TIME_LIMIT_MS,
  effectHandlers,
  nextInstanceId,
  reduce,
  SHORT_TURN_TIME_LIMIT_MS,
  toHandView,
  toPublicState,
  validateDeck
} from "./index.js";
import { createInitialMatch } from "./engine.js";
import type { MatchState } from "./types.js";
import { opponentOf, type GameEvent, type Seat } from "@twcardgame/shared";

describe("rules architecture", () => {
  it("has handlers for every current battlecry effect", () => {
    const effectTypes = new Set(
      CARD_CATALOG.map((card) => card.keywords?.battlecry?.type).filter((type): type is string => !!type)
    );

    for (const type of effectTypes) {
      expect(effectHandlers[type]).toBeTypeOf("function");
    }
  });

  it("enforces strict public PvP deck rules", () => {
    expect(validateDeck(["TW001"], CARD_CATALOG).valid).toBe(false);

    const legal = legalDeckIds();
    expect(validateDeck(legal, CARD_CATALOG).errors).toEqual([]);

    const legendaries = CARD_CATALOG.filter((card) => card.rarity === "LEGENDARY" && card.collectible !== false);
    expect(legendaries.length).toBeGreaterThanOrEqual(2);

    // 2 copies of a single legendary is allowed (per-card limit is 2).
    const withTwoLegendary = legal.slice(0, 28).concat(legendaries[0]!.id, legendaries[0]!.id);
    expect(validateDeck(withTwoLegendary, CARD_CATALOG).valid).toBe(true);

    // 3 copies of any card exceeds the per-card limit.
    const overCopyLimit = legal.slice(0, 27).concat(legendaries[0]!.id, legendaries[0]!.id, legendaries[0]!.id);
    expect(validateDeck(overCopyLimit, CARD_CATALOG).valid).toBe(false);

    // More than 2 legendary cards in total is illegal.
    const overLegendary = legal.slice(0, 27).concat(legendaries[0]!.id, legendaries[1]!.id, legendaries[0]!.id);
    const overResult = validateDeck(overLegendary, CARD_CATALOG);
    expect(overResult.valid).toBe(false);
    expect(overResult.errors.some((e) => e.includes("legendary limit"))).toBe(true);
  });

  it("enforces collection quantities during deck validation", () => {
    const legal = legalDeckIds();
    const doubledCardId = legal.find((id, index) => legal.indexOf(id) !== index)!;
    const collection = Array.from(new Set(legal)).map((cardId) => ({
      cardId,
      quantity: cardId === doubledCardId ? 1 : 2
    }));

    const result = validateDeck(legal, CARD_CATALOG, collection);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(`${doubledCardId} exceeds owned quantity 1; got 2.`);
  });

  it("does not expose hands or deck order through public state", () => {
    const { state } = createSeededMatch(1234);
    const publicState = toPublicState(state);

    expect(publicState.players.player1.handCount).toBe(3);
    expect("hand" in publicState.players.player1).toBe(false);
    expect("deck" in publicState.players.player1).toBe(false);
    expect(toHandView(state, "player1")).toHaveLength(3);
  });

  it("uses a 30s mulligan clock and a 50s default turn clock", () => {
    const created = createSeededMatch(2026).state;
    expect(created.turn.deadlineAtMs - created.turn.startedAtMs).toBe(DEFAULT_MULLIGAN_TIME_LIMIT_MS);

    const started = startMatch(2026);
    expect(started.turn.deadlineAtMs - started.turn.startedAtMs).toBe(DEFAULT_TURN_TIME_LIMIT_MS);
  });

  it("uses a 10s turn clock for a player with an unresolved timeout penalty", () => {
    const state = startMatch(2027);
    const nextSeat = opponentOf(state.turn.activeSeat);
    state.players[nextSeat].shortTurnPenalty = true;

    const result = reduce(
      state,
      { commandId: "start-short-turn", seat: state.turn.activeSeat, nowMs: 3000, command: { type: "endTurn" } },
      CARD_CATALOG
    );

    expect(result.state.turn.activeSeat).toBe(nextSeat);
    expect(result.state.turn.deadlineAtMs - result.state.turn.startedAtMs).toBe(SHORT_TURN_TIME_LIMIT_MS);
  });

  it("replays the same command log deterministically with the same seed", () => {
    const a = startMatch(42);
    const b = startMatch(42);

    expect(JSON.stringify(toPublicState(a))).toEqual(JSON.stringify(toPublicState(b)));
    expect(JSON.stringify(a.private.eventLog)).toEqual(JSON.stringify(b.private.eventLog));
  });

  it("applies a NEWS damage effect authoritatively", () => {
    const catalog = testCatalog();
    let state = createInitialMatch({
      matchId: "damage-test",
      cardCatalogVersion: "test",
      seed: 9,
      nowMs: 1000,
      catalog,
      players: [
        { seat: "player1", userId: "p1", displayName: "P1", deckIds: testDeckIds(catalog) },
        { seat: "player2", userId: "p2", displayName: "P2", deckIds: testDeckIds(catalog) }
      ]
    }).state;

    state.status = "in_progress";
    state.turn.activeSeat = "player1";
    state.players.player1.mana = { current: 10, max: 10 };
    state.players.player1.hand = [createRuntimeCard(catalog[1], "player1", nextInstanceId(state, "card"))];

    const result = reduce(
      state,
      {
        commandId: "cmd-play-damage",
        seat: "player1",
        nowMs: 2000,
        command: { type: "playCard", handInstanceId: state.players.player1.hand[0].instanceId, target: { type: "HERO", side: "player2" } }
      },
      catalog
    );

    expect(result.state.players.player2.hero.hp).toBe(27);
    expect(result.state.players.player1.hand).toHaveLength(0);
    expect(result.state.private.turnActionTaken).toBe(true);
    expect(result.events.some((event) => event.type === "DAMAGE")).toBe(true);
  });

  it("clears a timeout penalty on any valid player action", () => {
    const state = startMatch(79);
    const activeSeat = state.turn.activeSeat;
    state.players[activeSeat].shortTurnPenalty = true;

    const result = reduce(
      state,
      { commandId: "valid-action-clears-penalty", seat: activeSeat, nowMs: 2000, command: { type: "endTurn" } },
      CARD_CATALOG
    );

    expect(result.events.some((event) => event.type === "COMMAND_REJECTED")).toBe(false);
    expect(result.state.players[activeSeat].shortTurnPenalty).toBe(false);
  });

  it("does not clear a timeout penalty or mark action taken for rejected commands", () => {
    const state = startMatch(80);
    const activeSeat = state.turn.activeSeat;
    state.players[activeSeat].shortTurnPenalty = true;

    const result = reduce(
      state,
      { commandId: "invalid-action-keeps-penalty", seat: activeSeat, nowMs: 2000, command: { type: "playCard", handInstanceId: "missing-card" } },
      CARD_CATALOG
    );

    expect(result.events.some((event) => event.type === "COMMAND_REJECTED")).toBe(true);
    expect(result.state.players[activeSeat].shortTurnPenalty).toBe(true);
    expect(result.state.private.turnActionTaken).toBe(false);
  });

  it("records server timeout penalties through the command envelope", () => {
    const state = startMatch(81);
    const timedOutSeat = state.turn.activeSeat;

    const timedOut = reduce(
      state,
      { commandId: "server-timeout-test", seat: timedOutSeat, nowMs: 2000, command: { type: "endTurn" }, serverTimeout: true },
      CARD_CATALOG
    ).state;

    expect(timedOut.players[timedOutSeat].shortTurnPenalty).toBe(true);

    const returned = reduce(
      timedOut,
      { commandId: "return-to-penalized-seat", seat: timedOut.turn.activeSeat, nowMs: 3000, command: { type: "endTurn" } },
      CARD_CATALOG
    ).state;

    expect(returned.turn.activeSeat).toBe(timedOutSeat);
    expect(returned.turn.deadlineAtMs - returned.turn.startedAtMs).toBe(SHORT_TURN_TIME_LIMIT_MS);
  });

  it("ignores duplicate command ids without mutating state or emitting events", () => {
    const state = startMatch(77);
    const envelope = {
      commandId: "duplicate-end-turn",
      seat: state.turn.activeSeat,
      nowMs: 2000,
      command: { type: "endTurn" as const }
    };

    const first = reduce(state, envelope, CARD_CATALOG);
    const beforeReplay = JSON.stringify(first.state);
    const replay = reduce(first.state, envelope, CARD_CATALOG);

    expect(replay.events).toEqual([]);
    expect(JSON.stringify(replay.state)).toBe(beforeReplay);
  });

  it("rejects out-of-turn commands without advancing the turn", () => {
    const state = startMatch(78);
    const activeSeat = state.turn.activeSeat;
    const result = reduce(
      state,
      {
        commandId: "out-of-turn-end",
        seat: opponentOf(activeSeat),
        nowMs: 2000,
        command: { type: "endTurn" }
      },
      CARD_CATALOG
    );

    expect(result.events.some((event) => event.type === "COMMAND_REJECTED")).toBe(true);
    expect(result.state.turn.activeSeat).toBe(activeSeat);
    expect(result.state.turn.number).toBe(state.turn.number);
  });

  it("陳致中 with 陳水扁 on board draws three from an empty deck (three fatigue hits)", () => {
    const state = startMatch(31337);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    player.mana = { current: 10, max: 10 };

    // 陳水扁 onto the board exactly as the real game would summon it.
    const bian = createRuntimeCard(getCard("TW080"), seat, nextInstanceId(state, "card"));
    player.hand = [bian];
    let next = reduce(state, { commandId: "play-bian", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: bian.instanceId } }, CARD_CATALOG).state;
    expect(next.players[seat].board.some((m) => m.cardId === "TW080")).toBe(true);

    // Empty the deck and give the hero plenty of HP so fatigue won't end the match.
    next.players[seat].deck = [];
    next.players[seat].hero.hp = 100;
    next.players[seat].hero.maxHp = 100;
    next.players[seat].mana = { current: 10, max: 10 };

    const chih = createRuntimeCard(getCard("TW081"), seat, nextInstanceId(next, "card"));
    next.players[seat].hand = [chih];
    const result = reduce(next, { commandId: "play-chih", seat, nowMs: 2100, command: { type: "playCard", handInstanceId: chih.instanceId } }, CARD_CATALOG);

    const fatigueHits = result.events.filter((event) => event.type === "FATIGUE");
    expect(fatigueHits).toHaveLength(3);
    // Fatigue damage ramps 1 → 2 → 3 across the three forced draws.
    expect(fatigueHits.map((event) => event.payload?.amount)).toEqual([1, 2, 3]);
  });
});

function getCard(id: string): CardDefinition {
  const found = CARD_CATALOG.find((card) => card.id === id);
  if (!found) throw new Error(`missing card ${id}`);
  return found;
}

function createSeededMatch(seed: number) {
  return createInitialMatch({
    matchId: `match-${seed}`,
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed,
    nowMs: 1000,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: "p1", displayName: "P1", deckIds: legalDeckIds() },
      { seat: "player2", userId: "p2", displayName: "P2", deckIds: legalDeckIds() }
    ]
  });
}

function startMatch(seed: number): MatchState {
  let state = createSeededMatch(seed).state;
  state = reduce(state, { commandId: "m1", seat: "player1", nowMs: 1100, command: { type: "submitMulligan", replaceHandInstanceIds: [] } }, CARD_CATALOG).state;
  state = reduce(state, { commandId: "m2", seat: "player2", nowMs: 1200, command: { type: "submitMulligan", replaceHandInstanceIds: [] } }, CARD_CATALOG).state;
  return state;
}

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

function testCatalog(): CardDefinition[] {
  const filler = Array.from({ length: 15 }, (_, index): CardDefinition => ({
    id: `M${index}`,
    name: `Minion ${index}`,
    category: "test",
    cost: 1,
    attack: 1,
    health: 2,
    type: "MINION",
    rarity: "COMMON",
    description: "",
    image: "test.webp"
  }));
  return [
    filler[0],
    {
      id: "S_DAMAGE",
      name: "Damage",
      category: "新聞",
      cost: 1,
      type: "NEWS",
      rarity: "COMMON",
      description: "",
      image: "test.webp",
      keywords: { battlecry: { type: "DAMAGE", value: 3, target: { side: "ENEMY", type: "ALL" } } }
    },
    ...filler.slice(1)
  ];
}

function testDeckIds(catalog: readonly CardDefinition[]): string[] {
  return catalog.slice(0, 15).flatMap((card) => [card.id, card.id]);
}

// ── Target legality catalog ────────────────────────────────────────────────────

function targetLegalityCatalog(): CardDefinition[] {
  const minion = (id: string): CardDefinition => ({
    id, name: id, category: "test", cost: 1, attack: 1, health: 2, type: "MINION", rarity: "COMMON", description: "", image: "test.webp"
  });
  const fillers = Array.from({ length: 14 }, (_, i) => minion(`TL_F${i}`));
  return [
    ...fillers,
    { ...minion("TL_CHARGE"), keywords: { charge: true } },
    {
      id: "TL_DESTROY_ENEMY",
      name: "Destroy Enemy Minion",
      category: "新聞",
      cost: 1,
      type: "NEWS",
      rarity: "COMMON",
      description: "",
      image: "test.webp",
      keywords: { battlecry: { type: "DESTROY", target: { side: "ENEMY", type: "MINION" } } }
    },
    {
      id: "TL_BUFF_FRIENDLY",
      name: "Buff Friendly Minion",
      category: "新聞",
      cost: 1,
      type: "NEWS",
      rarity: "COMMON",
      description: "",
      image: "test.webp",
      keywords: { battlecry: { type: "BUFF_STAT_TARGET", stat: "ATTACK", value: 2, target: { side: "FRIENDLY", type: "MINION" } } }
    },
  ];
}

function targetLegalityDeckIds(catalog: readonly CardDefinition[]): string[] {
  return catalog.filter((c) => c.type === "MINION").slice(0, 15).flatMap((c) => [c.id, c.id]);
}

function targetLegalityMatch() {
  const catalog = targetLegalityCatalog();
  let state = createInitialMatch({
    matchId: "tl-match",
    cardCatalogVersion: "test",
    seed: 7,
    nowMs: 1000,
    catalog,
    players: [
      { seat: "player1", userId: "p1", displayName: "P1", deckIds: targetLegalityDeckIds(catalog) },
      { seat: "player2", userId: "p2", displayName: "P2", deckIds: targetLegalityDeckIds(catalog) }
    ]
  }).state;
  state = reduce(state, { commandId: "m1", seat: "player1", nowMs: 1100, command: { type: "submitMulligan", replaceHandInstanceIds: [] } }, catalog).state;
  state = reduce(state, { commandId: "m2", seat: "player2", nowMs: 1200, command: { type: "submitMulligan", replaceHandInstanceIds: [] } }, catalog).state;
  // Give both players max mana and inject cards needing targets
  state.players.player1.mana = { current: 10, max: 10 };
  state.players.player2.mana = { current: 10, max: 10 };
  return { state, catalog };
}

function rejectionReason(events: GameEvent[]): string | undefined {
  return events.find((event) => event.type === "COMMAND_REJECTED")?.payload?.reason as string | undefined;
}

describe("target legality", () => {
  it("rejects a targeted battlecry played without a target", () => {
    const { state, catalog } = targetLegalityMatch();
    const destroyCard: CardDefinition = catalog.find((c) => c.id === "TL_DESTROY_ENEMY")!;
    state.players[state.turn.activeSeat].hand = [createRuntimeCard(destroyCard, state.turn.activeSeat, nextInstanceId(state, "card"))];

    const result = reduce(
      state,
      { commandId: "tl1", seat: state.turn.activeSeat, nowMs: 2000, command: { type: "playCard", handInstanceId: state.players[state.turn.activeSeat].hand[0].instanceId } },
      catalog
    );
    expect(rejectionReason(result.events)).toBe("這張牌需要選擇目標。");
  });

  it("rejects a MINION-targeting battlecry aimed at a hero", () => {
    const { state, catalog } = targetLegalityMatch();
    const destroyCard: CardDefinition = catalog.find((c) => c.id === "TL_DESTROY_ENEMY")!;
    const seat = state.turn.activeSeat;
    const enemy = seat === "player1" ? "player2" : "player1";
    state.players[seat].hand = [createRuntimeCard(destroyCard, seat, nextInstanceId(state, "card"))];

    const result = reduce(
      state,
      { commandId: "tl2", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: state.players[seat].hand[0].instanceId, target: { type: "HERO", side: enemy } } },
      catalog
    );
    expect(rejectionReason(result.events)).toBe("這個目標不是隨從。");
  });

  it("rejects a FRIENDLY-targeting battlecry aimed at an enemy minion", () => {
    const { state, catalog } = targetLegalityMatch();
    const buffCard: CardDefinition = catalog.find((c) => c.id === "TL_BUFF_FRIENDLY")!;
    const seat = state.turn.activeSeat;
    const enemy = seat === "player1" ? "player2" : "player1";
    // Place an enemy minion to target
    const chargeCard = catalog.find((c) => c.id === "TL_CHARGE")!;
    const enemyMinion = createRuntimeCard(chargeCard, enemy, nextInstanceId(state, "card"));
    const enemyBoard = { instanceId: nextInstanceId(state, "minion"), cardId: chargeCard.id, ownerSeat: enemy as Seat, name: chargeCard.name, category: chargeCard.category, cost: 1, type: "MINION" as const, rarity: chargeCard.rarity, attack: 1, baseAttack: 1, health: 2, currentHealth: 2, keywords: {}, sleeping: false, canAttack: true, isEnraged: false, lockedTurns: 0, auraAttack: 0, auraHealth: 0, auraTaunt: false, tempBuffs: [] };
    state.players[enemy].board = [enemyBoard];
    state.players[seat].hand = [createRuntimeCard(buffCard, seat, nextInstanceId(state, "card"))];

    const result = reduce(
      state,
      { commandId: "tl3", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: state.players[seat].hand[0].instanceId, target: { type: "MINION", side: enemy, instanceId: enemyBoard.instanceId } } },
      catalog
    );
    expect(rejectionReason(result.events)).toBe("這個目標不是友軍。");
  });

  it("rejects a battlecry targeting a minion that is not on the board", () => {
    const { state, catalog } = targetLegalityMatch();
    const destroyCard: CardDefinition = catalog.find((c) => c.id === "TL_DESTROY_ENEMY")!;
    const seat = state.turn.activeSeat;
    const enemy = seat === "player1" ? "player2" : "player1";
    state.players[seat].hand = [createRuntimeCard(destroyCard, seat, nextInstanceId(state, "card"))];

    const result = reduce(
      state,
      { commandId: "tl4", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: state.players[seat].hand[0].instanceId, target: { type: "MINION", side: enemy, instanceId: "ghost_minion" } } },
      catalog
    );
    expect(rejectionReason(result.events)).toBe("找不到目標隨從。");
  });

  it("accepts a valid enemy-minion target", () => {
    const { state, catalog } = targetLegalityMatch();
    const destroyCard: CardDefinition = catalog.find((c) => c.id === "TL_DESTROY_ENEMY")!;
    const seat = state.turn.activeSeat;
    const enemy = seat === "player1" ? "player2" : "player1";
    const enemyBoard = { instanceId: "enemy_m1", cardId: "TL_F0", ownerSeat: enemy as Seat, name: "F0", category: "test", cost: 1, type: "MINION" as const, rarity: "COMMON" as const, attack: 1, baseAttack: 1, health: 2, currentHealth: 2, keywords: {}, sleeping: false, canAttack: true, isEnraged: false, lockedTurns: 0, auraAttack: 0, auraHealth: 0, auraTaunt: false, tempBuffs: [] };
    state.players[enemy].board = [enemyBoard];
    state.players[seat].hand = [createRuntimeCard(destroyCard, seat, nextInstanceId(state, "card"))];

    const result = reduce(
      state,
      { commandId: "tl5", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: state.players[seat].hand[0].instanceId, target: { type: "MINION", side: enemy, instanceId: "enemy_m1" } } },
      catalog
    );
    expect(result.events.some((e) => e.type === "COMMAND_REJECTED")).toBe(false);
    expect(result.events.some((e) => e.type === "CARD_PLAYED")).toBe(true);
    expect(result.state.players[enemy].board).toHaveLength(0);
  });

  it("attack: enforces taunt blocking", () => {
    const { state, catalog } = targetLegalityMatch();
    const seat = state.turn.activeSeat;
    const enemy = seat === "player1" ? "player2" : "player1";
    const attacker = { instanceId: "my_attacker", cardId: "TL_F0", ownerSeat: seat as Seat, name: "A", category: "test", cost: 1, type: "MINION" as const, rarity: "COMMON" as const, attack: 2, baseAttack: 2, health: 2, currentHealth: 2, keywords: {}, sleeping: false, canAttack: true, isEnraged: false, lockedTurns: 0, auraAttack: 0, auraHealth: 0, auraTaunt: false, tempBuffs: [] };
    const tauntMinion = { instanceId: "enemy_taunt", cardId: "TL_F1", ownerSeat: enemy as Seat, name: "T", category: "test", cost: 2, type: "MINION" as const, rarity: "COMMON" as const, attack: 1, baseAttack: 1, health: 3, currentHealth: 3, keywords: { taunt: true }, sleeping: false, canAttack: true, isEnraged: false, lockedTurns: 0, auraAttack: 0, auraHealth: 0, auraTaunt: false, tempBuffs: [] };
    state.players[seat].board = [attacker];
    state.players[enemy].board = [tauntMinion];

    // Attack enemy hero while taunt is present → rejected
    const result = reduce(
      state,
      { commandId: "tl6", seat, nowMs: 2000, command: { type: "attack", attackerInstanceId: "my_attacker", target: { type: "HERO", side: enemy } } },
      catalog
    );
    expect(rejectionReason(result.events)).toBe("請先攻擊具有沙包的敵方隨從。");

    // Attack the taunt minion → accepted
    const result2 = reduce(
      state,
      { commandId: "tl7", seat, nowMs: 2000, command: { type: "attack", attackerInstanceId: "my_attacker", target: { type: "MINION", side: enemy, instanceId: "enemy_taunt" } } },
      catalog
    );
    expect(result2.events.some((e) => e.type === "COMMAND_REJECTED")).toBe(false);
  });

  it("attack: rejects friendly targets with a specific message", () => {
    const { state, catalog } = targetLegalityMatch();
    const seat = state.turn.activeSeat;
    const attacker = { instanceId: "my_attacker", cardId: "TL_F0", ownerSeat: seat as Seat, name: "A", category: "test", cost: 1, type: "MINION" as const, rarity: "COMMON" as const, attack: 2, baseAttack: 2, health: 2, currentHealth: 2, keywords: {}, sleeping: false, canAttack: true, isEnraged: false, lockedTurns: 0, auraAttack: 0, auraHealth: 0, auraTaunt: false, tempBuffs: [] };
    const friendly = { instanceId: "friendly_m1", cardId: "TL_F1", ownerSeat: seat as Seat, name: "F", category: "test", cost: 2, type: "MINION" as const, rarity: "COMMON" as const, attack: 1, baseAttack: 1, health: 3, currentHealth: 3, keywords: {}, sleeping: false, canAttack: true, isEnraged: false, lockedTurns: 0, auraAttack: 0, auraHealth: 0, auraTaunt: false, tempBuffs: [] };
    state.players[seat].board = [attacker, friendly];

    const result = reduce(
      state,
      { commandId: "tl8", seat, nowMs: 2000, command: { type: "attack", attackerInstanceId: "my_attacker", target: { type: "MINION", side: seat, instanceId: "friendly_m1" } } },
      catalog
    );

    expect(rejectionReason(result.events)).toBe("只能攻擊敵方目標。");
  });
});

describe("起底 / Discover (CHANNEL)", () => {
  function channelDef(): CardDefinition {
    return {
      id: "TEST_CHANNEL",
      name: "起底測試",
      category: "新聞",
      cost: 0,
      type: "NEWS",
      rarity: "COMMON",
      description: "從牌庫挑 3 張選 1 張加入手牌。",
      image: "test.webp",
      keywords: { battlecry: { type: "CHANNEL", count: 3 } }
    };
  }

  function playChannel(seed = 4321, def: CardDefinition = channelDef()) {
    const state = startMatch(seed);
    const seat = state.turn.activeSeat;
    state.players[seat].mana.current = 5;
    const card = createRuntimeCard(def, seat, nextInstanceId(state, "card"));
    state.players[seat].hand = [card];
    const deckBefore = state.players[seat].deck.length;
    const result = reduce(
      state,
      { commandId: "ch-play", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: card.instanceId } },
      CARD_CATALOG
    );
    return { state: result.state, events: result.events, seat, deckBefore };
  }

  it("opens a private choice prompt with 3 candidates pulled from the deck", () => {
    const { state, seat, deckBefore } = playChannel();
    expect(state.pendingPrompt?.kind).toBe("choice");
    expect(state.pendingPrompt?.seat).toBe(seat);
    expect(state.pendingPrompt?.choiceCount).toBe(3);
    expect(state.private.pendingChoice?.cards).toHaveLength(3);
    expect(state.players[seat].deck.length).toBe(deckBefore - 3);
    // The public projection never exposes the candidate card identities.
    expect(toPublicState(state).pendingPrompt?.choiceCount).toBe(3);
    expect(JSON.stringify(toPublicState(state))).not.toContain("pendingChoice");
  });

  it("rejects other actions while the prompt is open", () => {
    const { state, seat } = playChannel();
    const other = createRuntimeCard(channelDef(), seat, nextInstanceId(state, "card"));
    state.players[seat].hand.push(other);
    const result = reduce(
      state,
      { commandId: "ch-block", seat, nowMs: 2100, command: { type: "playCard", handInstanceId: other.instanceId } },
      CARD_CATALOG
    );
    expect(rejectionReason(result.events)).toBe("請先完成你的選擇。");
    expect(result.state.pendingPrompt).toBeDefined();
  });

  it("resolvePrompt adds the chosen card to hand and shuffles the rest back", () => {
    const opened = playChannel();
    const { seat, deckBefore } = opened;
    const promptId = opened.state.pendingPrompt!.promptId;
    const chosen = opened.state.private.pendingChoice!.cards[1];
    const result = reduce(
      opened.state,
      { commandId: "ch-resolve", seat, nowMs: 2200, command: { type: "resolvePrompt", promptId, choiceInstanceId: chosen.instanceId } },
      CARD_CATALOG
    );
    const next = result.state;
    expect(next.pendingPrompt).toBeUndefined();
    expect(next.private.pendingChoice).toBeUndefined();
    expect(next.players[seat].hand.some((c) => c.instanceId === chosen.instanceId)).toBe(true);
    // 3 pulled, 1 to hand, 2 returned → one fewer card than before the channel.
    expect(next.players[seat].deck.length).toBe(deckBefore - 1);
    expect(result.events.some((e) => e.type === "PROMPT_RESOLVED")).toBe(true);
  });

  it("rejects a resolvePrompt that names an unoffered card", () => {
    const opened = playChannel();
    const promptId = opened.state.pendingPrompt!.promptId;
    const result = reduce(
      opened.state,
      { commandId: "ch-bad", seat: opened.seat, nowMs: 2200, command: { type: "resolvePrompt", promptId, choiceInstanceId: "not-a-candidate" } },
      CARD_CATALOG
    );
    expect(rejectionReason(result.events)).toBe("無效的選擇。");
    expect(result.state.pendingPrompt).toBeDefined();
  });

  it("is a no-op when no deck card matches the pool filter", () => {
    const def = channelDef();
    def.keywords!.battlecry = { type: "CHANNEL", count: 3, target_category_includes: "__no_such_category__" };
    const { state } = playChannel(9876, def);
    expect(state.pendingPrompt).toBeUndefined();
    expect(state.private.pendingChoice).toBeUndefined();
  });

  it("poolHasDeathrattle restricts candidates to 遺志 cards only", () => {
    const deathrattleDef: CardDefinition = {
      id: "DR_MINION",
      name: "遺志隨從",
      category: "勞工",
      cost: 2,
      attack: 1,
      health: 1,
      type: "MINION",
      rarity: "COMMON",
      description: "遺志: 抽一張牌",
      image: "test.webp",
      keywords: { deathrattle: { type: "DRAW", value: 1, target: { side: "FRIENDLY" } } }
    };
    const plainDef: CardDefinition = {
      id: "PLAIN_MINION",
      name: "普通隨從",
      category: "勞工",
      cost: 2,
      attack: 1,
      health: 1,
      type: "MINION",
      rarity: "COMMON",
      description: "",
      image: "test.webp"
    };

    const state = startMatch(2468);
    const seat = state.turn.activeSeat;
    state.players[seat].mana.current = 5;
    // Deterministic deck: a few 遺志 minions mixed with plain ones.
    state.players[seat].deck = [
      createRuntimeCard(deathrattleDef, seat, nextInstanceId(state, "card")),
      createRuntimeCard(plainDef, seat, nextInstanceId(state, "card")),
      createRuntimeCard(deathrattleDef, seat, nextInstanceId(state, "card")),
      createRuntimeCard(plainDef, seat, nextInstanceId(state, "card"))
    ];
    const def = channelDef();
    def.keywords!.battlecry = { type: "CHANNEL", count: 3, poolHasDeathrattle: true };
    const card = createRuntimeCard(def, seat, nextInstanceId(state, "card"));
    state.players[seat].hand = [card];

    const result = reduce(
      state,
      { commandId: "ch-dr", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: card.instanceId } },
      CARD_CATALOG
    );

    const candidates = result.state.private.pendingChoice?.cards ?? [];
    expect(candidates.length).toBe(2); // only the two 遺志 minions qualify
    expect(candidates.every((c) => c.keywords?.deathrattle)).toBe(true);
  });

  it("poolFromGraveyard reveals own dead minions and returns the unpicked to the graveyard", () => {
    const deadDef: CardDefinition = {
      id: "DEAD_MINION",
      name: "亡魂",
      category: "平民",
      cost: 2,
      attack: 1,
      health: 1,
      type: "MINION",
      rarity: "COMMON",
      description: "",
      image: "test.webp"
    };
    const state = startMatch(1357);
    const seat = state.turn.activeSeat;
    state.players[seat].mana.current = 6;
    state.players[seat].graveyard = [
      createRuntimeCard(deadDef, seat, nextInstanceId(state, "card")),
      createRuntimeCard(deadDef, seat, nextInstanceId(state, "card"))
    ];
    const deckBefore = state.players[seat].deck.length;
    const def = channelDef();
    def.keywords!.battlecry = { type: "CHANNEL", count: 3, poolFromGraveyard: true, poolCardType: "MINION" };
    const card = createRuntimeCard(def, seat, nextInstanceId(state, "card"));
    state.players[seat].hand = [card];

    const opened = reduce(
      state,
      { commandId: "gy-open", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: card.instanceId } },
      CARD_CATALOG
    ).state;
    expect(opened.private.pendingChoice?.fromGraveyard).toBe(true);
    expect(opened.private.pendingChoice?.cards.length).toBe(2);
    expect(opened.players[seat].graveyard.length).toBe(0); // candidates held privately
    expect(opened.players[seat].deck.length).toBe(deckBefore); // deck untouched

    const chosen = opened.private.pendingChoice!.cards[0];
    const promptId = opened.pendingPrompt!.promptId;
    const resolved = reduce(
      opened,
      { commandId: "gy-res", seat, nowMs: 2100, command: { type: "resolvePrompt", promptId, choiceInstanceId: chosen.instanceId } },
      CARD_CATALOG
    ).state;
    expect(resolved.players[seat].hand.some((c) => c.instanceId === chosen.instanceId)).toBe(true);
    expect(resolved.players[seat].graveyard.length).toBe(1); // the unpicked minion went back to the grave
    expect(resolved.players[seat].deck.length).toBe(deckBefore); // never reshuffled into the deck
  });

  it("picks:2 (起底兩張) opens a fresh reveal after the first pick resolves", () => {
    const newsDef: CardDefinition = {
      id: "POOL_NEWS",
      name: "池新聞",
      category: "新聞",
      cost: 1,
      type: "NEWS",
      rarity: "COMMON",
      description: "",
      image: "test.webp"
    };
    const state = startMatch(2024);
    const seat = state.turn.activeSeat;
    state.players[seat].mana.current = 9;
    state.players[seat].deck = Array.from({ length: 6 }, () => createRuntimeCard(newsDef, seat, nextInstanceId(state, "card")));
    const def = channelDef();
    def.keywords!.battlecry = { type: "CHANNEL", count: 3, picks: 2, poolCardType: "NEWS" };
    const card = createRuntimeCard(def, seat, nextInstanceId(state, "card"));
    state.players[seat].hand = [card];

    const first = reduce(
      state,
      { commandId: "p2-open", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: card.instanceId } },
      CARD_CATALOG
    ).state;
    expect(first.pendingPrompt).toBeDefined();
    const firstChosen = first.private.pendingChoice!.cards[0];
    const second = reduce(
      first,
      { commandId: "p2-res1", seat, nowMs: 2100, command: { type: "resolvePrompt", promptId: first.pendingPrompt!.promptId, choiceInstanceId: firstChosen.instanceId } },
      CARD_CATALOG
    ).state;
    // A second prompt opens automatically for the second pick.
    expect(second.pendingPrompt).toBeDefined();
    expect(second.private.pendingChoice?.promptId).not.toBe(first.pendingPrompt!.promptId);

    const secondChosen = second.private.pendingChoice!.cards[0];
    const done = reduce(
      second,
      { commandId: "p2-res2", seat, nowMs: 2200, command: { type: "resolvePrompt", promptId: second.pendingPrompt!.promptId, choiceInstanceId: secondChosen.instanceId } },
      CARD_CATALOG
    ).state;
    expect(done.pendingPrompt).toBeUndefined();
    expect(done.players[seat].hand.filter((c) => c.cardId === "POOL_NEWS").length).toBe(2);
  });
});

describe("ON_PLAY_NEWS / SELF_COST_REDUCE (新聞龍捲風)", () => {
  it("cheapens a held card by 1 each time a NEWS is played, flooring at 0", () => {
    const tornadoDef: CardDefinition = {
      id: "TEST_TORNADO",
      name: "龍捲風測試",
      category: "新聞",
      cost: 7,
      type: "NEWS",
      rarity: "RARE",
      description: "",
      image: "test.webp",
      keywords: { triggered: { type: "ON_PLAY_NEWS", action: "SELF_COST_REDUCE", value: 1 } }
    };
    const simpleNews: CardDefinition = {
      id: "SIMPLE_NEWS",
      name: "簡單新聞",
      category: "新聞",
      cost: 0,
      type: "NEWS",
      rarity: "COMMON",
      description: "",
      image: "test.webp"
    };
    const state = startMatch(99);
    const seat = state.turn.activeSeat;
    state.players[seat].mana.current = 5;
    const tornado = createRuntimeCard(tornadoDef, seat, nextInstanceId(state, "card"));
    const news = createRuntimeCard(simpleNews, seat, nextInstanceId(state, "card"));
    state.players[seat].hand = [tornado, news];

    const after = reduce(
      state,
      { commandId: "tor-news", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: news.instanceId } },
      CARD_CATALOG
    ).state;
    const heldTornado = after.players[seat].hand.find((c) => c.instanceId === tornado.instanceId)!;
    expect(heldTornado.cost).toBe(6);
    expect(heldTornado.isReduced).toBe(true);
  });
});

describe("DRAW_IF_HAND_EMPTY (抄底)", () => {
  function chaodiDef(): CardDefinition {
    return {
      id: "TEST_CHAODI",
      name: "抄底測試",
      category: "新聞",
      cost: 2,
      type: "NEWS",
      rarity: "RARE",
      description: "",
      image: "test.webp",
      keywords: { battlecry: { type: "DRAW_IF_HAND_EMPTY", value: 1, bonus_value: 3 } }
    };
  }

  it("draws 1 when other cards remain in hand", () => {
    const state = startMatch(4242);
    const seat = state.turn.activeSeat;
    state.players[seat].mana.current = 5;
    const chaodi = createRuntimeCard(chaodiDef(), seat, nextInstanceId(state, "card"));
    const filler = createRuntimeCard(chaodiDef(), seat, nextInstanceId(state, "card"));
    state.players[seat].hand = [chaodi, filler];
    const deckBefore = state.players[seat].deck.length;

    const after = reduce(
      state,
      { commandId: "cd-some", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: chaodi.instanceId } },
      CARD_CATALOG
    ).state;

    // filler stays + 1 drawn = 2 in hand; deck down by 1.
    expect(after.players[seat].hand.length).toBe(2);
    expect(after.players[seat].deck.length).toBe(deckBefore - 1);
  });

  it("draws 3 when it was the last card in hand", () => {
    const state = startMatch(4243);
    const seat = state.turn.activeSeat;
    state.players[seat].mana.current = 5;
    const chaodi = createRuntimeCard(chaodiDef(), seat, nextInstanceId(state, "card"));
    state.players[seat].hand = [chaodi];
    const deckBefore = state.players[seat].deck.length;

    const after = reduce(
      state,
      { commandId: "cd-empty", seat, nowMs: 2000, command: { type: "playCard", handInstanceId: chaodi.instanceId } },
      CARD_CATALOG
    ).state;

    expect(after.players[seat].hand.length).toBe(3);
    expect(after.players[seat].deck.length).toBe(deckBefore - 3);
  });
});

describe("tech enforcement vote environment", () => {
  it("damages an attacking minion after it attacks a hero", () => {
    const { state, catalog } = targetLegalityMatch();
    const seat = state.turn.activeSeat;
    const enemy = seat === "player1" ? "player2" : "player1";
    const attacker = { instanceId: "tech_attacker", cardId: "TL_F0", ownerSeat: seat as Seat, name: "A", category: "test", cost: 1, type: "MINION" as const, rarity: "COMMON" as const, attack: 2, baseAttack: 2, health: 2, currentHealth: 2, keywords: {}, sleeping: false, canAttack: true, isEnraged: false, lockedTurns: 0, auraAttack: 0, auraHealth: 0, auraTaunt: false, tempBuffs: [] };
    state.players[seat].board = [attacker];
    state.currentEnvironment = {
      id: "VE_TECH_ENFORCEMENT",
      name: "科技執法",
      appliedTurn: state.turn.number,
      effect: { type: "ENV_ATTACKER_TAKES_DAMAGE", value: 1 }
    };

    const result = reduce(
      state,
      { commandId: "tech-hero", seat, nowMs: 2000, command: { type: "attack", attackerInstanceId: "tech_attacker", target: { type: "HERO", side: enemy } } },
      catalog
    );

    expect(result.state.players[seat].board[0].currentHealth).toBe(1);
    const damageTargets = result.events.filter((event) => event.type === "DAMAGE").map((event) => event.payload?.target);
    expect(damageTargets).toEqual([`${enemy}:hero`, "tech_attacker"]);
    expect(result.events.find((event) => event.type === "DAMAGE" && event.payload?.target === "tech_attacker")?.payload?.source).toBe("TECH_ENFORCEMENT");
  });

  it("resolves after combat and counterattack damage", () => {
    const { state, catalog } = targetLegalityMatch();
    const seat = state.turn.activeSeat;
    const enemy = seat === "player1" ? "player2" : "player1";
    const attacker = { instanceId: "tech_attacker", cardId: "TL_F0", ownerSeat: seat as Seat, name: "A", category: "test", cost: 1, type: "MINION" as const, rarity: "COMMON" as const, attack: 1, baseAttack: 1, health: 2, currentHealth: 2, keywords: {}, sleeping: false, canAttack: true, isEnraged: false, lockedTurns: 0, auraAttack: 0, auraHealth: 0, auraTaunt: false, tempBuffs: [] };
    const defender = { instanceId: "tech_defender", cardId: "TL_F1", ownerSeat: enemy as Seat, name: "D", category: "test", cost: 1, type: "MINION" as const, rarity: "COMMON" as const, attack: 1, baseAttack: 1, health: 3, currentHealth: 3, keywords: {}, sleeping: false, canAttack: true, isEnraged: false, lockedTurns: 0, auraAttack: 0, auraHealth: 0, auraTaunt: false, tempBuffs: [] };
    state.players[seat].board = [attacker];
    state.players[enemy].board = [defender];
    state.currentEnvironment = {
      id: "VE_TECH_ENFORCEMENT",
      name: "科技執法",
      appliedTurn: state.turn.number,
      effect: { type: "ENV_ATTACKER_TAKES_DAMAGE", value: 1 }
    };

    const result = reduce(
      state,
      { commandId: "tech-minion", seat, nowMs: 2000, command: { type: "attack", attackerInstanceId: "tech_attacker", target: { type: "MINION", side: enemy, instanceId: "tech_defender" } } },
      catalog
    );

    expect(result.state.players[seat].board).toHaveLength(0);
    expect(result.state.players[enemy].board[0].currentHealth).toBe(2);
    const damageEvents = result.events.filter((event) => event.type === "DAMAGE");
    expect(damageEvents.map((event) => event.payload?.target)).toEqual(["tech_defender", "tech_attacker", "tech_attacker"]);
    expect(damageEvents.map((event) => event.payload?.remainingHealth)).toEqual([2, 1, 0]);
    expect(damageEvents[2].payload?.source).toBe("TECH_ENFORCEMENT");
  });
});

describe("遺志: 起底 (ADD_RANDOM_CATEGORY_FROM_DECK)", () => {
  const dppDef: CardDefinition = {
    id: "TEST_DPP",
    name: "測試民進黨",
    category: "民進黨政治人物",
    cost: 1,
    attack: 1,
    health: 1,
    type: "MINION",
    rarity: "COMMON",
    description: "",
    image: "test.webp"
  };
  const plainDef: CardDefinition = {
    id: "TEST_PLAIN",
    name: "測試平民",
    category: "勞工",
    cost: 1,
    attack: 1,
    health: 1,
    type: "MINION",
    rarity: "COMMON",
    description: "",
    image: "test.webp"
  };

  function minion(instanceId: string, ownerSeat: Seat, overrides: Record<string, unknown>) {
    return {
      instanceId,
      cardId: "TEST_PLAIN",
      ownerSeat,
      name: "M",
      category: "test",
      cost: 1,
      type: "MINION" as const,
      rarity: "COMMON" as const,
      attack: 1,
      baseAttack: 1,
      health: 1,
      currentHealth: 1,
      keywords: {},
      sleeping: false,
      canAttack: true,
      isEnraged: false,
      lockedTurns: 0,
      auraAttack: 0,
      auraHealth: 0,
      auraTaunt: false,
      tempBuffs: [],
      ...overrides
    };
  }

  it("fires on the OPPONENT's turn (off-turn death) without opening a prompt, pulling a matching card from the owner's deck", () => {
    const state = startMatch(20260630);
    const attackerSeat = state.turn.activeSeat;
    const ownerSeat = opponentOf(attackerSeat);

    // The owner's 呂秀蓮-style minion dies to the active opponent's attack.
    state.players[ownerSeat].board = [
      minion("lu", ownerSeat, {
        attack: 1,
        health: 1,
        currentHealth: 1,
        canAttack: false,
        keywords: {
          deathrattle: {
            type: "ADD_RANDOM_CATEGORY_FROM_DECK",
            poolCardType: "MINION",
            target_category_includes: "民進黨政治人物"
          }
        }
      })
    ];
    state.players[attackerSeat].board = [minion("killer", attackerSeat, { attack: 1, health: 2, currentHealth: 2 })];

    // Owner deck: exactly one matching candidate plus a non-matching one.
    state.players[ownerSeat].deck = [
      createRuntimeCard(dppDef, ownerSeat, nextInstanceId(state, "card")),
      createRuntimeCard(plainDef, ownerSeat, nextInstanceId(state, "card"))
    ];
    const handBefore = state.players[ownerSeat].hand.length;

    const result = reduce(
      state,
      { commandId: "dr1", seat: attackerSeat, nowMs: 2000, command: { type: "attack", attackerInstanceId: "killer", target: { type: "MINION", side: ownerSeat, instanceId: "lu" } } },
      CARD_CATALOG
    );

    // Minion died, deathrattle fired, no interactive prompt deadlocked the turn.
    expect(result.state.players[ownerSeat].board).toHaveLength(0);
    expect(result.events.some((e) => e.type === "DEATHRATTLE")).toBe(true);
    expect(result.state.pendingPrompt).toBeUndefined();
    // The only matching card moved deck → owner hand.
    expect(result.state.players[ownerSeat].hand.some((c) => c.cardId === "TEST_DPP")).toBe(true);
    expect(result.state.players[ownerSeat].hand.length).toBe(handBefore + 1);
    expect(result.state.players[ownerSeat].deck.some((c) => c.cardId === "TEST_DPP")).toBe(false);
    expect(result.state.players[ownerSeat].deck.some((c) => c.cardId === "TEST_PLAIN")).toBe(true);
  });

  it("is a no-op when the owner's deck has no matching card", () => {
    const state = startMatch(20260631);
    const attackerSeat = state.turn.activeSeat;
    const ownerSeat = opponentOf(attackerSeat);

    state.players[ownerSeat].board = [
      minion("lu", ownerSeat, {
        canAttack: false,
        keywords: {
          deathrattle: {
            type: "ADD_RANDOM_CATEGORY_FROM_DECK",
            poolCardType: "MINION",
            target_category_includes: "民進黨政治人物"
          }
        }
      })
    ];
    state.players[attackerSeat].board = [minion("killer", attackerSeat, { attack: 1, health: 2, currentHealth: 2 })];
    state.players[ownerSeat].deck = [createRuntimeCard(plainDef, ownerSeat, nextInstanceId(state, "card"))];
    const handBefore = state.players[ownerSeat].hand.length;

    const result = reduce(
      state,
      { commandId: "dr2", seat: attackerSeat, nowMs: 2000, command: { type: "attack", attackerInstanceId: "killer", target: { type: "MINION", side: ownerSeat, instanceId: "lu" } } },
      CARD_CATALOG
    );

    expect(result.state.players[ownerSeat].board).toHaveLength(0);
    expect(result.state.players[ownerSeat].hand.length).toBe(handBefore);
    expect(result.state.pendingPrompt).toBeUndefined();
  });
});
