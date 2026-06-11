import type { Room } from "@colyseus/sdk";
import type { Session } from "@supabase/supabase-js";
import type { DragLineKind } from "../drag.js";
import type {
  AiDifficulty,
  AiTheme,
  AmplificationOption,
  AmplificationSelection,
  FriendRequestRow,
  FriendRow,
  GameEvent,
  GameStatus,
  HandCardView,
  LeaderboardRow,
  Phase,
  PromptChoiceOffer,
  PublicPlayer,
  RewardSummary,
  Seat,
  ShopItemRow,
  TargetRef,
  VoteEvent,
  VoteWeights
} from "@twcardgame/shared";

export type { ShopItemRow } from "@twcardgame/shared";

export type AnimationKind =
  | "play"
  | "summon"
  | "attack"
  | "attackerMoves"
  | "damage"
  | "heal"
  | "buff"
  | "bounce"
  | "destroy"
  | "turn"
  | "reject"
  // particle-effect kinds (single-target unless cue.scope === "aoe")
  | "effectStrike" // spell / effect damage impact, distinct from a combat lunge
  | "deathrattle" // 遺志 — soul plume rising from a dead minion's slot
  | "shieldPop" // divine shield breaking (split out of "buff")
  | "lock" // silence / lock (split out of "buff")
  | "aoeSweep" // one board-wide overlay drawn per AOE cluster
  | "augmentGlow" // 增幅 indicator pulse when a bound augment fires
  | "questComplete"; // quest countdown reaches zero — golden ring before effects fire

/** Whether an effect hit a single target or swept the whole board (全場). */
export type AnimationScope = "single" | "aoe";

/** Flavour of a board-wide `aoeSweep` overlay, by originating effect family. */
export type AnimationSweepVariant = "damage" | "heal" | "buff" | "destroy" | "lock" | "bounce";

/** One entry in the Hearthstone-style battle log, derived from a GameEvent. */
export type BattleLogKind = "summon" | "play" | "attack" | "damage" | "heal" | "buff" | "silence" | "bounce" | "death";
/** Corner badge / action icon drawn on a log entry and inside its tooltip. */
export type BattleLogBadge = "sword" | "burst" | "heart" | "arrow" | "sparkle" | "silence" | "bounce";

/** A card (or hero) shown as art in a log entry's tile and rich tooltip. */
export interface BattleLogCardRef {
  name: string;
  /** Resolved card art URL; absent for heroes or unknown cards. */
  thumb?: string;
  /** True when this references a hero rather than a card (no art available). */
  hero?: boolean;
}

export interface BattleLogEntry {
  /** Source event `seq` — used as the stable DOM key and to dedupe. */
  seq: number;
  kind: BattleLogKind;
  /** Card shown on the strip tile and as the main card in the tooltip — the actor (for buff/silence, the card that triggered it; for heal, the target). */
  tile: BattleLogCardRef;
  /** Optional second card shown after the action icon in the tooltip (attack / single-target effect target). */
  flowTo?: BattleLogCardRef;
  /** Affected targets for a grouped effect. When present, `tile` is the actor and the tooltip fans out to these targets. */
  flowTargets?: { ref: BattleLogCardRef; detail?: string; amount?: number }[];
  /** Deprecated alias kept for older buff/silence callers. Prefer `flowTargets`. */
  buffTargets?: { ref: BattleLogCardRef; detail: string }[];
  /** Small corner badge on the tile (omitted for deaths, which use a centered overlay). */
  badge?: BattleLogBadge;
  /** Numeric magnitude (damage dealt / health restored), shown on the affected card. */
  amount?: number;
  /** Stat-change / qualifier text for buffs (e.g. "+2/+2"). */
  detail?: string;
  /** Full readable sentence shown in the tooltip. */
  label: string;
  /** Acting seat, for friendly/enemy tinting. */
  seat?: Seat;
}
export type MenuScreen = "main" | "battle" | "training" | "profile" | "collection" | "deckEditor" | "friends" | "leaderboard" | "shop" | "tasks" | "ai" | "test" | "computer_placeholder" | "pvp_placeholder" | "challenge_setup";
export type BattleMode = "training" | "challenge" | "pvp" | "ai";
export type CollectionFilter = "all" | "owned" | "missing";
export type CollectionSort = "cost-asc" | "cost-desc" | "rarity" | "name";
export type FriendsPanel = "friends" | "recommended" | "add";
export type AuthMode = "signin" | "signup";

