import type { Seat } from "@twcardgame/shared";
import type { AugmentFlags, MatchState, RuntimeCard } from "../types.js";

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
    damageReductionPerInstance: 0,
    reviveOnceAsVanilla: false,
    referendumImmune: false,
    extraDrawTurnsRemaining: 0
  };
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

/** 言論自由 / 新青安: flat cost reduction for a specific card, read by `getCardActualCost`. */
export function augmentFlatCostReduction(state: MatchState, seat: Seat, card: RuntimeCard): number {
  const flags = state.players[seat]?.augmentFlags;
  if (!flags) return 0;
  let reduction = 0;
  if (card.type === "NEWS") reduction += flags.newsCostReduce;
  if (card.category === "建築") reduction += flags.buildingCostReduce;
  return reduction;
}

/** 乞丐超人: cost multiplier in tenths (7 = ×0.7) once past the augment's turn threshold; else undefined. */
export function augmentCostMultiplierTenths(state: MatchState, seat: Seat): number | undefined {
  const flags = state.players[seat]?.augmentFlags;
  if (!flags || flags.costMultiplierTenths === undefined || flags.costMultiplierAfterTurn === undefined) return undefined;
  return state.turn.number > flags.costMultiplierAfterTurn ? flags.costMultiplierTenths : undefined;
}
