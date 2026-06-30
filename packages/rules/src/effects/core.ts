import type { CardDefinition, EffectDefinition } from "@twcardgame/cards";
import { opponentOf, type Seat } from "@twcardgame/shared";
import { nextInt, shuffleInPlace } from "../rng.js";
import {
  activePlayer,
  addEvent,
  createCardForHand,
  createMinionFromCard,
  currentNewsPower,
  getTargetUnit,
  removeMinion
} from "../state.js";
import { turnTimeLimitForPlayer } from "../timing.js";
import type { EffectContext, MatchState, PlayerState, RuntimeCard, RuntimeMinion, TargetUnitRef } from "../types.js";
import { applyEnvironmentTick, boardLimit, environmentTurnTimeLimitMs, suppressRuntimeCardMinionEffects } from "./environment.js";
import {
  applyDivineShieldAttackAugments,
  applyMinionSummonedAugments,
  applyPersistentMinionAugments,
  applyStartOfTurnAugments,
  tryReviveMinion
} from "./augments.js";
import { augmentManaRamp, unlockLowHpManaCap } from "./augmentFlags.js";
import { applyFatigue } from "./fatigue.js";

export const effectHandlers: Record<string, (effect: EffectDefinition, context: EffectContext) => void> = {
  ADD_CARD_TO_HAND: addCardToHand,
  BOUNCE: bounceTarget,
  BOUNCE_ALL_CATEGORY: bounceAllCategory,
  BOUNCE_ALL_ENEMY: bounceAllEnemy,
  BOUNCE_CATEGORY: bounceCategory,
  BOUNCE_RANDOM_ENEMY: bounceRandomEnemy,
  BOUNCE_TARGET: bounceTarget,
  BUFF_ADJACENT: buffAdjacent,
  BUFF_ALL: buffAll,
  BUFF_CATEGORY: buffCategory,
  BUFF_HEALTH_AND_TAUNT_TARGET: buffHealthAndTauntTarget,
  BUFF_STAT_TARGET: buffStatTarget,
  BUFF_STAT_TARGET_CATEGORY_BONUS: buffStatTargetCategoryBonus,
  BUFF_STAT_TARGET_TEMP: buffStatTargetTemp,
  DAMAGE: damageTarget,
  DAMAGE_ALL_ENEMY_MINIONS: damageAllEnemyMinions,
  DAMAGE_ALL_NON_CATEGORIES: damageAllNonCategories,
  DAMAGE_AND_DRAW_IF_KILL: damageAndDrawIfKill,
  DAMAGE_NON_CATEGORY: damageNonCategory,
  DAMAGE_RANDOM_FRIENDLY: damageRandomFriendly,
  DAMAGE_SELF: damageSelf,
  DESTROY: destroyTarget,
  DESTROY_ALL_MINIONS: destroyAllMinions,
  DESTROY_DAMAGED: destroyDamaged,
  DESTROY_HIGH_ATTACK: destroyHighAttack,
  DESTROY_LOCKED: destroyLocked,
  DESTROY_LOW_ATTACK: destroyLowAttack,
  DISCARD_DRAW: discardDraw,
  DISCARD_RANDOM: discardRandom,
  DRAW: drawEffect,
  DRAW_MINION_REDUCE_COST: drawMinionReduceCost,
  DRAW_NEWS: drawNews,
  EAT_FRIENDLY: eatFriendly,
  FULL_HEAL: fullHeal,
  FULL_HEAL_AND_DRAW: fullHealAndDraw,
  FULL_HEAL_BUFF_TARGET_CATEGORY_BONUS: fullHealBuffTargetCategoryBonus,
  GIVE_DIVINE_SHIELD: giveDivineShield,
  GIVE_DIVINE_SHIELD_ALL: giveDivineShieldAll,
  GIVE_DIVINE_SHIELD_CATEGORY: giveDivineShieldCategory,
  GIVE_KEYWORD_ADJACENT: giveKeywordAdjacent,
  HEAL: healTarget,
  HEAL_ALL_FRIENDLY: healAllFriendly,
  HEAL_CATEGORY_BONUS: healCategoryBonus,
  LOCK_ALL_AND_BUFF_CATEGORY: lockAllAndBuffCategory,
  LOCK_ALL_ENEMY: lockAllEnemy,
  LOCK_ATTACK: lockAttack,
  LOCK_SELF: lockSelf,
  MULTI_DAMAGE: multiDamage,
  REDUCE_COST_ALL_HAND: reduceCostAllHand,
  SET_ATTACK_ALL: setAttackAll,
  SET_DEATH_TIMER: setDeathTimer,
  SUMMON_MULTIPLE: summonMultiple,
  SWAP_ATTACK_HEALTH: swapAttackHealth,
  UNLOCK_AND_BUFF_HEALTH: unlockAndBuffHealth
};

export function resolveEffect(effect: EffectDefinition | undefined, context: EffectContext): void {
  if (!effect?.type) return;
  const effective = applyNewsPower(effect, context);
  const type = effective.type;
  if (!type) return;
  const handler = effectHandlers[type];
  if (!handler) throw new Error(`Unhandled effect type: ${type}`);
  handler(effective, context);
}

export function resolvePostAction(state: MatchState, events: EffectContext["events"], catalog: Map<string, CardDefinition>): void {
  updateAuras(state, events);
  resolveDeaths(state, events, catalog);
  updateAuras(state, events);
  finishIfHeroDead(state, events);
}

export function startTurn(state: MatchState, nowMs: number, events: EffectContext["events"]): void {
  const player = activePlayer(state);
  const turnTimeLimitMs = turnTimeLimitForPlayer(
    player,
    state.private.turnTimeLimitMs,
    environmentTurnTimeLimitMs(state, player.seat)
  );
  state.status = "in_progress";
  state.turn.number += 1;
  state.turn.startedAtMs = nowMs;
  state.turn.deadlineAtMs = nowMs + turnTimeLimitMs;
  state.private.turnActionTaken = false;
  const manaRamp = augmentManaRamp(state, player.seat);
  player.mana.max = Math.min(manaRamp.cap, player.mana.max + manaRamp.growth);
  player.mana.current = player.mana.max;
  if (manaRamp.unlockedLowHpCap) {
    addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: "AMP_LIFE_INSURANCE" }, player.seat);
  }
  drawCards(state, player, 1, events);
  // Augment start-of-turn grants (消費券3600 deferred crystals, 大薯買一送一 extra
  // draw) and freeze-expiry housekeeping, after the normal refill + draw.
  applyStartOfTurnAugments(state, player, events);
  for (const minion of player.board) {
    minion.sleeping = false;
    minion.canAttack = minion.lockedTurns <= 0;
  }
  // Expire / re-apply any global referendum environment (e.g. 大停電 silence) at
  // the start of every turn, after minions wake so silence re-locks them.
  applyEnvironmentTick(state, events);
  updateAuras(state, events);
  addEvent(state, events, "TURN_STARTED", { turn: state.turn.number, activeSeat: state.turn.activeSeat }, state.turn.activeSeat);
}

