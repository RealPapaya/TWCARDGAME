export type Seat = "player1" | "player2";
export type GameStatus = "mulligan" | "in_progress" | "finished" | "abandoned";
export type CardType = "MINION" | "NEWS";
export type Rarity = "COMMON" | "RARE" | "EPIC" | "LEGENDARY";
export type AiDifficulty = "easy" | "normal" | "hard";

export const AI_DIFFICULTIES: readonly AiDifficulty[] = ["easy", "normal", "hard"] as const;

// Phase 5 social/economy row shapes. Defined here (not in the web client) so
// other clients or admin tools can consume the same DTOs.

export interface FriendRow {
  friend_user_id: string;
  display_name: string;
  avatar_url?: string | null;
  wins_count: number;
}

export interface FriendRequestRow {
  request_id: string;
  other_user_id: string;
  display_name: string;
  avatar_url?: string | null;
  wins_count: number;
  direction: "incoming" | "outgoing";
  created_at?: string;
}

export interface LeaderboardRow {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
  wins_count: number;
}

export interface ShopItemRow {
  id: string;
  kind: string;
  display_name: string;
  description?: string | null;
  price_gold: number;
  contents: {
    cards?: string[];
    cardCount?: number;
    itemCount?: number;
    dropRates?: Array<{ label: string; rate: number; rarity?: Rarity; type?: string }>;
    note?: string;
  };
}

export const SEATS: readonly Seat[] = ["player1", "player2"] as const;

export function opponentOf(seat: Seat): Seat {
  return seat === "player1" ? "player2" : "player1";
}

export interface HeroState {
  hp: number;
  maxHp: number;
}

export interface ManaState {
  current: number;
  max: number;
}

export interface TargetRef {
  type: "HERO" | "MINION";
  side?: Seat;
  instanceId?: string;
}

export interface PublicMinion {
  instanceId: string;
  cardId: string;
  ownerSeat: Seat;
  attack: number;
  baseAttack: number;
  health: number;
  currentHealth: number;
  taunt: boolean;
  charge: boolean;
  divineShield: boolean;
  lockedTurns: number;
  deathTimer?: number;
  sleeping: boolean;
  canAttack: boolean;
  isEnraged: boolean;
  questTurns?: number;
  temporaryUntilTurn?: number;
}

export interface PublicPlayer {
  userId: string;
  displayName: string;
  connected: boolean;
  reconnectUntilMs?: number;
  hero: HeroState;
  mana: ManaState;
  handCount: number;
  deckCount: number;
  graveyardCount: number;
  mulliganReady: boolean;
  board: PublicMinion[];
}

export interface TurnState {
  activeSeat: Seat;
  number: number;
  startedAtMs: number;
  deadlineAtMs: number;
  actionSeq: number;
}

export interface PendingPrompt {
  promptId: string;
  seat: Seat;
  kind: "target" | "choice";
  sourceInstanceId: string;
  validTargets: TargetRef[];
}

export interface MatchResult {
  winnerSeat?: Seat;
  reason: "hero_destroyed" | "concede" | "disconnect_timeout" | "abandoned";
}

export interface PublicGameState {
  matchId: string;
  schemaVersion: number;
  cardCatalogVersion: string;
  status: GameStatus;
  turn: TurnState;
  players: Record<Seat, PublicPlayer>;
  pendingPrompt?: PendingPrompt;
  result?: MatchResult;
}

export interface HandCardView {
  instanceId: string;
  cardId: string;
  cost: number;
  type: CardType;
  attack?: number;
  health?: number;
}

export type GameCommand =
  | { type: "submitMulligan"; replaceHandInstanceIds: string[] }
  | { type: "playCard"; handInstanceId: string; target?: TargetRef; boardIndex?: number }
  | { type: "attack"; attackerInstanceId: string; target: TargetRef }
  | { type: "endTurn" }
  | { type: "concede" }
  | { type: "reconnect"; matchId: string };

export interface ClientCommandMessage {
  commandId: string;
  expectedActionSeq: number;
  command: GameCommand;
}

export interface CommandEnvelope {
  commandId: string;
  seat: Seat;
  nowMs: number;
  command: GameCommand;
}

export type GameEventType =
  | "MATCH_CREATED"
  | "MULLIGAN_SUBMITTED"
  | "TURN_STARTED"
  | "TURN_ENDED"
  | "CARD_DRAWN"
  | "CARD_BURNED"
  | "CARD_PLAYED"
  | "MINION_SUMMONED"
  | "ATTACK"
  | "DAMAGE"
  | "HEAL"
  | "BUFF"
  | "SHIELD_POPPED"
  | "DESTROY"
  | "BOUNCE"
  | "DISCARD"
  | "AURA_UPDATED"
  | "DEATHRATTLE"
  | "QUEST_COMPLETED"
  | "GAME_FINISHED"
  | "COMMAND_REJECTED";

export interface GameEvent {
  seq: number;
  type: GameEventType;
  seat?: Seat;
  payload?: Record<string, unknown>;
}
