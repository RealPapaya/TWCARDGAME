import type { CardDefinition } from "@twcardgame/cards";
import {
  opponentOf,
  type AiDifficulty,
  type CommandEnvelope,
  type GameCommand,
  type Seat
} from "@twcardgame/shared";
import { reduce } from "./engine.js";
import { legalMoves } from "./legalMoves.js";
import { nextInt } from "./rng.js";
import { canPayCardCost, findMinion, getCardActualCost } from "./state.js";
import type { MatchState, RuntimeMinion } from "./types.js";

export interface BotRngState {
  state: number;
}

/**
 * Picks a `GameCommand` for `seat` given the current `state`.
 * - "easy" picks uniformly at random.
 * - "normal" scores each candidate with a hand-rolled heuristic.
 * - "hard" runs the normal heuristic, then simulates the top-K moves one ply
 *   forward via `reduce()` and picks the one whose resulting state evaluates
 *   highest from `seat`'s perspective.
 *
 * Pure: no `Math.random`, no `Date.now`. The caller threads a seeded RNG.
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

  if (difficulty === "easy") return pickRandom(moves, rng);

  const scored = moves
    .map((move) => ({ move, score: scoreMove(state, seat, move) }))
    .sort((a, b) => b.score - a.score);

  if (difficulty === "normal") return scored[0].move;

  // hard: simulate the top 4 candidates one ply and re-score by resulting state value.
  const top = scored.slice(0, 4);
  let best = top[0];
  let bestStateScore = -Infinity;
  for (const candidate of top) {
    const envelope: CommandEnvelope = {
      commandId: `bot-sim-${rng.state}-${candidate.score}`,
      seat,
      nowMs,
      command: candidate.move
    };
    try {
      const sim = reduce(state, envelope, catalog);
      const stateScore = evaluateState(sim.state, seat) + candidate.score * 0.1;
      if (stateScore > bestStateScore) {
        bestStateScore = stateScore;
        best = candidate;
      }
    } catch {
      // Skip moves that the engine rejects in simulation — keep the heuristic pick.
    }
  }
  return best.move;
}

function pickRandom<T>(items: T[], rng: BotRngState): T {
  const next = nextInt(rng.state, items.length);
  rng.state = next.state;
  return items[next.value];
}

function scoreMove(state: MatchState, seat: Seat, move: GameCommand): number {
  if (move.type === "endTurn") return endTurnScore(state, seat);
  if (move.type === "submitMulligan") return 0;
  if (move.type === "concede") return -1_000_000;
  if (move.type === "playCard") return scorePlay(state, seat, move);
  if (move.type === "attack") return scoreAttack(state, seat, move);
  if (move.type === "selectAmplification") return scoreAmplification(state, seat, move);
  if (move.type === "submitVote") return 3 - move.optionIndex; // deterministic: prefer index 0
  if (move.type === "resolvePrompt") return scoreResolvePrompt(state, move);
  return 0;
}

/** 教召 / Discover: pick the highest-value candidate (stats for minions, cost otherwise). */
function scoreResolvePrompt(state: MatchState, move: Extract<GameCommand, { type: "resolvePrompt" }>): number {
  const card = state.private.pendingChoice?.cards.find((c) => c.instanceId === move.choiceInstanceId);
  if (!card) return 0;
  if (card.type === "MINION") return (card.attack ?? 0) + (card.health ?? 0);
  return card.cost; // spells/news: prefer the higher-impact (costlier) option
}

const TIER_RANK: Record<string, number> = { 加減賺: 1, 穩穩仔賺: 2, 卯死: 3 };

function scoreAmplification(state: MatchState, seat: Seat, move: Extract<GameCommand, { type: "selectAmplification" }>): number {
  // A phase's options now share one tier, so prefer a faction augment the deck
  // actually supports (颱風假 needs 勞工, 島嶼天光 needs 民進黨政治人物); otherwise the
  // tier rank breaks ties deterministically.
  const option = state.specialPhase?.amplificationOptions?.[seat]?.find((o) => o.id === move.optionId);
  if (!option) return 0;
  let score = TIER_RANK[option.tier] ?? 0;
  const counts = state.players[seat].registeredCategoryCounts;
  if (option.id === "AMP_TYPHOON_DAY") score += counts["勞工"] ?? 0;
  if (option.id === "AMP_ISLAND_DAWN") score += counts["民進黨政治人物"] ?? 0;
  return score;
}

