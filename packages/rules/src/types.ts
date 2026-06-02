import type {
  CommandEnvelope,
  GameEvent,
  GameStatus,
  HandCardView,
  MatchResult,
  PendingPrompt,
  PublicGameState,
  PublicMinion,
  PublicPlayer,
  Seat,
  TargetRef,
  TurnState
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
}

export interface MatchState {
  matchId: string;
  schemaVersion: number;
  cardCatalogVersion: string;
  status: GameStatus;
  turn: TurnState;
  players: Record<Seat, PlayerState>;
  pendingPrompt?: PendingPrompt;
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
