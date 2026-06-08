export type Seat = "player1" | "player2";
export type GameStatus = "mulligan" | "in_progress" | "finished" | "abandoned";
export type CardType = "MINION" | "NEWS";
export type Rarity = "COMMON" | "RARE" | "EPIC" | "LEGENDARY";
export type AiDifficulty = "easy" | "normal" | "hard";

export const AI_DIFFICULTIES: readonly AiDifficulty[] = ["easy", "normal", "hard"] as const;

// Themed PvE opponents ported from the LEGACY v1 app
// (LEGACY/js/data/default_decks.js). Each theme is a fixed 30-card deck the
// bot plays; the hero card id is the theme's legendary, used by the web client
// to render the opponent's portrait on the "進入戰鬥" screen.
export type AiTheme = "dpp" | "dpp2" | "kmt" | "kmt2" | "tpp";

export type AiPartyTag = "民進黨" | "國民黨" | "民眾黨";

export interface AiThemeDefinition {
  id: AiTheme;
  /** Theme figure name, e.g. "賴清德". */
  name: string;
  /** Full challenge label, e.g. "賴清德 — 新聞湧動". */
  label: string;
  /** Catalog card id of the theme's hero (its legendary), for UI portrait. */
  heroCardId: string;
  partyTag: AiPartyTag;
}

export interface DevTestMatchSetup {
  handCardIds?: string[];
  playerBoardCardIds?: string[];
  opponentBoardCardIds?: string[];
  playerHp?: number;
  opponentHp?: number;
  playerMana?: { current?: number; max?: number };
  opponentMana?: { current?: number; max?: number };
  infiniteMana?: Partial<Record<Seat, boolean>>;
  turnNumber?: number;
  activeSeat?: Seat;
  phase?: Phase;
  amplificationTiers?: Partial<Record<"turn6" | "turn14", AmplificationTier>>;
  amplificationIds?: Partial<Record<"turn6" | "turn14", string>>;
  voteEventId?: string;
  voteEventIds?: string[];
}

export const AI_THEMES: readonly AiThemeDefinition[] = [
  { id: "dpp", name: "賴清德", label: "賴清德 — 新聞湧動", heroCardId: "TW046", partyTag: "民進黨" },
  { id: "dpp2", name: "蔡英文", label: "蔡英文 — 無限回溯", heroCardId: "TW020", partyTag: "民進黨" },
  { id: "kmt", name: "韓國瑜", label: "韓國瑜 — 政壇輪迴", heroCardId: "TW032", partyTag: "國民黨" },
  { id: "kmt2", name: "傅崐萁", label: "傅崐萁 — 江湖棄殺", heroCardId: "TW038", partyTag: "國民黨" },
  { id: "tpp", name: "柯文哲", label: "柯文哲 — 台大醫科", heroCardId: "TW011", partyTag: "民眾黨" }
] as const;

// Fixed 30-card decks, ported verbatim from LEGACY DEFAULT_THEME_DECKS.
// Each deck is validated by `validateDeck` (30 cards, ≤2 copies, ≤2 legendary).
export const AI_THEME_DECKS: Record<AiTheme, readonly string[]> = {
  dpp: [
    "TW010", "TW010", "TW044", "TW044", "TW045", "TW045", "TW046", "TW046",
    "TW050", "TW050", "TW049", "TW051", "TW051", "TW056",
    "S001", "S006", "S006", "S011", "S019", "S019", "S020", "S020",
    "S010", "S016", "S017", "S018",
    "TW052", "TW052", "TW053", "TW053"
  ],
  dpp2: [
    "TW069", "TW069", "TW064", "TW064", "TW067", "TW067", "TW020", "TW020",
    "TW061", "TW061", "TW060", "TW060", "TW013", "TW013",
    "S022", "S022", "S027", "S027", "S003", "S003", "S008", "S008",
    "S018", "S018", "S004", "S004", "S001", "S001", "S016", "S016"
  ],
  kmt: [
    "TW016", "TW016", "TW023", "TW023", "TW030", "TW030", "TW032", "TW032",
    "TW031", "TW031", "TW033", "TW033", "TW034", "TW034", "TW036", "TW036",
    "TW047", "TW047", "TW056", "TW056",
    "S005", "S005", "S003", "S003", "S010", "S013",
    "TW054", "TW054", "TW013", "TW013"
  ],
  kmt2: [
    "S009", "S009", "TW039", "TW039", "S014", "S014", "TW054", "TW054",
    "TW030", "S008", "S008", "TW040", "TW040",
    "TW035", "TW035", "TW037", "TW037",
    "TW036", "TW036", "TW047", "TW047",
    "TW016", "TW038", "TW038",
    "TW028", "TW034", "TW034", "TW023", "TW023", "TW055"
  ],
  tpp: [
    "TW011", "TW011", "TW041", "TW041", "TW043", "TW043", "TW014", "TW014",
    "TW015", "TW015", "TW019", "TW019", "TW021", "TW021", "TW026", "TW026",
    "TW025", "TW025", "TW028", "TW028", "TW042", "TW042", "TW018", "TW027",
    "S013", "S014", "S014",
    "TW002", "TW022", "TW022"
  ]
};

