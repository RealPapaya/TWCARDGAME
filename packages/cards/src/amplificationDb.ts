import type { AmplificationTier } from "@twcardgame/shared";
import type { EffectDefinition } from "./types.js";

/**
 * One entry in the dynamic-amplification database. Filterable by faction tag
 * (card `category`) and strength tier. The `effect` is the bound modifier — its
 * internal mechanic is intentionally left as a `NOOP` stub for now; fill these in
 * per faction × tier later.
 *
 * NOTE: only the three example rows below are populated. Author the real
 * KMT / DPP / TPP (and neutral) pools here; the sampler ({@link filterAmplification}
 * consumed by `packages/rules`) groups by `tier` and offers one option per tier.
 */
export interface AmplificationDbEntry {
  id: string;
  name: string;
  description: string;
  tier: AmplificationTier;
  /** Card categories this amplification is offered for, e.g. "民進黨政治人物". Empty = any. */
  factionTags: string[];
  effect: EffectDefinition;
}

/**
 * 【動態增幅效果資料庫插槽】
 * Three representative rows, one per tier. `factionTags: []` means "offered to any
 * dominant faction" so the sampler always has a full tier set to draw from until
 * faction-specific pools are authored.
 */
export const AMPLIFICATION_DB: AmplificationDbEntry[] = [
  {
    id: "AMP_LOW_JOINT_ELECTION",
    name: "九合一選舉",
    description: "（低增幅）效果待補。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "NOOP" }
  },
  {
    id: "AMP_MID_GREAT_RECALL",
    name: "大罷免大失敗",
    description: "（中增幅）效果待補。",
    tier: "吃紅",
    factionTags: [],
    effect: { type: "NOOP" }
  },
  {
    id: "AMP_HIGH_SUNFLOWER",
    name: "太陽花學運",
    description: "（高增幅）效果待補。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "NOOP" }
  }
];

/**
 * Filters the amplification DB by dominant faction category and (optionally) tier.
 * An entry matches a faction when its `factionTags` is empty (universal) or
 * contains the category.
 */
export function filterAmplification(
  db: readonly AmplificationDbEntry[],
  factionCategory: string | undefined,
  tier?: AmplificationTier
): AmplificationDbEntry[] {
  return db.filter((entry) => {
    if (tier && entry.tier !== tier) return false;
    if (entry.factionTags.length === 0) return true;
    return factionCategory !== undefined && entry.factionTags.includes(factionCategory);
  });
}

/** Validates the amplification DB: unique ids + valid tiers. Effect logic is not yet required. */
export function validateAmplificationDb(db: readonly AmplificationDbEntry[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  const tiers = new Set<AmplificationTier>(["加減賺", "吃紅", "卯死"]);
  for (const entry of db) {
    if (ids.has(entry.id)) errors.push(`${entry.id}: duplicate amplification id`);
    ids.add(entry.id);
    if (!tiers.has(entry.tier)) errors.push(`${entry.id}: invalid tier ${entry.tier}`);
  }
  return { valid: errors.length === 0, errors };
}
