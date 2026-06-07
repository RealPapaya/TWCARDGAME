import { AMPLIFICATION_DB, CARD_CATALOG, CARD_CATALOG_VERSION, type AmplificationDbEntry } from "@twcardgame/cards";
import type { CommandEnvelope, Seat } from "@twcardgame/shared";
import { describe, expect, it } from "vitest";
import { createInitialMatch, reduce } from "./engine.js";
import { applyAugmentSelection, applyDamage, applyPersistentMinionAugments, drawCards, resolveDeaths } from "./effects.js";
import { getCardActualCost } from "./state.js";
import { legalMoves } from "./legalMoves.js";
import type { MatchState, RuntimeCard, RuntimeMinion } from "./types.js";

const catalogMap = new Map(CARD_CATALOG.map((card) => [card.id, card]));

function entry(id: string): AmplificationDbEntry {
  const found = AMPLIFICATION_DB.find((augment) => augment.id === id);
  if (!found) throw new Error(`missing augment ${id}`);
  return found;
}

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

let cmdSeq = 0;
function env(seat: Seat, command: CommandEnvelope["command"]): CommandEnvelope {
  cmdSeq += 1;
  return { commandId: `aug-${cmdSeq}`, seat, nowMs: 1000 + cmdSeq, command };
}

function startInProgress(seed: number): MatchState {
  let state = createInitialMatch({
    matchId: `aug-${seed}`,
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

function makeCard(over: Partial<RuntimeCard>): RuntimeCard {
  return {
    instanceId: "card-t",
    cardId: "S001",
    ownerSeat: "player1",
    name: "測試",
    category: "新聞",
    cost: 5,
    type: "NEWS",
    rarity: "COMMON",
    description: "",
    image: "",
    keywords: {},
    ...over
  };
}

function makeMinion(over: Partial<RuntimeMinion>): RuntimeMinion {
  return {
    instanceId: "minion-t",
    cardId: "TW003",
    ownerSeat: "player1",
    name: "測試隨從",
    category: "勞工",
    cost: 2,
    type: "MINION",
    rarity: "COMMON",
    attack: 2,
    baseAttack: 2,
    health: 3,
    currentHealth: 3,
    keywords: {},
    sleeping: false,
    canAttack: true,
    isEnraged: false,
    lockedTurns: 0,
    auraAttack: 0,
    auraHealth: 0,
    auraTaunt: false,
    tempBuffs: [],
    ...over
  };
}

describe("augment one-shot grants & hand snapshots", () => {
  it("發票中200 grants a crystal immediately", () => {
    const state = startInProgress(1);
    const seat = state.turn.activeSeat;
    const before = state.players[seat].mana.current;
    applyAugmentSelection(state, seat, entry("AMP_INVOICE_200"), []);
    expect(state.players[seat].mana.current).toBe(before + 1);
  });

  it("台股四萬點 sets current hand to cost 1 but leaves future draws untouched", () => {
    const state = startInProgress(2);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    const deckCard = player.deck[0];
    const deckPrinted = deckCard.cost;
    applyAugmentSelection(state, seat, entry("AMP_TW_40000"), []);
    expect(player.hand.every((card) => getCardActualCost(state, seat, card) <= 1)).toBe(true);
    // A card still in the deck keeps its printed cost (snapshot is one-shot).
    expect(getCardActualCost(state, seat, deckCard)).toBe(deckPrinted);
  });

  it("股利分紅 reduces current hand cost by 2 (floored at 0)", () => {
    const state = startInProgress(3);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    const sample = player.hand[0];
    const printed = sample.cost;
    applyAugmentSelection(state, seat, entry("AMP_DIVIDEND"), []);
    expect(sample.cost).toBe(Math.max(0, printed - 2));
  });
});

describe("augment passive cost readers", () => {
  it("言論自由 reduces NEWS cost by 2 permanently", () => {
    const state = startInProgress(4);
    const seat = state.turn.activeSeat;
    applyAugmentSelection(state, seat, entry("AMP_FREE_SPEECH"), []);
    expect(getCardActualCost(state, seat, makeCard({ type: "NEWS", cost: 5 }))).toBe(3);
  });

  it("新青安 reduces 建築 cost by 4 permanently", () => {
    const state = startInProgress(5);
    const seat = state.turn.activeSeat;
    applyAugmentSelection(state, seat, entry("AMP_NEW_HOUSING"), []);
    expect(getCardActualCost(state, seat, makeCard({ type: "MINION", category: "建築", cost: 6 }))).toBe(2);
  });

  it("乞丐超人 applies ×0.7 (四捨五入) only after turn 8", () => {
    const state = startInProgress(6);
    const seat = state.turn.activeSeat;
    applyAugmentSelection(state, seat, entry("AMP_BEGGAR_HERO"), []);
    state.turn.number = 8;
    expect(getCardActualCost(state, seat, makeCard({ type: "MINION", cost: 10 }))).toBe(10);
    state.turn.number = 9;
    expect(getCardActualCost(state, seat, makeCard({ type: "MINION", cost: 10 }))).toBe(7);
  });
});

describe("augment combat / persistent effects", () => {
  it("減稅 reduces every hero damage instance by 1", () => {
    const state = startInProgress(7);
    const seat = state.turn.activeSeat;
    applyAugmentSelection(state, seat, entry("AMP_TAX_CUT"), []);
    const player = state.players[seat];
    const before = player.hero.hp;
    applyDamage(state, { owner: player, kind: "HERO", unit: player.hero }, 3, []);
    expect(player.hero.hp).toBe(before - 2);
  });

  it("颱風假 grants +1/+1 to a summoned 勞工 minion", () => {
    const state = startInProgress(8);
    const seat = state.turn.activeSeat;
    applyAugmentSelection(state, seat, entry("AMP_TYPHOON_DAY"), []);
    const minion = makeMinion({ category: "勞工", attack: 2, health: 3, currentHealth: 3 });
    applyPersistentMinionAugments(state, seat, minion, []);
    expect(minion.attack).toBe(3);
    expect(minion.health).toBe(4);
  });

  it("基本工資調漲 gives +2 attack only to printed-cost 1-3 minions", () => {
    const state = startInProgress(9);
    const seat = state.turn.activeSeat;
    applyAugmentSelection(state, seat, entry("AMP_MIN_WAGE"), []);
    const cheap = makeMinion({ cost: 2, attack: 1, health: 1, currentHealth: 1 });
    const pricey = makeMinion({ cost: 5, attack: 1, health: 1, currentHealth: 1 });
    applyPersistentMinionAugments(state, seat, cheap, []);
    applyPersistentMinionAugments(state, seat, pricey, []);
    expect(cheap.attack).toBe(3);
    expect(pricey.attack).toBe(1);
  });

  it("育兒津貼 gives a played minion +1 max health", () => {
    const state = startInProgress(10);
    const seat = state.turn.activeSeat;
    applyAugmentSelection(state, seat, entry("AMP_CHILDCARE"), []);
    const minion = makeMinion({ attack: 2, health: 2, currentHealth: 2 });
    applyPersistentMinionAugments(state, seat, minion, []);
    expect(minion.health).toBe(3);
    expect(minion.currentHealth).toBe(3);
  });

  it("島嶼天光 doubles 民進黨政治人物 minions' attack and health", () => {
    const state = startInProgress(11);
    const seat = state.turn.activeSeat;
    applyAugmentSelection(state, seat, entry("AMP_ISLAND_DAWN"), []);
    const dpp = makeMinion({ category: "民進黨政治人物", attack: 4, health: 6, currentHealth: 6 });
    applyPersistentMinionAugments(state, seat, dpp, []);
    expect(dpp.attack).toBe(8);
    expect(dpp.health).toBe(12);
  });
});

describe("augment triggers & meta", () => {
  it("股東紀念品 halves the next drawn card's cost once, then clears", () => {
    const state = startInProgress(12);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    applyAugmentSelection(state, seat, entry("AMP_SHAREHOLDER_GIFT"), []);
    const top = player.deck[0];
    const printed = top.cost;
    drawCards(state, player, 1, []);
    expect(top.cost).toBe(Math.floor(printed / 2));
    expect(player.augmentFlags.nextDrawHalfCost).toBe(false);
  });

  it("普渡 revives the owner's dead minion once as a 1/1, never twice", () => {
    const state = startInProgress(13);
    const seat = state.turn.activeSeat;
    applyAugmentSelection(state, seat, entry("AMP_PUDU"), []);
    state.players[seat].board.push(makeMinion({ instanceId: "d1", attack: 4, health: 4, currentHealth: 0 }));
    resolveDeaths(state, [], catalogMap);
    const board = state.players[seat].board;
    expect(board).toHaveLength(1);
    expect(board[0].attack).toBe(1);
    expect(board[0].health).toBe(1);
    expect(board[0].revivedByPurdo).toBe(true);
    // The revived 1/1 dying does not revive again.
    board[0].currentHealth = 0;
    resolveDeaths(state, [], catalogMap);
    expect(state.players[seat].board).toHaveLength(0);
  });

  it("0050 raises the second phase tier by one, capped at 卯死", () => {
    const state = startInProgress(14);
    const seat = state.turn.activeSeat;
    state.augmentTiers = ["加減賺", "吃紅"];
    applyAugmentSelection(state, seat, entry("AMP_0050"), []);
    expect(state.augmentTiers[1]).toBe("卯死");
    state.augmentTiers = ["加減賺", "卯死"];
    applyAugmentSelection(state, seat, entry("AMP_0050"), []);
    expect(state.augmentTiers[1]).toBe("卯死");
  });
});

describe("違約交割 freeze", () => {
  it("grants 10 crystals and limits the frozen seat to ending its turn", () => {
    const state = startInProgress(15);
    const seat = state.turn.activeSeat;
    applyAugmentSelection(state, seat, entry("AMP_DEFAULT_SETTLEMENT"), []);
    expect(state.players[seat].mana.current).toBeGreaterThanOrEqual(10);
    expect(state.players[seat].augmentFlags.frozenUntilTurn).toBe(state.turn.number + 10);
    expect(legalMoves(state, seat)).toEqual([{ type: "endTurn" }]);

    const handId = state.players[seat].hand[0]?.instanceId ?? "none";
    const played = reduce(state, env(seat, { type: "playCard", handInstanceId: handId }), CARD_CATALOG);
    expect(played.events.some((e) => e.type === "COMMAND_REJECTED")).toBe(true);
    // Ending the turn is still allowed.
    const ended = reduce(state, env(seat, { type: "endTurn" }), CARD_CATALOG);
    expect(ended.events.some((e) => e.type === "COMMAND_REJECTED")).toBe(false);
  });
});

describe("潛逃國外 referendum immunity", () => {
  it("exempts the immune seat from an environment cost penalty, not the opponent", () => {
    const state = startInProgress(16);
    const seat = state.turn.activeSeat;
    const oppSeat: Seat = seat === "player1" ? "player2" : "player1";
    applyAugmentSelection(state, seat, entry("AMP_FLEE_ABROAD"), []);
    state.currentEnvironment = {
      id: "VE_UTILITY_HIKE",
      name: "油電雙漲",
      appliedTurn: state.turn.number,
      expiresTurn: state.turn.number + 4,
      effect: { type: "ENV_COST_PLUS_CAPPED", value: 2 }
    };
    const card = makeCard({ type: "MINION", category: "勞工", cost: 5 });
    expect(getCardActualCost(state, seat, card)).toBe(5);
    expect(getCardActualCost(state, oppSeat, card)).toBe(7);
  });
});
