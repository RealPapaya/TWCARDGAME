import type {
  AmplificationOption,
  AmplificationSelection,
  CommandEnvelope,
  GameEvent,
  GameStatus,
  HandCardView,
  MatchResult,
  PendingPrompt,
  Phase,
  PublicGameState,
  PublicMinion,
  PublicPlayer,
  Seat,
  TargetRef,
  TurnState,
  VoteEvent
} from "@twcardgame/shared";
import type { CardDefinition, CardKeywords, EffectDefinition } from "@twcardgame/cards";
import type { CardType, Rarity } from "@twcardgame/shared";

export interface RuntimeCard {
  instanceId: string;
  cardId: string;
  ownerSeat: Seat;
  name: string;
  category: string;
  cost: number;
  type: CardType;
  rarity: Rarity;
  description: string;
  image: string;
  attack?: number;
  health?: number;
  keywords: CardKeywords;
  bounce_bonus?: number;
  hanBounceBonus?: number;
  isReduced?: boolean;
}

export interface TempBuff {
  attack: number;
  health: number;
}

export interface RuntimeMinion {
  instanceId: string;
  cardId: string;
  ownerSeat: Seat;
  name: string;
  category: string;
  cost: number;
  type: "MINION";
  rarity: Rarity;
  attack: number;
  baseAttack: number;
  health: number;
  currentHealth: number;
  keywords: CardKeywords;
  sleeping: boolean;
  canAttack: boolean;
  isEnraged: boolean;
  lockedTurns: number;
  deathTimer?: number;
  temporaryUntilTurn?: number;
  questTurns?: number;
  auraAttack: number;
  auraHealth: number;
  auraTaunt: boolean;
  tempBuffs: TempBuff[];
  bounce_bonus?: number;
  hanBounceBonus?: number;
}

export interface PlayerState {
  seat: Seat;
  userId: string;
  displayName: string;
  connected: boolean;
  reconnectUntilMs?: number;
  hero: { hp: number; maxHp: number };
  mana: { current: number; max: number };
  hand: RuntimeCard[];
  deck: RuntimeCard[];
  graveyard: RuntimeCard[];
  board: RuntimeMinion[];
  mulliganReady: boolean;
  shortTurnPenalty: boolean;
  /** Amplification chosen in a previous AMPLIFICATION_PHASE; shown by the avatar. */
  amplification?: AmplificationSelection;
  /** The amplification effect bound to this player (passive modifiers consult it). */
  amplificationEffect?: EffectDefinition;
  /**
   * Card-category histogram of the registered 30-card deck, computed once at
   * match creation. Drives the deck analyzer. NEVER projected to public state
   * (it reveals the archetype).
   */
  registeredCategoryCounts: Record<string, number>;
}

/**
 * Transient state of an active special phase (amplification or voting). Lives on
 * `MatchState` only while `phase !== "NORMAL_PLAY"` and is cleared on resolution.
 * Amplification options are kept here (private) — only the matching seat's options
 * are projected into that seat's private message; the public view exposes counts
 * and "selected" flags only.
 */
export interface SpecialPhaseState {
  phase: Exclude<Phase, "NORMAL_PLAY">;
  phaseDeadlineAtMs: number;
  /** Whose turn was interrupted and resumes once the phase resolves. */
  resumeSeat: Seat;
  /** Turn number when the phase opened — guards against re-triggering it. */
  resumeTurnNumber: number;
  amplificationOptions?: Record<Seat, AmplificationOption[]>;
  amplificationChoice?: Partial<Record<Seat, string>>;
  voteEvents?: VoteEvent[];
  /** Integer roulette weights (a seat's weight is the OPPONENT's HP). */
  voteWeightsInt?: Record<Seat, number>;
  voteChoice?: Partial<Record<Seat, 0 | 1 | 2>>;
}

/** A global environment effect applied by a referendum, with optional expiry. */
export interface ActiveEnvironment {
  id: string;
  name: string;
  appliedTurn: number;
  /** Turn number at which the effect lapses; omitted for permanent effects. */
  expiresTurn?: number;
  effect: EffectDefinition;
}

export interface PrivateMatchState {
  rngState: number;
  nextInstanceSeq: number;
  nextEventSeq: number;
  processedCommandIds: string[];
  actionLog: CommandEnvelope[];
  eventLog: GameEvent[];
  turnActionTaken: boolean;
  turnTimeLimitMs: number;
  devTestInfiniteMana?: Partial<Record<Seat, boolean>>;
}

export interface MatchState {
  matchId: string;
  schemaVersion: number;
  cardCatalogVersion: string;
  status: GameStatus;
  phase: Phase;
  turn: TurnState;
  players: Record<Seat, PlayerState>;
  pendingPrompt?: PendingPrompt;
  specialPhase?: SpecialPhaseState;
  currentEnvironment?: ActiveEnvironment;
  result?: MatchResult;
  private: PrivateMatchState;
}

export interface PlayerSetup {
  seat: Seat;
  userId: string;
  displayName: string;
  deckIds: string[];
  ownedCardIds?: string[];
}

export interface CreateMatchInput {
  matchId: string;
  cardCatalogVersion: string;
  players: [PlayerSetup, PlayerSetup];
  seed: number;
  nowMs: number;
  mulliganTimeLimitMs?: number;
  turnTimeLimitMs?: number;
  catalog: readonly CardDefinition[];
}

export interface RulesResult {
  state: MatchState;
  events: GameEvent[];
}

export interface EffectContext {
  state: MatchState;
  activeSeat: Seat;
  source?: RuntimeCard | RuntimeMinion;
  target?: TargetRef;
  events: GameEvent[];
  catalog: Map<string, CardDefinition>;
}

export interface EffectHandler {
  (effect: EffectDefinition, context: EffectContext): void;
}

export interface TargetUnitRef {
  owner: PlayerState;
  kind: "HERO" | "MINION";
  unit: PlayerState["hero"] | RuntimeMinion;
}

export type PublicStateProjector = (state: MatchState) => PublicGameState;
export type HandProjector = (state: MatchState, seat: Seat) => HandCardView[];
export type PublicMinionProjector = (minion: RuntimeMinion) => PublicMinion;
export type PublicPlayerProjector = (player: PlayerState) => PublicPlayer;
