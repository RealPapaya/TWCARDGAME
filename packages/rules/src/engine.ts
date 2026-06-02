import type { CardDefinition, EffectDefinition } from "@twcardgame/cards";
import { opponentOf, type CommandEnvelope, type GameEvent, type Seat, type TargetRef } from "@twcardgame/shared";
import { createRuntimeCard, validateDeck } from "./deck.js";
import {
  drawCards,
  finishIfHeroDead,
  handlePlayNews,
  applyDamage,
  processEndOfTurn,
  resolveEffect,
  resolvePostAction,
  startTurn
} from "./effects.js";
import { nextInt, normalizeSeed, shuffleInPlace } from "./rng.js";
import {
  activePlayer,
  addEvent,
  cloneState,
  createMinionFromCard,
  findCardInHand,
  findMinion,
  getCardActualCost,
  getTargetUnit,
  nextInstanceId,
  opponentPlayer,
  toHandView,
  toPublicState
} from "./state.js";
import { DEFAULT_MULLIGAN_TIME_LIMIT_MS, DEFAULT_TURN_TIME_LIMIT_MS, SHORT_TURN_TIME_LIMIT_MS } from "./timing.js";
import type { CreateMatchInput, MatchState, PlayerSetup, PlayerState, RulesResult } from "./types.js";

export const SCHEMA_VERSION = 1;
export { DEFAULT_MULLIGAN_TIME_LIMIT_MS, DEFAULT_TURN_TIME_LIMIT_MS, SHORT_TURN_TIME_LIMIT_MS };

export function createInitialMatch(input: CreateMatchInput): RulesResult {
  const catalog = new Map(input.catalog.map((card) => [card.id, card]));
  const errors = input.players.flatMap((player) => {
    const validation = validateDeck(player.deckIds, input.catalog, player.ownedCardIds);
    return validation.errors.map((error) => `${player.seat}: ${error}`);
  });
  if (errors.length > 0) throw new Error(errors.join("\n"));

  const state: MatchState = {
    matchId: input.matchId,
    schemaVersion: SCHEMA_VERSION,
    cardCatalogVersion: input.cardCatalogVersion,
    status: "mulligan",
    turn: {
      activeSeat: "player1",
      number: 0,
      startedAtMs: input.nowMs,
      deadlineAtMs: input.nowMs + (input.mulliganTimeLimitMs ?? DEFAULT_MULLIGAN_TIME_LIMIT_MS),
      actionSeq: 0
    },
    players: {
      player1: createPlayer(input.players[0]),
      player2: createPlayer(input.players[1])
    },
    private: {
      rngState: normalizeSeed(input.seed),
      nextInstanceSeq: 1,
      nextEventSeq: 1,
      processedCommandIds: [],
      actionLog: [],
      eventLog: [],
      turnActionTaken: false,
      turnTimeLimitMs: input.turnTimeLimitMs ?? DEFAULT_TURN_TIME_LIMIT_MS
    }
  };

  const events: GameEvent[] = [];

  for (const setup of input.players) {
    const player = state.players[setup.seat];
    player.deck = setup.deckIds.map((cardId) => {
      const def = catalog.get(cardId);
      if (!def) throw new Error(`Unknown card ${cardId}`);
      return createRuntimeCard(def, setup.seat, nextInstanceId(state, "card"));
    });
    state.private.rngState = shuffleInPlace(player.deck, state.private.rngState);
    drawCards(state, player, 3, events);
  }

  const firstRoll = nextInt(state.private.rngState, 2);
  state.private.rngState = firstRoll.state;
  const first = firstRoll.value === 0 ? "player1" : "player2";
  state.turn.activeSeat = first;

  addEvent(state, events, "MATCH_CREATED", { firstSeat: first });
  return { state, events };
}