export function processEndOfTurn(state: MatchState, events: EffectContext["events"], catalog: Map<string, CardDefinition>): void {
  for (const player of Object.values(state.players)) {
    for (const minion of player.board) {
      if (minion.lockedTurns > 0) {
        minion.lockedTurns -= 1;
        if (minion.lockedTurns === 0 && !minion.sleeping) minion.canAttack = true;
      }
      if (typeof minion.deathTimer === "number" && minion.deathTimer > 0) {
        minion.deathTimer -= 1;
        if (minion.deathTimer === 0) minion.currentHealth = 0;
      }
      if (typeof minion.temporaryUntilTurn === "number" && state.turn.number >= minion.temporaryUntilTurn) {
        minion.currentHealth = 0;
      }
      if (minion.keywords.quest) {
        minion.questTurns = (minion.questTurns ?? 0) + 1;
        if (minion.questTurns >= (minion.keywords.quest.turns ?? 1)) {
          completeQuest(state, player, minion, events);
        }
      }
    }
  }
  cleanupTemporaryBuffs(state);
  activePlayer(state).augmentFlags.payCostWithHealthThisTurn = false;
  resolvePostAction(state, events, catalog);
}

export function drawCards(state: MatchState, player: PlayerState, count: number, events: EffectContext["events"], index = -1, reduction = 0): void {
  let fatigued = false;
  for (let i = 0; i < count; i++) {
    if (player.deck.length === 0) {
      // 牌庫抽乾:累加疲勞並對自身英雄造成等量傷害(見 effects/fatigue.ts)。
      applyFatigue(state, player, events);
      fatigued = true;
      continue;
    }
    const card = index >= 0 ? player.deck.splice(index, 1)[0] : player.deck.shift();
    if (!card) continue;
    suppressRuntimeCardMinionEffects(state, player.seat, card);
    // 股東紀念品: the next drawn card is permanently half-costed, then the flag clears.
    if (player.augmentFlags.nextDrawHalfCost) {
      card.cost = Math.floor(card.cost / 2);
      card.isReduced = true;
      player.augmentFlags.nextDrawHalfCost = false;
      addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: "AMP_SHAREHOLDER_GIFT", cards: [card.instanceId] }, player.seat);
    }
    if (reduction > 0) {
      card.cost = Math.max(0, card.cost - reduction);
      card.isReduced = true;
    }
    if (player.hand.length >= 10) {
      player.graveyard.push(card);
      addEvent(state, events, "CARD_BURNED", { cardId: card.cardId }, player.seat);
      continue;
    }
    player.hand.push(card);
    addEvent(state, events, "CARD_DRAWN", { cardId: card.cardId, handCount: player.hand.length }, player.seat);
    handleDrawTriggers(state, player, events);
  }
  // 疲勞可能致死。drawCards 被許多路徑呼叫,其中回合開始的固定抽牌之後不會再經過
  // resolvePostAction,所以這裡自行收尾結算(finishIfHeroDead 對已結束狀態為冪等)。
  if (fatigued) finishIfHeroDead(state, events);
}

export function applyDamage(
  state: MatchState,
  ref: TargetUnitRef,
  amount: number,
  events: EffectContext["events"],
  payload: Record<string, unknown> = {}
): void {
  if (amount <= 0) return;
  if (ref.kind === "MINION") {
    const minion = ref.unit as RuntimeMinion;
    if (minion.keywords.divineShield) {
      minion.keywords.divineShield = false;
      addEvent(state, events, "SHIELD_POPPED", { target: minion.instanceId }, ref.owner.seat);
      return;
    }
    minion.currentHealth -= amount;
    updateEnrage(minion);
    // Carry the authoritative post-hit health so the client can drop the HP digit
    // AT impact without waiting for (or racing) the held publicSync flush.
    addEvent(state, events, "DAMAGE", { target: minion.instanceId, amount, remainingHealth: minion.currentHealth, ...payload }, ref.owner.seat);
    // 每當此隨從受到傷害時觸發 (陳菊: ON_DAMAGE → 抽一張卡). Fires per damage instance that
    // got past the divine shield; a lethal hit still draws since death resolves later.
    const onDamage = minion.keywords.triggered;
    if (onDamage?.type === "ON_DAMAGE" && (!onDamage.action || onDamage.action === "DRAW")) {
      drawCards(state, ref.owner, onDamage.value ?? 1, events);
    }
  } else {
    // 減稅: reduce every hero damage instance by the bound amount (floored at 0).
    const reduction = ref.owner.augmentFlags?.damageReductionPerInstance ?? 0;
    const dealt = reduction > 0 ? Math.max(0, amount - reduction) : amount;
    if (reduction > 0 && dealt < amount) {
      addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: "AMP_TAX_CUT" }, ref.owner.seat);
    }
    ref.owner.hero.hp -= dealt;
    // Achievement detection (他的手可以穿過我的巴巴阿): record whether the damaged
    // hero's own side had a 沙包/taunt minion up at the moment of the hit, so the
    // match-end aggregator can sum "hero damage dealt past a taunt" deterministically.
    const defenderHadTaunt = ref.owner.board.some((minion) => minion.keywords.taunt);
    addEvent(state, events, "DAMAGE", { target: `${ref.owner.seat}:hero`, amount: dealt, remainingHealth: ref.owner.hero.hp, defenderHadTaunt, ...payload }, ref.owner.seat);
    if (unlockLowHpManaCap(ref.owner)) {
      addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: "AMP_LIFE_INSURANCE" }, ref.owner.seat);
    }
  }
}

export function healUnit(state: MatchState, ref: TargetUnitRef, amount: number, events: EffectContext["events"]): number {
  if (amount <= 0) return 0;
  if (ref.kind === "MINION") {
    const minion = ref.unit as RuntimeMinion;
    const healed = Math.max(0, Math.min(amount, minion.health - minion.currentHealth));
    minion.currentHealth += healed;
    updateEnrage(minion);
    addEvent(state, events, "HEAL", { target: minion.instanceId, amount: healed, remainingHealth: minion.currentHealth }, ref.owner.seat);
    return healed;
  }
  const healed = Math.max(0, Math.min(amount, ref.owner.hero.maxHp - ref.owner.hero.hp));
  ref.owner.hero.hp += healed;
  addEvent(state, events, "HEAL", { target: `${ref.owner.seat}:hero`, amount: healed, remainingHealth: ref.owner.hero.hp }, ref.owner.seat);
  return healed;
}

