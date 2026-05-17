import type { CardType, Rarity } from "@twcardgame/shared";

export type StatName = "ATTACK" | "HEALTH" | "ALL";

export interface TargetRule {
  side?: "FRIENDLY" | "ENEMY" | "ALL";
  type?: "MINION" | "HERO" | "ALL";
}

export interface EffectDefinition {
  type?: string;
  value?: number;
  attack?: number;
  bonus_value?: number;
  stat?: StatName;
  target?: TargetRule;
  target_category?: string;
  target_category_includes?: string;
  excluded_categories?: string[];
  buff_stat?: StatName;
  buff_value?: number;
  keyword?: string;
  cardId?: string;
  count?: number;
  isTemporary?: boolean;
  summon?: string[];
  discardCount?: number;
  drawCount?: number;
  action?: string;
  turns?: number;
  summonCardId?: string;
  effect?: EffectDefinition;
}

export interface CardKeywords {
  taunt?: boolean;
  charge?: boolean;
  divineShield?: boolean;
  battlecry?: EffectDefinition;
  deathrattle?: EffectDefinition;
  ongoing?: EffectDefinition;
  enrage?: EffectDefinition;
  triggered?: EffectDefinition;
  quest?: EffectDefinition;
  onDiscard?: "SUMMON" | string;
  newsPower?: number;
  baseTaunt?: boolean;
}

export interface CardDefinition {
  id: string;
  name: string;
  category: string;
  cost: number;
  type: CardType;
  rarity: Rarity;
  description: string;
  image: string;
  attack?: number;
  health?: number;
  keywords?: CardKeywords;
  collectible?: boolean;
  bounce_bonus?: number;
}

export const SUPPORTED_BATTLECRY_EFFECTS = [
  "ADD_CARD_TO_HAND",
  "BOUNCE",
  "BOUNCE_ALL_CATEGORY",
  "BOUNCE_ALL_ENEMY",
  "BOUNCE_CATEGORY",
  "BOUNCE_RANDOM_ENEMY",
  "BOUNCE_TARGET",
  "BUFF_ADJACENT",
  "BUFF_ALL",
  "BUFF_CATEGORY",
  "BUFF_HEALTH_AND_TAUNT_TARGET",
  "BUFF_STAT_TARGET",
  "BUFF_STAT_TARGET_CATEGORY_BONUS",
  "BUFF_STAT_TARGET_TEMP",
  "DAMAGE",
  "DAMAGE_ALL_ENEMY_MINIONS",
  "DAMAGE_ALL_NON_CATEGORIES",
  "DAMAGE_AND_DRAW_IF_KILL",
  "DAMAGE_NON_CATEGORY",
  "DAMAGE_RANDOM_FRIENDLY",
  "DAMAGE_SELF",
  "DESTROY",
  "DESTROY_ALL_MINIONS",
  "DESTROY_DAMAGED",
  "DESTROY_HIGH_ATTACK",
  "DESTROY_LOCKED",
  "DESTROY_LOW_ATTACK",
  "DISCARD_DRAW",
  "DISCARD_RANDOM",
  "DRAW",
  "DRAW_MINION_REDUCE_COST",
  "DRAW_NEWS",
  "EAT_FRIENDLY",
  "FULL_HEAL",
  "FULL_HEAL_AND_DRAW",
  "GIVE_DIVINE_SHIELD",
  "GIVE_DIVINE_SHIELD_ALL",
  "GIVE_DIVINE_SHIELD_CATEGORY",
  "GIVE_KEYWORD_ADJACENT",
  "HEAL",
  "HEAL_ALL_FRIENDLY",
  "HEAL_CATEGORY_BONUS",
  "LOCK_ALL_AND_BUFF_CATEGORY",
  "LOCK_ALL_ENEMY",
  "LOCK_ATTACK",
  "LOCK_SELF",
  "MULTI_DAMAGE",
  "REDUCE_COST_ALL_HAND",
  "SET_ATTACK_ALL",
  "SET_DEATH_TIMER",
  "SUMMON_MULTIPLE",
  "SWAP_ATTACK_HEALTH",
  "UNLOCK_AND_BUFF_HEALTH"
] as const;

export const SUPPORTED_DEATHRATTLE_EFFECTS = ["BOUNCE_SELF", "DRAW", "SUMMON"] as const;
export const SUPPORTED_ONGOING_EFFECTS = [
  "ADJACENT_BUFF_CATEGORY_ATTRS",
  "ADJACENT_BUFF_STATS",
  "REDUCE_NEWS_COST"
] as const;
export const SUPPORTED_TRIGGERED_EFFECTS = ["ON_DISCARD", "ON_PLAY_NEWS"] as const;
