import type { EffectHandler } from "../types.js";
import {
  damageAllEnemyMinions,
  damageAllNonCategories,
  damageAndDrawIfKill,
  damageNonCategory,
  damageRandomFriendly,
  damageSelf,
  damageTarget,
  fullHeal,
  fullHealAndDraw,
  fullHealBuffTargetCategoryBonus,
  healAllFriendly,
  healCategoryBonus,
  healTarget,
  multiDamage
} from "./core.js";

export const damageHealHandlers: Record<string, EffectHandler> = {
  DAMAGE: damageTarget,
  DAMAGE_ALL_ENEMY_MINIONS: damageAllEnemyMinions,
  DAMAGE_ALL_NON_CATEGORIES: damageAllNonCategories,
  DAMAGE_AND_DRAW_IF_KILL: damageAndDrawIfKill,
  DAMAGE_NON_CATEGORY: damageNonCategory,
  DAMAGE_RANDOM_FRIENDLY: damageRandomFriendly,
  DAMAGE_SELF: damageSelf,
  FULL_HEAL: fullHeal,
  FULL_HEAL_AND_DRAW: fullHealAndDraw,
  FULL_HEAL_BUFF_TARGET_CATEGORY_BONUS: fullHealBuffTargetCategoryBonus,
  HEAL: healTarget,
  HEAL_ALL_FRIENDLY: healAllFriendly,
  HEAL_CATEGORY_BONUS: healCategoryBonus,
  MULTI_DAMAGE: multiDamage
};