export function updateEnrage(minion: RuntimeMinion): void {
  const enrage = minion.keywords.enrage;
  if (!enrage || enrage.type !== "BUFF_STAT" || enrage.stat !== "ATTACK") return;
  const damaged = minion.currentHealth < minion.health;
  const value = enrage.value ?? 0;
  if (damaged && !minion.isEnraged) {
    minion.attack += value;
    minion.isEnraged = true;
  } else if (!damaged && minion.isEnraged) {
    minion.attack -= value;
    minion.isEnraged = false;
  }
}

export function updateAuras(state: MatchState, events: EffectContext["events"]): void {
  for (const player of Object.values(state.players)) {
    const desired = new Map<string, { attack: number; health: number; taunt: boolean }>();
    for (const minion of player.board) desired.set(minion.instanceId, { attack: 0, health: 0, taunt: false });

    player.board.forEach((source, index) => {
      const aura = source.keywords.ongoing;
      if (!aura) return;
      if (aura.type === "ADJACENT_BUFF_STATS") {
        for (const neighbor of adjacentMinions(player, index)) {
          const buff = desired.get(neighbor.instanceId);
          if (!buff) continue;
          const value = aura.value ?? 1;
          buff.attack += value;
          buff.health += value;
        }
      }
      if (aura.type === "ADJACENT_BUFF_CATEGORY_ATTRS") {
        for (const neighbor of adjacentMinions(player, index)) {
          if (!neighbor.category.includes(aura.target_category ?? "")) continue;
          const buff = desired.get(neighbor.instanceId);
          if (!buff) continue;
          buff.attack += aura.attack ?? 0;
          buff.health += aura.value ?? 0;
          if (aura.keyword === "taunt") buff.taunt = true;
        }
      }
    });

    for (const minion of player.board) {
      const next = desired.get(minion.instanceId) ?? { attack: 0, health: 0, taunt: false };
      const attackDiff = next.attack - minion.auraAttack;
      const healthDiff = next.health - minion.auraHealth;
      if (attackDiff !== 0 || healthDiff !== 0) {
        minion.attack += attackDiff;
        minion.health += healthDiff;
        if (healthDiff > 0) minion.currentHealth += healthDiff;
        if (healthDiff < 0 && minion.currentHealth > minion.health) minion.currentHealth = minion.health;
        minion.auraAttack = next.attack;
        minion.auraHealth = next.health;
        updateEnrage(minion);
        addEvent(state, events, "AURA_UPDATED", { target: minion.instanceId }, player.seat);
      }
      if (next.taunt && !minion.auraTaunt) {
        minion.keywords.taunt = true;
        minion.auraTaunt = true;
      }
      if (!next.taunt && minion.auraTaunt) {
        minion.keywords.taunt = !!minion.keywords.baseTaunt;
        minion.auraTaunt = false;
      }
    }
  }
}

export function resolveDeaths(state: MatchState, events: EffectContext["events"], catalog: Map<string, CardDefinition>): void {
  let removed = true;
  let guard = 0;
  while (removed && guard < 50) {
    removed = false;
    guard += 1;
    for (const player of Object.values(state.players)) {
      for (let i = player.board.length - 1; i >= 0; i--) {
        const minion = player.board[i];
        if (minion.currentHealth > 0) continue;
        const deathTimeNeighbors = [player.board[i - 1], player.board[i + 1]].filter(
          (neighbor): neighbor is RuntimeMinion => neighbor !== undefined
        );
        player.board.splice(i, 1);
        player.graveyard.push(minionToCard(state, minion));
        const destroyPayload: Record<string, unknown> = { target: minion.instanceId, cardId: minion.cardId };
        if (minion.deathReason) {
          destroyPayload.reason = minion.deathReason.kind;
          if (minion.deathReason.kind === "EVENT") destroyPayload.eventName = minion.deathReason.label;
        }
        addEvent(state, events, "DESTROY", destroyPayload, player.seat);
        grantDestroyedMinionCostRebate(state, minion, events, catalog);
        grantCategoryDeathMana(state, minion, events);
        resolveDeathrattle(state, player, minion, deathTimeNeighbors, events, catalog);
        healDeathTimeNeighborsFromAugments(state, player, minion, deathTimeNeighbors, events);
        if (
          minion.keywords.deathrattle?.type !== "SHUFFLE_SELF_INTO_DECK" &&
          player.augmentFlags.shuffleIntoDeckOnDeathCategories?.includes(minion.category)
        ) {
          shuffleDeadMinionIntoDeck(state, player, minion, catalog);
        }
        // 普渡: revive the owner's minion once as a 1/1 token (after the deathrattle).
        tryReviveMinion(state, player, minion, events);
        removed = true;
      }
    }
  }
}

function grantDestroyedMinionCostRebate(
  state: MatchState,
  minion: RuntimeMinion,
  events: EffectContext["events"],
  catalog: Map<string, CardDefinition>
): void {
  const originalCost = catalog.get(minion.cardId)?.cost ?? minion.cost;
  if (originalCost <= 0) return;
  for (const player of Object.values(state.players)) {
    if (!player.augmentFlags.destroyedMinionCostRebate) continue;
    player.mana.current += originalCost;
    addEvent(
      state,
      events,
      "AUGMENT_TRIGGERED",
      { augmentId: "AMP_VENDOR_KICKBACK", amount: originalCost, cardId: minion.cardId },
      player.seat
    );
  }
}

export function finishIfHeroDead(state: MatchState, events: EffectContext["events"]): void {
  if (state.status === "finished") return;
  const p1Dead = state.players.player1.hero.hp <= 0;
  const p2Dead = state.players.player2.hero.hp <= 0;
  if (!p1Dead && !p2Dead) return;
  const winnerSeat = p1Dead && p2Dead ? undefined : p1Dead ? "player2" : "player1";
  state.status = "finished";
  state.result = { winnerSeat, reason: "hero_destroyed" };
  addEvent(state, events, "GAME_FINISHED", { winnerSeat, reason: "hero_destroyed" });
}

export function handlePlayNews(state: MatchState, player: PlayerState, events: EffectContext["events"]): void {
  for (const minion of player.board) {
    const trigger = minion.keywords.triggered;
    if (trigger?.type !== "ON_PLAY_NEWS") continue;
    if (!trigger.action || trigger.action === "BUFF_ATTACK") {
      minion.attack += trigger.value ?? 1;
      addEvent(state, events, "BUFF", { target: minion.instanceId, stat: "ATTACK", value: trigger.value ?? 1 }, player.seat);
    }
    if (trigger.action === "HEAL") {
      healUnit(state, { owner: player, kind: "MINION", unit: minion }, trigger.value ?? 1, events);
    }
  }
  // Cards that cheapen themselves while held (新聞龍捲風: 每打出一張新聞 費用-1).
  for (const card of player.hand) {
    const trigger = card.keywords.triggered;
    if (trigger?.type !== "ON_PLAY_NEWS" || trigger.action !== "SELF_COST_REDUCE") continue;
    const old = card.cost;
    card.cost = Math.max(0, card.cost - (trigger.value ?? 1));
    if (card.cost !== old) card.isReduced = true;
  }
}

