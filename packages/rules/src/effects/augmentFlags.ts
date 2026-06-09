import type { Seat } from "@twcardgame/shared";
import type { AugmentFlags, MatchState, PlayerState, RuntimeCard } from "../types.js";

/**
 * Pure, dependency-light readers for a player's derived augment flags. Kept in
 * their own module (no `core`/`state` imports) so the hot paths — `getCardActualCost`,
 * `applyDamage`, `legalMoves` — and the engine can consult them without pulling
 * in the heavy `applyAugmentSelection` resolution module or risking import cycles.
 */

export function defaultAugmentFlags(): AugmentFlags {
  return {
    newsCostReduce: 0,
    buildingCostReduce: 0,
    nextDrawHalfCost: false,
    lowCostMinionAttackBuff: 0,
    playedMinionMaxHpBonus: 0,
    categoryCostReductions: [],
    summonEnemyOnCategory: [],
    damageReductionPerInstance: 0,
    reviveOnceAsVanilla: false,
    referendumImmune: false,
    bonusCrystalsNextTurnSources: [],
    extraDrawTurnsRemaining: 0,
    extraAmplificationRerollsNextPhase: 0,
    destroyedMinionCostRebate: false,
    payCostWithHealthNextTurn: false,
    payCostWithHealthThisTurn: false,
    manaRamps: [],
    manaCapBonus: 0,
    lowHpManaCapUnlocked: false
  };
}

/** Resolves the active mana cap/growth without stacking multiple ramp speeds. */
export function augmentManaRamp(state: MatchState, seat: Seat): { cap: number; growth: number; unlockedLowHpCap: boolean } {
  const player = state.players[seat];
  const flags = player?.augmentFlags;
  if (!player || !flags) return { cap: 10, growth: 1, unlockedLowHpCap: false };

  const unlockedLowHpCap = unlockLowHpManaCap(player);

  const capBonus = flags.manaCapBonus ?? 0;
  let cap = (flags.lowHpManaCapUnlocked ? flags.lowHpManaCap ?? 10 : 10) + capBonus;
  let growth = 1;
  for (const ramp of flags.manaRamps ?? []) {
    if (state.turn.number < ramp.turnThreshold) continue;
    cap = Math.max(cap, ramp.cap + capBonus);
    growth = Math.max(growth, ramp.growth);
  }
  return { cap, growth, unlockedLowHpCap };
}

/** Latches 壽險理賠 as soon as the hero reaches its configured HP threshold. */
export function unlockLowHpManaCap(player: PlayerState): boolean {
  const flags = player.augmentFlags;
  if (flags.lowHpManaCapUnlocked || flags.lowHpManaCapThreshold === undefined || player.hero.hp > flags.lowHpManaCapThreshold) {
    return false;
  }
  flags.lowHpManaCapUnlocked = true;
  return true;
}

/** 違約交割: the seat cannot attack or play cards until its freeze window lapses. */
export function isFrozen(state: MatchState, seat: Seat): boolean {
  const until = state.players[seat]?.augmentFlags?.frozenUntilTurn;
  return until !== undefined && state.turn.number <= until;
}

/** 潛逃國外: the seat is exempt from the turn-20 referendum effect. */
export function isReferendumImmune(state: MatchState, seat: Seat): boolean {
  return state.players[seat]?.augmentFlags?.referendumImmune === true;
}

/** 言論自由 / 新青年安心成家貸款: flat cost reduction for a specific card, read by `getCardActualCost`. */
export function augmentFlatCostReduction(state: MatchState, seat: Seat, card: RuntimeCard): number {
  const flags = state.players[seat]?.augmentFlags;
  if (!flags) return 0;
  let reduction = 0;
  if (card.type === "NEWS") reduction += flags.newsCostReduce;
  if (card.category === "建築") reduction += flags.buildingCostReduce;
  for (const categoryReduction of flags.categoryCostReductions ?? []) {
    if (card.category === categoryReduction.category) reduction += categoryReduction.value;
  }
  return reduction;
}

/** 乞丐超人: cost multiplier in tenths (7 = ×0.7) once past the augment's turn threshold; else undefined. */
export function augmentCostMultiplierTenths(state: MatchState, seat: Seat): number | undefined {
  const flags = state.players[seat]?.augmentFlags;
  if (!flags || flags.costMultiplierTenths === undefined || flags.costMultiplierAfterTurn === undefined) return undefined;
  return state.turn.number > flags.costMultiplierAfterTurn ? flags.costMultiplierTenths : undefined;
}

/** 台雞電OFFER: this turn's card costs are paid with hero HP instead of mana. */
export function paysCardCostWithHealth(state: MatchState, seat: Seat): boolean {
  return state.players[seat]?.augmentFlags?.payCostWithHealthThisTurn === true;
}
