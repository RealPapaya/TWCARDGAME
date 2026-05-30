import { describe, expect, it } from "vitest";
import { nextReconnectBudgetMs } from "./GameRoom.js";

describe("nextReconnectBudgetMs", () => {
  it("spends the disconnected time from the remaining budget", () => {
    // Drop with a full 30s budget, return after 10s → 20s left.
    expect(nextReconnectBudgetMs(30_000, 10_000)).toBe(20_000);
  });

  it("is cumulative across disconnects (one-time budget, not reset)", () => {
    const afterFirst = nextReconnectBudgetMs(30_000, 10_000); // 20s left
    const afterSecond = nextReconnectBudgetMs(afterFirst, 5_000); // 15s left
    expect(afterFirst).toBe(20_000);
    expect(afterSecond).toBe(15_000);
  });

  it("never goes negative when the gap exceeds the remaining budget", () => {
    expect(nextReconnectBudgetMs(20_000, 25_000)).toBe(0);
  });

  it("ignores negative elapsed time defensively", () => {
    expect(nextReconnectBudgetMs(30_000, -1_000)).toBe(30_000);
  });
});