export function applyNewsPower(effect: EffectDefinition, context: EffectContext): EffectDefinition {
  if (!effect.type || !context.source || context.source.type !== "NEWS" || typeof effect.value !== "number") return effect;
  const isDamage = effect.type.includes("DAMAGE");
  const isHeal = effect.type.includes("HEAL") || effect.type.includes("RECOVER");
  const excluded =
    effect.type.includes("DRAW") ||
    effect.type.includes("COST") ||
    effect.type.includes("REDUCE") ||
    effect.type === "FULL_HEAL_BUFF_TARGET_CATEGORY_BONUS";
  if ((!isDamage && !isHeal) || excluded) return effect;
  const bonus = currentNewsPower(context.state, context.activeSeat);
  if (bonus <= 0) return effect;
  return {
    ...effect,
    value: effect.value + bonus,
    bonus_value: typeof effect.bonus_value === "number" ? effect.bonus_value + bonus : effect.bonus_value
  };
}

export function damageTarget(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target) ?? {
    owner: context.state.players[opponentOf(context.activeSeat)],
    kind: "HERO" as const,
    unit: context.state.players[opponentOf(context.activeSeat)].hero
  };
  applyDamage(context.state, ref, effect.value ?? 0, context.events);
}

export function damageAndDrawIfKill(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref || ref.kind !== "MINION") return;
  applyDamage(context.state, ref, effect.value ?? 0, context.events);
  if ((ref.unit as RuntimeMinion).currentHealth <= 0) {
    drawCards(context.state, context.state.players[context.activeSeat], 1, context.events);
  }
}

export function damageSelf(effect: EffectDefinition, context: EffectContext): void {
  if (!context.source || context.source.type !== "MINION") return;
  const owner = context.state.players[context.activeSeat];
  const minion = owner.board.find((item) => item.instanceId === context.source?.instanceId);
  if (!minion) return;
  applyDamage(context.state, { owner, kind: "MINION", unit: minion }, effect.value ?? 0, context.events);
}

export function damageNonCategory(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref || ref.kind !== "MINION") return;
  const minion = ref.unit as RuntimeMinion;
  if (minion.category.includes(effect.target_category ?? "")) return;
  applyDamage(context.state, ref, effect.value ?? 0, context.events);
}

export function damageAllNonCategories(effect: EffectDefinition, context: EffectContext): void {
  const excluded = new Set(effect.excluded_categories ?? []);
  forEachMinion(context.state, (player, minion) => {
    if (!excluded.has(minion.category)) applyDamage(context.state, { owner: player, kind: "MINION", unit: minion }, effect.value ?? 0, context.events);
  });
}

export function damageAllEnemyMinions(effect: EffectDefinition, context: EffectContext): void {
  const enemy = context.state.players[opponentOf(context.activeSeat)];
  for (const minion of enemy.board) {
    applyDamage(context.state, { owner: enemy, kind: "MINION", unit: minion }, effect.value ?? 0, context.events);
  }
}

export function damageRandomFriendly(effect: EffectDefinition, context: EffectContext): void {
  const player = context.state.players[context.activeSeat];
  if (player.board.length === 0) {
    applyDamage(context.state, { owner: player, kind: "HERO", unit: player.hero }, effect.value ?? 0, context.events);
    return;
  }
  const next = nextInt(context.state.private.rngState, player.board.length);
  context.state.private.rngState = next.state;
  applyDamage(context.state, { owner: player, kind: "MINION", unit: player.board[next.value] }, effect.value ?? 0, context.events);
}

export function healTarget(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (ref) healUnit(context.state, ref, effect.value ?? 0, context.events);
}

export function healCategoryBonus(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref) return;
  const minion = ref.kind === "MINION" ? (ref.unit as RuntimeMinion) : undefined;
  const value = minion?.category.includes(effect.target_category_includes ?? "") ? effect.bonus_value ?? effect.value ?? 0 : effect.value ?? 0;
  healUnit(context.state, ref, value, context.events);
}

export function fullHeal(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref) return;
  const amount = ref.kind === "MINION" ? (ref.unit as RuntimeMinion).health : ref.owner.hero.maxHp;
  healUnit(context.state, ref, amount, context.events);
}

export function healAllFriendly(_effect: EffectDefinition, context: EffectContext): void {
  const player = context.state.players[context.activeSeat];
  for (const minion of player.board) healUnit(context.state, { owner: player, kind: "MINION", unit: minion }, minion.health, context.events);
}

export function fullHealAndDraw(effect: EffectDefinition, context: EffectContext): void {
  fullHeal(effect, context);
  drawCards(context.state, context.state.players[context.activeSeat], 1, context.events);
}

export function fullHealBuffTargetCategoryBonus(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref || ref.kind !== "MINION") return;
  const minion = ref.unit as RuntimeMinion;
  healUnit(context.state, ref, minion.health, context.events);
  buffMinion(context.state, ref.owner, minion, "HEALTH", effect.value ?? 0, context.events);
  const category = effect.target_category_includes ?? effect.target_category;
  if (category && minion.category.includes(category)) {
    buffMinion(context.state, ref.owner, minion, "ATTACK", effect.bonus_value ?? 0, context.events);
  }
}

export function buffStatTarget(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref || ref.kind !== "MINION") return;
  buffMinion(context.state, ref.owner, ref.unit as RuntimeMinion, effect.stat ?? "ATTACK", effect.value ?? 0, context.events);
}

export function buffStatTargetCategoryBonus(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref || ref.kind !== "MINION") return;
  const minion = ref.unit as RuntimeMinion;
  const value = minion.category.includes(effect.target_category_includes ?? "") ? effect.bonus_value ?? effect.value ?? 0 : effect.value ?? 0;
  buffMinion(context.state, ref.owner, minion, effect.stat ?? "ATTACK", value, context.events);
}

export function buffStatTargetTemp(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref || ref.kind !== "MINION") return;
  const minion = ref.unit as RuntimeMinion;
  const stat = effect.stat ?? "ALL";
  const buff = { attack: stat === "ATTACK" || stat === "ALL" ? effect.value ?? 0 : 0, health: stat === "HEALTH" || stat === "ALL" ? effect.value ?? 0 : 0 };
  minion.attack += buff.attack;
  minion.health += buff.health;
  minion.currentHealth += buff.health;
  minion.tempBuffs.push(buff);
  updateEnrage(minion);
  addEvent(context.state, context.events, "BUFF", { target: minion.instanceId, temporary: true, value: effect.value ?? 0 }, ref.owner.seat);
}

