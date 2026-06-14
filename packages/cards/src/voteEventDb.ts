import type { EffectDefinition } from "./types.js";

/**
 * How a winning referendum option mutates the game:
 * - `ENVIRONMENT` installs a global, optionally time-limited effect
 *   (`currentEnvironment`) re-applied each turn until `durationTurns` lapses.
 * - `IMMEDIATE` resolves the effect once at vote resolution and is not stored.
 */
export interface EnvironmentDescriptor {
  mode: "ENVIRONMENT" | "IMMEDIATE";
  durationTurns?: number;
  effect: EffectDefinition;
}

/**
 * One referendum event. `options` are the three display lines shown on the ballot
 * card (Index 0/1/2 effect descriptions); `apply` is the effect that resolves when
 * THIS event wins the inverse-HP roulette. `tierWeight` drives the華麗度/rarity
 * draw distribution.
 */
export interface VoteEventDbEntry {
  id: string;
  name: string;
  /** Relative draw weight (higher = more common). */
  tierWeight: number;
  options: [string, string, string];
  apply: EnvironmentDescriptor;
}


/**
 * 【全場公投事件資料庫插槽】
 * Ten political-meme event slots. Only the three "proven" rows below carry real
 * effects (to exercise the environment pipeline); the rest are `NOOP` stubs whose
 * `options`/`apply` you fill in later.
 */
