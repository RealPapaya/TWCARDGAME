import { opponentOf, type GameCommand, type Seat, type TargetRef } from "@twcardgame/shared";
import { isFrozen } from "./effects/augmentFlags.js";
import { boardLimit } from "./effects/environment.js";
import { canPayCardCost } from "./state.js";
import { effectNeedsTarget, targetTypesForRule } from "./targeting.js";
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
  if (state.pendingPrompt) {
    if (state.pendingPrompt.seat !== seat) return [];
    return legalPromptMoves(state, seat);
  }
  // 違約交割: a frozen player can only end their turn (avoids a deadlock and keeps
  // the bot's only legal move well-defined).
  if (isFrozen(state, seat)) return [{ type: "endTurn" }];

  const moves: GameCommand[] = [];
  for (const cmd of legalPlays(state, seat)) moves.push(cmd);
  for (const cmd of legalAttacks(state, seat)) moves.push(cmd);
  moves.push({ type: "endTurn" });
  return moves;
}

/** 起底 / Discover: one resolvePrompt move per privately-held candidate card. */
function legalPromptMoves(state: MatchState, seat: Seat): GameCommand[] {
  const pending = state.private.pendingChoice;
  if (!pending || pending.seat !== seat) return [];
  return pending.cards.map((card) => ({
    type: "resolvePrompt" as const,
    promptId: pending.promptId,
    choiceInstanceId: card.instanceId
  }));
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
    if (!canPayCardCost(state, seat, card)) continue;
    if (card.type === "MINION" && player.board.length >= boardLimit(state, seat)) continue;
    if (!hasEnoughOtherCardsForDiscard(card, player.hand.length)) continue;

    const battlecry = card.keywords.battlecry;
    const rule = battlecry?.target;
    if (!effectNeedsTarget(battlecry)) {
      for (const boardIndex of placementOptions(state, seat, card)) {
        result.push(
          boardIndex === undefined
            ? { type: "playCard", handInstanceId: card.instanceId }
            : { type: "playCard", handInstanceId: card.instanceId, boardIndex }
        );
      }
      continue;
    }

    for (const target of enumerateBattlecryTargets(state, seat, rule?.type, rule?.side)) {
      result.push({ type: "playCard", handInstanceId: card.instanceId, target });
    }
  }
  return result;
}

/**
 * Effects whose value depends on WHERE a minion sits — they buff/grant to the left and
 * right neighbours (`board[i-1]` / `board[i+1]`). For these, placement is a real
 * decision, so the AI must be offered the `boardIndex` choices instead of only append.
 */
export const ADJACENCY_EFFECT_TYPES: ReadonlySet<string> = new Set([
  "BUFF_ADJACENT",
  "BUFF_ADJACENT_HEALTH",
  "GIVE_KEYWORD_ADJACENT",
  "ADJACENT_BUFF_STATS",
  "ADJACENT_BUFF_CATEGORY_ATTRS"
]);

function isAdjacencyEffect(effect: { type?: string } | undefined): boolean {
  return effect?.type !== undefined && ADJACENCY_EFFECT_TYPES.has(effect.type);
}

/** True iff this card itself buffs/grants to its neighbours on play / death / continuously. */
function cardEmitsAdjacencyEffect(card: RuntimeCard): boolean {
  const k = card.keywords;
  return isAdjacencyEffect(k.battlecry) || isAdjacencyEffect(k.ongoing) || isAdjacencyEffect(k.deathrattle);
}

/** True iff a friendly minion already in play radiates an ongoing neighbour aura (e.g. 服務生). */
function friendlyHasOngoingAdjacencyAura(state: MatchState, seat: Seat): boolean {
  return state.players[seat].board.some((m) => isAdjacencyEffect(m.keywords.ongoing));
}

/**
 * The `boardIndex` slots worth offering for a minion play. Position only matters when the
 * card carries an adjacency effect, or when a friendly ongoing aura is already on the board
 * (so a new body can be slotted next to it). Otherwise we offer a single append (`undefined`)
 * to keep the branching factor down — a non-positional minion plays the same anywhere.
 */
function placementOptions(state: MatchState, seat: Seat, card: RuntimeCard): (number | undefined)[] {
  if (card.type !== "MINION") return [undefined];
  const board = state.players[seat].board;
  if (board.length === 0) return [undefined]; // only one possible slot
  if (!cardEmitsAdjacencyEffect(card) && !friendlyHasOngoingAdjacencyAura(state, seat)) return [undefined];
  const options: (number | undefined)[] = [];
  for (let i = 0; i <= board.length; i++) options.push(i);
  return options;
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
  type: "MINION" | "HERO" | "ALL" | undefined,
  side: "ENEMY" | "FRIENDLY" | "ALL" | undefined
): TargetRef[] {
  const targets: TargetRef[] = [];
  const types = targetTypesForRule(type);
  const sides: Seat[] = side === "ENEMY"
    ? [opponentOf(seat)]
    : side === "FRIENDLY"
      ? [seat]
      : [seat, opponentOf(seat)];

  for (const targetSeat of sides) {
    if (types.includes("HERO")) {
      targets.push({ type: "HERO", side: targetSeat });
    }
    if (types.includes("MINION")) {
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
