import { opponentOf, type GameCommand, type Seat, type TargetRef } from "@twcardgame/shared";
import type { EffectDefinition } from "@twcardgame/cards";
import { legalMoves } from "../legalMoves.js";
import { canPayCardCost, findMinion, getCardActualCost } from "../state.js";
import type { MatchState, RuntimeMinion } from "../types.js";
import { resolveMinionTrade } from "./combat.js";
import type { EngineContext, ScoredMove } from "./types.js";

/* --------------------------------------------------------------------------- *
 * Move scoring (one-ply heuristic). Ported from the original bot.ts and upgraded
 * with divine-shield-aware trades + friendly-buff / enemy-debuff targeting.
 * --------------------------------------------------------------------------- */

export function scoreMove(state: MatchState, seat: Seat, move: GameCommand): number {
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
export function scoreResolvePrompt(state: MatchState, move: Extract<GameCommand, { type: "resolvePrompt" }>): number {
  const card = state.private.pendingChoice?.cards.find((c) => c.instanceId === move.choiceInstanceId);
  if (!card) return 0;
  if (card.type === "MINION") return (card.attack ?? 0) + (card.health ?? 0);
  return card.cost; // spells/news: prefer the higher-impact (costlier) option
}

const TIER_RANK: Record<string, number> = { 加減賺: 1, 蕭貪: 2, 卯死: 3 };

export function scoreAmplification(state: MatchState, seat: Seat, move: Extract<GameCommand, { type: "selectAmplification" }>): number {
  const option = state.specialPhase?.amplificationOptions?.[seat]?.find((o) => o.id === move.optionId);
  if (!option) return 0;
  let score = TIER_RANK[option.tier] ?? 0;
  const counts = state.players[seat].registeredCategoryCounts;
  if (option.id === "AMP_TYPHOON_DAY") score += counts["勞工"] ?? 0;
  if (option.id === "AMP_ISLAND_DAWN") score += counts["民進黨政治人物"] ?? 0;
  return score;
}

export function endTurnScore(state: MatchState, seat: Seat): number {
  // Prefer ending the turn last: penalize while we still have a card we can pay
  // for, or a minion that could still swing.
  const player = state.players[seat];
  if (player.hand.some((card) => canPayCardCost(state, seat, card))) return -50;
  if (player.board.some((m) => !m.sleeping && m.canAttack && m.lockedTurns === 0 && m.attack > 0)) return -20;
  return -1;
}

export function scorePlay(state: MatchState, seat: Seat, move: Extract<GameCommand, { type: "playCard" }>): number {
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
  const battlecry = card.keywords.battlecry;
  if (battlecry) score += scoreBattlecryTarget(state, seat, battlecry, move.target);
  return score;
}

/**
 * "buff 一定給自己, debuff 一定給別人": reward routing a beneficial battlecry onto a
 * friendly minion (scaled by that minion's attack, so a shield/buff lands on the
 * biggest body) and a harmful one onto an enemy minion (scaled by the threat it
 * removes). A sacrifice (`EAT_FRIENDLY` / friendly `DESTROY`) prefers the worst body.
 */
function scoreBattlecryTarget(state: MatchState, seat: Seat, battlecry: EffectDefinition, target: TargetRef | undefined): number {
  const type = battlecry.type ?? "";
  let bonus = 0;
  if (type === "DAMAGE" || type === "DAMAGE_NON_CATEGORY") bonus += (battlecry.value ?? 1) * 2;
  if (!target) return bonus;

  const friendly = target.side === seat;
  const minion = targetedMinion(state, target);
  const intent = battlecryIntent(type, friendly);

  if (intent === "BENEFICIAL") {
    bonus += friendly ? 4 : -6;
    if (friendly && minion) bonus += minion.attack * 0.4; // buff the bigger threat
  } else if (intent === "HARMFUL") {
    bonus += friendly ? -8 : 4;
    if (!friendly && minion) bonus += (minion.attack + minion.currentHealth) * 0.4;
  } else if (intent === "SACRIFICE") {
    // Forced friendly removal: prefer killing the least valuable body.
    if (minion) bonus += 6 - (minion.attack + minion.currentHealth) * 0.5;
  }
  return bonus;
}

type BattlecryIntent = "BENEFICIAL" | "HARMFUL" | "SACRIFICE" | "NEUTRAL";

export function battlecryIntent(type: string, friendlyTarget: boolean): BattlecryIntent {
  if (type === "EAT_FRIENDLY") return "SACRIFICE";
  if (type === "DESTROY" || type.startsWith("DESTROY_") || type.startsWith("BOUNCE")) {
    return friendlyTarget ? "SACRIFICE" : "HARMFUL";
  }
  if (
    type.startsWith("BUFF") ||
    type.startsWith("GIVE_DIVINE_SHIELD") ||
    type === "GIVE_KEYWORD_ADJACENT" ||
    type.startsWith("HEAL") ||
    type.startsWith("FULL_HEAL") ||
    type === "UNLOCK_AND_BUFF_HEALTH"
  ) {
    return "BENEFICIAL";
  }
  if (type.startsWith("DAMAGE") || type === "MULTI_DAMAGE" || type.startsWith("LOCK") || type === "SET_DEATH_TIMER") {
    return "HARMFUL";
  }
  return "NEUTRAL";
}

function targetedMinion(state: MatchState, target: TargetRef): RuntimeMinion | undefined {
  if (target.type !== "MINION" || !target.side || !target.instanceId) return undefined;
  return findMinion(state.players[target.side], target.instanceId)?.minion;
}

export function scoreAttack(state: MatchState, seat: Seat, move: Extract<GameCommand, { type: "attack" }>): number {
  const enemy = state.players[opponentOf(seat)];
  const attackerEntry = findMinion(state.players[seat], move.attackerInstanceId);
  if (!attackerEntry) return -100;
  const attacker = attackerEntry.minion;

  if (move.target.type === "HERO") {
    if (enemy.hero.hp <= attacker.attack) return 1_000; // lethal this swing
    return 10 + attacker.attack;
  }

  if (!move.target.instanceId) return -10;
  const targetEntry = findMinion(enemy, move.target.instanceId);
  if (!targetEntry) return -10;
  const target = targetEntry.minion;

  const trade = resolveMinionTrade(attacker, target);
  let score = 5;
  if (trade.defenderDies) {
    score += target.attack + target.currentHealth; // value removed from the board
    if (!trade.attackerDies) score += 8; // clean favorable trade
  } else if (trade.defenderShieldPopped) {
    score += 1; // only popped a shield — barely worth a big attacker
  } else {
    score += Math.min(attacker.attack, target.currentHealth); // chip damage
  }
  if (trade.attackerDies && !trade.defenderDies) score -= 6; // suicidal
  if (target.keywords.taunt) score += 4; // clear a blocker for future face damage
  return score;
}

/* --------------------------------------------------------------------------- *
 * State evaluation (lookahead leaf). Shield value scales with the minion's attack
 * so the search naturally shields/keeps the biggest threats; the enemy-threat term
 * encodes "想盡辦法不要死".
 * --------------------------------------------------------------------------- */

const TERMINAL_WIN = 1_000_000;

export function evaluateState(state: MatchState, seat: Seat): number {
  if (state.status === "finished") {
    if (state.result?.winnerSeat === seat) return TERMINAL_WIN;
    if (state.result?.winnerSeat) return -TERMINAL_WIN;
    return 0;
  }
  const me = state.players[seat];
  const enemy = state.players[opponentOf(seat)];
  const enemyThreat = enemy.board.reduce((sum, m) => sum + Math.max(0, m.attack), 0);
  return (
    2 * (me.hero.hp - enemy.hero.hp) +
    // Non-linear life pressure: being low on HP is far worse than the linear term
    // implies (想盡辦法不要死), and an enemy near death is worth pushing for. Convex,
    // so it only really bites once a hero drops into kill range.
    (hpDanger(enemy.hero.hp) - hpDanger(me.hero.hp)) +
    (boardValue(me.board) - boardValue(enemy.board)) +
    // Card advantage: value our own resources, and mildly fear the enemy's.
    (0.8 * me.hand.length - 0.4 * enemy.hand.length) -
    1.5 * enemyThreat
  );
}

/** Convex penalty for a hero sitting below the "comfortable" threshold; 0 above it. */
function hpDanger(hp: number): number {
  const SAFE = 18;
  if (hp >= SAFE) return 0;
  const deficit = SAFE - Math.max(0, hp);
  return deficit * deficit * 0.06;
}

export function boardValue(board: readonly RuntimeMinion[]): number {
  let sum = 0;
  for (const m of board) {
    sum += Math.max(0, m.attack) + Math.max(0, m.currentHealth);
    if (m.keywords.taunt) sum += 2;
    if (m.keywords.divineShield) sum += 2 + m.attack * 0.5; // a shield on a big body is worth more
  }
  return sum;
}

/* --------------------------------------------------------------------------- *
 * Small selection helpers shared by the engines.
 * --------------------------------------------------------------------------- */

export function highestAttackMinion(board: readonly RuntimeMinion[]): RuntimeMinion | undefined {
  let best: RuntimeMinion | undefined;
  for (const m of board) if (!best || m.attack > best.attack) best = m;
  return best;
}

export function worstMinion(board: readonly RuntimeMinion[]): RuntimeMinion | undefined {
  let worst: RuntimeMinion | undefined;
  for (const m of board) {
    if (!worst || m.attack + m.currentHealth < worst.attack + worst.currentHealth) worst = m;
  }
  return worst;
}

/**
 * Legal moves for the engines, with one correction: a forced friendly sacrifice
 * (`EAT_FRIENDLY` / friendly `DESTROY`/`BOUNCE`) is collapsed to the single variant
 * that targets the WORST body. `boardValue` is linear so eating the worst vs the
 * best is value-equivalent to the lookahead — collapsing here guarantees the
 * engine "殺死最爛的卡" instead of leaving it to a tiebreak.
 */
export function engineMoves(state: MatchState, seat: Seat): GameCommand[] {
  return collapseSacrificeTargets(state, seat, legalMoves(state, seat));
}

export function collapseSacrificeTargets(state: MatchState, seat: Seat, moves: readonly GameCommand[]): GameCommand[] {
  const worstByCard = new Map<string, { move: GameCommand; rank: number }>();
  const passthrough: GameCommand[] = [];
  for (const move of moves) {
    if (
      move.type === "playCard" &&
      move.target?.type === "MINION" &&
      move.target.side === seat &&
      move.target.instanceId &&
      isSacrificePlay(state, seat, move)
    ) {
      const minion = findMinion(state.players[seat], move.target.instanceId)?.minion;
      const rank = minion ? minion.attack + minion.currentHealth : Number.POSITIVE_INFINITY;
      const current = worstByCard.get(move.handInstanceId);
      if (!current || rank < current.rank) worstByCard.set(move.handInstanceId, { move, rank });
      continue;
    }
    passthrough.push(move);
  }
  for (const { move } of worstByCard.values()) passthrough.push(move);
  return passthrough;
}

function isSacrificePlay(state: MatchState, seat: Seat, move: Extract<GameCommand, { type: "playCard" }>): boolean {
  const card = state.players[seat].hand.find((c) => c.instanceId === move.handInstanceId);
  return battlecryIntent(card?.keywords.battlecry?.type ?? "", true) === "SACRIFICE";
}

/** Rank legal moves by the one-ply heuristic, ties broken deterministically by order. */
export function rankMoves(state: MatchState, seat: Seat, moves: readonly GameCommand[]): ScoredMove[] {
  return moves
    .map((move, index) => ({ move, index, score: scoreMove(state, seat, move) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ move, score }) => ({ move, score }));
}

/** Pure greedy pick (highest heuristic, first-of-ties) — used for mulligan / special phases. */
export function bestMove(ctx: EngineContext, moves: readonly GameCommand[]): GameCommand {
  return rankMoves(ctx.state, ctx.seat, moves)[0].move;
}
