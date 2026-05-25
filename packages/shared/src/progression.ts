import type { AiDifficulty, AiTheme } from "./index.js";

// Player progression values ported from LEGACY v1
// (LEGACY/js/ui/app.js lines 4981-5168). The exact numbers below match v1; the
// only translation is the v2 difficulty mapping the user picked: v2 `easy` is
// v1 `NORMAL`, v2 `normal` is v1 `HARD`, v2 `hard` is v1 `HELL`. Server, UI,
// and SQL helper (migration 0012) all derive from this single source of truth.

export const MAX_LEVEL = 50;
export const LEVEL_UP_GOLD = 100;
export const MAX_LEVEL_XP_REQUIREMENT = 1500;

const PVE_FIRST_VICTORY_GOLD: Record<AiDifficulty, number> = {
  easy: 100,
  normal: 200,
  hard: 300
};

const PVE_XP: Record<AiDifficulty, { first: number; repeat: number }> = {
  easy: { first: 50, repeat: 8 },
  normal: { first: 100, repeat: 14 },
  hard: { first: 150, repeat: 25 }
};

/** XP needed to advance from `level` to `level + 1`. Capped at MAX_LEVEL. */
export function getXPRequiredForLevel(level: number): number {
  if (level < 1) return 0;
  if (level === 1) return 20;
  if (level <= 9) return (level + 1) * 10;
  if (level <= 19) return 100 + (level - 9) * 20;
  if (level <= 29) return 300 + (level - 19) * 30;
  if (level <= 39) return 600 + (level - 29) * 40;
  if (level <= 49) return 1000 + (level - 39) * 50;
  return MAX_LEVEL_XP_REQUIREMENT;
}

/** PvP winner XP: 8 base + HP bonus (0–4) + speed bonus (0–3). Range 8–15. */
export function calculatePvPExp(winnerHp: number, turnCount: number): number {
  const hp = Math.max(0, winnerHp);
  let exp = 8;
  exp += Math.floor((hp / 30) * 4);
  if (turnCount <= 5) exp += 3;
  else if (turnCount <= 10) exp += 2;
  else if (turnCount <= 15) exp += 1;
  return exp;
}

export function getPveXpReward(difficulty: AiDifficulty, isFirstVictory: boolean): number {
  const table = PVE_XP[difficulty];
  return isFirstVictory ? table.first : table.repeat;
}

export function getPveFirstVictoryGold(difficulty: AiDifficulty): number {
  return PVE_FIRST_VICTORY_GOLD[difficulty];
}

export interface LevelProgressionResult {
  xpAfter: number;
  levelAfter: number;
  levelUps: Array<{ level: number; goldAwarded: number }>;
}

/**
 * Apply `xpDelta` to a player at (xpBefore, levelBefore). Returns the resulting
 * xp + level and the list of levels gained (each grants LEVEL_UP_GOLD). XP is
 * dropped if the player is already at MAX_LEVEL, matching v1 (app.js:5161).
 */
export function applyXpAndComputeLevelUps(
  xpBefore: number,
  levelBefore: number,
  xpDelta: number
): LevelProgressionResult {
  let level = clampLevel(levelBefore);
  let xp = Math.max(0, xpBefore);
  const levelUps: Array<{ level: number; goldAwarded: number }> = [];
  if (level >= MAX_LEVEL) {
    return { xpAfter: xp, levelAfter: level, levelUps };
  }
  xp += Math.max(0, xpDelta);
  while (level < MAX_LEVEL) {
    const required = getXPRequiredForLevel(level);
    if (xp < required) break;
    xp -= required;
    level += 1;
    levelUps.push({ level, goldAwarded: LEVEL_UP_GOLD });
  }
  if (level >= MAX_LEVEL) xp = 0;
  return { xpAfter: xp, levelAfter: level, levelUps };
}

function clampLevel(level: number): number {
  if (!Number.isFinite(level) || level < 1) return 1;
  if (level > MAX_LEVEL) return MAX_LEVEL;
  return Math.floor(level);
}

export type RewardSource = "pve_first" | "pve_repeat" | "pvp" | "none";

export interface RewardSummary {
  result: "win" | "loss";
  mode: "pvp" | "pve";
  source: RewardSource;
  /** PvE only: which AI was beaten. Null for PvP or losses. */
  aiTheme: AiTheme | null;
  /** Difficulty of the match. Null for PvP. */
  aiDifficulty: AiDifficulty | null;
  xp: { before: number; after: number; gained: number };
  level: { before: number; after: number };
  levelUps: Array<{ level: number; goldAwarded: number }>;
  gold: {
    before: number;
    after: number;
    gained: number;
    breakdown: { firstVictory?: number; levelUps?: number };
  };
}
