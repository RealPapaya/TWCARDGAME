import { CARD_CATALOG, CARD_CATALOG_VERSION, type CardDefinition } from "@twcardgame/cards";
import { describe, expect, it } from "vitest";
import { createRuntimeCard, effectHandlers, nextInstanceId, reduce, toHandView, toPublicState, validateDeck } from "./index.js";
import { createInitialMatch } from "./engine.js";
import type { MatchState } from "./types.js";
import { opponentOf, type Seat } from "@twcardgame/shared";

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

    const legendary = CARD_CATALOG.find((card) => card.rarity === "LEGENDARY");
    expect(legendary).toBeTruthy();
    const illegal = legal.slice(0, 28).concat(legendary!.id, legendary!.id);
    expect(validateDeck(illegal, CARD_CATALOG).valid).toBe(false);
  });

  it("does not expose hands or deck order through public state", () => {
    const { state } = createSeededMatch(1234);
    const publicState = toPublicState(state);

    expect(publicState.players.player1.handCount).toBe(3);
    expect("hand" in publicState.players.player1).toBe(false);
    expect("deck" in publicState.players.player1).toBe(false);
    expect(toHandView(state, "player1")).toHaveLength(3);
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
    expect(result.events.some((event) => event.type === "DAMAGE")).toBe(true);
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
});

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
    expect(result.events.some((e) => e.type === "COMMAND_REJECTED")).toBe(true);
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
    expect(result.events.some((e) => e.type === "COMMAND_REJECTED")).toBe(true);
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
    expect(result.events.some((e) => e.type === "COMMAND_REJECTED")).toBe(true);
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
    expect(result.events.some((e) => e.type === "COMMAND_REJECTED")).toBe(true);
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
    expect(result.events.some((e) => e.type === "COMMAND_REJECTED")).toBe(true);

    // Attack the taunt minion → accepted
    const result2 = reduce(
      state,
      { commandId: "tl7", seat, nowMs: 2000, command: { type: "attack", attackerInstanceId: "my_attacker", target: { type: "MINION", side: enemy, instanceId: "enemy_taunt" } } },
      catalog
    );
    expect(result2.events.some((e) => e.type === "COMMAND_REJECTED")).toBe(false);
  });
});