export function reduce(state: MatchState, envelope: CommandEnvelope, catalogInput: readonly CardDefinition[]): RulesResult {
  if (state.private.processedCommandIds.includes(envelope.commandId)) {
    return { state, events: [] };
  }

  const next = cloneState(state);
  const catalog = new Map(catalogInput.map((card) => [card.id, card]));
  const events: GameEvent[] = [];

  next.private.processedCommandIds.push(envelope.commandId);
  next.private.actionLog.push(envelope);
  next.turn.actionSeq += 1;

  if (envelope.command.type === "reconnect") {
    next.players[envelope.seat].connected = true;
    next.players[envelope.seat].reconnectUntilMs = undefined;
    return { state: next, events };
  }

  if (next.status === "finished" || next.status === "abandoned") {
    reject(next, events, envelope.seat, "對局已經結束。");
    return { state: next, events };
  }

  if (envelope.command.type === "concede") {
    next.status = "finished";
    next.result = { winnerSeat: opponentOf(envelope.seat), reason: "concede" };
    addEvent(next, events, "GAME_FINISHED", { ...next.result }, envelope.seat);
    return { state: next, events };
  }

  if (envelope.command.type === "submitMulligan") {
    submitMulligan(next, envelope.seat, envelope.command.replaceHandInstanceIds, envelope.nowMs, events, catalog);
    return { state: next, events };
  }

  if (next.status !== "in_progress") {
    reject(next, events, envelope.seat, "對局尚未開始。");
    return { state: next, events };
  }

  if (next.turn.activeSeat !== envelope.seat) {
    reject(next, events, envelope.seat, "還不是你的回合。");
    return { state: next, events };
  }

  const rejectedBefore = events.filter((event) => event.type === "COMMAND_REJECTED").length;
  const turnBefore = next.turn.number;
  const activeSeatBefore = next.turn.activeSeat;
  const serverTimeoutEndTurn = envelope.serverTimeout === true && envelope.command.type === "endTurn";

  if (envelope.command.type === "playCard") {
    playCard(next, envelope.seat, envelope.command.handInstanceId, envelope.command.target, envelope.command.boardIndex, events, catalog);
  } else if (envelope.command.type === "attack") {
    attack(next, envelope.seat, envelope.command.attackerInstanceId, envelope.command.target, events, catalog);
  } else if (envelope.command.type === "endTurn") {
    if (serverTimeoutEndTurn && !next.private.turnActionTaken) {
      next.players[envelope.seat].shortTurnPenalty = true;
    }
    endTurn(next, envelope.nowMs, events, catalog);
  }

  const rejectedAfter = events.filter((event) => event.type === "COMMAND_REJECTED").length;
  if (!serverTimeoutEndTurn && rejectedAfter === rejectedBefore) {
    next.players[envelope.seat].shortTurnPenalty = false;
    if (turnBefore === next.turn.number && activeSeatBefore === next.turn.activeSeat) {
      next.private.turnActionTaken = true;
    }
  }

  return { state: next, events };
}

export { toHandView, toPublicState };

function createPlayer(setup: PlayerSetup): PlayerState {
  return {
    seat: setup.seat,
    userId: setup.userId,
    displayName: setup.displayName,
    connected: true,
    hero: { hp: 30, maxHp: 30 },
    mana: { current: 0, max: 0 },
    hand: [],
    deck: [],
    graveyard: [],
    board: [],
    mulliganReady: false,
    shortTurnPenalty: false
  };
}

function submitMulligan(
  state: MatchState,
  seat: Seat,
  replaceHandInstanceIds: string[],
  nowMs: number,
  events: GameEvent[],
  catalog: Map<string, CardDefinition>
): void {
  if (state.status !== "mulligan") {
    reject(state, events, seat, "換牌階段已結束。");
    return;
  }

  const player = state.players[seat];
  if (player.mulliganReady) return;

  const replace = new Set(replaceHandInstanceIds);
  const returning = player.hand.filter((card) => replace.has(card.instanceId));
  player.hand = player.hand.filter((card) => !replace.has(card.instanceId));
  player.deck.push(...returning);
  state.private.rngState = shuffleInPlace(player.deck, state.private.rngState);
  drawCards(state, player, returning.length, events);
  player.mulliganReady = true;
  addEvent(state, events, "MULLIGAN_SUBMITTED", { replaced: returning.length }, seat);

  if (state.players.player1.mulliganReady && state.players.player2.mulliganReady) {
    startTurn(state, nowMs, events);
  }
}

function validatePlayTarget(state: MatchState, seat: Seat, battlecry: EffectDefinition, target: TargetRef | undefined): string | null {
  const rule = battlecry.target;
  if (!rule) return null;
  if (!target) return "這張牌需要選擇目標。";
  if (rule.type === "MINION" && target.type !== "MINION") return "這個目標不是隨從。";
  if (rule.type === "HERO" && target.type !== "HERO") return "這個目標不是英雄。";
  const expectedSide = rule.side === "ENEMY" ? opponentOf(seat) : rule.side === "FRIENDLY" ? seat : null;
  if (expectedSide && target.side !== expectedSide) return rule.side === "ENEMY" ? "這個目標不是敵軍。" : "這個目標不是友軍。";
  if (target.type === "MINION") {
    if (!target.side || !state.players[target.side] || !target.instanceId) return "這個隨從目標無效。";
    if (!state.players[target.side].board.some((m) => m.instanceId === target.instanceId)) return "找不到目標隨從。";
  }
  return null;
}

