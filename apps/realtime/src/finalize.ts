import type { ClientCommandMessage, GameEvent, MatchResult, Seat } from "@twcardgame/shared";
import { SEATS } from "@twcardgame/shared";
import type { MatchState } from "@twcardgame/rules";

/**
 * Connection-layer helpers ported verbatim (in behaviour) from the Colyseus
 * server so the Durable Object stays byte-identical in gameplay. None of this
 * lives in `packages/rules` because it is transport/lifecycle plumbing, not
 * deterministic gameplay — exactly the boundary the migration must preserve.
 */

export function isMatchComplete(match: MatchState): boolean {
  return match.status === "finished" || match.status === "abandoned";
}

/**
 * Pure port of `MatchResultFinalizer.finish` (apps/server/src/matchFinalizer.ts):
 * set the terminal status/result and emit a single GAME_FINISHED event. Mutates
 * `match` in place, like the original.
 */
export function finalizeMatch(match: MatchState, result: MatchResult, seat?: Seat): GameEvent[] {
  if (isMatchComplete(match)) return [];

  match.status = result.reason === "abandoned" ? "abandoned" : "finished";
  match.result = result;

  const event: GameEvent = {
    seq: match.private.nextEventSeq++,
    type: "GAME_FINISHED",
    seat,
    payload: { ...result }
  };
  match.private.eventLog.push(event);
  return [event];
}

/** Port of GameRoom.nextReconnectBudgetMs — a single cumulative budget per seat. */
export function nextReconnectBudgetMs(prevBudgetMs: number, usedMs: number): number {
  return Math.max(0, prevBudgetMs - Math.max(0, usedMs));
}

/** Port of GameRoom.pendingMulliganSeats. */
export function pendingMulliganSeats(match: MatchState): Seat[] {
  if (match.status !== "mulligan") return [];
  return SEATS.filter((seat) => !match.players[seat].mulliganReady);
}

/**
 * Port of GameRoom.requiresActionSeq — which commands are gated by turn
 * freshness. Concede/reconnect/special-phase commands are not turn-scoped.
 */
export function requiresActionSeq(commandType: ClientCommandMessage["command"]["type"]): boolean {
  return (
    commandType !== "submitMulligan" &&
    commandType !== "reconnect" &&
    commandType !== "concede" &&
    commandType !== "selectAmplification" &&
    commandType !== "rerollAmplification" &&
    commandType !== "submitVote"
  );
}

/** Deterministic 32-bit FNV-1a seed from the room id (mirrors GameRoom.seedFromRoomId). */
export function seedFromString(input: string): number {
  let seed = 2166136261;
  for (let i = 0; i < input.length; i++) {
    seed ^= input.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}
