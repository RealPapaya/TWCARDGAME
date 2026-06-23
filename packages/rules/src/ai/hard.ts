import { opponentOf, type GameCommand } from "@twcardgame/shared";
import type { MatchState } from "../types.js";
import { enemyHasTaunt, totalReachableFaceDamage } from "./combat.js";
import { engineMoves, evaluateState, rankMoves } from "./shared.js";
import { evaluateWithOpponentReply } from "./opponent.js";
import { simulate } from "./simulate.js";
import type { EngineContext } from "./types.js";

// Search bounds. The budget is deliberately generous ("prioritise smart"): the beam
// explores our own turn with the cheap static eval for PRUNING, then the few most
// promising end-states per opener are re-scored with a full opponent-reply rollout
// (the expensive part). Root branches wider than interior nodes so a strong but
// non-greedy opener (set up now, swing later) isn't pruned before it's tried.
// MAX_SIM_NODES is a hard backstop so a pathological board can't blow the DO alarm.
const MAX_DEPTH = 5;
const ROOT_BRANCH = 10;
const BRANCH = 6;
const BEAM_WIDTH = 6;
const MAX_SIM_NODES = 320;
/** Per opener, how many of its best continuations get the (costly) opponent rollout. */
const LEAVES_PER_OPENER = 4;

interface Node {
  state: MatchState;
  firstMove: GameCommand;
}

/**
 * 困難 — a 2-ply minimax: a bounded beam search plans our whole turn, and each
 * candidate line is scored by simulating the OPPONENT's best reply and evaluating
 * the position that leaves us in (see {@link evaluateWithOpponentReply}). Only the
 * FIRST move is returned; the session re-enters `decide` per step, so the plan
 * unfolds one move at a time and is re-derived from the advanced state.
 *
 * Modelling the opponent's reply is what makes the four design priorities real rather
 * than approximated by a static threat term:
 *   1. 解場 vs 攻擊英雄 + lethal — a cheap lethal short-circuit; otherwise clearing
 *      vs going face is decided by which leaves us better off AFTER the reply.
 *   2. buff 先、再攻擊、且最大化 — a "buff then swing" line keeps the bigger threat
 *      alive through the opponent's turn, so it out-scores swinging first.
 *   3. 犧牲最爛的、且先攻擊 — sacrificing the worst body (collapsed upstream) and
 *      attacking before sacrificing both survive into a strictly better reply state.
 *   4. 想盡辦法不要死 — a line that hands the opponent lethal (or a huge swing back)
 *      now scores as a loss, so the search avoids it outright.
 */
export function decideHard(moves: GameCommand[], ctx: EngineContext): GameCommand {
  const lethal = findLethalFaceMove(ctx, moves);
  if (lethal) return lethal;

  const staticEval = (state: MatchState): number => evaluateState(state, ctx.seat);

  // Beam-search our own turn with the cheap static eval (for exploration + pruning),
  // collecting every reachable end-state grouped by the opener that began its line.
  // A bot move never ends the turn here (those are filtered), so each `after` is a
  // state we could legally stop at — a candidate leaf for the opponent rollout.
  const byOpener = new Map<string, { move: GameCommand; leaves: MatchState[] }>();
  const recordLeaf = (firstMove: GameCommand, state: MatchState): void => {
    const key = JSON.stringify(firstMove);
    let entry = byOpener.get(key);
    if (!entry) {
      entry = { move: firstMove, leaves: [] };
      byOpener.set(key, entry);
    }
    entry.leaves.push(state);
  };

  let sims = 0;
  let beam: Node[] = [];
  for (let depth = 0; depth < MAX_DEPTH && sims < MAX_SIM_NODES; depth++) {
    const frontier: Node[] = depth === 0 ? [{ state: ctx.state, firstMove: moves[0] }] : beam;
    const next: Node[] = [];

    for (const node of frontier) {
      if (sims >= MAX_SIM_NODES) break;
      const branch = depth === 0 ? ROOT_BRANCH : BRANCH;
      const candidates = rankMoves(node.state, ctx.seat, engineMoves(node.state, ctx.seat))
        .filter((c) => c.move.type !== "endTurn")
        .slice(0, branch);

      for (const candidate of candidates) {
        if (sims >= MAX_SIM_NODES) break;
        const after = simulate(ctx, node.state, candidate.move);
        sims++;
        if (!after) continue;
        const firstMove = depth === 0 ? candidate.move : node.firstMove;
        recordLeaf(firstMove, after);
        if (after.status === "in_progress" && after.turn.activeSeat === ctx.seat) {
          next.push({ state: after, firstMove });
        }
      }
    }

    if (next.length === 0) break;
    next.sort((a, b) => staticEval(b.state) - staticEval(a.state));
    beam = next.slice(0, BEAM_WIDTH);
  }

  // Baseline: do nothing this turn, scored after the opponent replies. We only act if
  // a real line beats passing — and passing is itself judged by what the opponent does.
  const endTurn = moves.find((m) => m.type === "endTurn");
  let best: { move: GameCommand; value: number } = {
    move: endTurn ?? moves[0],
    value: evaluateWithOpponentReply(ctx, ctx.state)
  };

  // Re-rank each opener by the opponent-aware value of its best continuations. We take
  // the MAX over an opener's leaves because we control which continuation we play next
  // step — so an opener is as good as the best safe line it can lead to.
  for (const { move, leaves } of byOpener.values()) {
    const top = leaves
      .map((state) => ({ state, score: staticEval(state) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, LEAVES_PER_OPENER);
    let value = -Infinity;
    for (const { state } of top) {
      value = Math.max(value, evaluateWithOpponentReply(ctx, state));
    }
    if (value > best.value) best = { move, value };
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
