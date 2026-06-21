import type { AmplificationTier } from "@twcardgame/shared";
import { SUPPORTED_AUGMENT_EFFECTS } from "./types.js";
import type { EffectDefinition } from "./types.js";

/**
 * One entry in the dynamic-amplification (增幅) database. Filterable by faction
 * tag (card `category`) and strength tier. The `effect` is the bound modifier —
 * its `type` is an `AUG_*` discriminator resolved per-seat by the rules engine's
 * `applyAugmentSelection` (one-shot) or consulted as a flag by the passive
 * readers (cost / damage / summon). Augments do NOT flow through the card
 * `resolveEffect` dispatch.
 */
export interface AmplificationDbEntry {
  id: string;
  name: string;
  description: string;
  /** Whether this amplification currently has a prepared image asset. */
  hasImage?: boolean;
  /** Cards explicitly named by the description and previewable from the UI. */
  relatedCardIds?: string[];
  tier: AmplificationTier;
  /** Card categories this amplification is offered for, e.g. "勞工". Empty = universal. */
  factionTags: string[];
  /** Offered only in the FIRST amplification phase (turn 7), within its tier's pool. */
  firstPhaseOnly?: boolean;
  effect: EffectDefinition;
}

/**
 * 【動態增幅效果資料庫】加減賺 / 蕭貪 / 卯死 三等級。每個階段的等級於開局抽定
 * （見 rules `phases.ts`），雙方共用同等級、各自依牌組加權抽出 3 個選項。派系
 * 增幅（`factionTags` 非空）僅在牌組含該類別時才可能出現，權重隨占比上升。
 */
