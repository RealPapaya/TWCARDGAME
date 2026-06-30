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
  /**
   * 起底 / Discover (CHANNEL): restricts the candidate pool to this card type. When
   * omitted, any deck card qualifies. Combine with `target_category_includes` for a
   * category filter and `count` for how many cards are revealed (default 3).
   */
  poolCardType?: CardType;
  /**
   * 起底 / Discover (CHANNEL): when true, restricts the candidate pool to cards that
   * carry a 遺志 (deathrattle) keyword. Combines with `poolCardType` /
   * `target_category_includes` as an additional AND filter.
   */
  poolHasDeathrattle?: boolean;
  /**
   * 起底 / Discover (CHANNEL): when true, the candidate pool is drawn from the active
   * seat's own graveyard (陣亡區) instead of its deck — e.g. 靈媒 起底一張已陣亡隨從.
   * Picked cards leave the graveyard; unpicked ones return to it (no shuffle).
   */
  poolFromGraveyard?: boolean;
  /**
   * 起底 / Discover (CHANNEL): how many sequential pick-one rounds to run (default 1).
   * 起底兩張 = `picks: 2` opens a second reveal-and-pick once the first resolves.
   */
  picks?: number;
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
  /** Augment grants: crystals awarded (now or deferred). */
  crystals?: number;
  /** Augment health payment/loss or max-health value. */
  health?: number;
  /** Augment returned-card cost reduction. */
  costReduction?: number;
  /** DESTROY_ALL_MINIONS: when true, killed minions cannot be revived by 普渡. */
  suppressRevive?: boolean;
  /** Augment durations: turns a deferred/passive augment effect lasts. */
  durationTurns?: number;
  /** Augment mana ramp: global turn at which the ramp becomes active. */
  turnThreshold?: number;
  /** Augment mana ramp: maximum crystal capacity. */
  manaCap?: number;
  /** Augment mana ramp: crystals gained on each start turn. */
  manaGrowth?: number;
  /** Augment mana ramp: hero HP threshold that permanently unlocks a cap. */
  heroHpThreshold?: number;
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
  /** Visible category shown to players (e.g. "建築"). Always present. */
  category: string;
  /**
   * Optional hidden category that keeps a card grouped under a legacy/secondary
   * tag (e.g. former "政府機關" cards now shown as "建築"). Not surfaced on the
   * card face; used for editor bookkeeping and future category logic.
   */
  hiddenCategory?: string;
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
  "CHANNEL",
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
  "DRAW_IF_CARD_ON_BOARD",
  "DRAW_MINION_REDUCE_COST",
  "DRAW_NEWS",
  "EAT_FRIENDLY",
  "FULL_HEAL",
  "FULL_HEAL_AND_DRAW",
  "FULL_HEAL_BUFF_TARGET_CATEGORY_BONUS",
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

export const SUPPORTED_DEATHRATTLE_EFFECTS = [
  "BUFF_ADJACENT_HEALTH",
  "BOUNCE_SELF",
  "DAMAGE_OWN_HERO",
  "DRAW",
  "SHUFFLE_SELF_INTO_DECK",
  "SUMMON"
] as const;
export const SUPPORTED_ONGOING_EFFECTS = [
  "ADJACENT_BUFF_CATEGORY_ATTRS",
  "ADJACENT_BUFF_STATS",
  "REDUCE_NEWS_COST"
] as const;
export const SUPPORTED_TRIGGERED_EFFECTS = ["ON_DISCARD", "ON_PLAY_NEWS", "ON_DRAW", "ON_DAMAGE"] as const;
export const SUPPORTED_ENRAGE_EFFECTS = ["BUFF_STAT"] as const;
export const SUPPORTED_QUEST_EFFECTS = ["DAMAGE_ALL_MINIONS"] as const;
export const SUPPORTED_ON_DISCARD_ACTIONS = ["SUMMON"] as const;

/**
 * Effect types valid on a dynamic-amplification (增幅) entry. These do NOT flow
 * through the card `resolveEffect` dispatch — they are resolved per-seat by the
 * rules `applyAugmentSelection` (one-shot) or read as flags by passive readers
 * (cost / damage / summon). Listed here so `validateAmplificationDb` can guard
 * the DB the same way `SUPPORTED_BATTLECRY_EFFECTS` guards cards.
 */
export const SUPPORTED_AUGMENT_EFFECTS = [
  "AUG_GRANT_CRYSTALS",
  "AUG_GRANT_CRYSTALS_NEXT_TURN",
  "AUG_NEXT_DRAW_HALF",
  "AUG_HAND_COST_SET",
  "AUG_HAND_COST_DELTA",
  "AUG_ADD_CARD_TO_HAND",
  "AUG_FREEZE",
  "AUG_REVIVE_VANILLA",
  "AUG_DAMAGE_REDUCTION",
  "AUG_DOUBLE_CATEGORY",
  "AUG_PERSIST_LOWCOST_ATTACK",
  "AUG_PERSIST_CATEGORY_BUFF",
  "AUG_NEWS_COST",
  "AUG_BUILDING_COST",
  "AUG_COST_MULTIPLIER",
  "AUG_PLAYED_MAXHP",
  "AUG_EXTRA_DRAW_TURNS",
  "AUG_REFERENDUM_IMMUNE",
  "AUG_RAISE_NEXT_TIER",
  "AUG_EXTRA_AMP_REROLL_NEXT_PHASE",
  "AUG_MANA_RAMP_AFTER_TURN",
  "AUG_MANA_CAP_LOW_HP",
  "AUG_HERO_MAX_HP",
  "AUG_PAY_COST_WITH_HEALTH_NEXT_TURN",
  "AUG_SELF_HP_LOSS_GRANT_CRYSTALS_NEXT_TURN",
  "AUG_BOUNCE_OWN_BOARD_TO_HAND_BUFF",
  "AUG_DESTROYED_MINION_COST_REBATE",
  "AUG_SUMMON_CARD",
  "AUG_ON_SUMMON_CATEGORY_SUMMON_ENEMY",
  "AUG_CATEGORY_COST_REDUCTION",
  "AUG_DRAW_CATEGORY",
  "AUG_CATEGORY_DEATHRATTLE_ADJACENT_HEAL",
  "AUG_CATEGORY_DIVINE_SHIELD_ATTACK",
  "AUG_SUMMON_RANDOM_CATEGORY_FROM_DECK_AND_DEATH_MANA"
] as const;