export type BattlecryPreviewState = {
  handInstanceId: string;
  cardId: string;
  isMinion: boolean;
  boardIndex: number;
  boardInstanceIdsBefore: string[];
  lineKind: DragLineKind;
  phase: "landing" | "aiming" | "committed";
};

export type PublicPlayerProfile = {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  winsCount: number;
  /** Real progression level when known (e.g. from the leaderboard). */
  level?: number;
  source: string;
  rank?: number;
};

export type MatchmakingState = {
  startedAtMs: number;
  status: "searching" | "joining" | "error";
};

export type AnimationCue = {
  id: string;
  kind: AnimationKind;
  text: string;
  seat?: Seat;
  targetKey?: string;
  /** For a flying effect (e.g. battlecry knife): the caster unit's key to fly FROM. */
  sourceKey?: string;
  cardId?: string;
  /**
   * Card-play overlay stat overrides. When set, the focus-zoom card face shows
   * these (buffed) stats instead of the catalog base — e.g. a bounced 韓國瑜
   * plays as a green 4/4. Omitted for normal plays, which fall back to catalog.
   */
  playAttack?: number;
  playHealth?: number;
  playEffectValue?: number;
  playBaseEffectValue?: number;
  playEffectBonusValue?: number;
  playBaseEffectBonusValue?: number;
  attackerInstanceId?: string;
  amount?: number;
  delayMs?: number;
  readyAtMs?: number;
  /** Board minion instanceIds an `augmentGlow` should light up (units the 增幅 changed). */
  augmentTargets?: string[];
  /** Own-hand card instanceIds an `augmentGlow` should light up (cards the 增幅 changed). */
  augmentCards?: string[];
  suppressBoardAnimation?: boolean;
  anchorX?: number;
  anchorY?: number;
  /** Source GameEvent.seq — lets the batch scope pass tag/dedupe this cue. */
  seq?: number;
  /** "aoe" when this cue is one member of a whole-board cluster (全場特效). */
  scope?: AnimationScope;
  /** Which board an `aoeSweep` overlay covers, relative to the local player. */
  seatSide?: "player" | "opponent";
  /** Flavour of an `aoeSweep` overlay. */
  variant?: AnimationSweepVariant;
};

