import type { Room } from "@colyseus/sdk";
import type { Session } from "@supabase/supabase-js";
import type {
  AiDifficulty,
  AiTheme,
  FriendRequestRow,
  FriendRow,
  GameEvent,
  GameStatus,
  HandCardView,
  LeaderboardRow,
  PublicPlayer,
  Seat,
  ShopItemRow,
  TargetRef
} from "@twcardgame/shared";

export type AnimationKind = "play" | "summon" | "attack" | "attackerMoves" | "damage" | "heal" | "buff" | "destroy" | "turn" | "reject";
export type MenuScreen = "main" | "battle" | "profile" | "collection" | "deckEditor" | "friends" | "leaderboard" | "shop" | "ai";
export type CollectionFilter = "all" | "owned" | "missing";
export type CollectionSort = "cost-asc" | "cost-desc" | "rarity" | "name";
export type FriendsPanel = "friends" | "recommended" | "add";

export type PublicPlayerProfile = {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  winsCount: number;
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
  cardId?: string;
  attackerInstanceId?: string;
  amount?: number;
};

export type ClientViewState = {
  room?: Room;
  mySeat?: Seat;
  hand: HandCardView[];
  state?: any;
  publicSync?: {
    status?: GameStatus;
    activeSeat?: Seat;
    turnNumber?: number;
    actionSeq?: number;
    result?: any;
    players?: Partial<Record<Seat, PublicPlayer>>;
  };
  presence: Map<Seat, { connected: boolean; reconnectUntilMs?: number }>;
  rejectedHandIds: Set<string>;
  selectedHandId?: string;
  mulliganSelection: Set<string>;
  selectedAttackerId?: string;
  selectedTarget?: TargetRef;
  events: GameEvent[];
  animationCues: AnimationCue[];
  eventStatus?: GameStatus;
  toast?: string;
  joining: boolean;
  accountLoading: boolean;
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
  confirmingConcede?: boolean;
  menuScreen: MenuScreen;
  matchmaking?: MatchmakingState;
  matchmakingTimer?: number;
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
  editingDisplayName?: string;
  editingDisplayNameActive?: boolean;
  friends: FriendRow[];
  friendRequests: FriendRequestRow[];
  friendsPanel: FriendsPanel;
  friendsLoading?: boolean;
  leaderboard: LeaderboardRow[];
  leaderboardLoading?: boolean;
  leaderboardSortBy: "wins" | "level";
  publicPlayerProfile?: PublicPlayerProfile;
  shopItems: ShopItemRow[];
  shopLoading?: boolean;
  packOpeningCards?: Array<{ cardId: string; name: string; rarity: string; image: string }>;
  packOpeningRewards?: PackOpeningReward[];
  packOpeningFlipped?: boolean[];
  packOpeningKind?: "card" | "cosmetic";
  aiDifficulty: AiDifficulty;
  aiTheme: AiTheme;
  privateJoinCode?: string;
  privateJoinCodeInput?: string;
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
};

export type ProfileRow = {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
  gold: number;
  vouchers: number;
  owned_avatars?: string[];
  owned_titles?: string[];
  selected_title?: string;
  login_days?: number;
  current_login_streak?: number;
  longest_login_streak?: number;
  last_login_date?: string | null;
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
