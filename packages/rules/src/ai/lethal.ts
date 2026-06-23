import { opponentOf, type GameCommand, type Seat } from "@twcardgame/shared";
import { legalMoves } from "../legalMoves.js";
import type { MatchState } from "../types.js";
import { totalReachableFaceDamage } from "./combat.js";
import { battlecryIntent } from "./shared.js";
import { simulate } from "./simulate.js";
import type { EngineContext } from "./types.js";

/** Hard backstop on `reduce` simulations so a wide board can't blow the DO alarm. */
const LETHAL_MAX_NODES = 600;

interface Distance {
  /** Enemy hero HP + total taunt HP: the wall we must chew through, this turn. */
  wall: number;
  /** Damage our board can still put on the table this turn (face / buffs / charge). */
  reach: number;
}

/**
 * A focused "can I kill the enemy hero THIS turn?" search - the piece the old
 * `findLethalFaceMove` couldn't do. It plans a sequence of damage-relevant moves and
 * returns the FIRST move of any line that ends the game in our favour, covering the
 * lethals a naive face-check misses:
 *   - clear the enemy's taunt(s), THEN go face;
 *   - burn the hero down with damage battlecries / spells;
 *   - buff an attacker (or drop a charge minion) to top off the last few points.
 *
 * DFS ordered damage-first, pruned to moves that make progress toward the kill
 * (shrink the wall or grow our reach), so it converges fast and stays bounded. Pure
 * and deterministic: move order is fixed and every transition goes through `reduce`.
 */
export function findLethal(ctx: EngineContext): GameCommand | undefined {
  const seat = ctx.seat;
  if (ctx.state.players[opponentOf(seat)].hero.hp <= 0) return undefined;

  let nodes = 0;
  const dfs = (state: MatchState, first: GameCommand | undefined, dist: Distance): GameCommand | undefined => {
    for (const move of orderedLethalMoves(state, seat)) {
      if (nodes >= LETHAL_MAX_NODES) return undefined;
      const after = simulate(ctx, state, move);
      nodes++;
      if (!after) continue;
      const firstMove = first ?? move;
      if (after.status === "finished") {
        if (after.result?.winnerSeat === seat) return firstMove;
        continue; // ended the game without winning - not a lethal line
      }
      if (after.turn.activeSeat !== seat) continue; // lethal must land before we pass
      const nextDist = lethalDistance(after, seat);
      // Only recurse on moves that bring the kill closer - a smaller wall or more
      // reach. Plays that do neither (e.g. a sleeping vanilla body) can't help THIS
      // turn, so pruning them keeps the branching factor tiny.
      if (nextDist.wall < dist.wall || nextDist.reach > dist.reach) {
        const found = dfs(after, firstMove, nextDist);
        if (found) return found;
      }
    }
    return undefined;
  };

  return dfs(ctx.state, undefined, lethalDistance(ctx.state, seat));
}

function lethalDistance(state: MatchState, seat: Seat): Distance {
  const enemy = state.players[opponentOf(seat)];
  const tauntHp = enemy.board
    .filter((m) => m.keywords.taunt)
    .reduce((sum, m) => sum + Math.max(0, m.currentHealth), 0);
  return {
    wall: enemy.hero.hp + tauntHp,
    reach: totalReachableFaceDamage(state.players[seat].board)
  };
}

/** Damage-relevant legal moves, ordered so the most direct path to the face goes first. */
function orderedLethalMoves(state: MatchState, seat: Seat): GameCommand[] {
  return legalMoves(state, seat)
    .filter((move) => isLethalRelevant(state, seat, move))
    .map((move, index) => ({ move, index, rank: lethalRank(state, seat, move) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ move }) => move);
}

function isLethalRelevant(state: MatchState, seat: Seat, move: GameCommand): boolean {
  if (move.type === "attack") return true; // face damage, or clearing a taunt that blocks it
  if (move.type !== "playCard") return false;
  const card = state.players[seat].hand.find((c) => c.instanceId === move.handInstanceId);
  if (!card) return false;
  if (card.type === "MINION" && card.keywords.charge) return true; // an attacker that swings now
  const battlecry = card.keywords.battlecry;
  if (!battlecry) return false;
  const friendly = move.target?.side === seat;
  const intent = battlecryIntent(battlecry.type ?? "", friendly);
  if (intent === "HARMFUL" && !friendly) return true; // burn the hero or kill a taunt
  if (intent === "BENEFICIAL" && friendly) return true; // buff our attacker for the last points
  return false;
}

function lethalRank(state: MatchState, seat: Seat, move: GameCommand): number {
  if (move.type === "attack") return move.target.type === "HERO" ? 0 : 1;
  if (move.type === "playCard") {
    const friendly = move.target?.side === seat;
    if (!friendly && move.target?.type === "HERO") return 2; // burn to face
    if (!friendly) return 3; // damage to clear a blocker
    return 4; // buff / charge enabler
  }
  return 5;
}
