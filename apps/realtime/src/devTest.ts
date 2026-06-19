import { AMPLIFICATION_DB, CARD_CATALOG, VOTE_EVENT_DB, type AmplificationDbEntry } from "@twcardgame/cards";
import { createCardForHand, createMinionFromCard, enterSpecialPhase, type MatchState } from "@twcardgame/rules";
import type { AmplificationOption, DevTestMatchSetup, GameEvent, Phase, Seat, VoteEvent } from "@twcardgame/shared";

/**
 * Dev-test PvE board setup — the Durable Object port of apps/server/src/devTest.ts.
 * The board-building logic (`applyDevTestMatchSetup` + validation) is a faithful
 * copy; it is pure (no Date.now() — `nowMs` is injected) so it runs under the
 * Workers runtime and is unit-testable. Only the request gate differs: Colyseus
 * inspected `onAuth` context headers, here we inspect the Worker `Request`.
 */

const catalog = new Map(CARD_CATALOG.map((card) => [card.id, card]));
const amplifications = new Map(AMPLIFICATION_DB.map((entry) => [entry.id, entry]));
const voteEvents = new Map(VOTE_EVENT_DB.map((event) => [event.id, event]));

/**
 * Dev-test rooms are a localhost-only developer tool (mirrors the server's
 * `isDevTestRequestAllowed`). A deployed Worker is reached at a public URL, so
 * the gate fails closed in production; `wrangler dev` (and the local Vite origin)
 * pass. We check `request.url` rather than the `Host` header because Host is a
 * forbidden header that fetch implementations may strip.
 */
export function isDevTestAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const originAllowed = !origin || isLocalUrl(origin);
  return originAllowed && isLocalUrl(request.url);
}

export function applyDevTestMatchSetup(state: MatchState, setup: DevTestMatchSetup, nowMs: number, events: GameEvent[] = []): void {
  validateSetup(setup);
  const activeSeat = setup.activeSeat === "player2" ? "player2" : "player1";
  const player = state.players.player1;
  const opponent = state.players.player2;

  state.status = "in_progress";
  state.pendingPrompt = undefined;
  state.private.pendingChoice = undefined;
  state.result = undefined;
  state.turn.activeSeat = activeSeat;
  state.turn.number = clampInt(setup.turnNumber, 1, 999, 1);
  state.turn.startedAtMs = nowMs;
  state.turn.deadlineAtMs = nowMs + 60_000;
  state.turn.actionSeq = 0;
  state.phase = "NORMAL_PLAY";
  state.specialPhase = undefined;
  state.currentEnvironment = undefined;
  state.private.eventLog = [];
  state.private.processedCommandIds = [];
  state.private.actionLog = [];

  for (const p of [player, opponent]) {
    p.hand = [];
    p.deck = [];
    p.graveyard = [];
    p.board = [];
    p.mulliganReady = true;
  }

  player.hero.hp = clampInt(setup.playerHp, 1, 99, 30);
  player.hero.maxHp = Math.max(player.hero.maxHp, player.hero.hp);
  opponent.hero.hp = clampInt(setup.opponentHp, 1, 99, 30);
  opponent.hero.maxHp = Math.max(opponent.hero.maxHp, opponent.hero.hp);
  applyMana(player.mana, setup.playerMana);
  applyMana(opponent.mana, setup.opponentMana);
  state.private.devTestInfiniteMana = {
    player1: setup.infiniteMana?.player1 === true,
    player2: setup.infiniteMana?.player2 === true
  };
  state.augmentTiers = [
    setup.amplificationTiers?.turn7 ?? state.augmentTiers[0],
    setup.amplificationTiers?.turn14 ?? state.augmentTiers[1]
  ];

  for (const cardId of setup.handCardIds ?? []) {
    const def = catalog.get(cardId)!;
    player.hand.push(createCardForHand(state, def, "player1"));
  }
  for (const cardId of setup.opponentHandCardIds ?? []) {
    const def = catalog.get(cardId)!;
    opponent.hand.push(createCardForHand(state, def, "player2"));
  }
  for (const cardId of setup.playerDeckCardIds ?? []) {
    const def = catalog.get(cardId)!;
    player.deck.push(createCardForHand(state, def, "player1"));
  }
  for (const cardId of setup.opponentDeckCardIds ?? []) {
    const def = catalog.get(cardId)!;
    opponent.deck.push(createCardForHand(state, def, "player2"));
  }
  addBoardMinions(state, "player1", setup.playerBoardCardIds ?? [], activeSeat);
  addBoardMinions(state, "player2", setup.opponentBoardCardIds ?? [], activeSeat);
  enterRequestedPhase(state, setup, nowMs, events);
}

function validateSetup(setup: DevTestMatchSetup): void {
  validateCards(setup.handCardIds ?? [], "hand", 10, false);
  validateCards(setup.opponentHandCardIds ?? [], "opponent hand", 10, false);
  validateCards(setup.playerDeckCardIds ?? [], "player deck", 60, false);
  validateCards(setup.opponentDeckCardIds ?? [], "opponent deck", 60, false);
  validateCards(setup.playerBoardCardIds ?? [], "player board", 7, true);
  validateCards(setup.opponentBoardCardIds ?? [], "opponent board", 7, true);
  validateAmplifications(setup.amplificationIds);
  if (setup.voteEventId !== undefined) validateVoteEvents([setup.voteEventId]);
  validateVoteEvents(setup.voteEventIds ?? []);
}

