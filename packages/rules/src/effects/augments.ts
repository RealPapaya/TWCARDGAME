import { CARD_CATALOG, type AmplificationDbEntry } from "@twcardgame/cards";
import { AMPLIFICATION_TIERS, type AmplificationTier, type Seat } from "@twcardgame/shared";
import { addEvent, createCardForHand, nextInstanceId } from "../state.js";
import type { EffectContext, MatchState, PlayerState, RuntimeMinion } from "../types.js";
import { bounceMinion, drawCards, updateEnrage } from "./core.js";
import { unlockLowHpManaCap } from "./augmentFlags.js";

/**
 * 【動態增幅 — 集中解析模組】
 * 增幅不走 card `resolveEffect` 路徑（其 context 以 activeSeat 為主，無法表達
 * 「綁定特定 seat、不分回合」）。選擇時由 {@link applyAugmentSelection} 依
 * `AUG_*` 型別分流：即時授予 / 設旗標 / 手牌快照 / 回溯持續增益；被動者由各
 * chokepoint 讀 `augmentFlags`（見 [[augmentFlags.ts]]）。資料在
 * `packages/cards/src/amplificationDb.ts`。
 */

type Events = EffectContext["events"];

const CATALOG_MAP = new Map(CARD_CATALOG.map((card) => [card.id, card]));

/** Raises a tier one step (加減賺→穩穩仔賺→卯死), capped at 卯死. Used by 0050. */
export function bumpTier(tier: AmplificationTier): AmplificationTier {
  const index = AMPLIFICATION_TIERS.indexOf(tier);
  return AMPLIFICATION_TIERS[Math.min(index + 1, AMPLIFICATION_TIERS.length - 1)];
}

/**
 * Binds one chosen augment to `seat`: resolves its one-shot effect now, sets the
 * derived flags consulted by passive readers, and retroactively buffs the current
 * board for persistent minion augments. Called from `resolveAmplificationPhase`.
 */