export function buffHealthAndTauntTarget(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref || ref.kind !== "MINION") return;
  const minion = ref.unit as RuntimeMinion;
  buffMinion(context.state, ref.owner, minion, "HEALTH", effect.value ?? 0, context.events);
  minion.keywords.taunt = true;
}

export function buffAll(effect: EffectDefinition, context: EffectContext): void {
  const player = context.state.players[context.activeSeat];
  for (const minion of player.board) buffMinion(context.state, player, minion, effect.stat ?? "ALL", effect.value ?? 0, context.events);
}

export function buffCategory(effect: EffectDefinition, context: EffectContext): void {
  const player = context.state.players[context.activeSeat];
  for (const minion of player.board) {
    if (minion.category === effect.target_category) buffMinion(context.state, player, minion, effect.stat ?? "ALL", effect.value ?? 0, context.events);
  }
}

export function buffAdjacent(effect: EffectDefinition, context: EffectContext): void {
  const source = sourceMinionInPlay(context);
  if (!source) return;
  for (const minion of adjacentMinions(source.owner, source.index)) {
    buffMinion(context.state, source.owner, minion, "ALL", effect.value ?? 1, context.events);
  }
}

export function giveDivineShield(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref || ref.kind !== "MINION") return;
  grantDivineShield(context.state, ref.owner, ref.unit as RuntimeMinion, context.events);
}

export function giveDivineShieldAll(_effect: EffectDefinition, context: EffectContext): void {
  const player = context.state.players[context.activeSeat];
  for (const minion of player.board) {
    grantDivineShield(context.state, player, minion, context.events);
  }
}

export function giveDivineShieldCategory(effect: EffectDefinition, context: EffectContext): void {
  const player = context.state.players[context.activeSeat];
  for (const minion of player.board) {
    if (minion.category === effect.target_category) {
      grantDivineShield(context.state, player, minion, context.events);
    }
  }
}

/** Grants divine shield and resolves augments even when the minion was already shielded. */
export function grantDivineShield(
  state: MatchState,
  player: PlayerState,
  minion: RuntimeMinion,
  events: EffectContext["events"]
): void {
  minion.keywords.divineShield = true;
  addEvent(state, events, "BUFF", { target: minion.instanceId, shield: true }, player.seat);
  applyDivineShieldAttackAugments(state, player, minion, events);
}

export function giveKeywordAdjacent(effect: EffectDefinition, context: EffectContext): void {
  const source = sourceMinionInPlay(context);
  if (!source || !effect.keyword) return;
  for (const minion of adjacentMinions(source.owner, source.index)) {
    (minion.keywords as Record<string, unknown>)[effect.keyword] = true;
    addEvent(context.state, context.events, "BUFF", { target: minion.instanceId, keyword: effect.keyword }, source.owner.seat);
  }
}

export function lockAttack(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref || ref.kind !== "MINION") return;
  const minion = ref.unit as RuntimeMinion;
  minion.lockedTurns = Math.max(minion.lockedTurns, effect.value ?? 1);
  minion.canAttack = false;
  addEvent(context.state, context.events, "BUFF", { target: minion.instanceId, lockedTurns: minion.lockedTurns }, ref.owner.seat);
}

export function lockSelf(effect: EffectDefinition, context: EffectContext): void {
  const source = sourceMinionInPlay(context);
  if (!source) return;
  source.minion.lockedTurns = Math.max(source.minion.lockedTurns, effect.value ?? 1);
  source.minion.canAttack = false;
}

export function lockAllEnemy(effect: EffectDefinition, context: EffectContext): void {
  const enemy = context.state.players[opponentOf(context.activeSeat)];
  for (const minion of enemy.board) {
    minion.lockedTurns = Math.max(minion.lockedTurns, effect.value ?? 1);
    minion.canAttack = false;
    addEvent(context.state, context.events, "BUFF", { target: minion.instanceId, lockedTurns: minion.lockedTurns }, enemy.seat);
  }
}

export function lockAllAndBuffCategory(effect: EffectDefinition, context: EffectContext): void {
  forEachMinion(context.state, (player, minion) => {
    minion.lockedTurns = Math.max(minion.lockedTurns, effect.value ?? 1);
    minion.canAttack = false;
    if (minion.category === effect.target_category) {
      buffMinion(context.state, player, minion, effect.buff_stat ?? "HEALTH", effect.buff_value ?? 0, context.events);
    }
  });
}

export function unlockAndBuffHealth(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref || ref.kind !== "MINION") return;
  const minion = ref.unit as RuntimeMinion;
  minion.lockedTurns = 0;
  if (!minion.sleeping) minion.canAttack = true;
  buffMinion(context.state, ref.owner, minion, "HEALTH", effect.value ?? 0, context.events);
}

export function summonMultiple(effect: EffectDefinition, context: EffectContext): void {
  const card = effect.cardId ? context.catalog.get(effect.cardId) : undefined;
  if (!card || card.type !== "MINION") return;
  const player = context.state.players[context.activeSeat];
  for (let i = 0; i < (effect.count ?? 1); i++) {
    summonCard(context.state, player, card, context.events, undefined, effect.isTemporary ? 1 : undefined);
  }
}

export function addCardToHand(effect: EffectDefinition, context: EffectContext): void {
  const card = effect.cardId ? context.catalog.get(effect.cardId) : undefined;
  if (!card) return;
  const player = context.state.players[context.activeSeat];
  for (let i = 0; i < (effect.value ?? 1); i++) {
    if (player.hand.length < 10) player.hand.push(createCardForHand(context.state, card, player.seat));
  }
}

export function destroyTarget(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (ref?.kind === "MINION") (ref.unit as RuntimeMinion).currentHealth = 0;
}

export function destroyAllMinions(effect: EffectDefinition, context: EffectContext): void {
  forEachMinion(context.state, (_player, minion) => {
    minion.currentHealth = 0;
    // suppressRevive: unconditional wipe (莫拉克) — mark so 普渡 cannot revive any of them.
    if (effect.suppressRevive) minion.revivedByPurdo = true;
  });
}

export function destroyLowAttack(effect: EffectDefinition, context: EffectContext): void {
  destroyByAttack(context, (attack) => attack <= (effect.value ?? 0));
}

export function destroyHighAttack(effect: EffectDefinition, context: EffectContext): void {
  destroyByAttack(context, (attack) => attack >= (effect.value ?? 0));
}

export function destroyDamaged(_effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (ref?.kind === "MINION") {
    const minion = ref.unit as RuntimeMinion;
    if (minion.currentHealth < minion.health) minion.currentHealth = 0;
  }
}

