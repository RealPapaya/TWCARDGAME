import { AMPLIFICATION_DB, CARD_CATALOG, CARD_CATALOG_VERSION, type AmplificationDbEntry } from "@twcardgame/cards";
import type { CommandEnvelope, Seat } from "@twcardgame/shared";
import { describe, expect, it } from "vitest";
import { createInitialMatch, reduce } from "./engine.js";
import { applyAugmentSelection, applyDamage, applyPersistentMinionAugments, drawCards, resolveDeaths, resolveEffect, startTurn } from "./effects.js";
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
  it("發票中200 grants a crystal and raises the crystal cap immediately", () => {
    const state = startInProgress(1);
    const seat = state.turn.activeSeat;
    const before = state.players[seat].mana.current;
    const beforeMax = state.players[seat].mana.max;
    applyAugmentSelection(state, seat, entry("AMP_INVOICE_200"), []);
    expect(state.players[seat].mana.current).toBe(before + 1);
    expect(state.players[seat].mana.max).toBe(beforeMax + 1);
    expect(state.players[seat].augmentFlags.manaCapBonus).toBe(1);
  });

  it("invoice crystal cap bonuses match each invoice tier and persist into future turns", () => {
    const cases = [
      ["AMP_INVOICE_200", 1],
      ["AMP_INVOICE_1000", 2],
      ["AMP_JACKPOT", 3]
    ] as const;

    for (const [augmentId, crystals] of cases) {
      const state = startInProgress(100 + crystals);
      const seat = state.turn.activeSeat;
      const player = state.players[seat];
      player.deck = [];
      player.mana.current = 10;
      player.mana.max = 10;

      applyAugmentSelection(state, seat, entry(augmentId), []);
      expect(player.mana.current).toBe(10 + crystals);
      expect(player.mana.max).toBe(10 + crystals);
      expect(player.augmentFlags.manaCapBonus).toBe(crystals);

      startTurn(state, 3000 + crystals, []);
      expect(player.mana.max).toBe(10 + crystals);
      expect(player.mana.current).toBe(10 + crystals);
    }
  });

  it("跳樓大拍賣 sets current hand to cost 1 but leaves future draws untouched", () => {
    const state = startInProgress(2);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    const deckCard = player.deck[0];
    const deckPrinted = deckCard.cost;
    applyAugmentSelection(state, seat, entry("AMP_FIRE_SALE"), []);
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

describe("betel nut effects", () => {
  it("adds three S029 cards when the labor mid-tier augment is selected", () => {
    const state = startInProgress(17);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    player.hand = [];
    applyAugmentSelection(state, seat, entry("AMP_BETEL_NUT_500"), []);
    expect(player.hand).toHaveLength(3);
    expect(player.hand.every((card) => card.cardId === "S029")).toBe(true);
  });

  it("fully heals and grants health, with an attack bonus for labor minions", () => {
    const state = startInProgress(18);
    const seat = state.turn.activeSeat;
    const minion = makeMinion({ instanceId: "betel-labor", category: "勞工", attack: 2, health: 5, currentHealth: 1 });
    state.players[seat].board = [minion];

    resolveEffect(
      {
        type: "FULL_HEAL_BUFF_TARGET_CATEGORY_BONUS",
        value: 3,
        bonus_value: 3,
        target_category_includes: "勞工"
      },
      {
        state,
        activeSeat: seat,
        target: { type: "MINION", side: seat, instanceId: minion.instanceId },
        events: [],
        catalog: catalogMap
      }
    );

    expect(minion.attack).toBe(5);
    expect(minion.health).toBe(8);
    expect(minion.currentHealth).toBe(8);
  });

  it("does not grant the attack bonus to non-labor minions", () => {
    const state = startInProgress(19);
    const seat = state.turn.activeSeat;
    const minion = makeMinion({ instanceId: "betel-other", category: "學生", attack: 2, health: 5, currentHealth: 1 });
    state.players[seat].board = [minion];

    resolveEffect(
      {
        type: "FULL_HEAL_BUFF_TARGET_CATEGORY_BONUS",
        value: 3,
        bonus_value: 3,
        target_category_includes: "勞工"
      },
      {
        state,
        activeSeat: seat,
        target: { type: "MINION", side: seat, instanceId: minion.instanceId },
        events: [],
        catalog: catalogMap
      }
    );

    expect(minion.attack).toBe(2);
    expect(minion.health).toBe(8);
    expect(minion.currentHealth).toBe(8);
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
    expect(entry("AMP_BEGGAR_HERO").tier).toBe("穩穩仔賺");
    state.turn.number = 8;
    expect(getCardActualCost(state, seat, makeCard({ type: "MINION", cost: 10 }))).toBe(10);
    state.turn.number = 9;
    expect(getCardActualCost(state, seat, makeCard({ type: "MINION", cost: 10 }))).toBe(7);
  });

  it("台股四萬點 no longer snapshots hand costs", () => {
    const state = startInProgress(20);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    const handCosts = player.hand.map((card) => card.cost);
    applyAugmentSelection(state, seat, entry("AMP_TW_40000"), []);
    expect(player.hand.map((card) => card.cost)).toEqual(handCosts);
  });
});

describe("augment mana ramp", () => {
  it("定期定額 starts +2 mana growth on global turn 10 and caps at 15", () => {
    const state = startInProgress(21);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    applyAugmentSelection(state, seat, entry("AMP_DCA"), []);

    player.mana.max = 9;
    state.turn.number = 8;
    startTurn(state, 2000, []);
    expect(state.turn.number).toBe(9);
    expect(player.mana.max).toBe(10);

    player.mana.max = 9;
    state.turn.number = 9;
    startTurn(state, 3000, []);
    expect(state.turn.number).toBe(10);
    expect(player.mana.max).toBe(11);

    player.mana.max = 14;
    state.turn.number = 10;
    startTurn(state, 4000, []);
    expect(player.mana.max).toBe(15);
  });

  it("壽險理賠 permanently unlocks cap 20 once hero HP is <= 5", () => {
    const state = startInProgress(22);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    applyAugmentSelection(state, seat, entry("AMP_LIFE_INSURANCE"), []);

    player.hero.hp = 6;
    applyDamage(state, { owner: player, kind: "HERO", unit: player.hero }, 1, []);
    expect(player.augmentFlags.lowHpManaCapUnlocked).toBe(true);
    player.hero.hp = 30;
    player.mana.max = 10;
    state.turn.number = 10;
    startTurn(state, 2000, []);
    expect(player.augmentFlags.lowHpManaCapUnlocked).toBe(true);
    expect(player.mana.max).toBe(11);

    player.mana.max = 19;
    state.turn.number = 11;
    startTurn(state, 3000, []);
    expect(player.mana.max).toBe(20);

    state.turn.number = 12;
    startTurn(state, 4000, []);
    expect(player.mana.max).toBe(20);
  });

  it("台股四萬點 starts +2 mana growth on global turn 20 and caps at 30", () => {
    const state = startInProgress(23);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    applyAugmentSelection(state, seat, entry("AMP_TW_40000"), []);

    player.mana.max = 10;
    state.turn.number = 18;
    startTurn(state, 2000, []);
    expect(state.turn.number).toBe(19);
    expect(player.mana.max).toBe(10);

    state.turn.number = 19;
    startTurn(state, 3000, []);
    expect(state.turn.number).toBe(20);
    expect(player.mana.max).toBe(12);

    player.mana.max = 29;
    state.turn.number = 20;
    startTurn(state, 4000, []);
    expect(player.mana.max).toBe(30);
  });

  it("multiple active mana ramps use highest cap and highest growth without stacking growth", () => {
    const state = startInProgress(24);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    applyAugmentSelection(state, seat, entry("AMP_DCA"), []);
    applyAugmentSelection(state, seat, entry("AMP_TW_40000"), []);

    player.mana.max = 10;
    state.turn.number = 19;
    startTurn(state, 2000, []);
    expect(player.mana.max).toBe(12);
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

  it("要拚 grants one extra reroll for the next amplification phase", () => {
    const state = startInProgress(31);
    const seat = state.turn.activeSeat;
    applyAugmentSelection(state, seat, entry("AMP_GO_FOR_BROKE"), []);
    expect(state.players[seat].augmentFlags.extraAmplificationRerollsNextPhase).toBe(1);
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
    state.augmentTiers = ["加減賺", "穩穩仔賺"];
    applyAugmentSelection(state, seat, entry("AMP_0050"), []);
    expect(state.augmentTiers[1]).toBe("卯死");
    state.augmentTiers = ["加減賺", "卯死"];
    applyAugmentSelection(state, seat, entry("AMP_0050"), []);
    expect(state.augmentTiers[1]).toBe("卯死");
  });
});

describe("destroyed-minion cost rebate augment", () => {
  it("grants the printed cost of any destroyed minion to the augment holder", () => {
    const state = startInProgress(32);
    const seat = state.turn.activeSeat;
    const oppSeat: Seat = seat === "player1" ? "player2" : "player1";
    const printed = CARD_CATALOG.find((card) => card.type === "MINION" && card.cost > 1);
    if (!printed || printed.attack === undefined || printed.health === undefined) throw new Error("missing nonzero-cost minion");
    const player = state.players[seat];
    player.mana.current = 0;
    applyAugmentSelection(state, seat, entry("AMP_VENDOR_KICKBACK"), []);

    state.players[oppSeat].board = [
      makeMinion({
        instanceId: "rebate-enemy",
        ownerSeat: oppSeat,
        cardId: printed.id,
        name: printed.name,
        category: printed.category,
        cost: 0,
        attack: printed.attack,
        baseAttack: printed.attack,
        health: printed.health,
        currentHealth: 0
      })
    ];

    const events: any[] = [];
    resolveDeaths(state, events, catalogMap);

    expect(player.mana.current).toBe(printed.cost);
    expect(events.some((event) => event.type === "AUGMENT_TRIGGERED" && event.payload?.augmentId === "AMP_VENDOR_KICKBACK")).toBe(true);
  });

  it("can pay both players and gives no crystals for a printed 0-cost minion", () => {
    const state = startInProgress(33);
    const zero = {
      id: "TEST_ZERO_MINION",
      name: "Zero",
      category: "測試",
      cost: 0,
      attack: 1,
      health: 1,
      type: "MINION" as const,
      rarity: "COMMON" as const,
      description: "",
      image: "",
      keywords: {}
    };
    const localCatalog = new Map(catalogMap);
    localCatalog.set(zero.id, zero);
    state.players.player1.mana.current = 0;
    state.players.player2.mana.current = 0;
    applyAugmentSelection(state, "player1", entry("AMP_VENDOR_KICKBACK"), []);
    applyAugmentSelection(state, "player2", entry("AMP_VENDOR_KICKBACK"), []);
    state.players.player1.board = [
      makeMinion({
        instanceId: "rebate-zero",
        cardId: zero.id,
        name: zero.name,
        category: zero.category,
        cost: 8,
        attack: zero.attack,
        baseAttack: zero.attack,
        health: zero.health,
        currentHealth: 0
      })
    ];

    resolveDeaths(state, [], localCatalog);

    expect(state.players.player1.mana.current).toBe(0);
    expect(state.players.player2.mana.current).toBe(0);
  });
});

describe("new hero and resource augments", () => {
  it("raises hero max HP without healing current HP", () => {
    const state = startInProgress(25);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    player.hero.hp = 12;
    const initialMax = player.hero.maxHp;

    applyAugmentSelection(state, seat, entry("AMP_VILLAGE_LUNCHBOX"), []);
    applyAugmentSelection(state, seat, entry("AMP_PARTY_ASSET_SUPPLEMENT"), []);
    applyAugmentSelection(state, seat, entry("AMP_ONE_PARTY_DOMINANCE"), []);

    expect(player.hero.maxHp).toBe(initialMax + 35);
    expect(player.hero.hp).toBe(12);
  });

  it("loses 5 HP now and grants 5 current crystals at the start of the next own turn", () => {
    const state = startInProgress(26);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    player.hero.hp = 20;
    player.deck = [];
    player.mana.max = 4;
    player.mana.current = 0;

    applyAugmentSelection(state, seat, entry("AMP_BLOOD_DONATION_VOUCHER"), []);
    expect(player.hero.hp).toBe(15);
    expect(player.augmentFlags.bonusCrystalsNextTurn).toBe(5);

    startTurn(state, 2000, []);
    expect(player.mana.max).toBe(5);
    expect(player.mana.current).toBe(10);
    expect(player.augmentFlags.bonusCrystalsNextTurn).toBeUndefined();
  });

  it("pays card costs with HP on the next own turn and can pay lethal HP", () => {
    const state = startInProgress(27);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    player.hand = [makeCard({ instanceId: "health-pay-lethal", cost: 3, keywords: {} })];
    player.deck = [];
    player.hero.hp = 3;
    player.mana.max = 0;
    player.mana.current = 0;

    applyAugmentSelection(state, seat, entry("AMP_TAIJI_ELECTRIC_OFFER"), []);
    expect(legalMoves(state, seat).some((move) => move.type === "playCard")).toBe(false);

    startTurn(state, 2000, []);
    expect(player.augmentFlags.payCostWithHealthThisTurn).toBe(true);
    expect(legalMoves(state, seat).some((move) => move.type === "playCard")).toBe(true);

    const played = reduce(state, env(seat, { type: "playCard", handInstanceId: "health-pay-lethal" }), CARD_CATALOG).state;
    expect(played.players[seat].hero.hp).toBe(0);
    expect(played.players[seat].mana.current).toBe(1);
    expect(played.status).toBe("finished");
  });

  it("clears HP payment when the affected turn ends", () => {
    const state = startInProgress(28);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    player.hand = [makeCard({ instanceId: "health-pay-once", cost: 3, keywords: {} })];
    player.deck = [];
    player.hero.hp = 10;
    player.mana.max = 0;
    player.mana.current = 0;

    applyAugmentSelection(state, seat, entry("AMP_TAIJI_ELECTRIC_OFFER"), []);
    startTurn(state, 2000, []);
    const played = reduce(state, env(seat, { type: "playCard", handInstanceId: "health-pay-once" }), CARD_CATALOG).state;
    expect(played.players[seat].augmentFlags.payCostWithHealthThisTurn).toBe(true);

    const ended = reduce(played, env(seat, { type: "endTurn" }), CARD_CATALOG).state;
    expect(ended.players[seat].augmentFlags.payCostWithHealthThisTurn).toBe(false);
  });
});

describe("new bounce-buff augments", () => {
  it("流水席 stacks its +1/+1 separately from the card's existing bounce bonus", () => {
    const state = startInProgress(29);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    const original = CARD_CATALOG.find((card) => card.id === "TW032");
    if (!original || original.type !== "MINION") throw new Error("missing TW032");
    player.hand = [];
    player.board = [
      makeMinion({
        instanceId: "banquet-bounce",
        cardId: original.id,
        name: original.name,
        category: original.category,
        cost: original.cost,
        attack: original.attack,
        baseAttack: original.attack,
        health: original.health,
        currentHealth: original.health,
        bounce_bonus: original.bounce_bonus
      })
    ];

    applyAugmentSelection(state, seat, entry("AMP_BANQUET"), []);

    expect(player.board).toHaveLength(0);
    expect(player.hand).toHaveLength(1);
    expect(player.hand[0].attack).toBe((original.attack ?? 0) + (original.bounce_bonus ?? 0) + 1);
    expect(player.hand[0].health).toBe((original.health ?? 0) + (original.bounce_bonus ?? 0) + 1);
    expect(player.hand[0].cost).toBe(original.cost);
  });

  it("國定假日 stacks +2/+2 after bounce bonus and reduces returned cost by 1", () => {
    const state = startInProgress(30);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    const original = CARD_CATALOG.find((card) => card.id === "TW032");
    if (!original || original.type !== "MINION") throw new Error("missing TW032");
    player.hand = [];
    player.board = [
      makeMinion({
        instanceId: "holiday-bounce",
        cardId: original.id,
        name: original.name,
        category: original.category,
        cost: original.cost,
        attack: original.attack,
        baseAttack: original.attack,
        health: original.health,
        currentHealth: original.health,
        bounce_bonus: original.bounce_bonus
      })
    ];

    applyAugmentSelection(state, seat, entry("AMP_NATIONAL_HOLIDAY"), []);

    expect(player.board).toHaveLength(0);
    expect(player.hand).toHaveLength(1);
    expect(player.hand[0].attack).toBe((original.attack ?? 0) + (original.bounce_bonus ?? 0) + 2);
    expect(player.hand[0].health).toBe((original.health ?? 0) + (original.bounce_bonus ?? 0) + 2);
    expect(player.hand[0].cost).toBe(Math.max(0, original.cost - 1));
    expect(player.hand[0].isReduced).toBe(true);
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
