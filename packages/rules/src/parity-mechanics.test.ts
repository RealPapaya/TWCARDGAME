import { CARD_CATALOG, CARD_CATALOG_VERSION, type CardDefinition } from "@twcardgame/cards";
import type { GameEvent, Seat, TargetRef } from "@twcardgame/shared";
import { describe, expect, it } from "vitest";
import {
  applyDamage,
  createInitialMatch,
  createMinionFromCard,
  createRuntimeCard,
  nextInstanceId,
  reduce,
  toHandView,
  updateAuras
} from "./index.js";
import type { MatchState, RuntimeMinion } from "./types.js";

const DIRECT_CARD_COVERAGE = new Set([
  "TW028",
  "TW036",
  "TW037",
  "TW038",
  "TW040",
  "TW044",
  "TW045",
  "TW046",
  "TW051",
  "TW052",
  "TW055",
  "TW061",
  "TW062",
  "TW063",
  "TW066",
  "TW071",
  "TW077",
  "S001",
  "S006",
  "S007",
  "S009",
  "S011",
  "S022"
]);

const EFFECT_FAMILY_COVERAGE = new Set([
  "ADD_CARD_TO_HAND",
  "ADJACENT_BUFF_CATEGORY_ATTRS",
  "ADJACENT_BUFF_STATS",
  "BOUNCE",
  "BOUNCE_ALL_CATEGORY",
  "BOUNCE_ALL_ENEMY",
  "BOUNCE_CATEGORY",
  "BOUNCE_RANDOM_ENEMY",
  "BOUNCE_SELF",
  "BOUNCE_TARGET",
  "BUFF_ADJACENT",
  "BUFF_ALL",
  "BUFF_CATEGORY",
  "BUFF_HEALTH_AND_TAUNT_TARGET",
  "BUFF_STAT_TARGET_CATEGORY_BONUS",
  "BUFF_STAT_TARGET_TEMP",
  "DAMAGE",
  "DAMAGE_ALL_ENEMY_MINIONS",
  "DAMAGE_ALL_NON_CATEGORIES",
  "DAMAGE_AND_DRAW_IF_KILL",
  "DAMAGE_NON_CATEGORY",
  "DAMAGE_RANDOM_FRIENDLY",
  "DAMAGE_SELF",
  "DESTROY",
  "DESTROY_ALL_MINIONS",
  "DESTROY_DAMAGED",
  "DESTROY_HIGH_ATTACK",
  "DESTROY_LOCKED",
  "DESTROY_LOW_ATTACK",
  "DISCARD_DRAW",
  "DISCARD_RANDOM",
  "DRAW",
  "DRAW_MINION_REDUCE_COST",
  "DRAW_NEWS",
  "EAT_FRIENDLY",
  "ENRAGE",
  "FULL_HEAL",
  "FULL_HEAL_AND_DRAW",
  "FULL_HEAL_BUFF_TARGET_CATEGORY_BONUS",
  "GIVE_DIVINE_SHIELD",
  "GIVE_DIVINE_SHIELD_CATEGORY",
  "GIVE_KEYWORD_ADJACENT",
  "HEAL",
  "HEAL_ALL_FRIENDLY",
  "HEAL_CATEGORY_BONUS",
  "LOCK_ALL_AND_BUFF_CATEGORY",
  "LOCK_ALL_ENEMY",
  "LOCK_ATTACK",
  "LOCK_SELF",
  "MULTI_DAMAGE",
  "NEWS_POWER",
  "ON_DISCARD",
  "ON_DISCARD_CARD",
  "ON_PLAY_NEWS",
  "QUEST",
  "REDUCE_COST_ALL_HAND",
  "REDUCE_NEWS_COST",
  "SET_ATTACK_ALL",
  "SET_DEATH_TIMER",
  "SUMMON",
  "SUMMON_MULTIPLE",
  "SWAP_ATTACK_HEALTH",
  "UNLOCK_AND_BUFF_HEALTH"
]);

