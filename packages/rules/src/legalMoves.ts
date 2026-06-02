import { opponentOf, type GameCommand, type Seat, type TargetRef } from "@twcardgame/shared";
import { getCardActualCost } from "./state.js";
import type { MatchState, RuntimeCard, RuntimeMinion } from "./types.js";

/**
 * Enumerates a representative set of legal `GameCommand`s for `seat`. Intended
 * to drive the AI opponent — not exhaustive (mulligan subsets are pruned to two
 * candidates to keep the branching factor manageable), but every command this
 * returns is independently legal under `reduce()`.
 */
export function legalMoves(state: MatchState, seat: Seat): GameCommand[] {
  if (state.status === "mulligan") return legalMulliganMoves(state, seat);
  if (state.status !== "in_progress") return [];
  // Special phases interleave with `in_progress` and let both seats act, so they
  // are checked before the active-seat guard.
  if (state.phase === "AMPLIFICATION_PHASE") return legalAmplificationMoves(state, seat);
  if (state.phase === "VOTING_PHASE") return legalVoteMoves(state, seat);
  if (state.turn.activeSeat !== seat) return [];
  if (state.pendingPrompt && state.pendingPrompt.seat !== seat) return [];

  const moves: GameCommand[] = [];
  for (const cmd of legalPlays(state, seat)) moves.push(cmd);
  for (const cmd of legalAttacks(state, seat)) moves.push(cmd);
  moves.push({ type: "endTurn" });
  return moves;
}

function legalAmplificationMoves(state: MatchState, seat: Seat): GameCommand[] {
  const sp = state.specialPhase;
  if (!sp || sp.phase !== "AMPLIFICATION_PHASE") return [];
  if (sp.amplificationChoice?.[seat] !== undefined) return [];
  return (sp.amplificationOptions?.[seat] ?? []).map((option) => ({
    type: "selectAmplification" as const,
    optionId: option.id
  }));
}

function legalVoteMoves(state: MatchState, seat: Seat): GameCommand[] {
  const sp = state.specialPhase;
  if (!sp || sp.phase !== "VOTING_PHASE") return [];
  if (sp.voteChoice?.[seat] !== undefined) return [];
  const eventCount = sp.voteEvents?.length ?? 0;
  const moves: GameCommand[] = [];
  for (let index = 0; index < eventCount && index < 3; index++) {
    moves.push({ type: "submitVote", optionIndex: index as 0 | 1 | 2 });
  }
  return moves;
}

function legalMulliganMoves(state: MatchState, seat: Seat): GameCommand[] {
  const player = state.players[seat];
  if (player.mulliganReady) return [];
  const replaceHigh = player.hand.filter((card) => card.cost >= 5).map((card) => card.instanceId);
  const moves: GameCommand[] = [{ type: "submitMulligan", replaceHandInstanceIds: [] }];
  if (replaceHigh.length > 0) {
    moves.push({ type: "submitMulligan", replaceHandInstanceIds: replaceHigh });
  }
  return moves;
}

function legalPlays(state: MatchState, seat: Seat): GameCommand[] {
  const player = state.players[seat];
  const result: GameCommand[] = [];
  for (const card of player.hand) {
    const cost = getCardActualCost(state, seat, card);
    if (player.mana.current < cost) continue;
    if (card.type === "MINION" && player.board.length >= 7) continue;
    if (!hasEnoughOtherCardsForDiscard(card, player.hand.length)) continue;

    const battlecry = card.keywords.battlecry;
    const rule = battlecry?.target;
    if (!battlecry || !rule || !rule.type || rule.type === "ALL") {
      result.push({ type: "playCard", handInstanceId: card.instanceId });
      continue;
    }

    for (const target of enumerateBattlecryTargets(state, seat, rule.type, rule.side)) {
      result.push({ type: "playCard", handInstanceId: card.instanceId, target });
    }
  }
  return result;
}

function hasEnoughOtherCardsForDiscard(card: RuntimeCard, handLength: number): boolean {
  const battlecry = card.keywords.battlecry;
  if (battlecry?.type !== "DISCARD_RANDOM") return true;
  const required = battlecry.value ?? 1;
  return handLength > required;
}

function enumerateBattlecryTargets(
  state: MatchState,
  seat: Seat,
  type: "MINION" | "HERO",
  side: "ENEMY" | "FRIENDLY" | "ALL" | undefined
): TargetRef[] {
  const targets: TargetRef[] = [];
  const sides: Seat[] = side === "ENEMY"
    ? [opponentOf(seat)]
    : side === "FRIENDLY"
      ? [seat]
      : [seat, opponentOf(seat)];

  for (const targetSeat of sides) {
    if (type === "HERO") {
      targets.push({ type: "HERO", side: targetSeat });
    } else {
      for (const minion of state.players[targetSeat].board) {
        targets.push({ type: "MINION", side: targetSeat, instanceId: minion.instanceId });
      }
    }
  }
  return targets;
}

function legalAttacks(state: MatchState, seat: Seat): GameCommand[] {
  const player = state.players[seat];
  const enemy = state.players[opponentOf(seat)];
  const taunts = enemy.board.filter((m) => m.keywords.taunt);
  const result: GameCommand[] = [];

  for (const attacker of player.board) {
    if (!canAttackerSwing(attacker)) continue;
    if (taunts.length > 0) {
      for (const target of taunts) {
        result.push({
          type: "attack",
          attackerInstanceId: attacker.instanceId,
          target: { type: "MINION", side: enemy.seat, instanceId: target.instanceId }
        });
      }
    } else {
      for (const target of enemy.board) {
        result.push({
          type: "attack",
          attackerInstanceId: attacker.instanceId,
          target: { type: "MINION", side: enemy.seat, instanceId: target.instanceId }
        });
      }
      result.push({
        type: "attack",
        attackerInstanceId: attacker.instanceId,
        target: { type: "HERO", side: enemy.seat }
      });
    }
  }
  return result;
}

function canAttackerSwing(minion: RuntimeMinion): boolean {
  if (minion.sleeping || !minion.canAttack) return false;
  if (minion.lockedTurns > 0) return false;
  if (minion.attack <= 0) return false;
  return true;
}
