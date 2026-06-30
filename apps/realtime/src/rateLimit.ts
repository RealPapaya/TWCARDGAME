/**
 * A pure, deterministic fixed-window rate limiter. State lives in the Lobby
 * Durable Object (the single global chokepoint every match-creating request
 * already passes through), so this module owns no I/O and is fully unit-testable —
 * `nowMs` is injected, never read from the clock. It bounds abuse of the
 * unauthenticated match-creation endpoints (room/DO spawning) per client IP.
 */

export interface RateLimitWindow {
  count: number;
  /** Wall-clock ms at which this window resets and the counter starts over. */
  resetAtMs: number;
}

export interface RateLimitState {
  windows: Record<string, RateLimitWindow>;
}

export interface RateLimitRule {
  /** Max requests permitted within one window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Ms until the window resets (0 when allowed). */
  retryAfterMs: number;
}

export function emptyRateLimitState(): RateLimitState {
  return { windows: {} };
}

/**
 * Account for one request against `key`. Mutates `state` (caller persists it) and
 * prunes expired windows so the map can't grow without bound.
 */
export function checkRateLimit(
  state: RateLimitState,
  key: string,
  nowMs: number,
  rule: RateLimitRule
): RateLimitResult {
  pruneExpired(state, nowMs);

  const window = state.windows[key];
  if (!window || nowMs >= window.resetAtMs) {
    state.windows[key] = { count: 1, resetAtMs: nowMs + rule.windowMs };
    return { allowed: true, remaining: Math.max(0, rule.limit - 1), retryAfterMs: 0 };
  }

  if (window.count >= rule.limit) {
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, window.resetAtMs - nowMs) };
  }

  window.count += 1;
  return { allowed: true, remaining: Math.max(0, rule.limit - window.count), retryAfterMs: 0 };
}

function pruneExpired(state: RateLimitState, nowMs: number): void {
  for (const [key, window] of Object.entries(state.windows)) {
    if (nowMs >= window.resetAtMs) delete state.windows[key];
  }
}