describe("phase 2 parity mechanics", () => {
  it("BOUNCE_SELF deathrattle returns the original catalog card, not damaged runtime stats", () => {
    const { state } = parityMatch();
    const seat = state.turn.activeSeat;
    const foe = enemy(seat);
    const source = placeMinion(state, foe, "TW036", { attack: 7, health: 7, currentHealth: 2 });
    const before = state.players[foe].hand.length;

    const next = playCard(state, "S006", { type: "MINION", side: foe, instanceId: source.instanceId }).state;
    const returned = next.players[foe].hand.find((card) => card.cardId === "TW036");
    const original = card("TW036");

    expect(next.players[foe].board.some((minion) => minion.instanceId === source.instanceId)).toBe(false);
    expect(next.players[foe].hand.length).toBe(before + 1);
    expect(returned?.attack).toBe(original.attack);
    expect(returned?.health).toBe(original.health);
  });

  it("SUMMON and DRAW deathrattles resolve from lethal damage", () => {
    const summonMatch = parityMatch();
    const summonSeat = summonMatch.state.turn.activeSeat;
    const summonFoe = enemy(summonSeat);
    const chen = placeMinion(summonMatch.state, summonFoe, "TW061", { currentHealth: 3 });

    const afterSummon = playCard(summonMatch.state, "S020", { type: "MINION", side: summonFoe, instanceId: chen.instanceId }).state;
    expect(afterSummon.players[summonFoe].board.map((minion) => minion.cardId)).toContain("TW062");

    const drawMatch = parityMatch();
    const drawSeat = drawMatch.state.turn.activeSeat;
    const drawFoe = enemy(drawSeat);
    const veteran = placeMinion(drawMatch.state, drawFoe, "TW037", { currentHealth: 1 });
    const beforeHand = drawMatch.state.players[drawFoe].hand.length;
    const beforeDeck = drawMatch.state.players[drawFoe].deck.length;

    const afterDraw = playCard(drawMatch.state, "S006", { type: "MINION", side: drawFoe, instanceId: veteran.instanceId }).state;
    expect(afterDraw.players[drawFoe].hand.length).toBe(beforeHand + 2);
    expect(afterDraw.players[drawFoe].deck.length).toBe(beforeDeck - 2);
  });

  it("divine shield prevents lethal damage and delays deathrattle resolution until a later hit", () => {
    const { state } = parityMatch();
    const seat = state.turn.activeSeat;
    const foe = enemy(seat);
    const shielded = placeMinion(state, foe, "TW061", { currentHealth: 1 });
    shielded.keywords.divineShield = true;

    const afterShield = playCard(state, "S006", { type: "MINION", side: foe, instanceId: shielded.instanceId }, "shield-pop").state;
    const survived = afterShield.players[foe].board.find((minion) => minion.instanceId === shielded.instanceId)!;

    expect(survived.currentHealth).toBe(1);
    expect(survived.keywords.divineShield).toBe(false);
    expect(afterShield.players[foe].board.map((minion) => minion.cardId)).not.toContain("TW062");

    const afterLethal = playCard(afterShield, "S006", { type: "MINION", side: foe, instanceId: shielded.instanceId }, "shield-lethal").state;
    expect(afterLethal.players[foe].board.some((minion) => minion.instanceId === shielded.instanceId)).toBe(false);
    expect(afterLethal.players[foe].board.map((minion) => minion.cardId)).toContain("TW062");
  });

  it("bounce returns a fresh catalog card instead of damaged or buffed board stats", () => {
    const { state } = parityMatch();
    const seat = state.turn.activeSeat;
    const foe = enemy(seat);
    const altered = placeMinion(state, foe, "TW002", { attack: 9, health: 9, currentHealth: 1 });
    const beforeHand = state.players[foe].hand.length;

    const next = playCard(state, "TW031", { type: "MINION", side: foe, instanceId: altered.instanceId }, "bounce-reset").state;
    const returned = next.players[foe].hand.find((handCard) => handCard.cardId === "TW002");
    const original = card("TW002");

    expect(next.players[foe].board.some((minion) => minion.instanceId === altered.instanceId)).toBe(false);
    expect(next.players[foe].hand.length).toBe(beforeHand + 1);
    expect(returned?.attack).toBe(original.attack);
    expect(returned?.health).toBe(original.health);
  });

  it("ongoing adjacent auras apply, remove cleanly, and clamp health", () => {
    const { state } = parityMatch();
    const seat = state.turn.activeSeat;
    const left = placeMinion(state, seat, "TW016", { currentHealth: 3 });
    const statAura = placeMinion(state, seat, "TW028");
    const right = placeMinion(state, seat, "TW002", { currentHealth: 1 });

    updateAuras(state, []);
    expect(left.attack).toBe(card("TW016").attack! + 1);
    expect(left.health).toBe(card("TW016").health! + 1);
    expect(right.attack).toBe(card("TW002").attack! + 1);

    state.players[seat].board = [left, right];
    updateAuras(state, []);
    expect(left.attack).toBe(card("TW016").attack);
    expect(left.health).toBe(card("TW016").health);
    expect(right.currentHealth).toBeLessThanOrEqual(right.health);
    expect(statAura.cardId).toBe("TW028");
  });

  it("category aura grants and removes only aura taunt", () => {
    const { state } = parityMatch();
    const seat = state.turn.activeSeat;
    const source = placeMinion(state, seat, "TW055");
    const target = placeMinion(state, seat, "TW016");

    updateAuras(state, []);
    expect(target.keywords.taunt).toBe(true);
    expect(target.health).toBe(card("TW016").health! + 1);

    state.players[seat].board = [target];
    updateAuras(state, []);
    expect(target.keywords.taunt).toBe(false);
    expect(target.health).toBe(card("TW016").health);
    expect(source.cardId).toBe("TW055");
  });

  it("REDUCE_NEWS_COST ongoing effects affect NEWS hand view and payment only", () => {
    const { state } = parityMatch();
    const seat = state.turn.activeSeat;
    placeMinion(state, seat, "TW052");
    placeMinion(state, seat, "TW050");
    const news = putInHand(state, seat, "S006");

    expect(toHandView(state, seat).find((view) => view.instanceId === news.instanceId)?.cost).toBe(0);
    const beforeMana = state.players[seat].mana.current;
    const next = reduce(state, envelope(state, seat, "news-cost", { type: "playCard", handInstanceId: news.instanceId, target: { type: "HERO", side: enemy(seat) } }), CARD_CATALOG).state;

    expect(next.players[seat].mana.current).toBe(beforeMana);
  });

  it("enrage toggles on damage and heal without drifting attack", () => {
    const { state } = parityMatch();
    const seat = state.turn.activeSeat;
    const minion = placeMinion(state, seat, "TW027");
    const events: GameEvent[] = [];

    applyDamage(state, { owner: state.players[seat], kind: "MINION", unit: minion }, 1, events);
    expect(minion.isEnraged).toBe(true);
    expect(minion.attack).toBe(card("TW027").attack! + card("TW027").keywords!.enrage!.value!);

    const next = playCard(state, "TW019", { type: "MINION", side: seat, instanceId: minion.instanceId }).state;
    const healed = next.players[seat].board.find((boardMinion) => boardMinion.instanceId === minion.instanceId)!;
    expect(healed.isEnraged).toBe(false);
    expect(healed.attack).toBe(card("TW027").attack);
  });

  it("temporary buffs clean up without drifting aura or enrage stats", () => {
    const { state } = parityMatch();
    const seat = state.turn.activeSeat;
    const target = placeMinion(state, seat, "TW027", { currentHealth: card("TW027").health! - 1 });
    placeMinion(state, seat, "TW028");
    updateAuras(state, []);

    expect(target.isEnraged).toBe(true);
    expect(target.attack).toBe(card("TW027").attack! + 1 + card("TW027").keywords!.enrage!.value!);
    expect(target.health).toBe(card("TW027").health! + 1);

    const buffed = playCard(state, "S004", { type: "MINION", side: seat, instanceId: target.instanceId }, "temp-buff-aura-enrage").state;
    const buffedTarget = buffed.players[seat].board.find((minion) => minion.instanceId === target.instanceId)!;
    expect(buffedTarget.attack).toBe(card("TW027").attack! + 1 + card("TW027").keywords!.enrage!.value! + 2);
    expect(buffedTarget.health).toBe(card("TW027").health! + 3);

    const afterEnd = endTurn(buffed, seat, "temp-buff-cleanup");
    const cleaned = afterEnd.players[seat].board.find((minion) => minion.instanceId === target.instanceId)!;
    expect(cleaned.attack).toBe(card("TW027").attack! + 1);
    expect(cleaned.health).toBe(card("TW027").health! + 1);
    expect(cleaned.currentHealth).toBeLessThanOrEqual(cleaned.health);
    expect(cleaned.tempBuffs).toEqual([]);
    expect(cleaned.auraAttack).toBe(1);
    expect(cleaned.auraHealth).toBe(1);
    expect(cleaned.isEnraged).toBe(false);
  });

  it("quests and timers advance at end of turn and resolve before the next turn starts", () => {
    const summonQuestMatch = parityMatch();
    const summonSeat = summonQuestMatch.state.turn.activeSeat;
    placeMinion(summonQuestMatch.state, summonSeat, "TW062", { questTurns: 3 });

    const afterSummonQuest = endTurn(summonQuestMatch.state, summonSeat, "quest-summon");
    expect(afterSummonQuest.players[summonSeat].board.map((minion) => minion.cardId)).toContain("TW061");
    expect(afterSummonQuest.players[summonSeat].board.map((minion) => minion.cardId)).not.toContain("TW062");

    const damageQuestMatch = parityMatch();
    const damageSeat = damageQuestMatch.state.turn.activeSeat;
    const damageFoe = enemy(damageSeat);
    placeMinion(damageQuestMatch.state, damageSeat, "TW063", { questTurns: 5 });
    placeMinion(damageQuestMatch.state, damageFoe, "TW002");

    const afterDamageQuest = endTurn(damageQuestMatch.state, damageSeat, "quest-damage");
    expect(afterDamageQuest.players[damageSeat].board).toHaveLength(0);
    expect(afterDamageQuest.players[damageFoe].board).toHaveLength(0);
  });

  it("lock and death timers count down on end turns", () => {
    const lockMatch = parityMatch();
    const lockSeat = lockMatch.state.turn.activeSeat;
    const target = placeMinion(lockMatch.state, lockSeat, "TW002", { sleeping: false, canAttack: true });
    const locked = playCard(lockMatch.state, "S022", { type: "MINION", side: lockSeat, instanceId: target.instanceId }).state;
    const lockedTarget = locked.players[lockSeat].board.find((minion) => minion.instanceId === target.instanceId)!;
    expect(lockedTarget.lockedTurns).toBe(2);

    const afterOneEnd = endTurn(locked, lockSeat, "lock-end-1");
    expect(afterOneEnd.players[lockSeat].board.find((minion) => minion.instanceId === target.instanceId)?.lockedTurns).toBe(1);
    const afterTwoEnds = endTurn(afterOneEnd, afterOneEnd.turn.activeSeat, "lock-end-2");
    const unlocked = afterTwoEnds.players[lockSeat].board.find((minion) => minion.instanceId === target.instanceId)!;
    expect(unlocked.lockedTurns).toBe(0);
    expect(unlocked.canAttack).toBe(true);

    const deathMatch = parityMatch();
    const deathSeat = deathMatch.state.turn.activeSeat;
    const deathFoe = enemy(deathSeat);
    const doomed = placeMinion(deathMatch.state, deathFoe, "TW002");
    let timed = playCard(deathMatch.state, "TW071", { type: "MINION", side: deathFoe, instanceId: doomed.instanceId }).state;
    expect(timed.players[deathFoe].board[0]!.deathTimer).toBe(3);
    timed = endTurn(timed, deathSeat, "death-end-1");
    timed = endTurn(timed, timed.turn.activeSeat, "death-end-2");
    timed = endTurn(timed, timed.turn.activeSeat, "death-end-3");
    expect(timed.players[deathFoe].board.some((minion) => minion.instanceId === doomed.instanceId)).toBe(false);
  });

  it("discard and NEWS-play triggers resolve from real catalog cards", () => {
    const discardMatch = parityMatch();
    const discardSeat = discardMatch.state.turn.activeSeat;
    const fu = placeMinion(discardMatch.state, discardSeat, "TW038");
    discardMatch.state.players[discardSeat].hand = [];
    putInHand(discardMatch.state, discardSeat, "S009");
    putInHand(discardMatch.state, discardSeat, "TW040");

    const afterDiscard = reduce(
      discardMatch.state,
      envelope(discardMatch.state, discardSeat, "discard-trigger", { type: "playCard", handInstanceId: discardMatch.state.players[discardSeat].hand[0]!.instanceId }),
      CARD_CATALOG
    ).state;
    const buffedFu = afterDiscard.players[discardSeat].board.find((minion) => minion.instanceId === fu.instanceId)!;
    expect(buffedFu.attack).toBe(card("TW038").attack! + 2);
    expect(afterDiscard.players[discardSeat].board.map((minion) => minion.cardId)).toContain("TW040");

    const newsMatch = parityMatch();
    const newsSeat = newsMatch.state.turn.activeSeat;
    const attackTrigger = placeMinion(newsMatch.state, newsSeat, "TW051");
    const healTrigger = placeMinion(newsMatch.state, newsSeat, "TW066", { currentHealth: 2 });
    const afterNews = playCard(newsMatch.state, "S001").state;
    const attackAfter = afterNews.players[newsSeat].board.find((minion) => minion.instanceId === attackTrigger.instanceId)!;
    const healAfter = afterNews.players[newsSeat].board.find((minion) => minion.instanceId === healTrigger.instanceId)!;

    expect(attackAfter.attack).toBe(card("TW051").attack! + 1);
    expect(healAfter.currentHealth).toBe(4);
  });

  it("newsPower modifies only NEWS damage and heal values, including category bonus values", () => {
    const { state } = parityMatch();
    const seat = state.turn.activeSeat;
    const foe = enemy(seat);
    placeMinion(state, seat, "TW044");
    const healTarget = placeMinion(state, seat, "TW045", { health: 20, currentHealth: 1 });
    placeMinion(state, seat, "TW046");

    const damageResult = playCard(state, "S006", { type: "HERO", side: foe }, "news-power-damage");
    const damagePlayEvent = damageResult.events.find((event) => event.type === "CARD_PLAYED");
    expect(damagePlayEvent?.payload?.baseEffectValue).toBe(3);
    expect(damagePlayEvent?.payload?.effectValue).toBe(11);
    const afterDamage = damageResult.state;
    expect(afterDamage.players[foe].hero.hp).toBe(19);

    const healResult = playCard(afterDamage, "S011", { type: "MINION", side: seat, instanceId: healTarget.instanceId }, "news-power-heal");
    const healPlayEvent = healResult.events.find((event) => event.type === "CARD_PLAYED");
    expect(healPlayEvent?.payload?.baseEffectValue).toBe(1);
    expect(healPlayEvent?.payload?.effectValue).toBe(9);
    expect(healPlayEvent?.payload?.baseEffectBonusValue).toBe(2);
    expect(healPlayEvent?.payload?.effectBonusValue).toBe(10);
    const afterHeal = healResult.state;
    const healed = afterHeal.players[seat].board.find((minion) => minion.instanceId === healTarget.instanceId)!;
    expect(healed.currentHealth).toBe(11);

    const afterDraw = playCard(afterHeal, "S001", undefined, "news-power-draw").state;
    expect(afterDraw.players[seat].hand.length).toBe(2);

    const reducedCard = putInHand(afterDraw, seat, "TW002");
    const reduceHand = putInHand(afterDraw, seat, "S007");
    const afterReduce = reduce(afterDraw, envelope(afterDraw, seat, "news-power-reduce", { type: "playCard", handInstanceId: reduceHand.instanceId }), CARD_CATALOG).state;
    expect(afterReduce.players[seat].hand.find((handCard) => handCard.instanceId === reducedCard.instanceId)?.cost).toBe(card("TW002").cost - 1);
  });

  it("every behavioral catalog card is covered by a direct test or an explicit effect-family test", () => {
    const uncovered = CARD_CATALOG.filter(hasBehavior).filter((catalogCard) => {
      if (DIRECT_CARD_COVERAGE.has(catalogCard.id)) return false;
      return behaviorKeys(catalogCard).some((key) => !EFFECT_FAMILY_COVERAGE.has(key));
    });

    expect(uncovered.map((catalogCard) => `${catalogCard.id}:${behaviorKeys(catalogCard).join(",")}`)).toEqual([]);
  });
});

