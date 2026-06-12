import { CARD_CATALOG, type AmplificationDbEntry } from "@twcardgame/cards";
import { AMPLIFICATION_TIERS, opponentOf, type AmplificationTier, type Seat } from "@twcardgame/shared";
import { addEvent, createCardForHand, nextInstanceId } from "../state.js";
import type { EffectContext, MatchState, PlayerState, RuntimeMinion } from "../types.js";
import { nextInt } from "../rng.js";
import { bounceMinion, drawCards, grantDivineShield, summonCard, updateEnrage } from "./core.js";
import { boardLimit } from "./environment.js";
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
  // Hand-card / board-minion instanceIds the client should glow when this augment
  // fires, so the player sees which cards/units the 增幅 changed (Part B). Left
  // empty for purely invisible effects (crystals / flags) → dot-only glow.
  const glowCards: string[] = [];
  const glowTargets: string[] = [];

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
        glowCards.push(card.instanceId);
      }
      triggered = true;
      break;
    case "AUG_HAND_COST_DELTA":
      for (const card of player.hand) {
        card.cost = Math.max(0, card.cost - (effect.value ?? 0));
        card.isReduced = true;
        glowCards.push(card.instanceId);
      }
      triggered = true;
      break;
    case "AUG_ADD_CARD_TO_HAND": {
      const card = effect.cardId ? CARD_CATALOG.find((candidate) => candidate.id === effect.cardId) : undefined;
      if (card) {
        for (let i = 0; i < (effect.count ?? effect.value ?? 1); i++) {
          if (player.hand.length < 10) {
            const added = createCardForHand(state, card, seat);
            player.hand.push(added);
            glowCards.push(added.instanceId);
          }
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
        if (minion.category === effect.target_category) {
          doubleMinionHealth(minion);
          glowTargets.push(minion.instanceId);
        }
      }
      triggered = true;
      break;
    case "AUG_PERSIST_LOWCOST_ATTACK":
      flags.lowCostMinionAttackBuff += effect.value ?? 0;
      for (const minion of player.board) {
        if (minion.cost >= 1 && minion.cost <= 3) {
          addStats(minion, effect.value ?? 0, 0);
          glowTargets.push(minion.instanceId);
        }
      }
      triggered = true;
      break;
    case "AUG_PERSIST_CATEGORY_BUFF": {
      const value = effect.value ?? 0;
      flags.categoryBuff = { category: effect.target_category ?? "", value };
      for (const minion of player.board) {
        if (minion.category === effect.target_category) {
          addStats(minion, value, value);
          glowTargets.push(minion.instanceId);
        }
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
      player.hero.hp += effect.value ?? 0;
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
          actorSeat: player.seat,
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
    case "AUG_SUMMON_CARD": {
      const targetSeat = effect.target?.side === "ENEMY" ? opponentOf(seat) : seat;
      const targetPlayer = state.players[targetSeat];
      const card = effect.cardId ? CATALOG_MAP.get(effect.cardId) : undefined;
      if (card) {
        for (let i = 0; i < (effect.count ?? 1); i++) summonCard(state, targetPlayer, card, events);
        triggered = true;
      }
      break;
    }
    case "AUG_ON_SUMMON_CATEGORY_SUMMON_ENEMY":
      if (effect.target_category && effect.cardId) {
        flags.summonEnemyOnCategory ??= [];
        flags.summonEnemyOnCategory.push({
          augmentId: entry.id,
          category: effect.target_category,
          cardId: effect.cardId,
          count: effect.count ?? 1
        });
      }
      break;
    case "AUG_CATEGORY_COST_REDUCTION":
      if (effect.target_category && (effect.value ?? 0) > 0) {
        flags.categoryCostReductions ??= [];
        flags.categoryCostReductions.push({ category: effect.target_category, value: effect.value ?? 0 });
        if (effect.keyword === "SHUFFLE_SELF_INTO_DECK") {
          flags.shuffleIntoDeckOnDeathCategories ??= [];
          flags.shuffleIntoDeckOnDeathCategories.push(effect.target_category);
        }
      }
      break;
    case "AUG_DRAW_CATEGORY": {
      for (let i = 0; i < (effect.value ?? 1); i++) {
        const index = player.deck.findIndex((card) => card.category === effect.target_category);
        if (index < 0) break;
        drawCards(state, player, 1, events, index);
        triggered = true;
      }
      break;
    }
    case "AUG_CATEGORY_DEATHRATTLE_ADJACENT_HEAL":
      if (effect.target_category && (effect.value ?? 0) > 0) {
        flags.categoryDeathrattleAdjacentHeals ??= [];
        flags.categoryDeathrattleAdjacentHeals.push({
          augmentId: entry.id,
          category: effect.target_category,
          value: effect.value ?? 0
        });
      }
      break;
    case "AUG_CATEGORY_DIVINE_SHIELD_ATTACK":
      if (effect.target_category && (effect.value ?? 0) > 0) {
        flags.categoryDivineShieldAttackBuffs ??= [];
        flags.categoryDivineShieldAttackBuffs.push({
          augmentId: entry.id,
          category: effect.target_category,
          value: effect.value ?? 0
        });
        for (const minion of player.board) {
          if (minion.category !== effect.target_category) continue;
          grantDivineShield(state, player, minion, events);
          glowTargets.push(minion.instanceId);
        }
        triggered = true;
      }
      break;
    case "AUG_SUMMON_RANDOM_CATEGORY_FROM_DECK_AND_DEATH_MANA": {
      const category = effect.target_category;
      if (!category) break;
      flags.categoryDeathManaGains ??= [];
      flags.categoryDeathManaGains.push({
        augmentId: entry.id,
        category,
        value: effect.value ?? 1
      });
      for (let i = 0; i < (effect.count ?? 1); i++) {
        const candidates = player.deck
          .map((card, index) => ({ card, index }))
          .filter(({ card }) => card.type === "MINION" && card.category === category);
        if (candidates.length === 0 || player.board.length >= boardLimit(state, seat)) break;
        const roll = nextInt(state.private.rngState, candidates.length);
        state.private.rngState = roll.state;
        const selected = candidates[roll.value];
        const definition = CATALOG_MAP.get(selected.card.cardId);
        if (!definition || !summonCard(state, player, definition, events)) break;
        player.deck.splice(selected.index, 1);
        glowTargets.push(player.board[player.board.length - 1].instanceId);
      }
      triggered = true;
      break;
    }
    default:
      break;
  }

  if (triggered) {
    addEvent(
      state,
      events,
      "AUGMENT_TRIGGERED",
      glowCardsOrTargetsPayload(entry.id, glowCards, glowTargets),
      seat
    );
  }
}

/** Builds the AUGMENT_TRIGGERED payload, omitting empty target/card arrays so the
 * event stays minimal (and old replays without these fields stay compatible). */
function glowCardsOrTargetsPayload(
  augmentId: string,
  cards: readonly string[],
  targets: readonly string[]
): Record<string, unknown> {
  const payload: Record<string, unknown> = { augmentId };
  if (cards.length > 0) payload.cards = [...cards];
  if (targets.length > 0) payload.targets = [...targets];
  return payload;
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
    doubleMinionHealth(minion);
    changed = true;
  }

  if (changed) {
    addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: `persist:${seat}`, targets: [minion.instanceId] }, seat);
  }
}