export function destroyLocked(_effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (ref?.kind === "MINION" && (ref.unit as RuntimeMinion).lockedTurns > 0) {
    (ref.unit as RuntimeMinion).currentHealth = 0;
  }
}

export function discardDraw(effect: EffectDefinition, context: EffectContext): void {
  discardRandom({ ...effect, type: "DISCARD_RANDOM", value: effect.discardCount ?? 1 }, context);
  drawCards(context.state, context.state.players[context.activeSeat], effect.drawCount ?? 1, context.events);
}

export function discardRandom(effect: EffectDefinition, context: EffectContext): void {
  const player = context.state.players[context.activeSeat];
  for (let i = 0; i < (effect.value ?? 1) && player.hand.length > 0; i++) {
    const next = nextInt(context.state.private.rngState, player.hand.length);
    context.state.private.rngState = next.state;
    const [card] = player.hand.splice(next.value, 1);
    player.graveyard.push(card);
    addEvent(context.state, context.events, "DISCARD", { cardId: card.cardId }, player.seat);
    handleDiscard(context.state, player, card, context.catalog, context.events);
  }
}

export function drawEffect(effect: EffectDefinition, context: EffectContext): void {
  drawCards(context.state, context.state.players[context.activeSeat], effect.value ?? 1, context.events);
}

// 陳致中: draw `value` cards, or `bonus_value` instead when the referenced card
// (effect.cardId, e.g. 陳水扁) is on the caster's own board.
export function drawIfCardOnBoard(effect: EffectDefinition, context: EffectContext): void {
  const player = context.state.players[context.activeSeat];
  const hasCard = !!effect.cardId && player.board.some((minion) => minion.cardId === effect.cardId);
  const count = hasCard ? (effect.bonus_value ?? effect.value ?? 1) : (effect.value ?? 1);
  drawCards(context.state, player, count, context.events);
}

// 抄底: draw `value` cards normally, or `bonus_value` instead when the caster's
// hand is empty (this card was their last — 如果你完全沒有牌，改抽三張). The played
// card is already spliced out of hand before the battlecry resolves.
export function drawIfHandEmpty(effect: EffectDefinition, context: EffectContext): void {
  const player = context.state.players[context.activeSeat];
  const count = player.hand.length === 0 ? (effect.bonus_value ?? effect.value ?? 1) : (effect.value ?? 1);
  drawCards(context.state, player, count, context.events);
}

export function drawMinionReduceCost(effect: EffectDefinition, context: EffectContext): void {
  const player = context.state.players[context.activeSeat];
  const index = player.deck.findIndex((card) => card.type === "MINION");
  if (index !== -1) drawCards(context.state, player, 1, context.events, index, effect.value ?? 0);
}

export function drawNews(effect: EffectDefinition, context: EffectContext): void {
  const player = context.state.players[context.activeSeat];
  const index = player.deck.findIndex((card) => card.type === "NEWS");
  if (index !== -1) drawCards(context.state, player, 1, context.events, index, effect.value ?? 0);
}

export function eatFriendly(effect: EffectDefinition, context: EffectContext): void {
  const source = sourceMinionInPlay(context);
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!source || !ref || ref.kind !== "MINION" || ref.owner.seat !== context.activeSeat) return;
  const target = ref.unit as RuntimeMinion;
  source.minion.attack += target.attack;
  source.minion.health += target.health;
  source.minion.currentHealth += target.health;
  target.currentHealth = 0;
}

export function multiDamage(effect: EffectDefinition, context: EffectContext): void {
  const enemy = context.state.players[opponentOf(context.activeSeat)];
  let candidates: TargetUnitRef[] = [{ owner: enemy, kind: "HERO", unit: enemy.hero }, ...enemy.board.map((minion) => ({ owner: enemy, kind: "MINION" as const, unit: minion }))];
  for (let i = 0; i < (effect.value ?? 0) && candidates.length > 0; i++) {
    const next = nextInt(context.state.private.rngState, candidates.length);
    context.state.private.rngState = next.state;
    const ref = candidates[next.value];
    applyDamage(context.state, ref, 1, context.events);
    if (ref.kind === "MINION" && (ref.unit as RuntimeMinion).currentHealth <= 0) {
      candidates = candidates.filter((candidate) => candidate !== ref);
    }
  }
}

export function reduceCostAllHand(effect: EffectDefinition, context: EffectContext): void {
  const player = context.state.players[context.activeSeat];
  for (const card of player.hand) {
    const old = card.cost;
    card.cost = Math.max(0, card.cost - (effect.value ?? 0));
    if (card.cost !== old) card.isReduced = true;
  }
}

export function setAttackAll(effect: EffectDefinition, context: EffectContext): void {
  forEachMinion(context.state, (player, minion) => {
    minion.attack = (effect.value ?? 0) + minion.auraAttack + (minion.isEnraged ? minion.keywords.enrage?.value ?? 0 : 0);
    minion.baseAttack = effect.value ?? 0;
    addEvent(context.state, context.events, "BUFF", { target: minion.instanceId, setAttack: effect.value ?? 0 }, player.seat);
  });
}

export function setDeathTimer(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (ref?.kind === "MINION") (ref.unit as RuntimeMinion).deathTimer = effect.value ?? 3;
}

export function swapAttackHealth(_effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (!ref || ref.kind !== "MINION") return;
  const minion = ref.unit as RuntimeMinion;
  const attack = minion.attack;
  const hp = minion.currentHealth;
  minion.attack = hp;
  minion.baseAttack = hp - minion.auraAttack;
  minion.health = attack;
  minion.currentHealth = attack;
  updateEnrage(minion);
}

export function bounceTarget(_effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (ref?.kind === "MINION") bounceMinion(context.state, ref.owner, ref.unit as RuntimeMinion, context.catalog, context.events, { actorSeat: context.activeSeat });
}

export function bounceCategory(effect: EffectDefinition, context: EffectContext): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (ref?.kind !== "MINION") return;
  const minion = ref.unit as RuntimeMinion;
  if (effect.target_category_includes && !minion.category.includes(effect.target_category_includes)) return;
  bounceMinion(context.state, ref.owner, minion, context.catalog, context.events, { actorSeat: context.activeSeat });
}

export function bounceAllCategory(effect: EffectDefinition, context: EffectContext): void {
  for (const player of Object.values(context.state.players)) {
    for (const minion of [...player.board]) {
      if (minion.category.includes(effect.target_category_includes ?? "")) {
        bounceMinion(context.state, player, minion, context.catalog, context.events, { actorSeat: context.activeSeat });
      }
    }
  }
}