function validateCards(cardIds: readonly string[], label: string, max: number, minionOnly: boolean): void {
  if (cardIds.length > max) throw new Error(`Dev test ${label} may contain at most ${max} cards.`);
  for (const cardId of cardIds) {
    const def = catalog.get(cardId);
    if (!def) throw new Error(`Unknown dev test card id: ${cardId}`);
    if (minionOnly && def.type !== "MINION") throw new Error(`Dev test ${label} card must be a MINION: ${cardId}`);
  }
}

function addBoardMinions(state: MatchState, seat: Seat, cardIds: readonly string[], activeSeat: Seat): void {
  const player = state.players[seat];
  for (const cardId of cardIds) {
    const def = catalog.get(cardId)!;
    const runtime = createCardForHand(state, def, seat);
    const minion = createMinionFromCard(state, runtime, seat);
    minion.sleeping = false;
    minion.canAttack = seat === activeSeat && minion.lockedTurns <= 0;
    player.board.push(minion);
  }
}

function enterRequestedPhase(state: MatchState, setup: DevTestMatchSetup, nowMs: number, events: GameEvent[]): void {
  const phase = validPhase(setup.phase);
  if (!phase || phase === "NORMAL_PLAY") return;
  enterSpecialPhase(state, phase, nowMs, events);
  if (phase === "AMPLIFICATION_PHASE" && state.specialPhase?.phase === "AMPLIFICATION_PHASE") {
    applyRequestedAmplificationOptions(state, setup);
  }
  if (phase === "VOTING_PHASE" && setup.voteEventIds?.length && state.specialPhase?.phase === "VOTING_PHASE") {
    state.specialPhase.voteEvents = buildVoteEvents(setup.voteEventIds);
  } else if (phase === "VOTING_PHASE" && setup.voteEventId && state.specialPhase?.phase === "VOTING_PHASE") {
    state.specialPhase.voteEvents = buildVoteEvents([setup.voteEventId]);
  }
}

function validPhase(value: unknown): Phase | undefined {
  return value === "NORMAL_PLAY" || value === "AMPLIFICATION_PHASE" || value === "VOTING_PHASE" ? value : undefined;
}

function validateVoteEvents(ids: readonly string[]): void {
  if (ids.length > 3) throw new Error("Dev test vote setup may contain at most 3 events.");
  for (const id of ids) {
    if (!voteEvents.has(id)) throw new Error(`Unknown dev test vote event id: ${id}`);
  }
}

function validateAmplifications(ids: DevTestMatchSetup["amplificationIds"]): void {
  for (const id of [ids?.turn7, ids?.turn14]) {
    if (id !== undefined && !amplifications.has(id)) throw new Error(`Unknown dev test amplification id: ${id}`);
  }
}

function applyRequestedAmplificationOptions(state: MatchState, setup: DevTestMatchSetup): void {
  const phaseKey = state.turn.number === 14 ? "turn14" : "turn7";
  const entry = setup.amplificationIds?.[phaseKey] ? amplifications.get(setup.amplificationIds[phaseKey]!) : undefined;
  if (!entry || !state.specialPhase?.amplificationOptions) return;
  const option = toAmplificationOption(entry);
  state.specialPhase.amplificationOptions.player1 = withRequestedOption(option, state.specialPhase.amplificationOptions.player1);
  state.specialPhase.amplificationOptions.player2 = withRequestedOption(option, state.specialPhase.amplificationOptions.player2);
}

function withRequestedOption(option: AmplificationOption, options: AmplificationOption[]): AmplificationOption[] {
  const rest = options.filter((candidate) => candidate.id !== option.id && candidate.tier === option.tier);
  return [option, ...rest].slice(0, 3);
}

function toAmplificationOption(entry: AmplificationDbEntry): AmplificationOption {
  return {
    id: entry.id,
    tier: entry.tier,
    name: entry.name,
    description: entry.description,
    relatedCardIds: entry.relatedCardIds
  };
}

function buildVoteEvents(requestedIds: readonly string[]): VoteEvent[] {
  const ids: string[] = [];
  for (const id of requestedIds) {
    if (voteEvents.has(id) && !ids.includes(id)) ids.push(id);
  }
  for (const id of voteEvents.keys()) {
    if (ids.length >= 3) break;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.map(toVoteEvent).filter((event): event is VoteEvent => Boolean(event)).slice(0, 3);
}

function toVoteEvent(id: string): VoteEvent | undefined {
  const entry = voteEvents.get(id);
  if (!entry) return undefined;
  return { id: entry.id, name: entry.name, options: [...entry.options] as [string, string, string] };
}

function applyMana(target: { current: number; max: number }, input: DevTestMatchSetup["playerMana"]): void {
  const max = clampInt(input?.max, 0, 30, 10);
  target.max = max;
  target.current = clampInt(input?.current, 0, max, max);
}

function isLocalUrl(value: string): boolean {
  try {
    return isLocalHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}
