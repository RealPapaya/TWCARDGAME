import type { EffectHandler } from "../types.js";
import {
  bounceAllCategory,
  bounceAllEnemy,
  bounceCategory,
  bounceRandomEnemy,
  bounceTarget,
  destroyAllMinions,
  destroyDamaged,
  destroyHighAttack,
  destroyLocked,
  destroyLowAttack,
  destroyTarget,
  summonMultiple
} from "./core.js";

export const summonDestroyBounceHandlers: Record<string, EffectHandler> = {
  BOUNCE: bounceTarget,
  BOUNCE_ALL_CATEGORY: bounceAllCategory,
  BOUNCE_ALL_ENEMY: bounceAllEnemy,
  BOUNCE_CATEGORY: bounceCategory,
  BOUNCE_RANDOM_ENEMY: bounceRandomEnemy,
  BOUNCE_TARGET: bounceTarget,
  DESTROY: destroyTarget,
  DESTROY_ALL_MINIONS: destroyAllMinions,
  DESTROY_DAMAGED: destroyDamaged,
  DESTROY_HIGH_ATTACK: destroyHighAttack,
  DESTROY_LOCKED: destroyLocked,
  DESTROY_LOW_ATTACK: destroyLowAttack,
  SUMMON_MULTIPLE: summonMultiple
};
