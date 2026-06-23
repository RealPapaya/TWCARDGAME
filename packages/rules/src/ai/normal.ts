import { opponentOf, type GameCommand, type Seat } from "@twcardgame/shared";
import type { MatchState } from "../types.js";
import { engineMoves, evaluateState, rankMoves } from "./shared.js";
import { simulate } from "./simulate.js";
import type { EngineContext } from "./types.js";

// Ply-1 / ply-2 branching caps. ≤ K1 + K1*K2 ≈ 30 `reduce` simulations per step.
const K1 = 6;
const K2 = 4;
// A discrete cliff (dwarfing the normal eval range) for a line that leaves us dead
// to the opponent's CURRENT board next turn. Big enough to override any tempo gain.
const LETHAL_RISK_PENALTY = 500;

/**
 * 普通 — "開始思考兩步驟之後的未來": a 2-ply, self-only lookahead. For the best K1
 * ply-1 candidates it simulates the move, then from the resulting state takes the
 * best K2 of OUR OWN follow-ups and scores by the resulting state. Targeted
 * buff/debuff routing and divine-shield-aware trades come from the shared heuristic.
 *
 * It does NOT roll out the opponent's whole turn — that is 困難's job, and keeping it
 * out preserves the difficulty ladder (easy = greedy, normal = self lookahead + a
 * crude survival instinct, hard = full opponent-reply minimax + lethal solver). The
 * only opponent awareness here is a cheap "am I dead to their board next turn?" check
 * that stops 普通 from blithely passing into a board it already sees can kill it.
 * Returns the ply-1 move that begins the best line.
 */
export function decideNormal(moves: GameCommand[], ctx: EngineContext): GameCommand {
  const top = rankMoves(ctx.state, ctx.seat, moves).slice(0, K1);
  const leafValue = (state: MatchState): number =>
    evaluateState(state, ctx.seat) - (diesToEnemyBoardNextTurn(state, ctx.seat) ? LETHAL_RISK_PENALTY : 0);

  let best = top[0].move;
  let bestValue = -Infinity;
  for (const candidate of top) {
    const afterFirst = simulate(ctx, ctx.state, candidate.move);
    if (!afterFirst) continue;

    let lineValue = leafValue(afterFirst); // option: stop after the first move
    if (afterFirst.status === "in_progress" && afterFirst.turn.activeSeat === ctx.seat) {
      const followUps = rankMoves(afterFirst, ctx.seat, engineMoves(afterFirst, ctx.seat))
        .filter((m) => m.move.type !== "endTurn")
        .slice(0, K2);
      for (const follow of followUps) {
        const afterSecond = simulate(ctx, afterFirst, follow.move);
        if (afterSecond) lineValue = Math.max(lineValue, leafValue(afterSecond));
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

/**
 * Crude survival check (NOT a simulation): could the opponent's current board kill us
 * next turn if we passed here? A taunt of ours forces them through the wall first, so
 * we conservatively treat any taunt as "not obviously lethal" and leave the precise
 * math to 困難's real rollout. Summoning sickness is ignored on purpose — by the
 * opponent's turn their current minions will be awake.
 */
function diesToEnemyBoardNextTurn(state: MatchState, seat: Seat): boolean {
  if (state.status !== "in_progress") return false;
  const me = state.players[seat];
  if (me.board.some((m) => m.keywords.taunt)) return false;
  const incoming = state.players[opponentOf(seat)].board.reduce((sum, m) => sum + Math.max(0, m.attack), 0);
  return incoming >= me.hero.hp;
}
