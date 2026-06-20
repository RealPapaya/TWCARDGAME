import type { CommandEnvelope, GameCommand } from "@twcardgame/shared";
import { reduce } from "../engine.js";
import type { MatchState } from "../types.js";
import type { EngineContext } from "./types.js";

/**
 * Module-local monotonic counter, used ONLY to mint a unique `commandId` for each
 * simulated move so `reduce`'s idempotency guard never no-ops a simulation. It
 * never enters `MatchState` / the snapshot and never influences WHICH move is
 * chosen (moves are ranked by score, ties broken by enumeration order), so it is
 * determinism-safe: two identical `decide` inputs still yield the same move.
 */
let simSeq = 0;

/**
 * Applies `move` to a CLONE of `fromState` via the pure `reduce` and returns the
 * resulting state — or `undefined` if the engine rejected the move (illegal in
 * this simulated line) or threw. `fromState` is never mutated (`reduce` clones).
 */
export function simulate(ctx: EngineContext, fromState: MatchState, move: GameCommand): MatchState | undefined {
  const envelope: CommandEnvelope = {
    commandId: `ai-sim-${simSeq++}`,
    seat: ctx.seat,
    nowMs: ctx.nowMs,
    command: move
  };
  try {
    const { state, events } = reduce(fromState, envelope, ctx.catalog);
    // A rejected command leaves the clone effectively unchanged — discard the
    // branch rather than treating "no progress" as a real line.
    if (events.some((event) => event.type === "COMMAND_REJECTED")) return undefined;
    return state;
  } catch {
    return undefined;
  }
}
