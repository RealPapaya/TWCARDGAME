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

const NOOP: EnvironmentDescriptor = { mode: "IMMEDIATE", effect: { type: "NOOP" } };

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
    name: "油電雙漲",
    tierWeight: 35,
    options: ["所有卡牌消耗 +2（上限 10）", "所有卡牌消耗 +2（上限 10）", "所有卡牌消耗 +2（上限 10）"],
    apply: { mode: "ENVIRONMENT", durationTurns: 4, effect: { type: "ENV_COST_PLUS_CAPPED", value: 2 } }
  },
  {
    id: "VE_MORAKOT",
    name: "莫拉克颱風",
    tierWeight: 20,
    options: ["場上所有隨從死亡", "場上所有隨從死亡", "場上所有隨從死亡"],
    apply: { mode: "IMMEDIATE", effect: { type: "DESTROY_ALL_MINIONS" } }
  },
  { id: "VE_KAOHSIUNG_BLAST", name: "高雄氣爆", tierWeight: 35, options: ["效果待補", "效果待補", "效果待補"], apply: NOOP },
  { id: "VE_MAZU", name: "媽祖繞境", tierWeight: 35, options: ["效果待補", "效果待補", "效果待補"], apply: NOOP },
  { id: "VE_MARTIAL_LAW", name: "戒嚴", tierWeight: 20, options: ["效果待補", "效果待補", "效果待補"], apply: NOOP },
  { id: "VE_SLOT_07", name: "（事件待補 07）", tierWeight: 45, options: ["效果待補", "效果待補", "效果待補"], apply: NOOP },
  { id: "VE_SLOT_08", name: "（事件待補 08）", tierWeight: 45, options: ["效果待補", "效果待補", "效果待補"], apply: NOOP },
  { id: "VE_SLOT_09", name: "（事件待補 09）", tierWeight: 45, options: ["效果待補", "效果待補", "效果待補"], apply: NOOP },
  { id: "VE_SLOT_10", name: "（事件待補 10）", tierWeight: 45, options: ["效果待補", "效果待補", "效果待補"], apply: NOOP }
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
