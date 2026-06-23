import { opponentOf, type GameCommand, type Seat } from "@twcardgame/shared";
import { reduce } from "../engine.js";
import { legalMoves } from "../legalMoves.js";
import type { MatchState } from "../types.js";
import { evaluateState, rankMoves } from "./shared.js";
import type { EngineContext } from "./types.js";

/**
 * How many moves of the opponent's reply turn we are willing to roll out before
 * giving up and scoring the position as-is. A real turn is well under this; the cap
 * is only a backstop against a pathological loop (it never enters `MatchState`).
 */
const OPP_MAX_STEPS = 24;

/**
 * Module-local monotonic counter — mints a unique `commandId` per simulated move so
 * `reduce`'s idempotency guard never no-ops a rollout step. Same rationale (and the
 * same determinism-safety argument) as the counter in `simulate.ts`: it never enters
 * `MatchState`/the snapshot and never influences WHICH move is chosen.
 */
let oppSeq = 0;

function step(
  ctx: EngineContext,
  fromState: MatchState,
  move: GameCommand,
  seat: Seat
): MatchState | undefined {
  try {
    const { state, events } = reduce(
      fromState,
      { commandId: `ai-opp-${oppSeq++}`, seat, nowMs: ctx.nowMs, command: move },
      ctx.catalog
    );
    if (events.some((event) => event.type === "COMMAND_REJECTED")) return undefined;
    return state;
  } catch {
    return undefined;
  }
}

/**
 * The "paranoid opponent" model that turns 困難 from a self-only optimizer into a
 * real 2-ply minimax. Given a `leaf` state at the end of the bot's planned line:
 *
 *  1. If it is still the bot's turn, end the turn so the opponent gets to respond.
 *  2. Roll the opponent's reply turn forward with a greedy (one-ply heuristic) policy
 *     — the same `rankMoves` ordering the easy engine uses, so it reliably takes
 *     lethal / face damage / good trades — until the opponent passes or the game ends.
 *  3. Score the resulting position from the BOT's perspective.
 *
 * The result is "how good is this line once the opponent has hit back", which is what
 * makes the bot stop over-extending into clears, hold defenders, and — above all —
 * 想盡辦法不要死: a line that hands the opponent lethal now evaluates as a loss.
 *
 * Pure and deterministic: the greedy policy breaks ties by enumeration order (no RNG),
 * and every transition goes through `reduce` with the supplied `nowMs`.
 */
export function evaluateWithOpponentReply(ctx: EngineContext, leaf: MatchState): number {
  const seat = ctx.seat;
  let state = leaf;

  // (1) Hand the turn over if the line stopped mid-our-turn. A pending prompt means
  // we still owe a choice — don't fabricate an end-turn through it; score as-is.
  if (
    state.status === "in_progress" &&
    state.turn.activeSeat === seat &&
    !state.pendingPrompt
  ) {
    const ended = step(ctx, state, { type: "endTurn" }, seat);
    if (ended) state = ended;
  }

  // (2) Greedily roll out the opponent's reply. We only advance moves that belong to
  // the opponent (their normal turn plus any special-phase choice they owe); once
  // control returns to us we stop — deeper plies are not modeled here.
  const oppSeat = opponentOf(seat);
  for (let i = 0; i < OPP_MAX_STEPS; i++) {
    if (state.status !== "in_progress") break;
    const oppMoves = legalMoves(state, oppSeat);
    if (oppMoves.length === 0) break;
    const best = rankMoves(state, oppSeat, oppMoves)[0]?.move;
    if (!best) break;
    const after = step(ctx, state, best, oppSeat);
    if (!after) break;
    state = after;
  }

  // (3) Score the position once the dust settles.
  return evaluateState(state, seat);
}