function endTurnScore(state: MatchState, seat: Seat): number {
  // Prefer ending the turn last: penalize while we still have mana that could
  // pay for any card in hand.
  const player = state.players[seat];
  const playableInHand = player.hand.some((card) => canPayCardCost(state, seat, card));
  if (playableInHand) return -50;
  const swingableMinion = player.board.some((m) => !m.sleeping && m.canAttack && m.lockedTurns === 0 && m.attack > 0);
  if (swingableMinion) return -20;
  return -1;
}

function scorePlay(state: MatchState, seat: Seat, move: Extract<GameCommand, { type: "playCard" }>): number {
  const player = state.players[seat];
  const card = player.hand.find((c) => c.instanceId === move.handInstanceId);
  if (!card) return -100;
  const cost = getCardActualCost(state, seat, card);
  let score = 8 + cost * 2; // mana efficiency baseline
  if (card.type === "MINION") {
    score += (card.attack ?? 0) + (card.health ?? 0);
    if (card.keywords.taunt) score += 3;
    if (card.keywords.divineShield) score += 2;
    if (card.keywords.charge) score += 2;
  } else {
    score += 5; // playing a spell/news is usually decent
  }
  // Battlecry that targets — small bonus for damage-ish effects against enemy minions or hero.
  const battlecry = card.keywords.battlecry;
  if (battlecry && move.target) {
    if (move.target.side && move.target.side !== seat) score += 4;
    if (battlecry.type === "DAMAGE" || battlecry.type === "DAMAGE_NON_CATEGORY") {
      score += (battlecry.value ?? 1) * 2;
    }
  }
  return score;
}

function scoreAttack(state: MatchState, seat: Seat, move: Extract<GameCommand, { type: "attack" }>): number {
  const enemySeat = opponentOf(seat);
  const me = state.players[seat];
  const enemy = state.players[enemySeat];
  const attackerEntry = findMinion(me, move.attackerInstanceId);
  if (!attackerEntry) return -100;
  const attacker = attackerEntry.minion;

  if (move.target.type === "HERO") {
    // Lethal check: if we can drop the enemy hero this swing, that's the best move available.
    if (enemy.hero.hp <= attacker.attack) return 1_000;
    return 10 + attacker.attack;
  }

  if (!move.target.instanceId) return -10;
  const targetEntry = findMinion(enemy, move.target.instanceId);
  if (!targetEntry) return -10;
  const target = targetEntry.minion;
  let score = 5 + Math.min(attacker.attack, target.currentHealth);
  // Favorable trade: we live, they die.
  if (attacker.attack >= target.currentHealth && target.attack < attacker.currentHealth) score += 8;
  // Threat removal: high-attack enemy minion.
  score += target.attack;
  // Suicidal trade: we die but they don't — discourage.
  if (target.attack >= attacker.currentHealth && attacker.attack < target.currentHealth) score -= 6;
  // Taunt removal: bonus when we clear a taunt blocking our future face damage.
  if (target.keywords.taunt) score += 4;
  return score;
}

function evaluateState(state: MatchState, seat: Seat): number {
  if (state.status === "finished") {
    if (state.result?.winnerSeat === seat) return 1_000;
    if (state.result?.winnerSeat) return -1_000;
    return 0;
  }
  const me = state.players[seat];
  const enemy = state.players[opponentOf(seat)];
  return (
    me.hero.hp * 2 -
    enemy.hero.hp * 2 +
    boardValue(me.board) -
    boardValue(enemy.board) +
    me.hand.length * 0.5
  );
}

function boardValue(board: RuntimeMinion[]): number {
  let sum = 0;
  for (const m of board) {
    sum += m.attack + m.currentHealth;
    if (m.keywords.taunt) sum += 2;
    if (m.keywords.divineShield) sum += 2;
  }
  return sum;
}