export function applyAugmentSelection(state: MatchState, seat: Seat, entry: AmplificationDbEntry, events: Events): void {
  const player = state.players[seat];
  const flags = player.augmentFlags;
  const effect = entry.effect;
  let triggered = false;

  switch (effect.type) {
    case "AUG_GRANT_CRYSTALS":
      player.mana.current += effect.crystals ?? 0;
      player.mana.max += effect.crystals ?? 0;
      flags.manaCapBonus = (flags.manaCapBonus ?? 0) + (effect.crystals ?? 0);
      triggered = true;
      break;
    case "AUG_GRANT_CRYSTALS_NEXT_TURN":
      flags.bonusCrystalsNextTurn = (flags.bonusCrystalsNextTurn ?? 0) + (effect.crystals ?? 0);
      flags.bonusCrystalsNextTurnSources ??= [];
      flags.bonusCrystalsNextTurnSources.push(entry.id);
      break;
    case "AUG_NEXT_DRAW_HALF":
      flags.nextDrawHalfCost = true;
      break;
    case "AUG_HAND_COST_SET":
      for (const card of player.hand) {
        card.cost = Math.max(0, effect.value ?? 1);
        card.isReduced = true;
      }
      triggered = true;
      break;
    case "AUG_HAND_COST_DELTA":
      for (const card of player.hand) {
        card.cost = Math.max(0, card.cost - (effect.value ?? 0));
        card.isReduced = true;
      }
      triggered = true;
      break;
    case "AUG_ADD_CARD_TO_HAND": {
      const card = effect.cardId ? CARD_CATALOG.find((candidate) => candidate.id === effect.cardId) : undefined;
      if (card) {
        for (let i = 0; i < (effect.count ?? effect.value ?? 1); i++) {
          if (player.hand.length < 10) player.hand.push(createCardForHand(state, card, seat));
        }
        triggered = true;
      }
      break;
    }
    case "AUG_FREEZE":
      player.mana.current += effect.crystals ?? 0;
      flags.frozenUntilTurn = state.turn.number + (effect.durationTurns ?? 0);
      triggered = true;
      break;
    case "AUG_REVIVE_VANILLA":
      flags.reviveOnceAsVanilla = true;
      break;
    case "AUG_DAMAGE_REDUCTION":
      flags.damageReductionPerInstance += effect.value ?? 0;
      break;
    case "AUG_DOUBLE_CATEGORY":
      flags.doubleCategory = effect.target_category;
      for (const minion of player.board) {
        if (minion.category === effect.target_category) doubleMinion(minion);
      }
      triggered = true;
      break;
    case "AUG_PERSIST_LOWCOST_ATTACK":
      flags.lowCostMinionAttackBuff += effect.value ?? 0;
      for (const minion of player.board) {
        if (minion.cost >= 1 && minion.cost <= 3) addStats(minion, effect.value ?? 0, 0);
      }
      triggered = true;
      break;
    case "AUG_PERSIST_CATEGORY_BUFF": {
      const value = effect.value ?? 0;
      flags.categoryBuff = { category: effect.target_category ?? "", value };
      for (const minion of player.board) {
        if (minion.category === effect.target_category) addStats(minion, value, value);
      }
      triggered = true;
      break;
    }
    case "AUG_NEWS_COST":
      flags.newsCostReduce += effect.value ?? 0;
      break;
    case "AUG_BUILDING_COST":
      flags.buildingCostReduce += effect.value ?? 0;
      break;
    case "AUG_COST_MULTIPLIER":
      flags.costMultiplierTenths = effect.value;
      flags.costMultiplierAfterTurn = effect.turns;
      break;
    case "AUG_PLAYED_MAXHP":
      flags.playedMinionMaxHpBonus += effect.value ?? 0;
      break;
    case "AUG_EXTRA_DRAW_TURNS":
      flags.extraDrawTurnsRemaining += effect.durationTurns ?? 0;
      break;
    case "AUG_REFERENDUM_IMMUNE":
      flags.referendumImmune = true;
      break;
    case "AUG_RAISE_NEXT_TIER":
      state.augmentTiers[1] = bumpTier(state.augmentTiers[1]);
      break;
    case "AUG_EXTRA_AMP_REROLL_NEXT_PHASE":
      flags.extraAmplificationRerollsNextPhase += effect.value ?? 1;
      break;
    case "AUG_MANA_RAMP_AFTER_TURN":
      if (effect.turnThreshold && effect.manaCap && effect.manaGrowth) {
        flags.manaRamps ??= [];
        flags.manaRamps.push({
          augmentId: entry.id,
          turnThreshold: effect.turnThreshold,
          cap: effect.manaCap,
          growth: effect.manaGrowth
        });
      }
      break;
    case "AUG_MANA_CAP_LOW_HP":
      flags.lowHpManaCapThreshold = effect.heroHpThreshold;
      flags.lowHpManaCap = effect.manaCap;
      if (effect.heroHpThreshold !== undefined && player.hero.hp <= effect.heroHpThreshold) {
        flags.lowHpManaCapUnlocked = true;
        triggered = true;
      }
      break;
    case "AUG_HERO_MAX_HP":
      player.hero.maxHp += effect.value ?? 0;
      triggered = true;
      break;
    case "AUG_PAY_COST_WITH_HEALTH_NEXT_TURN":
      flags.payCostWithHealthNextTurn = true;
      break;
    case "AUG_SELF_HP_LOSS_GRANT_CRYSTALS_NEXT_TURN": {
      const health = effect.health ?? effect.value ?? 0;
      player.hero.hp -= health;
      addEvent(state, events, "DAMAGE", { target: `${seat}:hero`, amount: health, lifeLoss: true }, seat);
      if (unlockLowHpManaCap(player)) {
        addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: "AMP_LIFE_INSURANCE" }, seat);
      }
      flags.bonusCrystalsNextTurn = (flags.bonusCrystalsNextTurn ?? 0) + (effect.crystals ?? 0);
      flags.bonusCrystalsNextTurnSources ??= [];
      flags.bonusCrystalsNextTurnSources.push(entry.id);
      triggered = true;
      break;
    }
    case "AUG_BOUNCE_OWN_BOARD_TO_HAND_BUFF": {
      const value = effect.value ?? 0;
      const costReduction = effect.costReduction ?? 0;
      for (const minion of [...player.board]) {
        bounceMinion(state, player, minion, CATALOG_MAP, events, {
          transformReturnedCard: (card) => {
            card.attack = (card.attack ?? 0) + value;
            card.health = (card.health ?? 0) + value;
            if (costReduction > 0) {
              const old = card.cost;
              card.cost = Math.max(0, card.cost - costReduction);
              if (card.cost !== old) card.isReduced = true;
            }
          }
        });
      }
      triggered = true;
      break;
    }
    case "AUG_DESTROYED_MINION_COST_REBATE":
      flags.destroyedMinionCostRebate = true;
      break;
    default:
      break;
  }

  if (triggered) addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: entry.id }, seat);
}

/**
 * Applies a player's persistent minion augments to a minion they have just played
 * or summoned. Additive buffs first, doubling last (so it doubles the buffed line).
 * NOT applied to 普渡 revive tokens (they are forced 1/1 by {@link tryReviveMinion}).
 */