export type ClientViewState = {
  room?: Room;
  mySeat?: Seat;
  hand: HandCardView[];
  state?: any;
  publicSync?: {
    status?: GameStatus;
    phase?: Phase;
    activeSeat?: Seat;
    turnNumber?: number;
    turnStartedAtMs?: number;
    turnDeadlineAtMs?: number;
    phaseDeadlineAtMs?: number;
    actionSeq?: number;
    result?: any;
    players?: Partial<Record<Seat, PublicPlayer>>;
    boardLimit?: number;
    activeEnvironment?: { id: string; name: string };
  };
  /** This seat's privately-delivered amplification options (turn 6/14). */
  amplificationOptions?: AmplificationOption[];
  /** This seat's privately-delivered 教召 / Discover candidate cards, while a choice prompt is open. */
  promptChoice?: PromptChoiceOffer;
  specialPhasePeek?: boolean;
  amplificationRerollStage?: "out" | "in";
  amplificationRerollStartedAtMs?: number;
  pendingAmplificationOptions?: AmplificationOption[];
  presence: Map<Seat, { connected: boolean; reconnectUntilMs?: number }>;
  rejectedHandIds: Set<string>;
  selectedHandId?: string;
  draggingHandId?: string;
  mulliganSelection: Set<string>;
  selectedAttackerId?: string;
  selectedTarget?: TargetRef;
  /**
   * A targeted-battlecry card mid two-stage play (LEGACY v1 parity). It plays
   * exactly like any other card — drop, card-play animation, land on the field —
   * and only then a targeting arrow is shown. No `playCard` command is sent
   * until a legal target is picked, so cancelling leaves the card untouched in
   * hand. Phases: `landing` (card-play animation running, nothing on the board
   * yet), `aiming` (minion on the field, arrow active), `committed` (command
   * sent — the landed card is kept until the server sync replaces it).
   */
  pendingBattlecry?: BattlecryPreviewState;
  acceptedBattlecry?: BattlecryPreviewState;
  events: GameEvent[];
  battleLog: BattleLogEntry[];
  animationCues: AnimationCue[];
  turnAnnouncement?: {
    id: string;
    text: string;
    seat: Seat;
    untilMs: number;
  };
  eventStatus?: GameStatus;
  toast?: string;
  rewardSummary?: RewardSummary;
  rewardAnim?: RewardAnimationState;
  joining: boolean;
  accountLoading: boolean;
  authMode: AuthMode;
  session?: Session | null;
  profile?: ProfileRow;
  decks: DeckRow[];
  collection: CollectionRow[];
  matchHistory: MatchHistoryRow[];
  selectedDeckId?: string;
  editingDeck?: Partial<DeckRow> & Pick<DeckRow, "name" | "card_ids">;
  hoveredCardId?: string;
  hoveredCard?: ResolvedCardView;
  hoverAnchor?: { x: number; y: number; width: number; height: number };
  hoveredAugment?: AmplificationSelection & { description?: string };
  augmentHoverAnchor?: { x: number; y: number; width: number; height: number };
  hoveredEvent?: { id: string; name: string; description?: string };
  eventHoverAnchor?: { x: number; y: number; width: number; height: number };
  confirmingConcede?: boolean;
  menuScreen: MenuScreen;
  matchmaking?: MatchmakingState;
  matchmakingTimer?: number;
  opponentDisconnectTimer?: number;
  collectionFilter: CollectionFilter;
  collectionSort: CollectionSort;
  collectionCategory: string;
  collectionRarity: string;
  collectionSearch: string;
  pinnedCollectionCardId?: string;
  cardOpBusy?: boolean;
  confirmDialog?: {
    title: string;
    message?: string;
    confirmLabel: string;
    cancelLabel: string;
    danger?: boolean;
    resolve: (ok: boolean) => void;
  };
  coverPickerOpen?: boolean;
  avatarPickerOpen?: boolean;
  titlePickerOpen?: boolean;
  editingDisplayName?: string;
  editingDisplayNameActive?: boolean;
  friends: FriendRow[];
  friendRequests: FriendRequestRow[];
  friendsPanel: FriendsPanel;
  friendsLoading?: boolean;
  leaderboard: LeaderboardRow[];
  leaderboardLoading?: boolean;
  leaderboardSortBy: "wins" | "level";
  /** Which match kind the profile 戰績統計 panel is showing (PvP vs PvE). */
  statsMode: "pvp" | "pve";
  publicPlayerProfile?: PublicPlayerProfile;
  shopItems: ShopItemRow[];
  shopLoading?: boolean;
  tasks: TaskView[];
  tasksLoading?: boolean;
  packOpeningCards?: Array<{ cardId: string; name: string; rarity: string; image: string }>;
  packOpeningRewards?: PackOpeningReward[];
  packOpeningFlipped?: boolean[];
  packOpeningKind?: "card" | "cosmetic";
  aiDifficulty: AiDifficulty;
  aiDifficultySelected?: boolean;
  aiTheme: AiTheme;
  privateJoinCode?: string;
  privateJoinCodeInput?: string;
  battleMode: BattleMode;
  bgmVolume: number;
  sfxVolume: number;
  bgmMuted: boolean;
  sfxMuted: boolean;
  settingsOpen: boolean;
  battleSettingsOpen: boolean;
  battleDeckOpen: boolean;
  changelogOpen: boolean;
};

