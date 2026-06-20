import type { GameCommand } from "@twcardgame/shared";
import { legalMoves } from "../legalMoves.js";
import { evaluateState, rankMoves } from "./shared.js";
import { simulate } from "./simulate.js";
import type { EngineContext } from "./types.js";

// Ply-1 / ply-2 branching caps. ≤ K1 + K1*K2 ≈ 30 `reduce` simulations per step.
const K1 = 6;
const K2 = 4;

/**
 * 普通 — "開始思考兩步驟之後的未來": a 2-ply, self-only lookahead. For the best K1
 * ply-1 candidates it simulates the move, then from the resulting state takes the
 * best K2 of OUR OWN follow-ups (the opponent is never simulated) and scores by the
 * resulting state. Targeted buff/debuff routing and divine-shield-aware trades come
 * from the shared heuristic. Returns the ply-1 move that begins the best line.
 */
export function decideNormal(moves: GameCommand[], ctx: EngineContext): GameCommand {
  const top = rankMoves(ctx.state, ctx.seat, moves).slice(0, K1);

  let best = top[0].move;
  let bestValue = -Infinity;
  for (const candidate of top) {
    const afterFirst = simulate(ctx, ctx.state, candidate.move);
    if (!afterFirst) continue;

    let lineValue = evaluateState(afterFirst, ctx.seat); // option: stop after the first move
    if (afterFirst.status === "in_progress" && afterFirst.turn.activeSeat === ctx.seat) {
      const followUps = rankMoves(afterFirst, ctx.seat, legalMoves(afterFirst, ctx.seat))
        .filter((m) => m.move.type !== "endTurn")
        .slice(0, K2);
      for (const follow of followUps) {
        const afterSecond = simulate(ctx, afterFirst, follow.move);
        if (afterSecond) lineValue = Math.max(lineValue, evaluateState(afterSecond, ctx.seat));
      }
    }

    const value = lineValue + candidate.score * 0.1; // tiny tiebreak toward the heuristic
    if (value > bestValue) {
      bestValue = value;
      best = candidate.move;
    }
  }
  return best;
}
