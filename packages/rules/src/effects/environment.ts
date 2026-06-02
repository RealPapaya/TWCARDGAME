import type { EffectDefinition } from "@twcardgame/cards";
import { addEvent } from "../state.js";
import type { ActiveEnvironment, EffectContext, EffectHandler, MatchState } from "../types.js";

/**
 * Global environment effects installed by the turn-20 referendum
 * (`currentEnvironment`). Two of the three "proven" vote effects route through
 * here as ongoing environments (大停電 silence, 油電雙漲 cost penalty); the third
 * (莫拉克颱風) is an IMMEDIATE `DESTROY_ALL_MINIONS` resolved through the existing
 * registry handler. `NOOP` is registered so the many stubbed DB slots resolve
 * harmlessly instead of throwing `Unhandled effect type`.
 */

/** Cost penalty currently imposed by the environment (e.g. 油電雙漲 +2). Read by `getCardActualCost`. */
export function environmentCostDelta(state: MatchState): number {
  const env = state.currentEnvironment;
  if (!env || !isEnvironmentActive(state, env)) return 0;
  if (env.effect.type === "ENV_COST_PLUS_CAPPED") return env.effect.value ?? 0;
  return 0;
}

function isEnvironmentActive(state: MatchState, env: ActiveEnvironment): boolean {
  return env.expiresTurn === undefined || state.turn.number <= env.expiresTurn;
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
}

function silenceAllMinions(state: MatchState): void {
  for (const player of Object.values(state.players)) {
    for (const minion of player.board) {
      minion.lockedTurns = Math.max(minion.lockedTurns, 1);
      minion.canAttack = false;
    }
  }
}

export const environmentHandlers: Record<string, EffectHandler> = {
  NOOP: () => {},
  // Passive: the penalty is read in getCardActualCost while the environment is active.
  ENV_COST_PLUS_CAPPED: () => {},
  ENV_SILENCE_ALL: (_effect: EffectDefinition, context: EffectContext) => silenceAllMinions(context.state)
};
