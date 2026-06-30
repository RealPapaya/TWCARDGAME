import type { CardDefinition } from "@twcardgame/cards";
import {
  opponentOf,
  type GameEvent,
  type HandCardView,
  type PromptChoiceOffer,
  type PublicGameState,
  type Seat,
  type SpecialPhaseView,
  type TargetRef
} from "@twcardgame/shared";
import { createRuntimeCard } from "./deck.js";
import { environmentBoardLimit, environmentCostDelta, isEnvironmentActive, suppressRuntimeCardMinionEffects, suppressRuntimeMinionEffects } from "./effects/environment.js";
import { environmentForcesZeroCost } from "./effects/voteEvents.js";
import { effectNeedsTarget } from "./targeting.js";
import {
  augmentCostMultiplierTenths,
  augmentFlatCostReduction,
  isReferendumImmune,
  paysCardCostWithHealth,
  unlockLowHpManaCap
} from "./effects/augmentFlags.js";
import type { MatchState, PlayerState, RuntimeCard, RuntimeMinion, TargetUnitRef } from "./types.js";

export function cloneState(state: MatchState): MatchState {
  return structuredClone(state);
}

export function nextInstanceId(state: MatchState, prefix = "inst"): string {
  const id = `${prefix}_${state.private.nextInstanceSeq}`;
  state.private.nextInstanceSeq += 1;
  return id;
}

export function addEvent(state: MatchState, events: GameEvent[], type: GameEvent["type"], payload?: Record<string, unknown>, seat?: Seat): void {
  const event: GameEvent = {
    seq: state.private.nextEventSeq++,
    type,
    seat,
    payload
  };
  events.push(event);
  state.private.eventLog.push(event);
}

export function activePlayer(state: MatchState): PlayerState {
  return state.players[state.turn.activeSeat];
}

export function opponentPlayer(state: MatchState): PlayerState {
  return state.players[opponentOf(state.turn.activeSeat)];
}

export function toPublicState(state: MatchState): PublicGameState {
  return {
    matchId: state.matchId,
    schemaVersion: state.schemaVersion,
    cardCatalogVersion: state.cardCatalogVersion,
    status: state.status,
    phase: state.phase,
    turn: structuredClone(state.turn),
    players: {
      player1: toPublicPlayer(state.players.player1),
      player2: toPublicPlayer(state.players.player2)
    },
    pendingPrompt: state.pendingPrompt ? structuredClone(state.pendingPrompt) : undefined,
    specialPhase: toSpecialPhaseView(state),
    result: state.result ? structuredClone(state.result) : undefined,
    boardLimit: environmentBoardLimit(state),
    activeEnvironment: toActiveEnvironmentView(state)
  };
}

/** Display-only projection of the live referendum venue effect (id + name), or undefined. */
function toActiveEnvironmentView(state: MatchState) {
  const env = state.currentEnvironment;
  if (!env || !isEnvironmentActive(state, env)) return undefined;
  const remainingTurns = env.expiresTurn === undefined ? undefined : Math.max(1, env.expiresTurn - state.turn.number);
  return { id: env.id, name: env.name, remainingTurns };
}

/**
 * Public projection of the active special phase. Deliberately omits each seat's
 * amplification options (those are private, delivered per-seat) and the raw
 * integer roulette weights / individual votes; only "selected"/"submitted"
 * flags, the shared vote events, and the display win % are exposed.
 */
export function toSpecialPhaseView(state: MatchState): SpecialPhaseView | undefined {
  const sp = state.specialPhase;
  if (!sp) return undefined;
  if (sp.phase === "AMPLIFICATION_PHASE") {
    return {
      phaseDeadlineAtMs: sp.phaseDeadlineAtMs,
      amplificationSelected: {
        player1: sp.amplificationChoice?.player1 !== undefined,
        player2: sp.amplificationChoice?.player2 !== undefined
      },
      amplificationRerollUsed: {
        player1: sp.amplificationRerollUsed?.player1 === true,
        player2: sp.amplificationRerollUsed?.player2 === true
      },
      amplificationRerollRemaining: {
        player1: Math.max(0, (sp.amplificationRerollLimit?.player1 ?? 1) - (sp.amplificationRerollCount?.player1 ?? 0)),
        player2: Math.max(0, (sp.amplificationRerollLimit?.player2 ?? 1) - (sp.amplificationRerollCount?.player2 ?? 0))
      }
    };
  }
  return {
    phaseDeadlineAtMs: sp.phaseDeadlineAtMs,
    voteEvents: sp.voteEvents ? structuredClone(sp.voteEvents) : undefined,
    voteWeights: sp.voteWeightsInt ? displayWeights(sp.voteWeightsInt) : undefined,
    voteSubmitted: {
      player1: sp.voteChoice?.player1 !== undefined,
      player2: sp.voteChoice?.player2 !== undefined
    }
  };
}