function parityMatch(seed = 1234): { state: MatchState } {
  let state = createInitialMatch({
    matchId: `parity-${seed}`,
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed,
    nowMs: 1000,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: "p1", displayName: "P1", deckIds: legalDeckIds() },
      { seat: "player2", userId: "p2", displayName: "P2", deckIds: legalDeckIds() }
    ]
  }).state;
  state = reduce(state, envelope(state, "player1", "m1", { type: "submitMulligan", replaceHandInstanceIds: [] }), CARD_CATALOG).state;
  state = reduce(state, envelope(state, "player2", "m2", { type: "submitMulligan", replaceHandInstanceIds: [] }), CARD_CATALOG).state;
  state.players.player1.mana = { current: 10, max: 10 };
  state.players.player2.mana = { current: 10, max: 10 };
  return { state };
}

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((catalogCard) => catalogCard.rarity !== "LEGENDARY" && catalogCard.collectible !== false)
    .slice(0, 15)
    .flatMap((catalogCard) => [catalogCard.id, catalogCard.id]);
}

function card(id: string): CardDefinition {
  const found = CARD_CATALOG.find((catalogCard) => catalogCard.id === id);
  if (!found) throw new Error(`Missing test card ${id}`);
  return found;
}

function enemy(seat: Seat): Seat {
  return seat === "player1" ? "player2" : "player1";
}

