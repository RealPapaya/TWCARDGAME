import type { EffectDefinition } from "@twcardgame/cards";
import { nextInt, shuffleInPlace } from "../rng.js";
import { addEvent, nextInstanceId } from "../state.js";
import type { EffectContext, EffectHandler, PendingChoice, MatchState, RuntimeCard } from "../types.js";
import type { GameEvent, Seat } from "@twcardgame/shared";

/** 起底 / Discover: how many candidate cards are revealed when `count` is omitted. */
const DEFAULT_REVEAL = 3;
/** Picker label shown in the UI / events. */
const CHANNEL_LABEL = "起底";

/**
 * 起底 (CHANNEL / Discover). Pulls up to `count` (default 3) random cards out of the
 * active seat's own deck — or graveyard when `poolFromGraveyard` is set — that match the
 * optional `poolCardType` / `target_category_includes` / `poolHasDeathrattle` filters,
 * then opens a `pendingPrompt` choice. The candidate cards are held privately in
 * `state.private.pendingChoice` (never in public state — that would leak pile order); the
 * player resolves with a `resolvePrompt` command. With no eligible card this is a no-op.
 *
 * `picks` (default 1) runs the reveal-and-pick sequentially that many times: 起底兩張 is
 * `picks: 2`, opening a second reveal once the first is resolved.
 */
export function channel(effect: EffectDefinition, context: EffectContext): void {
  const sourceInstanceId = context.source?.instanceId ?? "";
  const remainingPicks = Math.max(1, effect.picks ?? 1);
  openChannelPrompt(context.state, context.activeSeat, effect, sourceInstanceId, context.events, remainingPicks);
}

/**
 * Opens a single reveal-and-pick prompt. `remainingPicks` includes the round being opened,
 * so a value > 1 chains another prompt once this one resolves (起底 N 張).
 */
function openChannelPrompt(
  state: MatchState,
  seat: Seat,
  effect: EffectDefinition,
  sourceInstanceId: string,
  events: GameEvent[],
  remainingPicks: number
): void {
  // One prompt at a time. The engine blocks every other action while a prompt is
  // open, so a second CHANNEL before the first resolves shouldn't occur — bail safely.
  if (state.pendingPrompt) return;

  const player = state.players[seat];
  const reveal = Math.max(1, effect.count ?? DEFAULT_REVEAL);
  const fromGraveyard = effect.poolFromGraveyard === true;
  const sourcePile = fromGraveyard ? player.graveyard : player.deck;
  const typeFilter = effect.poolCardType;
  const categoryFilter = effect.target_category_includes;
  const deathrattleFilter = effect.poolHasDeathrattle === true;

  const eligible: number[] = [];
  sourcePile.forEach((card, index) => {
    if (typeFilter && card.type !== typeFilter) return;
    if (categoryFilter && !card.category.includes(categoryFilter)) return;
    if (deathrattleFilter && !card.keywords?.deathrattle) return;
    eligible.push(index);
  });
  if (eligible.length === 0) return; // nothing to channel → no-op (ends any chain)

  const pickCount = Math.min(reveal, eligible.length);
  const pickedIndices: number[] = [];
  const pool = [...eligible];
  for (let i = 0; i < pickCount; i++) {
    const next = nextInt(state.private.rngState, pool.length);
    state.private.rngState = next.state;
    pickedIndices.push(pool.splice(next.value, 1)[0]);
  }
  // Remove from the pile high-index-first so an earlier splice doesn't shift the rest.
  pickedIndices.sort((a, b) => b - a);
  const cards: RuntimeCard[] = [];
  for (const index of pickedIndices) cards.push(sourcePile.splice(index, 1)[0]);
  cards.reverse(); // present in pre-shuffle pile order

  const promptId = nextInstanceId(state, "prompt");
  state.pendingPrompt = {
    promptId,
    seat,
    kind: "choice",
    sourceInstanceId,
    validTargets: [],
    choiceCount: cards.length,
    label: CHANNEL_LABEL
  };
  state.private.pendingChoice = {
    promptId,
    seat,
    sourceInstanceId,
    label: CHANNEL_LABEL,
    cards,
    fromGraveyard,
    channelEffect: effect,
    remainingPicks
  };
  addEvent(state, events, "PROMPT_OPENED", { promptId, kind: "choice", label: CHANNEL_LABEL, choiceCount: cards.length }, seat);
}

/**
 * Resolves an open 起底 choice: the picked card joins the seat's hand (burned if the
 * hand is full, mirroring a draw) and the remaining candidates are returned to their
 * pile. Returns false (and emits a rejection) when the prompt / choice is invalid.
 */
export function resolveChannelPrompt(
  state: MatchState,
  seat: Seat,
  promptId: string,
  choiceInstanceId: string,
  events: GameEvent[]
): boolean {
  const pending = state.private.pendingChoice;
  const prompt = state.pendingPrompt;
  if (!pending || !prompt || prompt.seat !== seat || pending.promptId !== promptId) {
    addEvent(state, events, "COMMAND_REJECTED", { reason: "沒有等待中的選擇。" }, seat);
    return false;
  }
  const chosenIndex = pending.cards.findIndex((card) => card.instanceId === choiceInstanceId);
  if (chosenIndex === -1) {
    addEvent(state, events, "COMMAND_REJECTED", { reason: "無效的選擇。" }, seat);
    return false;
  }
  finishChannel(state, seat, pending, chosenIndex, events);
  return true;
}

/** Force-resolves open choices by taking the first candidate each round (server timeout). */
export function resolveChannelPromptDefault(state: MatchState, seat: Seat, events: GameEvent[]): void {
  // Drain every chained pick so no prompt is left open when the turn ends.
  while (state.private.pendingChoice && state.private.pendingChoice.seat === seat) {
    finishChannel(state, seat, state.private.pendingChoice, 0, events);
  }
}

function finishChannel(
  state: MatchState,
  seat: Seat,
  pending: PendingChoice,
  chosenIndex: number,
  events: GameEvent[]
): void {
  const player = state.players[seat];
  const cards = pending.cards;
  const [chosen] = cards.splice(chosenIndex, 1);
  // Unpicked candidates return to their pile. Graveyard order is irrelevant, so only the
  // deck is reshuffled to keep its draw order hidden.
  if (pending.fromGraveyard) {
    for (const leftover of cards) player.graveyard.push(leftover);
  } else {
    for (const leftover of cards) player.deck.push(leftover);
    if (cards.length > 0) state.private.rngState = shuffleInPlace(player.deck, state.private.rngState);
  }

  if (player.hand.length >= 10) {
    player.graveyard.push(chosen);
    addEvent(state, events, "CARD_BURNED", { cardId: chosen.cardId }, seat);
  } else {
    player.hand.push(chosen);
    addEvent(state, events, "CARD_DRAWN", { cardId: chosen.cardId, handCount: player.hand.length, channeled: true }, seat);
  }
  addEvent(state, events, "PROMPT_RESOLVED", { promptId: pending.promptId, cardId: chosen.cardId }, seat);
  state.pendingPrompt = undefined;
  state.private.pendingChoice = undefined;

  // 起底 N 張: open the next reveal-and-pick round until the picks are exhausted.
  const remaining = (pending.remainingPicks ?? 1) - 1;
  if (remaining > 0 && pending.channelEffect) {
    openChannelPrompt(state, seat, pending.channelEffect, pending.sourceInstanceId, events, remaining);
  }
}

export const channelHandlers: Record<string, EffectHandler> = {
  CHANNEL: channel
};