export const VOTE_EVENT_DB: VoteEventDbEntry[] = [
  {
    id: "VE_BLACKOUT",
    name: "大停電",
    tierWeight: 35,
    options: ["全場隨從沉默 4 回合", "全場隨從沉默 4 回合", "全場隨從沉默 4 回合"],
    apply: { mode: "ENVIRONMENT", durationTurns: 4, effect: { type: "ENV_SILENCE_ALL" } }
  },
  {
    id: "VE_UTILITY_HIKE",
    name: "物價通膨",
    tierWeight: 35,
    options: ["所有卡牌費用 +2（上限 10）", "所有卡牌費用 +2（上限 10）", "所有卡牌費用 +2（上限 10）"],
    apply: { mode: "ENVIRONMENT", durationTurns: 4, effect: { type: "ENV_COST_PLUS_CAPPED", value: 2 } }
  },
  {
    id: "VE_MORAKOT",
    name: "莫拉克風災",
    tierWeight: 20,
    options: ["摧毀場上所有隨從（無法復活）", "摧毀場上所有隨從（無法復活）", "摧毀場上所有隨從（無法復活）"],
    apply: { mode: "IMMEDIATE", effect: { type: "DESTROY_ALL_MINIONS", suppressRevive: true } }
  },
  {
    id: "VE_KAOHSIUNG_BLAST",
    name: "高雄氣爆",
    tierWeight: 35,
    options: ["雙方最右邊的隨從死亡", "雙方最右邊的隨從死亡", "雙方最右邊的隨從死亡"],
    apply: { mode: "IMMEDIATE", effect: { type: "DESTROY_RIGHTMOST_MINIONS" } }
  },
  {
    id: "VE_MAZU",
    name: "媽祖大繞境",
    tierWeight: 30,
    options: ["全場隨從獲得光盾", "全場隨從獲得光盾", "全場隨從獲得光盾"],
    apply: { mode: "IMMEDIATE", effect: { type: "GIVE_DIVINE_SHIELD_ALL_BOARD" } }
  },
  {
    id: "VE_PARTY_INFIGHTING",
    name: "黨內鬥爭",
    tierWeight: 20,
    options: ["雙方場上只留下費用最高的隨從，其餘死亡", "雙方場上只留下費用最高的隨從，其餘死亡", "雙方場上只留下費用最高的隨從，其餘死亡"],
    apply: { mode: "IMMEDIATE", effect: { type: "KEEP_RANDOM_HIGHEST_COST_PER_SIDE" } }
  },
  {
    id: "VE_PARLIAMENT_STAR_BRAWL",
    name: "議會明星大亂鬥",
    tierWeight: 20,
    options: ["場上所有隨從隨機留下一名，其餘死亡", "場上所有隨從隨機留下一名，其餘死亡", "場上所有隨從隨機留下一名，其餘死亡"],
    apply: { mode: "IMMEDIATE", effect: { type: "KEEP_RANDOM_ONE_BOARD_MINION" } }
  },
  {
    id: "VE_MARTIAL_LAW",
    name: "戒嚴",
    tierWeight: 20,
    options: ["場上隨從全部回到手牌，費用全部改為 10", "場上隨從全部回到手牌，費用全部改為 10", "場上隨從全部回到手牌，費用全部改為 10"],
    apply: { mode: "IMMEDIATE", effect: { type: "MARTIAL_LAW_BOUNCE_ALL_COST_10" } }
  },
  {
    id: "VE_GHOST_GATE",
    name: "鬼門開",
    tierWeight: 25,
    options: ["雙方同時從墓場隨機復活 2 隻隨從", "雙方同時從墓場隨機復活 2 隻隨從", "雙方同時從墓場隨機復活 2 隻隨從"],
    apply: { mode: "IMMEDIATE", effect: { type: "SUMMON_FROM_GRAVEYARD", count: 2 } }
  },
  {
    id: "VE_FINANCIAL_CRISIS",
    name: "金融海嘯",
    tierWeight: 20,
    options: ["雙方水晶歸 1 重新累加", "雙方水晶歸 1 重新累加", "雙方水晶歸 1 重新累加"],
    apply: { mode: "IMMEDIATE", effect: { type: "RESET_MANA_ALL" } }
  },
  {
    id: "VE_BASEBALL_CHAMPION",
    name: "歡慶 12 強冠軍",
    tierWeight: 20,
    options: ["雙方英雄血量回滿", "雙方英雄血量回滿", "雙方英雄血量回滿"],
    apply: { mode: "IMMEDIATE", effect: { type: "FULL_HEAL_BOTH_HEROES" } }
  },
  {
    id: "VE_CASH_HANDOUT",
    name: "普發現金",
    tierWeight: 30,
    options: ["下一整輪雙方卡牌消耗為 0", "下一整輪雙方卡牌消耗為 0", "下一整輪雙方卡牌消耗為 0"],
    apply: { mode: "ENVIRONMENT", durationTurns: 2, effect: { type: "ENV_COST_ZERO" } }
  },
  {
    id: "VE_CURFEW_TIME",
    name: "宵禁時間",
    tierWeight: 25,
    options: ["雙方回合時間永久變為 15 秒", "雙方回合時間永久變為 15 秒", "雙方回合時間永久變為 15 秒"],
    apply: { mode: "ENVIRONMENT", effect: { type: "ENV_TURN_TIME_LIMIT_MS", value: 15000 } }
  },
  {
    id: "VE_SOCIAL_DISTANCING",
    name: "社交距離",
    tierWeight: 20,
    options: [
      "場上隨從上限永久改為 3，多餘的隨從回到手牌（滿手則死亡）",
      "場上隨從上限永久改為 3，多餘的隨從回到手牌（滿手則死亡）",
      "場上隨從上限永久改為 3，多餘的隨從回到手牌（滿手則死亡）"
    ],
    apply: { mode: "ENVIRONMENT", effect: { type: "ENV_BOARD_LIMIT", value: 3 } }
  },
  {
    id: "VE_EQUALITY_FOR_ALL",
    name: "人人平等",
    tierWeight: 25,
    options: ["所有隨從效果永久無效", "所有隨從效果永久無效", "所有隨從效果永久無效"],
    apply: { mode: "ENVIRONMENT", effect: { type: "ENV_DISABLE_ALL_MINION_EFFECTS" } }
  },
  {
    id: "VE_TECH_ENFORCEMENT",
    name: "科技執法",
    tierWeight: 20,
    options: ["發動攻擊的隨從在攻擊結算後受到 1 點傷害。", "發動攻擊的隨從在攻擊結算後受到 1 點傷害。", "發動攻擊的隨從在攻擊結算後受到 1 點傷害。"],
    apply: { mode: "ENVIRONMENT", effect: { type: "ENV_ATTACKER_TAKES_DAMAGE", value: 1 } }
  }
];

/** Validates the vote-event DB: unique ids, positive weights, exactly 3 options. Effect logic not yet required. */
export function validateVoteEventDb(db: readonly VoteEventDbEntry[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of db) {
    if (ids.has(entry.id)) errors.push(`${entry.id}: duplicate vote-event id`);
    ids.add(entry.id);
    if (!(entry.tierWeight > 0)) errors.push(`${entry.id}: tierWeight must be positive`);
    if (entry.options.length !== 3) errors.push(`${entry.id}: must declare exactly 3 options`);
  }
  return { valid: errors.length === 0, errors };
}