export type ResolvedCardView = {
  cardId: string;
  instanceId: string;
  name: string;
  category: string;
  description: string;
  image: string;
  cost: number;
  baseCost?: number;
  type: string;
  rarity: string;
  attack?: number;
  baseAttack?: number;
  health?: number;
  baseHealth?: number;
  effectValue?: number;
  baseEffectValue?: number;
  effectBonusValue?: number;
  baseEffectBonusValue?: number;
};

export type ProfileRow = {
  user_id: string;
  display_name: string;
  display_name_set?: boolean;
  avatar_url?: string | null;
  gold: number;
  vouchers: number;
  xp?: number;
  level?: number;
  owned_avatars?: string[];
  owned_titles?: string[];
  selected_title?: string | null;
  login_days?: number;
  current_login_streak?: number;
  longest_login_streak?: number;
  last_login_date?: string | null;
};

export type TaskRecurrence = "once" | "daily" | "weekly";

/** Active row from `quest_definitions` (read via RLS for display). */
export type TaskQuestRow = {
  id: string;
  display_name: string;
  description?: string | null;
  event_type: string;
  target_count: number;
  recurrence: TaskRecurrence;
  reward?: { gold?: number } & Record<string, unknown>;
  active: boolean;
};

/** The caller's own `user_quest_progress` row for the current period. */
export type TaskProgressRow = {
  quest_id: string;
  period_key: string;
  current_count: number;
  completed_at?: string | null;
  claimed_at?: string | null;
};

/** A quest joined with the caller's progress for the current period. */
export type TaskView = {
  quest: TaskQuestRow;
  progress?: TaskProgressRow;
  state: "in-progress" | "claimable" | "claimed";
  current: number;
  target: number;
};

export type DeckRow = {
  id: string;
  user_id: string;
  name: string;
  card_catalog_version: string;
  card_ids: string[];
  cover_card_id?: string | null;
  updated_at?: string;
};

export type CollectionRow = {
  card_id: string;
  quantity: number;
};

export type MatchHistoryRow = {
  id: string;
  winner_seat?: Seat | null;
  result_reason: string;
  created_at?: string;
  finished_at?: string;
  player1_user_id?: string | null;
  player2_user_id?: string | null;
  /** True when the opponent was the AI (PvE); false/absent for human PvP matches. */
  is_vs_ai?: boolean | null;
  /** AI persona theme id (PvE only), e.g. "dpp". */
  ai_theme?: string | null;
  /** AI difficulty (PvE only): "easy" | "normal" | "hard". */
  ai_difficulty?: string | null;
  /** Display names recovered from final_state.players (PvP opponent name lookup). */
  players_view?: {
    player1?: { displayName?: string } | null;
    player2?: { displayName?: string } | null;
  } | null;
  /** final_state.turn — used to recover the number of turns played. */
  turn_view?: { number?: number | string } | null;
};

/**
 * Drives the post-match reward animation. The overlay shell is rendered once
 * by render(); the XP bar / gold ticker mutate via rAF (reward-screen.ts).
 */
export type RewardAnimationState = {
  /** "xp" -> filling bar; "gold" -> ticker; "done" -> continue button armed. */
  stage: "xp" | "gold" | "done";
  /** Displayed level while the XP bar walks through level-ups. */
  displayedLevel: number;
  /** Displayed XP into the current level (used to render the bar). */
  displayedXpIntoLevel: number;
  /** Bar capacity for the displayed level. */
  displayedXpRequired: number;
  /** Displayed gold counter mid-tween. */
  displayedGold: number;
};

export type PackOpeningReward =
  | {
      type: "card";
      cardId: string;
      name: string;
      category: string;
      description: string;
      cost: number;
      cardType: string;
      rarity: string;
      image: string;
      attack?: number;
      health?: number;
    }
  | { type: "avatar"; id: string; name: string; path: string }
  | { type: "title"; id: string; name: string }
  | { type: "voucher"; amount: number; name: string };

export type PurchaseShopResult = {
  itemId: string;
  kind: string;
  priceGold: number;
  remainingGold: number;
  rewards: Array<{ type: string; cardId?: string; id?: string; name?: string; path?: string; amount?: number }>;
};
