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
  tier: AmplificationTier;
  /** Card categories this amplification is offered for, e.g. "勞工". Empty = universal. */
  factionTags: string[];
  /** Offered only in the FIRST amplification phase (turn 6), within its tier's pool. */
  firstPhaseOnly?: boolean;
  effect: EffectDefinition;
}

/**
 * 【動態增幅效果資料庫】加減賺 / 穩穩仔賺 / 卯死 三等級。每個階段的等級於開局抽定
 * （見 rules `phases.ts`），雙方共用同等級、各自依牌組加權抽出 3 個選項。派系
 * 增幅（`factionTags` 非空）僅在牌組含該類別時才可能出現，權重隨占比上升。
 */
export const AMPLIFICATION_DB: AmplificationDbEntry[] = [
  // ---- 加減賺（低增幅）----------------------------------------------------
  {
    id: "AMP_INVOICE_200",
    name: "發票中200",
    description: "額外獲得一顆水晶，水晶上限 +1。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_GRANT_CRYSTALS", crystals: 1 }
  },
  {
    id: "AMP_VOUCHER_3600",
    name: "消費券3600",
    description: "下一回合獲得 3 顆水晶（僅一回合）。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_GRANT_CRYSTALS_NEXT_TURN", crystals: 3 }
  },
  {
    id: "AMP_SHAREHOLDER_GIFT",
    name: "股東紀念品",
    description: "抽到的下一張卡費用永久減半。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_NEXT_DRAW_HALF" }
  },
  {
    id: "AMP_0050",
    name: "蹲得越低",
    description: "下一次增幅的等級提升一階。",
    tier: "加減賺",
    factionTags: [],
    firstPhaseOnly: true,
    effect: { type: "AUG_RAISE_NEXT_TIER" }
  },
  {
    id: "AMP_GO_FOR_BROKE",
    name: "要拚",
    description: "下一次增幅可以多重抽一次增幅。",
    tier: "加減賺",
    factionTags: [],
    firstPhaseOnly: true,
    effect: { type: "AUG_EXTRA_AMP_REROLL_NEXT_PHASE", value: 1 }
  },
  {
    id: "AMP_MIN_WAGE",
    name: "基本工資調漲",
    description: "費用 1-3 的隨從 攻擊 +2（含之後打出，整局有效）。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_PERSIST_LOWCOST_ATTACK", value: 2 }
  },
  {
    id: "AMP_FRIES_BOGO",
    name: "大薯買一送一",
    description: "接下來 2 回合 都可以多抽一張牌。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_EXTRA_DRAW_TURNS", durationTurns: 2, value: 1 }
  },
  {
    id: "AMP_FLEE_ABROAD",
    name: "潛逃國外",
    description: "此局必定不會受第 20 回合公投事件影響。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_REFERENDUM_IMMUNE" }
  },
  {
    id: "AMP_TYPHOON_DAY",
    name: "颱風假",
    description: "所有勞工永久 +1/+1（含之後打出，整局有效）。",
    tier: "加減賺",
    factionTags: ["勞工"],
    effect: { type: "AUG_PERSIST_CATEGORY_BUFF", target_category: "勞工", stat: "ALL", value: 1 }
  },
  {
    id: "AMP_LIFE_INSURANCE",
    name: "壽險理賠",
    description: "英雄生命降至 5 或以下時，永久解鎖水晶上限 20。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_MANA_CAP_LOW_HP", heroHpThreshold: 5, manaCap: 20 }
  },
  {
    id: "AMP_VILLAGE_LUNCHBOX",
    name: "里長的愛心便當",
    description: "英雄生命上限 +5。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_HERO_MAX_HP", value: 5 }
  },
  {
    id: "AMP_BLOOD_DONATION_VOUCHER",
    name: "捐血送禮券",
    description: "英雄生命 -5，下回合獲得 +5 水晶（僅一回合）。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_SELF_HP_LOSS_GRANT_CRYSTALS_NEXT_TURN", health: 5, crystals: 5 }
  },
  {
    id: "AMP_BANQUET",
    name: "流水席",
    description: "自己目前場上隨從立刻回到手牌，並且獲得 +1/+1。",
    tier: "加減賺",
    factionTags: [],
    effect: { type: "AUG_BOUNCE_OWN_BOARD_TO_HAND_BUFF", value: 1 }
  },

  // ---- 穩穩仔賺（中增幅）------------------------------------------------------
  {
    id: "AMP_DIVIDEND",
    name: "股利分紅",
    description: "手上所有卡牌費用 -2（僅當下手牌）。",
    tier: "穩穩仔賺",
    factionTags: [],
    effect: { type: "AUG_HAND_COST_DELTA", value: 2 }
  },
  {
    id: "AMP_INVOICE_1000",
    name: "發票中1000",
    description: "額外獲得兩顆水晶，水晶上限 +2。",
    tier: "穩穩仔賺",
    factionTags: [],
    effect: { type: "AUG_GRANT_CRYSTALS", crystals: 2 }
  },
  {
    id: "AMP_TAX_CUT",
    name: "減稅",
    description: "此局英雄每次受到傷害 -1。",
    tier: "穩穩仔賺",
    factionTags: [],
    effect: { type: "AUG_DAMAGE_REDUCTION", value: 1 }
  },
  {
    id: "AMP_CHILDCARE",
    name: "育兒津貼",
    description: "每當打出隨從牌 該隨從最大生命 +1。",
    tier: "穩穩仔賺",
    factionTags: [],
    effect: { type: "AUG_PLAYED_MAXHP", value: 1 }
  },
  {
    id: "AMP_FREE_SPEECH",
    name: "言論自由",
    description: "新聞費用永久 -2。",
    tier: "穩穩仔賺",
    factionTags: [],
    effect: { type: "AUG_NEWS_COST", value: 2 }
  },
  {
    id: "AMP_NEW_HOUSING",
    name: "新青年安心成家貸款",
    description: "建築費用永久 -4。",
    tier: "穩穩仔賺",
    factionTags: [],
    effect: { type: "AUG_BUILDING_COST", value: 4 }
  },
  {
    id: "AMP_BETEL_NUT_500",
    name: "林北檳榔擠剛攏哺500啦",
    description: "獲得 3 張檳榔到手牌。",
    tier: "穩穩仔賺",
    factionTags: ["勞工"],
    effect: { type: "AUG_ADD_CARD_TO_HAND", cardId: "S029", count: 3 }
  },
  {
    id: "AMP_BEGGAR_HERO",
    name: "乞丐超人",
    description: "第 8 回合之後 卡片費用 7 折（四捨五入）。",
    tier: "穩穩仔賺",
    factionTags: [],
    effect: { type: "AUG_COST_MULTIPLIER", value: 7, turns: 8 }
  },
  {
    id: "AMP_DCA",
    name: "定期定額",
    description: "第 10 回合起，每回合水晶成長 +2，上限提升至 15。",
    tier: "穩穩仔賺",
    factionTags: [],
    effect: { type: "AUG_MANA_RAMP_AFTER_TURN", turnThreshold: 10, manaCap: 15, manaGrowth: 2 }
  },
  {
    id: "AMP_PARTY_ASSET_SUPPLEMENT",
    name: "黨產大補丸",
    description: "英雄生命上限 +10。",
    tier: "穩穩仔賺",
    factionTags: [],
    effect: { type: "AUG_HERO_MAX_HP", value: 10 }
  },
  {
    id: "AMP_NATIONAL_HOLIDAY",
    name: "國定假日",
    description: "自己目前場上隨從立刻回到手牌，並且獲得 +2/+2，費用 -1。",
    tier: "穩穩仔賺",
    factionTags: [],
    effect: { type: "AUG_BOUNCE_OWN_BOARD_TO_HAND_BUFF", value: 2, costReduction: 1 }
  },

  // ---- 卯死（高增幅）------------------------------------------------------
  {
    id: "AMP_ISLAND_DAWN",
    name: "島嶼天光",
    description: "天色漸漸光 — 所有民進黨政治人物在此局生命及攻擊變成兩倍。",
    tier: "卯死",
    factionTags: ["民進黨政治人物"],
    effect: { type: "AUG_DOUBLE_CATEGORY", target_category: "民進黨政治人物" }
  },
  {
    id: "AMP_DEFAULT_SETTLEMENT",
    name: "違約交割",
    description: "獲得 10 點水晶 但接下來 10 回合動彈不得（雙方合計）。",
    tier: "卯死",
    factionTags: [],
    firstPhaseOnly: true,
    effect: { type: "AUG_FREEZE", crystals: 10, durationTurns: 10 }
  },
  {
    id: "AMP_JACKPOT",
    name: "發票中頭獎",
    description: "額外獲得 3 顆水晶，水晶上限 +3。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_GRANT_CRYSTALS", crystals: 3 }
  },
  {
    id: "AMP_VENDOR_KICKBACK",
    name: "廠商回扣",
    description: "本場比賽摧毀隨從後，可以立刻獲得該隨從原始費用的水晶。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_DESTROYED_MINION_COST_REBATE" }
  },
  {
    id: "AMP_PUDU",
    name: "普渡",
    description: "本場我方隨從死後都會復活一次 但攻擊 / 生命只有 1。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_REVIVE_VANILLA" }
  },
  {
    id: "AMP_TW_40000",
    name: "台股四萬點",
    description: "第 20 回合起，每回合水晶成長 +2，上限提升至 30。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_MANA_RAMP_AFTER_TURN", turnThreshold: 20, manaCap: 30, manaGrowth: 2 }
  },
  {
    id: "AMP_FIRE_SALE",
    name: "跳樓大拍賣",
    description: "手上的牌 費用全部歸剩下 1（僅當下手牌）。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_HAND_COST_SET", value: 1 }
  },
  {
    id: "AMP_ONE_PARTY_DOMINANCE",
    name: "一黨獨大",
    description: "英雄生命上限 +20。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_HERO_MAX_HP", value: 20 }
  },
  {
    id: "AMP_TAIJI_ELECTRIC_OFFER",
    name: "台雞電OFFER",
    description: "你的下個回合卡片費用改為血量。",
    tier: "卯死",
    factionTags: [],
    effect: { type: "AUG_PAY_COST_WITH_HEALTH_NEXT_TURN" }
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
  const tiers = new Set<AmplificationTier>(["加減賺", "穩穩仔賺", "卯死"]);
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
    if (entry.firstPhaseOnly && !FIRST_PHASE_ONLY_IDS.has(entry.id)) {
      errors.push(`${entry.id}: firstPhaseOnly is only valid for ${[...FIRST_PHASE_ONLY_IDS].join(", ")}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
