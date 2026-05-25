import { describe, expect, it } from "vitest";
import {
  applyXpAndComputeLevelUps,
  calculatePvPExp,
  getPveFirstVictoryGold,
  getPveXpReward,
  getXPRequiredForLevel,
  LEVEL_UP_GOLD,
  MAX_LEVEL,
  MAX_LEVEL_XP_REQUIREMENT
} from "./progression.js";

describe("getXPRequiredForLevel", () => {
  // Mirrors the boundaries in LEGACY/js/ui/app.js:4981-4990.
  const cases: Array<[number, number]> = [
    [0, 0],
    [1, 20],
    [2, 30],
    [9, 100],
    [10, 120],
    [19, 300],
    [20, 330],
    [29, 600],
    [30, 640],
    [39, 1000],
    [40, 1050],
    [49, 1500],
    [50, MAX_LEVEL_XP_REQUIREMENT],
    [51, MAX_LEVEL_XP_REQUIREMENT]
  ];

  for (const [level, expected] of cases) {
    it(`level ${level} -> ${expected}`, () => {
      expect(getXPRequiredForLevel(level)).toBe(expected);
    });
  }
});

describe("calculatePvPExp", () => {
  // Cases derived directly from LEGACY/js/ui/app.js:5015-5037.
  it("full HP + fastest turn returns the max (15)", () => {
    expect(calculatePvPExp(30, 3)).toBe(15);
  });

  it("clamps speed bonus at the 5-turn boundary", () => {
    expect(calculatePvPExp(30, 5)).toBe(15);
    expect(calculatePvPExp(30, 6)).toBe(14);
  });

  it("half HP, mid speed", () => {
    // hp 15 -> floor((15/30)*4) = 2 ; turn 11 -> speed 1 ; base 8 -> 11.
    expect(calculatePvPExp(15, 11)).toBe(11);
  });

  it("zero HP and slow game collapses to the base 8", () => {
    expect(calculatePvPExp(0, 99)).toBe(8);
  });

  it("low HP rounds the HP bonus down to zero", () => {
    expect(calculatePvPExp(5, 99)).toBe(8);
  });

  it("over-turn-15 wins still get the HP bonus", () => {
    expect(calculatePvPExp(30, 16)).toBe(12);
  });
});

describe("PvE reward helpers (v2-mapped: easy=NORMAL, normal=HARD, hard=HELL)", () => {
  it("first-victory gold by difficulty", () => {
    expect(getPveFirstVictoryGold("easy")).toBe(100);
    expect(getPveFirstVictoryGold("normal")).toBe(200);
    expect(getPveFirstVictoryGold("hard")).toBe(300);
  });

  it("XP rewards first vs repeat", () => {
    expect(getPveXpReward("easy", true)).toBe(50);
    expect(getPveXpReward("easy", false)).toBe(8);
    expect(getPveXpReward("normal", true)).toBe(100);
    expect(getPveXpReward("normal", false)).toBe(14);
    expect(getPveXpReward("hard", true)).toBe(150);
    expect(getPveXpReward("hard", false)).toBe(25);
  });
});

describe("applyXpAndComputeLevelUps", () => {
  it("no XP gained leaves the player put", () => {
    const r = applyXpAndComputeLevelUps(5, 1, 0);
    expect(r).toEqual({ xpAfter: 5, levelAfter: 1, levelUps: [] });
  });

  it("crossing exactly one level returns one level-up and the remainder", () => {
    // L1 needs 20; start 15, gain 10 -> 25 -> level 2, 5 leftover.
    const r = applyXpAndComputeLevelUps(15, 1, 10);
    expect(r.levelAfter).toBe(2);
    expect(r.xpAfter).toBe(5);
    expect(r.levelUps).toEqual([{ level: 2, goldAwarded: LEVEL_UP_GOLD }]);
  });

  it("a first-victory PvE Normal grant from a fresh account leaps multiple levels", () => {
    // Fresh L1 + 100 XP: spends 20 (->L2), 30 (->L3), 40 (->L4), 10 leftover.
    const r = applyXpAndComputeLevelUps(0, 1, 100);
    expect(r.levelAfter).toBe(4);
    expect(r.xpAfter).toBe(10);
    expect(r.levelUps).toEqual([
      { level: 2, goldAwarded: 100 },
      { level: 3, goldAwarded: 100 },
      { level: 4, goldAwarded: 100 }
    ]);
  });

  it("caps at MAX_LEVEL and drops surplus XP", () => {
    const r = applyXpAndComputeLevelUps(0, MAX_LEVEL, 9999);
    expect(r.levelAfter).toBe(MAX_LEVEL);
    expect(r.xpAfter).toBe(0);
    expect(r.levelUps).toEqual([]);
  });

  it("hitting MAX_LEVEL mid-grant truncates further XP", () => {
    // From L49 with 1499 xp, gaining 999999 should land at L50 with 0 xp.
    const r = applyXpAndComputeLevelUps(1499, 49, 999_999);
    expect(r.levelAfter).toBe(MAX_LEVEL);
    expect(r.xpAfter).toBe(0);
    expect(r.levelUps).toEqual([{ level: MAX_LEVEL, goldAwarded: LEVEL_UP_GOLD }]);
  });
});
