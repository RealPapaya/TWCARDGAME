import type { EffectDefinition } from "@twcardgame/cards";
import type { EffectContext, EffectHandler } from "../types.js";
import { applyNewsPower } from "./core.js";
import { buffKeywordLockHandlers } from "./buff-keyword-lock.js";
import { damageHealHandlers } from "./damage-heal.js";
import { handHandlers } from "./hand.js";
import { summonDestroyBounceHandlers } from "./summon-destroy-bounce.js";

export const effectHandlers: Record<string, EffectHandler> = {
  ...handHandlers,
  ...summonDestroyBounceHandlers,
  ...buffKeywordLockHandlers,
  ...damageHealHandlers
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
