import { CARD_CATALOG, CARD_CATALOG_VERSION, type CardDefinition } from "@twcardgame/cards";
import { describe, expect, it } from "vitest";
import { createRuntimeCard, effectHandlers, nextInstanceId, reduce, toHandView, toPublicState, validateDeck } from "./index.js";
import { createInitialMatch } from "./engine.js";
import type { MatchState } from "./types.js";

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