export function applyPersistentMinionAugments(state: MatchState, seat: Seat, minion: RuntimeMinion, events: Events): void {
  const flags = state.players[seat]?.augmentFlags;
  if (!flags) return;
  let changed = false;

  if (flags.lowCostMinionAttackBuff > 0 && minion.cost >= 1 && minion.cost <= 3) {
    addStats(minion, flags.lowCostMinionAttackBuff, 0);
    changed = true;
  }
  if (flags.playedMinionMaxHpBonus > 0) {
    addStats(minion, 0, flags.playedMinionMaxHpBonus);
    changed = true;
  }
  if (flags.categoryBuff && minion.category === flags.categoryBuff.category) {
    addStats(minion, flags.categoryBuff.value, flags.categoryBuff.value);
    changed = true;
  }
  if (flags.doubleCategory && minion.category === flags.doubleCategory) {
    doubleMinion(minion);
    changed = true;
  }

  if (changed) addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: `persist:${seat}` }, seat);
}

/**
 * Resolves a player's start-of-turn augment grants: deferred crystals (消費券3600,
 * one-shot) and extra draws (大薯買一送一, N turns), then clears an expired freeze.
 * Called from `startTurn` after the normal mana refill + draw.
 */
export function applyStartOfTurnAugments(state: MatchState, player: PlayerState, events: Events): void {
  const flags = player.augmentFlags;

  if (flags.bonusCrystalsNextTurn && flags.bonusCrystalsNextTurn > 0) {
    player.mana.current += flags.bonusCrystalsNextTurn;
    flags.bonusCrystalsNextTurn = undefined;
    const sources = flags.bonusCrystalsNextTurnSources?.length ? flags.bonusCrystalsNextTurnSources : ["AMP_VOUCHER_3600"];
    for (const augmentId of sources) addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId }, player.seat);
    flags.bonusCrystalsNextTurnSources = [];
  }

  if (flags.payCostWithHealthNextTurn) {
    flags.payCostWithHealthNextTurn = false;
    flags.payCostWithHealthThisTurn = true;
    addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: "AMP_TAIJI_ELECTRIC_OFFER" }, player.seat);
  }

  if (flags.extraDrawTurnsRemaining > 0) {
    flags.extraDrawTurnsRemaining -= 1;
    drawCards(state, player, 1, events);
    addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: "AMP_FRIES_BOGO" }, player.seat);
  }

  if (flags.frozenUntilTurn !== undefined && state.turn.number > flags.frozenUntilTurn) {
    flags.frozenUntilTurn = undefined;
  }
}

/**
 * 普渡: when one of the augment holder's minions dies, spawn a 1/1 vanilla token of
 * the same card once. The token is flagged so it cannot itself re-revive, and is
 * built directly (bypassing persistent-buff hooks) to stay a clean 1/1. Called from
 * `resolveDeaths` after the deathrattle, when board space allows.
 */
export function tryReviveMinion(state: MatchState, player: PlayerState, deadMinion: RuntimeMinion, events: Events): void {
  const flags = player.augmentFlags;
  if (!flags?.reviveOnceAsVanilla) return;
  if (deadMinion.revivedByPurdo) return;
  if (player.board.length >= 7) return;

  const token: RuntimeMinion = {
    instanceId: nextInstanceId(state, "minion"),
    cardId: deadMinion.cardId,
    ownerSeat: player.seat,
    name: deadMinion.name,
    category: deadMinion.category,
    cost: deadMinion.cost,
    type: "MINION",
    rarity: deadMinion.rarity,
    attack: 1,
    baseAttack: 1,
    health: 1,
    currentHealth: 1,
    keywords: {},
    sleeping: true,
    canAttack: false,
    isEnraged: false,
    lockedTurns: 0,
    auraAttack: 0,
    auraHealth: 0,
    auraTaunt: false,
    tempBuffs: [],
    revivedByPurdo: true
  };
  player.board.push(token);
  addEvent(state, events, "MINION_SUMMONED", { target: token.instanceId, cardId: token.cardId }, player.seat);
  addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: "AMP_PUDU" }, player.seat);
}

/** Mirrors core `buffMinion`: adds to attack/health/currentHealth directly (aura diffs are preserved). */
function addStats(minion: RuntimeMinion, attack: number, health: number): void {
  if (attack === 0 && health === 0) return;
  minion.attack += attack;
  if (health !== 0) {
    minion.health += health;
    minion.currentHealth += health;
  }
  updateEnrage(minion);
}

function doubleMinion(minion: RuntimeMinion): void {
  minion.attack += minion.attack;
  minion.health += minion.health;
  minion.currentHealth += minion.currentHealth;
  updateEnrage(minion);
}