export function bounceAllEnemy(effect: EffectDefinition, context: EffectContext): void {
  const enemy = context.state.players[opponentOf(context.activeSeat)];
  for (const minion of [...enemy.board]) bounceMinion(context.state, enemy, minion, context.catalog, context.events, { actorSeat: context.activeSeat });

  const source = sourceMinionInPlay(context);
  const player = context.state.players[context.activeSeat];
  if (!source || !effect.summon) return;
  let insertAt = source.index;
  const left = context.catalog.get(effect.summon[0]);
  if (left) {
    summonCard(context.state, player, left, context.events, insertAt);
    insertAt += 1;
  }
  const right = context.catalog.get(effect.summon[1]);
  if (right) summonCard(context.state, player, right, context.events, insertAt + 1);
}

export function bounceRandomEnemy(_effect: EffectDefinition, context: EffectContext): void {
  const enemy = context.state.players[opponentOf(context.activeSeat)];
  if (enemy.board.length === 0) return;
  const next = nextInt(context.state.private.rngState, enemy.board.length);
  context.state.private.rngState = next.state;
  bounceMinion(context.state, enemy, enemy.board[next.value], context.catalog, context.events, { actorSeat: context.activeSeat });
}

function completeQuest(state: MatchState, player: PlayerState, minion: RuntimeMinion, events: EffectContext["events"]): void {
  const quest = minion.keywords.quest;
  if (!quest) return;
  addEvent(state, events, "QUEST_COMPLETED", { source: minion.instanceId, cardId: minion.cardId }, player.seat);
  if (quest.summonCardId) {
    minion.currentHealth = 0;
    minion.keywords.deathrattle = { type: "SUMMON", cardId: quest.summonCardId };
  }
  if (quest.effect?.type === "DAMAGE_ALL_MINIONS") {
    forEachMinion(state, (owner, target) => {
      applyDamage(state, { owner, kind: "MINION", unit: target }, quest.effect?.value ?? 0, events);
    });
    delete minion.keywords.quest;
    delete minion.questTurns;
  }
}

function resolveDeathrattle(
  state: MatchState,
  player: PlayerState,
  deadMinion: RuntimeMinion,
  deathTimeNeighbors: readonly RuntimeMinion[],
  events: EffectContext["events"],
  catalog: Map<string, CardDefinition>
): void {
  const deathrattle = deadMinion.keywords.deathrattle;
  if (!deathrattle) return;
  addEvent(state, events, "DEATHRATTLE", { source: deadMinion.instanceId, type: deathrattle.type }, player.seat);
  if (deathrattle.type === "SUMMON" && deathrattle.cardId) {
    const def = catalog.get(deathrattle.cardId);
    if (def) summonCard(state, player, def, events);
  }
  if (deathrattle.type === "BOUNCE_SELF") {
    const original = catalog.get(deadMinion.cardId);
    const card = original ? createCardForHand(state, original, player.seat) : minionToCard(state, deadMinion);
    if (player.hand.length < 10) {
      player.hand.push(card);
      addEvent(state, events, "BOUNCE", { target: deadMinion.instanceId, cardId: deadMinion.cardId }, player.seat);
    }
  }
  if (deathrattle.type === "DRAW") {
    drawCards(state, player, deathrattle.value ?? 1, events);
  }
  if (deathrattle.type === "DAMAGE_OWN_HERO") {
    applyDamage(state, { owner: player, kind: "HERO", unit: player.hero }, deathrattle.value ?? 0, events);
  }
  if (deathrattle.type === "SHUFFLE_SELF_INTO_DECK") {
    shuffleDeadMinionIntoDeck(state, player, deadMinion, catalog);
  }
  if (deathrattle.type === "BUFF_ADJACENT_HEALTH") {
    for (const neighbor of deathTimeNeighbors) {
      if (player.board.includes(neighbor)) {
        buffMinion(state, player, neighbor, "HEALTH", deathrattle.value ?? 1, events);
      }
    }
  }
}

function grantCategoryDeathMana(
  state: MatchState,
  deadMinion: RuntimeMinion,
  events: EffectContext["events"]
): void {
  for (const player of Object.values(state.players)) {
    for (const gain of player.augmentFlags.categoryDeathManaGains ?? []) {
      if (deadMinion.category !== gain.category) continue;
      player.mana.current += gain.value;
      addEvent(
        state,
        events,
        "AUGMENT_TRIGGERED",
        { augmentId: gain.augmentId, amount: gain.value, cardId: deadMinion.cardId },
        player.seat
      );
    }
  }
}

function healDeathTimeNeighborsFromAugments(
  state: MatchState,
  player: PlayerState,
  deadMinion: RuntimeMinion,
  neighbors: readonly RuntimeMinion[],
  events: EffectContext["events"]
): void {
  const heals = (player.augmentFlags.categoryDeathrattleAdjacentHeals ?? []).filter(
    (heal) => deadMinion.category === heal.category
  );
  const value = heals.reduce((sum, heal) => sum + heal.value, 0);
  if (value <= 0) return;
  const surviving = neighbors.filter((neighbor) => neighbor.currentHealth > 0 && player.board.includes(neighbor));
  for (const neighbor of surviving) {
    healUnit(state, { owner: player, kind: "MINION", unit: neighbor }, value, events);
  }
  if (surviving.length > 0) {
    for (const heal of heals) {
      addEvent(
        state,
        events,
        "AUGMENT_TRIGGERED",
        { augmentId: heal.augmentId, targets: surviving.map((neighbor) => neighbor.instanceId) },
        player.seat
      );
    }
  }
}

function shuffleDeadMinionIntoDeck(
  state: MatchState,
  player: PlayerState,
  deadMinion: RuntimeMinion,
  catalog: Map<string, CardDefinition>
): void {
  let graveyardIndex = -1;
  for (let i = player.graveyard.length - 1; i >= 0; i--) {
    if (player.graveyard[i].cardId === deadMinion.cardId) {
      graveyardIndex = i;
      break;
    }
  }
  const graveyardCard = graveyardIndex >= 0 ? player.graveyard.splice(graveyardIndex, 1)[0] : undefined;
  const original = catalog.get(deadMinion.cardId);
  const card = original ? createCardForHand(state, original, player.seat) : graveyardCard;
  if (!card) return;
  player.deck.push(card);
  state.private.rngState = shuffleInPlace(player.deck, state.private.rngState);
}

// 陳水扁: each successful draw buffs every board minion carrying an ON_DRAW
// trigger by `value` (stat defaults to ALL → +value/+value).
function handleDrawTriggers(state: MatchState, player: PlayerState, events: EffectContext["events"]): void {
  for (const minion of player.board) {
    const triggered = minion.keywords.triggered;
    if (triggered?.type !== "ON_DRAW") continue;
    buffMinion(state, player, minion, triggered.stat ?? "ALL", triggered.value ?? 1, events);
  }
}

