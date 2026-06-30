import { describe, expect, it } from "vitest";
import { checkRateLimit, emptyRateLimitState } from "./rateLimit.js";

const RULE = { limit: 3, windowMs: 1000 };

describe("checkRateLimit", () => {
  it("allows up to the limit within a window, then blocks", () => {
    const state = emptyRateLimitState();
    expect(checkRateLimit(state, "ip", 0, RULE)).toMatchObject({ allowed: true, remaining: 2 });
    expect(checkRateLimit(state, "ip", 100, RULE)).toMatchObject({ allowed: true, remaining: 1 });
    expect(checkRateLimit(state, "ip", 200, RULE)).toMatchObject({ allowed: true, remaining: 0 });
    const blocked = checkRateLimit(state, "ip", 300, RULE);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(700); // window opened at 0, resets at 1000
  });

  it("resets after the window elapses", () => {
    const state = emptyRateLimitState();
    checkRateLimit(state, "ip", 0, RULE);
    checkRateLimit(state, "ip", 0, RULE);
    checkRateLimit(state, "ip", 0, RULE);
    expect(checkRateLimit(state, "ip", 500, RULE).allowed).toBe(false);
    expect(checkRateLimit(state, "ip", 1000, RULE)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("tracks each key independently", () => {
    const state = emptyRateLimitState();
    checkRateLimit(state, "a", 0, RULE);
    checkRateLimit(state, "a", 0, RULE);
    checkRateLimit(state, "a", 0, RULE);
    expect(checkRateLimit(state, "a", 0, RULE).allowed).toBe(false);
    expect(checkRateLimit(state, "b", 0, RULE).allowed).toBe(true);
  });

  it("prunes expired windows so the map cannot grow unbounded", () => {
    const state = emptyRateLimitState();
    checkRateLimit(state, "old", 0, RULE);
    checkRateLimit(state, "fresh", 2000, RULE);
    expect(Object.keys(state.windows)).toEqual(["fresh"]);
  });
});
