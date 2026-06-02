import type { PlayerState } from "./types.js";

export const DEFAULT_TURN_TIME_LIMIT_MS = 50_000;
export const DEFAULT_MULLIGAN_TIME_LIMIT_MS = 30_000;
export const SHORT_TURN_TIME_LIMIT_MS = 10_000;

export function turnTimeLimitForPlayer(player: PlayerState, defaultTurnTimeLimitMs = DEFAULT_TURN_TIME_LIMIT_MS): number {
  return player.shortTurnPenalty ? SHORT_TURN_TIME_LIMIT_MS : defaultTurnTimeLimitMs;
}