function putInHand(state: MatchState, seat: Seat, cardId: string) {
  const runtime = createRuntimeCard(card(cardId), seat, nextInstanceId(state, "card"));
  state.players[seat].hand.push(runtime);
  return runtime;
}

function placeMinion(state: MatchState, seat: Seat, cardId: string, overrides: Partial<RuntimeMinion> = {}): RuntimeMinion {
  const runtime = createRuntimeCard(card(cardId), seat, nextInstanceId(state, "card"));
  const minion = createMinionFromCard(state, runtime, seat);
  Object.assign(minion, { sleeping: false, canAttack: true }, overrides);
  state.players[seat].board.push(minion);
  return minion;
}

function playCard(state: MatchState, cardId: string, target?: TargetRef, commandId = `play-${cardId}-${state.private.nextInstanceSeq}`) {
  const seat = state.turn.activeSeat;
  state.players[seat].hand = [];
  const runtime = putInHand(state, seat, cardId);
  return reduce(state, envelope(state, seat, commandId, { type: "playCard", handInstanceId: runtime.instanceId, target }), CARD_CATALOG);
}

function endTurn(state: MatchState, seat: Seat, commandId: string): MatchState {
  return reduce(state, envelope(state, seat, commandId, { type: "endTurn" }), CARD_CATALOG).state;
}

function envelope(state: MatchState, seat: Seat, commandId: string, command: Parameters<typeof reduce>[1]["command"]): Parameters<typeof reduce>[1] {
  return { commandId, seat, nowMs: state.turn.startedAtMs + state.turn.actionSeq + 100, command };
}

function hasBehavior(catalogCard: CardDefinition): boolean {
  return behaviorKeys(catalogCard).length > 0;
}

function behaviorKeys(catalogCard: CardDefinition): string[] {
  const keywords = catalogCard.keywords;
  if (!keywords) return [];
  return [
    keywords.battlecry?.type,
    keywords.deathrattle?.type,
    keywords.ongoing?.type,
    keywords.enrage ? "ENRAGE" : undefined,
    keywords.triggered?.type,
    keywords.quest ? "QUEST" : undefined,
    keywords.onDiscard ? "ON_DISCARD_CARD" : undefined,
    keywords.newsPower ? "NEWS_POWER" : undefined
  ].filter((key): key is string => !!key);
}