export const AMPLIFICATION_DB: AmplificationDbEntry[] = [
  // ---- 加減賺（低增幅）----------------------------------------------------
  {
    id: "AMP_INVOICE_200",
    hasImage: true,
    name: "發票中200",
    description: "額外獲得一顆水晶，水晶上限 +1。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_GRANT_CRYSTALS", crystals: 1 }
  },
  {
    id: "AMP_VOUCHER_3600",
    hasImage: true,
    name: "消費券3600",
    description: "下一回合獲得 2 顆水晶（僅一回合）。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_GRANT_CRYSTALS_NEXT_TURN", crystals: 2 }
  },
  {
    id: "AMP_SHAREHOLDER_GIFT",
    hasImage: true,
    name: "股東紀念品",
    description: "抽到的下一張卡費用永久減半。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_NEXT_DRAW_HALF" }
  },
  {
    id: "AMP_0050",
    hasImage: true,
    name: "蹲得越低",
    description: "下一次增幅的等級提升一階。",
    tier: "加減賺",
    factionTags: [],
    firstPhaseOnly: true,
    effect: { type: "AUG_RAISE_NEXT_TIER" }
  },
  {
    id: "AMP_GO_FOR_BROKE",
    hasImage: true,
    name: "要拚",
    description: "下一次增幅可以多重抽一次增幅。",
    tier: "加減賺",
    factionTags: [],
    firstPhaseOnly: true,
    effect: { type: "AUG_EXTRA_AMP_REROLL_NEXT_PHASE", value: 1 }
  },
  {
    id: "AMP_THREE_WAY_RACE",
    hasImage: true,
    name: "政壇三腳督",
    description: "從牌組抽一張民眾黨政治人物。",
    tier: "加減賺",
    factionTags: ["民眾黨政治人物"],
    effect: { type: "AUG_DRAW_CATEGORY", target_category: "民眾黨政治人物", value: 1 }
  },
  {
    id: "AMP_MIN_WAGE",
    hasImage: true,
    name: "基本工資調漲",
    description: "費用 1-4 的隨從 攻擊 +1（含之後打出，整局有效）。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_PERSIST_LOWCOST_ATTACK", value: 1 }
  },
  {
    id: "AMP_FRIES_BOGO",
    hasImage: true,
    name: "大薯買一送一",
    description: "接下來 2 回合 都可以多抽一張牌。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_EXTRA_DRAW_TURNS", durationTurns: 2, value: 1 }
  },
  {
    id: "AMP_FLEE_ABROAD",
    hasImage: true,
    name: "潛逃國外",
    description: "此局必定不會受第 20 回合公投事件影響。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_REFERENDUM_IMMUNE" }
  },
  {
    id: "AMP_TYPHOON_DAY",
    hasImage: true,
    name: "颱風假",
    description: "所有勞工永久 +1攻擊（含之後打出，整局有效）。",
    tier: "加減賺",
    factionTags: ["勞工"],
    effect: { type: "AUG_PERSIST_CATEGORY_BUFF", target_category: "勞工", stat: "ATTACK", value: 1 }
  },
  {
    id: "AMP_ENERGY_TRANSITION",
    hasImage: true,
    name: "能源轉型",
    description: "在對手場上放置 3 個核廢料。",
    relatedCardIds: ["TW077"],
    tier: "加減賺",
    factionTags: ["民進黨政治人物"],
    effect: { type: "AUG_SUMMON_CARD", cardId: "TW077", count: 3, target: { side: "ENEMY" } }
  },
  {
    id: "AMP_LIFE_INSURANCE",
    hasImage: true,
    name: "壽險理賠",
    description: "英雄生命降至 5 或以下時，永久解鎖水晶上限 20。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_MANA_CAP_LOW_HP", heroHpThreshold: 5, manaCap: 20 }
  },
  {
    id: "AMP_VILLAGE_LUNCHBOX",
    hasImage: true,
    name: "里長的愛心便當",
    description: "英雄生命上限 +5。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_HERO_MAX_HP", value: 5 }
  },
  {
    id: "AMP_BLOOD_DONATION_VOUCHER",
    hasImage: true,
    name: "捐血送禮券",
    description: "英雄生命 -5，下回合獲得 +3 水晶（僅一回合）。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_SELF_HP_LOSS_GRANT_CRYSTALS_NEXT_TURN", health: 5, crystals: 3 }
  },
  {
    id: "AMP_BANQUET",
    hasImage: true,
    name: "流水席",
    description: "自己目前場上隨從立刻回到手牌，並且獲得 +1/+1。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_BOUNCE_OWN_BOARD_TO_HAND_BUFF", value: 1 }
  },

  // ---- 蕭貪（中增幅）------------------------------------------------------
  {
    id: "AMP_DIVIDEND",
    hasImage: true,
    name: "股利分紅",
    description: "手上所有卡牌費用 -2（僅當下手牌）。",
    tier: "蕭貪",
    factionTags: [],
    effect: { type: "AUG_HAND_COST_DELTA", value: 2 }
  },
  {
    id: "AMP_INVOICE_1000",
    hasImage: true,
    name: "發票中1000",
    description: "額外獲得兩顆水晶，水晶上限 +2。",
    tier: "蕭貪",
    factionTags: [],
    effect: { type: "AUG_GRANT_CRYSTALS", crystals: 2 }
  },
  {
    id: "AMP_TAX_CUT",
    hasImage: true,
    name: "減稅",
    description: "此局英雄每次受到傷害 -1。",
    tier: "蕭貪",
    factionTags: [],
    effect: { type: "AUG_DAMAGE_REDUCTION", value: 1 }
  },
  {
    id: "AMP_CHILDCARE",
    hasImage: true,
    name: "育兒津貼",
    description: "每當打出隨從牌 該隨從最大生命 +1。",
    tier: "蕭貪",
    factionTags: [],
    effect: { type: "AUG_PLAYED_MAXHP", value: 1 }
  },
  {
    id: "AMP_FREE_SPEECH",
    hasImage: true,
    name: "言論自由",
    description: "新聞費用永久 -2。",
    tier: "蕭貪",
    factionTags: [],
    effect: { type: "AUG_NEWS_COST", value: 2 }
  },
  {
    id: "AMP_NEW_HOUSING",
    hasImage: true,
    name: "新青年安心成家貸款",
    description: "建築費用永久 -4。",
    tier: "蕭貪",
    factionTags: [],
    effect: { type: "AUG_BUILDING_COST", value: 4 }
  },
  {
    id: "AMP_BETEL_NUT_500",
    hasImage: true,
    name: "林北檳榔擠剛攏哺500啦",
    description: "獲得 3 張檳榔到手牌。",
    relatedCardIds: ["S029"],
    tier: "蕭貪",
    factionTags: ["勞工"],
    effect: { type: "AUG_ADD_CARD_TO_HAND", cardId: "S029", count: 3 }
  },
  {
    id: "AMP_BEGGAR_HERO",
    hasImage: true,
    name: "乞丐超人",
    description: "第 8 回合之後 卡片費用 7 折（四捨五入）。",
    tier: "蕭貪",
    factionTags: [],
    effect: { type: "AUG_COST_MULTIPLIER", value: 7, turns: 8 }
  },
  {
    id: "AMP_DCA",
    hasImage: true,
    name: "定期定額",
    description: "第 10 回合起，每回合水晶成長 +2，上限提升至 15。",
    tier: "蕭貪",
    factionTags: [],
    effect: { type: "AUG_MANA_RAMP_AFTER_TURN", turnThreshold: 10, manaCap: 15, manaGrowth: 2 }
  },
  {
    id: "AMP_PARTY_ASSET_SUPPLEMENT",
    hasImage: true,
    name: "黨產大補丸",
    description: "英雄生命上限 +10。",
    tier: "蕭貪",
    factionTags: [],
    effect: { type: "AUG_HERO_MAX_HP", value: 10 }
  },
  {
    id: "AMP_NATIONAL_HOLIDAY",
    hasImage: true,
    name: "國定假日",
    description: "自己目前場上隨從立刻回到手牌，並且獲得 +2/+2，費用 -1。",
    tier: "蕭貪",
    factionTags: [],
    effect: { type: "AUG_BOUNCE_OWN_BOARD_TO_HAND_BUFF", value: 2, costReduction: 1 }
  },
  {
    id: "AMP_NUCLEAR_FREE_HOMELAND",
    hasImage: true,
    name: "非核家園",
    description: "每當召喚一名民進黨政治人物，在對手場上放置一個核廢料。",
    relatedCardIds: ["TW077"],
    tier: "蕭貪",
    factionTags: ["民進黨政治人物"],
    effect: {
      type: "AUG_ON_SUMMON_CATEGORY_SUMMON_ENEMY",
      target_category: "民進黨政治人物",
      cardId: "TW077",
      count: 1
    }
  },
  {
    id: "AMP_RESTART_NUCLEAR_FOUR",
    hasImage: true,
    name: "重啟核四",
    description: "在自己的場上放置 4 張核電廠。",
    relatedCardIds: ["TW063"],
    tier: "蕭貪",
    factionTags: ["國民黨政治人物"],
    effect: { type: "AUG_SUMMON_CARD", cardId: "TW063", count: 4, target: { side: "FRIENDLY" } }
  },
  {
    id: "AMP_RETURN_COUNTRY_TO_YOU",
    hasImage: true,
    name: "把國家還給你們",
    description: "整局我方民眾黨政治人物死亡時，治療死亡當下兩側仍存活隨從 2 點生命。",
    tier: "蕭貪",
    factionTags: ["民眾黨政治人物"],
    effect: {
      type: "AUG_CATEGORY_DEATHRATTLE_ADJACENT_HEAL",
      target_category: "民眾黨政治人物",
      value: 2
    }
  },

  // ---- 卯死（高增幅）------------------------------------------------------
  {
    id: "AMP_ISLAND_DAWN",
    hasImage: true,
    name: "島嶼天光",
    description: "天色漸漸光 — 所有民進黨政治人物在此局生命變成兩倍。",
    tier: "卯死",
    factionTags: ["民進黨政治人物"],
    effect: { type: "AUG_DOUBLE_CATEGORY", target_category: "民進黨政治人物" }
  },
  {
    id: "AMP_DEFAULT_SETTLEMENT",
    hasImage: true,
    name: "違約交割",
    description: "獲得 10 點水晶 但接下來 10 回合動彈不得（雙方合計）。",
    tier: "卯死",
    factionTags: [],
    firstPhaseOnly: true,
    effect: { type: "AUG_FREEZE", crystals: 10, durationTurns: 10 }
  },
  {
    id: "AMP_JACKPOT",
    hasImage: true,
    name: "發票中頭獎",
    description: "額外獲得 3 顆水晶，水晶上限 +3。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_GRANT_CRYSTALS", crystals: 3 }
  },
  {
    id: "AMP_VENDOR_KICKBACK",
    hasImage: true,
    name: "廠商回扣",
    description: "本場比賽摧毀隨從後，可以立刻獲得該隨從原始費用的水晶。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_DESTROYED_MINION_COST_REBATE" }
  },
  {
    id: "AMP_ILLEGAL_MIGRANT_WORKERS",
    hasImage: true,
    name: "非法移工",
    description: "隨機從牌組召喚兩名勞工。本場每當有勞工死亡，本回合獲得 1 點臨時費用。",
    tier: "卯死",
    factionTags: ["勞工"],
    effect: {
      type: "AUG_SUMMON_RANDOM_CATEGORY_FROM_DECK_AND_DEATH_MANA",
      target_category: "勞工",
      count: 2,
      value: 1
    }
  },
  {
    id: "AMP_PUDU",
    hasImage: true,
    name: "普渡",
    description: "本場我方隨從死後都會復活一次 但攻擊 / 生命只有 1。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_REVIVE_VANILLA" }
  },
  {
    id: "AMP_TW_40000",
    hasImage: true,
    name: "台股四萬點",
    description: "第 20 回合起，每回合水晶成長 +2，上限提升至 30。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_MANA_RAMP_AFTER_TURN", turnThreshold: 20, manaCap: 30, manaGrowth: 2 }
  },
  {
    id: "AMP_FIRE_SALE",
    hasImage: true,
    name: "跳樓大拍賣",
    description: "手上的牌 費用全部歸剩下 1（僅當下手牌）。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_HAND_COST_SET", value: 1 }
  },
  {
    id: "AMP_ONE_PARTY_DOMINANCE",
    hasImage: true,
    name: "一黨獨大",
    description: "英雄生命上限 +20。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_HERO_MAX_HP", value: 20 }
  },
  {
    id: "AMP_TAIJI_ELECTRIC_OFFER",
    hasImage: true,
    name: "台雞電OFFER",
    description: "你的下個回合卡片費用改為血量。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_PAY_COST_WITH_HEALTH_NEXT_TURN" }
  },
  {
    id: "AMP_1992_CONSENSUS",
    hasImage: true,
    name: "九二共識",
    description: "所有國民黨政治人物費用永久 -1，並獲得「遺志：回到牌組堆」。",
    tier: "卯死",
    factionTags: ["國民黨政治人物"],
    effect: {
      type: "AUG_CATEGORY_COST_REDUCTION",
      target_category: "國民黨政治人物",
      value: 1,
      keyword: "SHUFFLE_SELF_INTO_DECK"
    }
  },
  {
    id: "AMP_GARBAGE_NO_BLUE_GREEN",
    hasImage: true,
    name: "垃圾不分藍綠",
    description: "立即賦予我方民眾黨政治人物光盾；整局每當我方民眾黨政治人物獲得光盾或帶著天生光盾上場時，攻擊 +3。",
    tier: "卯死",
    factionTags: ["民眾黨政治人物"],
    effect: {
      type: "AUG_CATEGORY_DIVINE_SHIELD_ATTACK",
      target_category: "民眾黨政治人物",
      value: 3
    }
  }
];

