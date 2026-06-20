import type { GameCommand } from "@twcardgame/shared";
import { nextInt } from "../rng.js";
import { rankMoves } from "./shared.js";
import type { EngineContext } from "./types.js";

/**
 * 簡單 — the one-ply greedy heuristic (the bot's previous default behaviour): score
 * every legal move and take the best, breaking ties with the seeded RNG so a fixed
 * seed still produces a fixed move. No lookahead.
 */
export function decideEasy(moves: GameCommand[], ctx: EngineContext): GameCommand {
  const ranked = rankMoves(ctx.state, ctx.seat, moves);
  const best = ranked[0].score;
  const tied = ranked.filter((m) => m.score === best).map((m) => m.move);
  if (tied.length === 1) return tied[0];
  const pick = nextInt(ctx.rng.state, tied.length);
  ctx.rng.state = pick.state;
  return tied[pick.value];
}