function playCard(
  state: MatchState,
  seat: Seat,
  handInstanceId: string,
  target: TargetRef | undefined,
  boardIndex: number | undefined,
  events: GameEvent[],
  catalog: Map<string, CardDefinition>
): void {
  const player = state.players[seat];
  const found = findCardInHand(player, handInstanceId);
  if (!found) {
    reject(state, events, seat, "這張牌不在手牌中。");
    return;
  }
  const { card, index } = found;
  const actualCost = getCardActualCost(state, seat, card);
  if (player.mana.current < actualCost) {
    reject(state, events, seat, "魔力不足。");
    return;
  }
  if (card.type === "MINION" && player.board.length >= 7) {
    reject(state, events, seat, "場上已滿，無法再召喚隨從。");
    return;
  }
  if (card.keywords.battlecry?.type === "DISCARD_RANDOM" && player.hand.length <= (card.keywords.battlecry.value ?? 1)) {
    reject(state, events, seat, "沒有足夠的其他手牌可棄置。");
    return;
  }
  if (card.keywords.battlecry) {
    const targetError = validatePlayTarget(state, seat, card.keywords.battlecry, target);
    if (targetError) {
      reject(state, events, seat, targetError);
      return;
    }
  }

  player.mana.current -= actualCost;
  player.hand.splice(index, 1);
  addEvent(state, events, "CARD_PLAYED", { cardId: card.cardId, handInstanceId }, seat);

  if (card.type === "MINION") {
    const minion = createMinionFromCard(state, card, seat);
    const insertion = typeof boardIndex === "number" ? Math.max(0, Math.min(boardIndex, player.board.length)) : player.board.length;
    player.board.splice(insertion, 0, minion);
    addEvent(state, events, "MINION_SUMMONED", { cardId: minion.cardId, target: minion.instanceId }, seat);
    resolveEffect(minion.keywords.battlecry, { state, activeSeat: seat, source: minion, target, events, catalog });
  } else {
    if (card.cardId === "S002" && card.keywords.battlecry) {
      card.keywords.battlecry.value = player.deck.length === 0 ? 20 : 10;
    }
    resolveEffect(card.keywords.battlecry, { state, activeSeat: seat, source: card, target, events, catalog });
    handlePlayNews(state, player, events);
  }

  resolvePostAction(state, events, catalog);
}

function attack(
  state: MatchState,
  seat: Seat,
  attackerInstanceId: string,
  target: TargetRef,
  events: GameEvent[],
  catalog: Map<string, CardDefinition>
): void {
  const player = state.players[seat];
  const enemy = state.players[opponentOf(seat)];
  const found = findMinion(player, attackerInstanceId);
  if (!found) {
    reject(state, events, seat, "找不到攻擊者。");
    return;
  }
  const attacker = found.minion;
  if (attacker.sleeping || !attacker.canAttack) {
    reject(state, events, seat, "這名隨從本回合不能攻擊。");
    return;
  }
  if (attacker.lockedTurns > 0) {
    reject(state, events, seat, "這名隨從被鎖定，不能攻擊。");
    return;
  }
  if (attacker.attack <= 0) {
    reject(state, events, seat, "這名隨從沒有攻擊力。");
    return;
  }
  const ref = getTargetUnit(state, seat, target);
  if (!ref) {
    reject(state, events, seat, target?.type === "MINION" ? "找不到目標隨從。" : "無效的攻擊目標。");
    return;
  }
  if (ref.owner.seat !== enemy.seat) {
    reject(state, events, seat, "只能攻擊敵方目標。");
    return;
  }
  const taunts = enemy.board.filter((minion) => minion.keywords.taunt);
  if (taunts.length > 0 && !(target?.type === "MINION" && taunts.some((minion) => minion.instanceId === target.instanceId))) {
    reject(state, events, seat, "請先攻擊具有嘲諷的敵方隨從。");
    return;
  }

  const targetAttack = ref.kind === "MINION" ? (ref.unit as { attack: number }).attack : 0;
  const attackerRef = { owner: player, kind: "MINION" as const, unit: attacker };
  addEvent(state, events, "ATTACK", { attackerInstanceId, target }, seat);
  applyDamage(state, ref, attacker.attack, events);
  if (ref.kind === "MINION") applyDamage(state, attackerRef, targetAttack, events);
  attacker.canAttack = false;
  resolvePostAction(state, events, catalog);
  finishIfHeroDead(state, events);
}

function endTurn(state: MatchState, nowMs: number, events: GameEvent[], catalog: Map<string, CardDefinition>): void {
  const previousSeat = state.turn.activeSeat;
  addEvent(state, events, "TURN_ENDED", { turn: state.turn.number }, previousSeat);
  processEndOfTurn(state, events, catalog);
  if (state.status === "finished") return;
  state.turn.activeSeat = opponentPlayer(state).seat;
  startTurn(state, nowMs, events);
}

function reject(state: MatchState, events: GameEvent[], seat: Seat, reason: string): void {
  addEvent(state, events, "COMMAND_REJECTED", { reason }, seat);
}