/** Display win percentages from integer roulette weights (kept local to avoid a phases.ts import cycle). */
function displayWeights(weights: Record<Seat, number>): { player1: number; player2: number } {
  const total = weights.player1 + weights.player2;
  if (total === 0) return { player1: 50, player2: 50 };
  return {
    player1: Math.round((weights.player1 / total) * 100),
    player2: Math.round((weights.player2 / total) * 100)
  };
}

export function toPublicPlayer(player: PlayerState) {
  return {
    userId: player.userId,
    displayName: player.displayName,
    connected: player.connected,
    reconnectUntilMs: player.reconnectUntilMs,
    hero: structuredClone(player.hero),
    mana: structuredClone(player.mana),
    handCount: player.hand.length,
    deckCount: player.deck.length,
    graveyardCount: player.graveyard.length,
    mulliganReady: player.mulliganReady,
    board: player.board.map(toPublicMinion),
    amplification: player.amplification ? structuredClone(player.amplification) : undefined,
    augments: player.augments.map((augment) => structuredClone(augment))
  };
}

export function toPublicMinion(minion: RuntimeMinion) {
  return {
    instanceId: minion.instanceId,
    cardId: minion.cardId,
    ownerSeat: minion.ownerSeat,
    attack: minion.attack,
    baseAttack: minion.baseAttack,
    health: minion.health,
    currentHealth: minion.currentHealth,
    taunt: !!minion.keywords.taunt,
    charge: !!minion.keywords.charge,
    divineShield: !!minion.keywords.divineShield,
    lockedTurns: minion.lockedTurns,
    deathTimer: minion.deathTimer,
    sleeping: minion.sleeping,
    canAttack: minion.canAttack,
    isEnraged: minion.isEnraged,
    questTurns: minion.questTurns,
    temporaryUntilTurn: minion.temporaryUntilTurn,
    // True only while a persistent (ongoing) effect is live. Silence / environment
    // effect-disabling clears `keywords`, so this drops to false and the client's
    // aura visual disappears in lockstep with the mechanic.
    hasOngoing: !!minion.keywords.ongoing
  };
}

export function toHandView(state: MatchState, seat: Seat): HandCardView[] {
  return state.players[seat].hand.map((card) => ({
    instanceId: card.instanceId,
    cardId: card.cardId,
    cost: getCardActualCost(state, seat, card),
    type: card.type,
    attack: card.attack,
    health: card.health,
    needsTarget: effectNeedsTarget(card.keywords.battlecry)
  }));
}

/**
 * Per-seat projection of an open 起底 / Discover choice, for the private direct
 * message. Returns undefined unless `seat` is the prompted seat. Card identities are
 * delivered only here — never in `toPublicState` — so deck order isn't leaked.
 */
export function toPromptChoiceOffer(state: MatchState, seat: Seat): PromptChoiceOffer | undefined {
  const pending = state.private.pendingChoice;
  if (!pending || pending.seat !== seat) return undefined;
  return {
    promptId: pending.promptId,
    label: pending.label,
    cards: pending.cards.map((card) => ({
      instanceId: card.instanceId,
      cardId: card.cardId,
      cost: getCardActualCost(state, seat, card),
      type: card.type,
      attack: card.attack,
      health: card.health
    }))
  };
}

export function getCardActualCost(state: MatchState, seat: Seat, card: RuntimeCard): number {
  if (state.private.devTestInfiniteMana?.[seat]) return 0;
  const immune = isReferendumImmune(state, seat);
  if (!immune && environmentForcesZeroCost(state)) return 0;
  let cost = card.cost;
  if (card.type === "NEWS") {
    for (const minion of state.players[seat].board) {
      if (minion.keywords.ongoing?.type === "REDUCE_NEWS_COST") {
        cost -= minion.keywords.ongoing.value ?? 0;
      }
    }
  }
  // Augment flat cost reductions (言論自由 新聞 −2 / 新青年安心成家貸款 建築 −4).
  cost -= augmentFlatCostReduction(state, seat, card);
  // Augment cost multiplier (乞丐超人 ×0.7 四捨五入, once past its turn threshold).
  const multiplierTenths = augmentCostMultiplierTenths(state, seat);
  if (multiplierTenths !== undefined) cost = Math.round((cost * multiplierTenths) / 10);
  // Global environment cost penalty (e.g. 油電雙漲), skipped for 潛逃國外. Applied on
  // top of any reduction and hard-capped at 10 so drawn cards inherit it automatically.
  if (!immune) {
    const envDelta = environmentCostDelta(state);
    if (envDelta > 0) cost = Math.min(10, cost + envDelta);
  }
  return Math.max(0, cost);
}