/**
 * Filters the amplification DB by dominant faction category and (optionally) tier.
 * An entry matches a faction when its `factionTags` is empty (universal) or
 * contains the category. (Retained for back-compat; the deck-weighted sampler in
 * `packages/rules` filters by tier directly and weights faction entries itself.)
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

const AUGMENT_EFFECT_TYPES = new Set<string>(SUPPORTED_AUGMENT_EFFECTS);
const FIRST_PHASE_ONLY_IDS = new Set<string>(["AMP_0050", "AMP_GO_FOR_BROKE", "AMP_DEFAULT_SETTLEMENT"]);

/**
 * Validates the amplification DB: unique ids, valid tiers, supported effect
 * types, `firstPhaseOnly` restricted to the designed augments, and faction
 * entries carrying a non-empty `factionTags`.
 */
export function validateAmplificationDb(db: readonly AmplificationDbEntry[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  const tiers = new Set<AmplificationTier>(["加減賺", "蕭貪", "卯死"]);
  for (const entry of db) {
    if (ids.has(entry.id)) errors.push(`${entry.id}: duplicate amplification id`);
    ids.add(entry.id);
    if (!tiers.has(entry.tier)) errors.push(`${entry.id}: invalid tier ${entry.tier}`);
    const type = entry.effect?.type;
    if (!type || !AUGMENT_EFFECT_TYPES.has(type)) errors.push(`${entry.id}: unsupported augment effect type ${type ?? "(none)"}`);
    if (type === "AUG_MANA_RAMP_AFTER_TURN") {
      if (!positiveInt(entry.effect.turnThreshold)) errors.push(`${entry.id}: mana ramp requires a positive turnThreshold`);
      if (!positiveInt(entry.effect.manaCap)) errors.push(`${entry.id}: mana ramp requires a positive manaCap`);
      if (!positiveInt(entry.effect.manaGrowth)) errors.push(`${entry.id}: mana ramp requires a positive manaGrowth`);
    }
    if (type === "AUG_MANA_CAP_LOW_HP") {
      if (!positiveInt(entry.effect.heroHpThreshold)) errors.push(`${entry.id}: low-HP mana cap requires a positive heroHpThreshold`);
      if (!positiveInt(entry.effect.manaCap)) errors.push(`${entry.id}: low-HP mana cap requires a positive manaCap`);
    }
    if (type === "AUG_HERO_MAX_HP") {
      if (!positiveInt(entry.effect.value)) errors.push(`${entry.id}: hero max HP augment requires a positive value`);
    }
    if (type === "AUG_SELF_HP_LOSS_GRANT_CRYSTALS_NEXT_TURN") {
      if (!positiveInt(entry.effect.health)) errors.push(`${entry.id}: HP-loss crystal augment requires a positive health`);
      if (!positiveInt(entry.effect.crystals)) errors.push(`${entry.id}: HP-loss crystal augment requires positive crystals`);
    }
    if (type === "AUG_BOUNCE_OWN_BOARD_TO_HAND_BUFF") {
      if (!positiveInt(entry.effect.value)) errors.push(`${entry.id}: bounce-buff augment requires a positive value`);
      if (entry.effect.costReduction !== undefined && !positiveInt(entry.effect.costReduction)) {
        errors.push(`${entry.id}: bounce-buff augment costReduction must be a positive integer when present`);
      }
    }
    if (type === "AUG_SUMMON_CARD") {
      if (!entry.effect.cardId) errors.push(`${entry.id}: summon-card augment requires cardId`);
      if (!positiveInt(entry.effect.count)) errors.push(`${entry.id}: summon-card augment requires a positive count`);
      if (!entry.effect.target?.side || !["FRIENDLY", "ENEMY"].includes(entry.effect.target.side)) {
        errors.push(`${entry.id}: summon-card augment requires FRIENDLY or ENEMY target side`);
      }
    }
    if (type === "AUG_ON_SUMMON_CATEGORY_SUMMON_ENEMY") {
      if (!entry.effect.target_category) errors.push(`${entry.id}: summon-trigger augment requires target_category`);
      if (!entry.effect.cardId) errors.push(`${entry.id}: summon-trigger augment requires cardId`);
      if (!positiveInt(entry.effect.count)) errors.push(`${entry.id}: summon-trigger augment requires a positive count`);
    }
    if (type === "AUG_CATEGORY_COST_REDUCTION") {
      if (!entry.effect.target_category) errors.push(`${entry.id}: category-cost augment requires target_category`);
      if (!positiveInt(entry.effect.value)) errors.push(`${entry.id}: category-cost augment requires a positive value`);
      if (entry.effect.keyword !== undefined && entry.effect.keyword !== "SHUFFLE_SELF_INTO_DECK") {
        errors.push(`${entry.id}: unsupported category-cost augment keyword ${entry.effect.keyword}`);
      }
    }
    if (
      type === "AUG_DRAW_CATEGORY" ||
      type === "AUG_CATEGORY_DEATHRATTLE_ADJACENT_HEAL" ||
      type === "AUG_CATEGORY_DIVINE_SHIELD_ATTACK" ||
      type === "AUG_SUMMON_RANDOM_CATEGORY_FROM_DECK_AND_DEATH_MANA"
    ) {
      if (!entry.effect.target_category) errors.push(`${entry.id}: category augment requires target_category`);
      if (!positiveInt(entry.effect.value)) errors.push(`${entry.id}: category augment requires a positive value`);
    }
    if (
      type === "AUG_SUMMON_RANDOM_CATEGORY_FROM_DECK_AND_DEATH_MANA" &&
      !positiveInt(entry.effect.count)
    ) {
      errors.push(`${entry.id}: random category summon augment requires a positive count`);
    }
    if (entry.firstPhaseOnly && !FIRST_PHASE_ONLY_IDS.has(entry.id)) {
      errors.push(`${entry.id}: firstPhaseOnly is only valid for ${[...FIRST_PHASE_ONLY_IDS].join(", ")}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