function handleDiscard(state: MatchState, player: PlayerState, discarded: RuntimeCard, catalog: Map<string, CardDefinition>, events: EffectContext["events"]): void {
  for (const minion of player.board) {
    const triggered = minion.keywords.triggered;
    if (triggered?.type === "ON_DISCARD") {
      buffMinion(state, player, minion, "ALL", triggered.value ?? 2, events);
    }
  }
  if (discarded.keywords.onDiscard === "SUMMON") {
    const def = catalog.get(discarded.cardId);
    if (def) summonCard(state, player, def, events);
  }
}

interface BounceMinionOptions {
  transformReturnedCard?: (card: RuntimeCard, removed: RuntimeMinion) => void;
  /**
   * The seat that CAUSED the bounce (the caster), distinct from the bounced
   * minion's owner. Recorded on the BOUNCE event so quest detection can credit
   * "回手隨從" to the acting player. Omitted for ownerless/global effects
   * (e.g. environment board wipes), which then aren't attributed to anyone.
   */
  actorSeat?: Seat;
}

export function bounceMinion(
  state: MatchState,
  owner: PlayerState,
  minion: RuntimeMinion,
  catalog: Map<string, CardDefinition>,
  events: EffectContext["events"],
  options: BounceMinionOptions = {}
): void {
  // Hand already full: the minion can't return, so it dies on the board. Tag the
  // reason and settle it through `resolveDeaths` so 遺志 (deathrattle) and other
  // death effects fire exactly like any other death, then surface a labelled
  // DESTROY (滿手死亡 / 因事件死亡). Settle inline because some callers (e.g. the
  // augment phase) don't run `resolvePostAction` afterward.
  if (owner.hand.length >= 10 && owner.board.includes(minion)) {
    minion.deathReason = { kind: "FULL_HAND" };
    minion.currentHealth = 0;
    resolveDeaths(state, events, catalog);
    return;
  }
  const removed = removeMinion(owner, minion);
  if (!removed) return;
  const original = catalog.get(removed.cardId);
  if (!original) return;
  const card = createCardForHand(state, original, owner.seat);
  if (removed.hanBounceBonus) card.hanBounceBonus = removed.hanBounceBonus;
  if (card.bounce_bonus) card.hanBounceBonus = (card.hanBounceBonus ?? 0) + card.bounce_bonus;
  if (card.hanBounceBonus) {
    card.attack = (card.attack ?? 0) + card.hanBounceBonus;
    card.health = (card.health ?? 0) + card.hanBounceBonus;
  }
  options.transformReturnedCard?.(card, removed);
  if (owner.hand.length < 10) owner.hand.push(card);
  const bouncePayload: Record<string, unknown> = { target: removed.instanceId, cardId: removed.cardId };
  if (options.actorSeat) bouncePayload.actorSeat = options.actorSeat;
  addEvent(state, events, "BOUNCE", bouncePayload, owner.seat);
}

export function summonCard(state: MatchState, player: PlayerState, card: CardDefinition, events: EffectContext["events"], index?: number, temporaryTurns?: number): RuntimeMinion | undefined {
  if (player.board.length >= boardLimit(state, player.seat) || card.type !== "MINION") return undefined;
  const runtimeCard = createCardForHand(state, card, player.seat);
  const minion = createMinionFromCard(state, runtimeCard, player.seat);
  if (temporaryTurns) {
    minion.deathTimer = temporaryTurns;
    minion.temporaryUntilTurn = state.turn.number + temporaryTurns;
  }
  const insertion = typeof index === "number" ? Math.max(0, Math.min(index, player.board.length)) : player.board.length;
  player.board.splice(insertion, 0, minion);
  applyPersistentMinionAugments(state, player.seat, minion, events);
  addEvent(state, events, "MINION_SUMMONED", { target: minion.instanceId, cardId: minion.cardId }, player.seat);
  applyMinionSummonedAugments(state, player.seat, minion, events);
  return minion;
}

function minionToCard(state: MatchState, minion: RuntimeMinion): RuntimeCard {
  return {
    instanceId: nextCardInstanceIdForGraveyard(state, minion.cardId),
    cardId: minion.cardId,
    ownerSeat: minion.ownerSeat,
    name: minion.name,
    category: minion.category,
    cost: minion.cost,
    type: "MINION",
    rarity: minion.rarity,
    description: "",
    image: "",
    attack: minion.attack,
    health: minion.health,
    keywords: structuredClone(minion.keywords),
    bounce_bonus: minion.bounce_bonus,
    hanBounceBonus: minion.hanBounceBonus
  };
}

function nextCardInstanceIdForGraveyard(state: MatchState, cardId: string): string {
  const id = `grave_${cardId}_${state.private.nextInstanceSeq}`;
  state.private.nextInstanceSeq += 1;
  return id;
}

function buffMinion(state: MatchState, player: PlayerState, minion: RuntimeMinion, stat: string, value: number, events: EffectContext["events"]): void {
  if (value === 0) return;
  if (stat === "ATTACK" || stat === "ALL") minion.attack += value;
  if (stat === "HEALTH" || stat === "ALL") {
    minion.health += value;
    minion.currentHealth += value;
  }
  updateEnrage(minion);
  addEvent(state, events, "BUFF", { target: minion.instanceId, stat, value }, player.seat);
}

function destroyByAttack(context: EffectContext, predicate: (attack: number) => boolean): void {
  const ref = getTargetUnit(context.state, context.activeSeat, context.target);
  if (ref?.kind === "MINION" && predicate((ref.unit as RuntimeMinion).attack)) {
    (ref.unit as RuntimeMinion).currentHealth = 0;
  }
}

function cleanupTemporaryBuffs(state: MatchState): void {
  forEachMinion(state, (_player, minion) => {
    for (const buff of minion.tempBuffs) {
      minion.attack -= buff.attack;
      minion.health -= buff.health;
      if (minion.currentHealth > minion.health) minion.currentHealth = minion.health;
    }
    minion.tempBuffs = [];
    updateEnrage(minion);
  });
}

function adjacentMinions(player: PlayerState, index: number): RuntimeMinion[] {
  return [player.board[index - 1], player.board[index + 1]].filter((minion): minion is RuntimeMinion => Boolean(minion));
}

function sourceMinionInPlay(context: EffectContext): { owner: PlayerState; minion: RuntimeMinion; index: number } | undefined {
  if (!context.source || context.source.type !== "MINION") return undefined;
  const owner = context.state.players[context.activeSeat];
  const index = owner.board.findIndex((minion) => minion.instanceId === context.source?.instanceId);
  if (index === -1) return undefined;
  return { owner, minion: owner.board[index], index };
}

function forEachMinion(state: MatchState, fn: (player: PlayerState, minion: RuntimeMinion) => void): void {
  for (const player of Object.values(state.players)) {
    for (const minion of player.board) fn(player, minion);
  }
}
