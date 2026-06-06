import { CARD_CATALOG } from "@twcardgame/cards";
import { createCardForHand, createMinionFromCard, type MatchState } from "@twcardgame/rules";
import type { DevTestMatchSetup, Seat } from "@twcardgame/shared";

const catalog = new Map(CARD_CATALOG.map((card) => [card.id, card]));

export function isDevTestRequestAllowed(context: any): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const headers = context?.headers;
  const host = headerValue(headers, "host") ?? context?.req?.headers?.host;
  const origin = headerValue(headers, "origin") ?? context?.req?.headers?.origin;
  const ips: unknown[] = Array.isArray(context?.ip) ? context.ip : [context?.ip];

  const originAllowed = !origin || isLocalUrl(origin);
  const endpointIsLocal = isLocalHostHeader(host) || ips.some((ip) => typeof ip === "string" && isLoopbackIp(ip));
  return originAllowed && endpointIsLocal;
}

export function applyDevTestMatchSetup(state: MatchState, setup: DevTestMatchSetup, nowMs = Date.now()): void {
  validateSetup(setup);
  const activeSeat = setup.activeSeat === "player2" ? "player2" : "player1";
  const player = state.players.player1;
  const opponent = state.players.player2;

  state.status = "in_progress";
  state.pendingPrompt = undefined;
  state.result = undefined;
  state.turn.activeSeat = activeSeat;
  state.turn.number = clampInt(setup.turnNumber, 1, 999, 1);
  state.turn.startedAtMs = nowMs;
  state.turn.deadlineAtMs = nowMs + 60_000;
  state.turn.actionSeq = 0;
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

  for (const cardId of setup.handCardIds ?? []) {
    const def = catalog.get(cardId)!;
    player.hand.push(createCardForHand(state, def, "player1"));
  }
  addBoardMinions(state, "player1", setup.playerBoardCardIds ?? [], activeSeat);
  addBoardMinions(state, "player2", setup.opponentBoardCardIds ?? [], activeSeat);
}

function validateSetup(setup: DevTestMatchSetup): void {
  validateCards(setup.handCardIds ?? [], "hand", 10, false);
  validateCards(setup.playerBoardCardIds ?? [], "player board", 7, true);
  validateCards(setup.opponentBoardCardIds ?? [], "opponent board", 7, true);
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

function applyMana(target: { current: number; max: number }, input: DevTestMatchSetup["playerMana"]): void {
  const max = clampInt(input?.max, 0, 10, 10);
  target.max = max;
  target.current = clampInt(input?.current, 0, max, max);
}

function headerValue(headers: any, name: string): string | undefined {
  const value = headers?.get?.(name);
  return typeof value === "string" ? value : undefined;
}

function isLocalUrl(value: string): boolean {
  try {
    return isLocalHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLocalHostHeader(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  try {
    return isLocalHostname(new URL(`http://${value}`).hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
}

function isLoopbackIp(value: string): boolean {
  const ip = value.toLowerCase();
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}
