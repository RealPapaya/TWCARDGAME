import type { CardDefinition } from "@twcardgame/cards";
import type { AiDifficulty, GameCommand, Seat } from "@twcardgame/shared";
import { bestMove, decideEasy, decideHard, decideNormal, type EngineContext } from "./ai/index.js";
import { legalMoves } from "./legalMoves.js";
import type { MatchState } from "./types.js";

export interface BotRngState {
  state: number;
}

/**
 * Picks a `GameCommand` for `seat`. Three genuinely distinct engines (all in
 * `./ai/`), selected by difficulty:
 *  - "easy"   — one-ply greedy heuristic (no lookahead).
 *  - "normal" — 2-ply self-only lookahead + targeted buff/debuff + trade math.
 *  - "hard"   — bounded turn-sequence beam search (lethal, buff-then-swing,
 *               sacrifice-worst, survival-aware).
 *
 * Deeper engines only kick in during regular play on `seat`'s own turn; mulligan
 * and the amplification / voting / 教召 prompt phases use the greedy pick so their
 * behaviour stays simple and deterministic.
 *
 * Pure: no `Math.random`, no `Date.now`. The caller threads a seeded RNG, and any
 * forward simulation goes through `reduce` with the supplied `nowMs`.
 */
export function decide(
  state: MatchState,
  seat: Seat,
  difficulty: AiDifficulty,
  rng: BotRngState,
  catalog: readonly CardDefinition[],
  nowMs: number
): GameCommand | undefined {
  const moves = legalMoves(state, seat);
  if (moves.length === 0) return undefined;
  if (moves.length === 1) return moves[0];

  const ctx: EngineContext = { state, seat, rng, catalog, nowMs };
  if (difficulty === "easy") return decideEasy(moves, ctx);

  const regularPlay =
    state.status === "in_progress" &&
    state.phase === "NORMAL_PLAY" &&
    state.turn.activeSeat === seat &&
    !state.pendingPrompt;
  if (!regularPlay) return bestMove(ctx, moves);

  if (difficulty === "normal") return decideNormal(moves, ctx);
  return decideHard(moves, ctx);
}
