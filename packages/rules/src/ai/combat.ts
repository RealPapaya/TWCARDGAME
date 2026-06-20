import type { RuntimeMinion } from "../types.js";

/**
 * Divine-shield-aware combat math. The legacy `scoreAttack` treated a swing as a
 * kill whenever `attack >= currentHealth`, ignoring that a divine shield absorbs
 * the whole hit (the unit survives and the shield pops). These helpers model that
 * so the engines stop wasting big attackers popping shields and stop "trading"
 * into a shielded defender that won't die.
 */
export interface TradeOutcome {
  /** The attacker dies to the defender's retaliation. */
  attackerDies: boolean;
  /** The defender dies to the attacker's swing. */
  defenderDies: boolean;
  /** The defender had a shield that absorbed the swing (so it survives this hit). */
  defenderShieldPopped: boolean;
  /** The attacker had a shield that absorbed the retaliation. */
  attackerShieldPopped: boolean;
}

export function resolveMinionTrade(attacker: RuntimeMinion, defender: RuntimeMinion): TradeOutcome {
  const defenderShield = defender.keywords.divineShield === true;
  const attackerShield = attacker.keywords.divineShield === true;
  const attackerHits = attacker.attack > 0;
  const defenderHits = defender.attack > 0;
  return {
    defenderDies: attackerHits && !defenderShield && attacker.attack >= defender.currentHealth,
    attackerDies: defenderHits && !attackerShield && defender.attack >= attacker.currentHealth,
    defenderShieldPopped: attackerHits && defenderShield,
    attackerShieldPopped: defenderHits && attackerShield
  };
}

/** True iff a minion can swing this turn (matches `legalMoves`' `canAttackerSwing`). */
export function canSwing(minion: RuntimeMinion): boolean {
  return !minion.sleeping && minion.canAttack && minion.lockedTurns <= 0 && minion.attack > 0;
}

/** Total face damage the board could deal THIS turn if nothing blocks (caller checks taunt). */
export function totalReachableFaceDamage(board: readonly RuntimeMinion[]): number {
  let damage = 0;
  for (const minion of board) {
    if (canSwing(minion)) damage += minion.attack;
  }
  return damage;
}

export function enemyHasTaunt(board: readonly RuntimeMinion[]): boolean {
  return board.some((minion) => minion.keywords.taunt === true);
}