/** Resolves passive augments after a minion has entered the board. */
export function applyMinionSummonedAugments(state: MatchState, seat: Seat, minion: RuntimeMinion, events: Events): void {
  const flags = state.players[seat]?.augmentFlags;
  if (!flags) return;
  if (minion.keywords.divineShield) applyDivineShieldAttackAugments(state, state.players[seat], minion, events);
  for (const trigger of flags.summonEnemyOnCategory ?? []) {
    if (minion.category !== trigger.category) continue;
    const card = CATALOG_MAP.get(trigger.cardId);
    if (!card) continue;
    const enemy = state.players[opponentOf(seat)];
    const before = enemy.board.length;
    for (let i = 0; i < trigger.count; i++) summonCard(state, enemy, card, events);
    if (enemy.board.length > before) {
      addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: trigger.augmentId }, seat);
    }
  }
}

/** Applies attack buffs that trigger whenever a minion receives divine shield. */
export function applyDivineShieldAttackAugments(
  state: MatchState,
  player: PlayerState,
  minion: RuntimeMinion,
  events: Events
): void {
  const buffs = (player.augmentFlags.categoryDivineShieldAttackBuffs ?? []).filter(
    (buff) => minion.category === buff.category
  );
  const value = buffs.reduce((sum, buff) => sum + buff.value, 0);
  if (value <= 0) return;
  addStats(minion, value, 0);
  for (const buff of buffs) {
    addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: buff.augmentId, targets: [minion.instanceId] }, player.seat);
  }
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
  if (player.board.length >= boardLimit(state, player.seat)) return;

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
  // Distinct from a normal summon so quest detection can count "復活隨從".
  addEvent(state, events, "RESURRECT", { target: token.instanceId, cardId: token.cardId }, player.seat);
  applyMinionSummonedAugments(state, player.seat, token, events);
  addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: "AMP_PUDU", targets: [token.instanceId] }, player.seat);
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

function doubleMinionHealth(minion: RuntimeMinion): void {
  minion.health += minion.health;
  minion.currentHealth += minion.currentHealth;
  updateEnrage(minion);
}
