import type { EffectDefinition } from "@twcardgame/cards";
import { SEATS, type Seat } from "@twcardgame/shared";
import { addEvent } from "../state.js";
import type { ActiveEnvironment, EffectContext, EffectHandler, MatchState, RuntimeCard, RuntimeMinion } from "../types.js";

/**
 * Global environment effects installed by the turn-20 referendum
 * (`currentEnvironment`). Two of the three "proven" vote effects route through
 * here as ongoing environments (大停電 silence, 油電雙漲 cost penalty); the third
 * (莫拉克颱風) is an IMMEDIATE `DESTROY_ALL_MINIONS` resolved through the existing
 * registry handler. `NOOP` is registered so the many stubbed DB slots resolve
 * harmlessly instead of throwing `Unhandled effect type`.
 */

/** Default maximum number of minions a single side may field on the board. */
export const DEFAULT_BOARD_LIMIT = 7;

/**
 * Maximum minions `seat` may field, honouring the 社交距離 referendum environment
 * (`ENV_BOARD_LIMIT`, e.g. cap 3). A referendum-immune seat keeps the default cap,
 * matching how the other persistent environments skip immune players.
 */
export function boardLimit(state: MatchState, seat: Seat): number {
  const env = state.currentEnvironment;
  if (!env || !isEnvironmentActive(state, env)) return DEFAULT_BOARD_LIMIT;
  if (env.effect.type !== "ENV_BOARD_LIMIT") return DEFAULT_BOARD_LIMIT;
  if (state.players[seat].augmentFlags.referendumImmune) return DEFAULT_BOARD_LIMIT;
  return env.effect.value ?? DEFAULT_BOARD_LIMIT;
}

/**
 * The board cap imposed by the active environment, ignoring per-seat immunity.
 * Used for the global public projection that drives the client's board spacing.
 */
export function environmentBoardLimit(state: MatchState): number {
  const env = state.currentEnvironment;
  if (!env || !isEnvironmentActive(state, env)) return DEFAULT_BOARD_LIMIT;
  if (env.effect.type !== "ENV_BOARD_LIMIT") return DEFAULT_BOARD_LIMIT;
  return env.effect.value ?? DEFAULT_BOARD_LIMIT;
}

/** Cost penalty currently imposed by the environment (e.g. 油電雙漲 +2). Read by `getCardActualCost`. */
export function environmentCostDelta(state: MatchState): number {
  const env = state.currentEnvironment;
  if (!env || !isEnvironmentActive(state, env)) return 0;
  if (env.effect.type === "ENV_COST_PLUS_CAPPED") return env.effect.value ?? 0;
  return 0;
}

export function environmentTurnTimeLimitMs(state: MatchState, seat: Seat): number | undefined {
  const env = state.currentEnvironment;
  if (!env || !isEnvironmentActive(state, env)) return undefined;
  if (env.effect.type !== "ENV_TURN_TIME_LIMIT_MS") return undefined;
  if (state.players[seat].augmentFlags.referendumImmune) return undefined;
  return env.effect.value;
}

export function environmentDisablesMinionEffects(state: MatchState, seat: Seat): boolean {
  const env = state.currentEnvironment;
  if (!env || !isEnvironmentActive(state, env)) return false;
  if (env.effect.type !== "ENV_DISABLE_ALL_MINION_EFFECTS") return false;
  return !state.players[seat].augmentFlags.referendumImmune;
}

export function environmentAttackerDamage(state: MatchState, seat: Seat): number {
  const env = state.currentEnvironment;
  if (!env || !isEnvironmentActive(state, env)) return 0;
  if (env.effect.type !== "ENV_ATTACKER_TAKES_DAMAGE") return 0;
  if (state.players[seat].augmentFlags.referendumImmune) return 0;
  return env.effect.value ?? 1;
}

export function isEnvironmentActive(state: MatchState, env: ActiveEnvironment): boolean {
  return env.expiresTurn === undefined || state.turn.number < env.expiresTurn;
}