export function isAiTheme(value: unknown): value is AiTheme {
  return typeof value === "string" && AI_THEMES.some((theme) => theme.id === value);
}

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

// --- Special phases: turn 6/14 deck amplification & turn 20 inverse-HP voting ---

/**
 * Global battle phase, orthogonal to {@link GameStatus}. While the phase is not
 * `NORMAL_PLAY`, regular play/attack/endTurn commands and the turn countdown are
 * suspended; the only legal commands are the matching phase command.
 */
export type Phase = "NORMAL_PLAY" | "AMPLIFICATION_PHASE" | "VOTING_PHASE";

/** Amplification strength tiers, weakest → strongest. */
export type AmplificationTier = "加減賺" | "吃紅" | "卯死";

export const AMPLIFICATION_TIERS: readonly AmplificationTier[] = ["加減賺", "吃紅", "卯死"] as const;

/** One of the three upgrade choices privately offered to a player. */
export interface AmplificationOption {
  id: string;
  tier: AmplificationTier;
  name: string;
  description: string;
}

/** The amplification a player committed to; shown beside their hero avatar. */
export interface AmplificationSelection {
  id: string;
  tier: AmplificationTier;
  name: string;
}

/** A drawn referendum event with three voteable option labels (index 0/1/2). */
export interface VoteEvent {
  id: string;
  name: string;
  options: [string, string, string];
}

/** Per-seat win probability for the inverse-HP roulette (display %, "弱勢族群加成"). */
export interface VoteWeights {
  player1: number;
  player2: number;
}

/**
 * Public, synced view of the active special phase. Amplification *options* are
 * NOT here — they are private per-seat (see {@link AmplificationOffer}); only
 * the per-seat "has selected" flag and the resolved selection are public.
 */
export interface SpecialPhaseView {
  phaseDeadlineAtMs: number;
  amplificationSelected?: Record<Seat, boolean>;
  voteEvents?: VoteEvent[];
  voteWeights?: VoteWeights;
  voteSubmitted?: Record<Seat, boolean>;
}

/** Private direct message delivering a seat's tailored amplification options. */
export interface AmplificationOffer {
  options: AmplificationOption[];
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
  /** Most-recently bound amplification (retained for back-compat with the single badge). */
  amplification?: AmplificationSelection;
  /** All amplifications this player has bound (0..2), in phase order; drives the avatar indicators. */
  augments?: AmplificationSelection[];
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
  phase: Phase;
  turn: TurnState;
  players: Record<Seat, PublicPlayer>;
  pendingPrompt?: PendingPrompt;
  specialPhase?: SpecialPhaseView;
  result?: MatchResult;
}

export interface HandCardView {
  instanceId: string;
  cardId: string;
  cost: number;
  type: CardType;
  attack?: number;
  health?: number;
  needsTarget?: boolean;
}

export type GameCommand =
  | { type: "submitMulligan"; replaceHandInstanceIds: string[] }
  | { type: "playCard"; handInstanceId: string; target?: TargetRef; boardIndex?: number }
  | { type: "attack"; attackerInstanceId: string; target: TargetRef }
  | { type: "endTurn" }
  | { type: "concede" }
  | { type: "reconnect"; matchId: string }
  | { type: "selectAmplification"; optionId: string }
  | { type: "submitVote"; optionIndex: 0 | 1 | 2 };

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
  serverTimeout?: boolean;
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
  | "COMMAND_REJECTED"
  | "PHASE_STARTED"
  | "PHASE_ENDED"
  | "AMPLIFICATION_SELECTED"
  | "AUGMENT_TRIGGERED"
  | "VOTE_CAST"
  | "VOTE_RESOLVED"
  | "ENVIRONMENT_APPLIED"
  | "ENVIRONMENT_EXPIRED"
  | "EVENT_NOTICE";

export interface GameEvent {
  seq: number;
  type: GameEventType;
  seat?: Seat;
  payload?: Record<string, unknown>;
}

export * from "./animationTiming.js";
export * from "./progression.js";