export function canPayCardCost(state: MatchState, seat: Seat, card: RuntimeCard): boolean {
  const player = state.players[seat];
  const cost = getCardActualCost(state, seat, card);
  return paysCardCostWithHealth(state, seat) ? player.hero.hp >= cost : player.mana.current >= cost;
}

export function payCardCost(state: MatchState, seat: Seat, card: RuntimeCard, events: GameEvent[]): number {
  const player = state.players[seat];
  const cost = getCardActualCost(state, seat, card);
  if (paysCardCostWithHealth(state, seat)) {
    if (cost > 0) {
      player.hero.hp -= cost;
      // Carry post-payment HP so the client drops the hero digit at impact (in
      // lockstep with the -N number) instead of waiting for the held publicSync
      // flush. lifeLoss/payment still mark this self-inflicted for stat exclusion.
      addEvent(state, events, "DAMAGE", { target: `${seat}:hero`, amount: cost, remainingHealth: player.hero.hp, lifeLoss: true, payment: "HEALTH" }, seat);
      if (unlockLowHpManaCap(player)) addEvent(state, events, "AUGMENT_TRIGGERED", { augmentId: "AMP_LIFE_INSURANCE" }, seat);
    }
  } else {
    player.mana.current -= cost;
  }
  return cost;
}

export function createMinionFromCard(state: MatchState, card: RuntimeCard, ownerSeat: Seat): RuntimeMinion {
  if (typeof card.attack !== "number" || typeof card.health !== "number") {
    throw new Error(`${card.cardId} is not a minion card.`);
  }
  const minion: RuntimeMinion = {
    instanceId: nextInstanceId(state, "minion"),
    cardId: card.cardId,
    ownerSeat,
    name: card.name,
    category: card.category,
    cost: card.cost,
    type: "MINION",
    rarity: card.rarity,
    attack: card.attack,
    baseAttack: card.attack,
    health: card.health,
    currentHealth: card.health,
    keywords: structuredClone(card.keywords ?? {}),
    sleeping: true,
    canAttack: false,
    isEnraged: false,
    lockedTurns: 0,
    auraAttack: 0,
    auraHealth: 0,
    auraTaunt: false,
    tempBuffs: [],
    bounce_bonus: card.bounce_bonus,
    hanBounceBonus: card.hanBounceBonus
  };

  suppressRuntimeMinionEffects(state, ownerSeat, minion);
  if (minion.keywords.taunt) minion.keywords.baseTaunt = true;
  if (minion.keywords.charge) {
    minion.sleeping = false;
    minion.canAttack = true;
  }
  if (minion.keywords.quest) minion.questTurns = 0;
  return minion;
}

export function createCardForHand(state: MatchState, def: CardDefinition, ownerSeat: Seat): RuntimeCard {
  const card = createRuntimeCard(def, ownerSeat, nextInstanceId(state, "card"));
  suppressRuntimeCardMinionEffects(state, ownerSeat, card);
  return card;
}

export function findCardInHand(player: PlayerState, handInstanceId: string): { card: RuntimeCard; index: number } | undefined {
  const index = player.hand.findIndex((card) => card.instanceId === handInstanceId);
  return index === -1 ? undefined : { card: player.hand[index], index };
}

export function findMinion(player: PlayerState, instanceId: string): { minion: RuntimeMinion; index: number } | undefined {
  const index = player.board.findIndex((minion) => minion.instanceId === instanceId);
  return index === -1 ? undefined : { minion: player.board[index], index };
}

export function getTargetUnit(state: MatchState, activeSeatValue: Seat, target?: TargetRef): TargetUnitRef | undefined {
  if (!target) return undefined;
  const side = target.side ?? (target.type === "HERO" ? opponentOf(activeSeatValue) : undefined);
  if (!side) return undefined;
  const owner = state.players[side];
  if (target.type === "HERO") return { owner, kind: "HERO", unit: owner.hero };
  if (!target.instanceId) return undefined;
  const found = findMinion(owner, target.instanceId);
  return found ? { owner, kind: "MINION", unit: found.minion } : undefined;
}

export function removeMinion(owner: PlayerState, minion: RuntimeMinion): RuntimeMinion | undefined {
  const index = owner.board.findIndex((item) => item.instanceId === minion.instanceId);
  if (index === -1) return undefined;
  return owner.board.splice(index, 1)[0];
}

export function currentNewsPower(state: MatchState, seat: Seat): number {
  return state.players[seat].board.reduce((sum, minion) => sum + (minion.keywords.newsPower ?? 0), 0);
}