/**
 * Advances the active environment one turn: expires it when its window has
 * lapsed, otherwise re-applies any ongoing effect (so newly summoned minions
 * inherit a silence). Called from `startTurn` before the special-phase trigger.
 */
export function applyEnvironmentTick(state: MatchState, events: EffectContext["events"]): void {
  const env = state.currentEnvironment;
  if (!env) return;
  if (!isEnvironmentActive(state, env)) {
    state.currentEnvironment = undefined;
    addEvent(state, events, "ENVIRONMENT_EXPIRED", { id: env.id, name: env.name });
    return;
  }
  if (env.effect.type === "ENV_SILENCE_ALL") silenceAllMinions(state);
  if (env.effect.type === "ENV_DISABLE_ALL_MINION_EFFECTS") disableAllMinionEffects(state);
}

function silenceAllMinions(state: MatchState): void {
  for (const player of Object.values(state.players)) {
    // 潛逃國外: the referendum silence environment skips an immune player's board.
    if (player.augmentFlags.referendumImmune) continue;
    for (const minion of player.board) {
      minion.lockedTurns = Math.max(minion.lockedTurns, 1);
      minion.canAttack = false;
    }
  }
}

function disableAllMinionEffects(state: MatchState): void {
  for (const seat of SEATS) {
    if (!environmentDisablesMinionEffects(state, seat)) continue;
    const player = state.players[seat];
    for (const card of player.deck) disableCardMinionEffects(card);
    for (const card of player.hand) disableCardMinionEffects(card);
    for (const card of player.graveyard) disableCardMinionEffects(card);
    for (const minion of player.board) disableRuntimeMinionEffects(minion);
  }
}

export function suppressRuntimeCardMinionEffects(state: MatchState, seat: Seat, card: RuntimeCard): void {
  if (!environmentDisablesMinionEffects(state, seat)) return;
  disableCardMinionEffects(card);
}

export function suppressRuntimeMinionEffects(state: MatchState, seat: Seat, minion: RuntimeMinion): void {
  if (!environmentDisablesMinionEffects(state, seat)) return;
  disableRuntimeMinionEffects(minion);
}

function disableCardMinionEffects(card: RuntimeCard): void {
  if (card.type !== "MINION") return;
  card.keywords = {};
}

function disableRuntimeMinionEffects(minion: RuntimeMinion): void {
  if (minion.isEnraged && minion.keywords.enrage?.type === "BUFF_STAT" && minion.keywords.enrage.stat === "ATTACK") {
    minion.attack -= minion.keywords.enrage.value ?? 0;
  }
  for (const buff of minion.tempBuffs) {
    minion.attack -= buff.attack;
    minion.health -= buff.health;
  }
  minion.attack -= minion.auraAttack;
  minion.health -= minion.auraHealth;
  if (minion.currentHealth > minion.health) minion.currentHealth = minion.health;
  minion.keywords = {};
  minion.tempBuffs = [];
  minion.auraAttack = 0;
  minion.auraHealth = 0;
  minion.auraTaunt = false;
  minion.isEnraged = false;
  delete minion.questTurns;
  delete minion.deathTimer;
  delete minion.temporaryUntilTurn;
}

export const environmentHandlers: Record<string, EffectHandler> = {
  NOOP: () => {},
  // Passive: the penalty is read in getCardActualCost while the environment is active.
  ENV_COST_PLUS_CAPPED: () => {},
  ENV_SILENCE_ALL: (_effect: EffectDefinition, context: EffectContext) => silenceAllMinions(context.state),
  ENV_TURN_TIME_LIMIT_MS: () => {},
  ENV_ATTACKER_TAKES_DAMAGE: () => {},
  // Passive: the cap is read in boardLimit() while the environment is active; the
  // one-time board trim runs from applyVoteEventEffect when the event installs.
  ENV_BOARD_LIMIT: () => {},
  ENV_DISABLE_ALL_MINION_EFFECTS: (_effect: EffectDefinition, context: EffectContext) => disableAllMinionEffects(context.state)
};
