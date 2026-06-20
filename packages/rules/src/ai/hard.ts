import { opponentOf, type GameCommand } from "@twcardgame/shared";
import { legalMoves } from "../legalMoves.js";
import type { MatchState } from "../types.js";
import { enemyHasTaunt, totalReachableFaceDamage } from "./combat.js";
import { evaluateState, rankMoves } from "./shared.js";
import { simulate } from "./simulate.js";
import type { EngineContext } from "./types.js";

// Beam-search bounds. Worst case ≈ BEAM_WIDTH * BRANCH * MAX_DEPTH ≈ 96 `reduce`
// simulations per step; MAX_SIM_NODES is a hard backstop so a pathological board
// can't blow the Durable Object's alarm budget.
const MAX_DEPTH = 4;
const BRANCH = 6;
const BEAM_WIDTH = 4;
const MAX_SIM_NODES = 160;

interface Node {
  state: MatchState;
  firstMove: GameCommand;
}

/**
 * 困難 — a bounded turn-sequence beam search that plans the whole turn and returns
 * only the FIRST move (the session re-enters `decide` per step, so the plan unfolds
 * one move at a time and is re-derived from the advanced state). It encodes the four
 * priorities the design calls for:
 *   1. 解場 vs 攻擊英雄 + lethal — a cheap lethal short-circuit, otherwise the
 *      board-clear-vs-face tradeoff falls out of the evaluation's threat term.
 *   2. buff 先、再攻擊、且最大化 — shield/buff value scales with the buffed minion's
 *      attack (in `boardValue`), so the search keeps the biggest threats alive; a
 *      "buff then swing" line evaluates higher than swinging first.
 *   3. 犧牲最爛的、且先攻擊 — sacrificing the worst body loses the least board value,
 *      and attacking before sacrificing leaves a strictly better state; the search
 *      finds both because it evaluates whole-turn end states.
 *   4. 想盡辦法不要死 — the evaluation penalizes the opponent's reachable attack.
 */
export function decideHard(moves: GameCommand[], ctx: EngineContext): GameCommand {
  const lethal = findLethalFaceMove(ctx, moves);
  if (lethal) return lethal;

  const evalFor = (state: MatchState): number => evaluateState(state, ctx.seat);
  const endTurn = moves.find((m) => m.type === "endTurn");

  let best: { move: GameCommand; value: number } = {
    move: endTurn ?? moves[0],
    value: evalFor(ctx.state) // baseline: only act if a line beats doing nothing
  };
  let sims = 0;
  let beam: Node[] = [];

  for (let depth = 0; depth < MAX_DEPTH && sims < MAX_SIM_NODES; depth++) {
    const frontier: Node[] = depth === 0 ? [{ state: ctx.state, firstMove: moves[0] }] : beam;
    const next: Node[] = [];

    for (const node of frontier) {
      if (sims >= MAX_SIM_NODES) break;
      const candidates = rankMoves(node.state, ctx.seat, legalMoves(node.state, ctx.seat))
        .filter((c) => c.move.type !== "endTurn")
        .slice(0, BRANCH);

      for (const candidate of candidates) {
        if (sims >= MAX_SIM_NODES) break;
        const after = simulate(ctx, node.state, candidate.move);
        sims++;
        if (!after) continue;
        const firstMove = depth === 0 ? candidate.move : node.firstMove;
        const value = evalFor(after);
        if (value > best.value) best = { move: firstMove, value };
        if (after.status === "in_progress" && after.turn.activeSeat === ctx.seat) {
          next.push({ state: after, firstMove });
        }
      }
    }

    if (next.length === 0) break;
    next.sort((a, b) => evalFor(b.state) - evalFor(a.state));
    beam = next.slice(0, BEAM_WIDTH);
  }

  return best.move;
}

/**
 * Fast path for the common "lethal is already on the board" case: if the enemy has
 * no taunt and our swingable attackers' total damage covers the enemy hero, start
 * hitting face. The session keeps re-entering until the hero is dead.
 */
function findLethalFaceMove(ctx: EngineContext, moves: GameCommand[]): GameCommand | undefined {
  const enemy = ctx.state.players[opponentOf(ctx.seat)];
  if (enemyHasTaunt(enemy.board)) return undefined;
  if (totalReachableFaceDamage(ctx.state.players[ctx.seat].board) < enemy.hero.hp) return undefined;
  return moves.find((m) => m.type === "attack" && m.target.type === "HERO");
}
