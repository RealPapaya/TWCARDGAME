import "./polyfills.js";
import { Client, type Room } from "@colyseus/sdk";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { CARD_CATALOG, CARD_CATALOG_VERSION, type CardDefinition } from "@twcardgame/cards";
import { AI_THEMES } from "@twcardgame/shared";
import type {
  AiDifficulty,
  AiTheme,
  ClientCommandMessage,
  FriendRow,
  FriendRequestRow,
  GameCommand,
  GameEvent,
  GameStatus,
  HandCardView,
  LeaderboardRow,
  PublicMinion,
  PublicPlayer,
  Seat,
  ShopItemRow,
  TargetRef
} from "@twcardgame/shared";
import { GameStateSchema } from "./schema.js";
import { assetUrl, classNames, escapeAttr, escapeHtml, fanStyle, opponentFanStyle } from "./ui.js";
import { beginAttackDrag, beginHandDrag, classifyEffectKind, ensureDragLayer } from "./drag.js";
import { installGlobalErrorHandlers } from "./logger.js";
import "./styles.css";

installGlobalErrorHandlers();

type AnimationKind = "play" | "summon" | "attack" | "attackerMoves" | "damage" | "heal" | "buff" | "destroy" | "turn" | "reject";
type SoundCue = "cardPlay" | "attack" | "damage" | "heal" | "death" | "turn" | "reject" | "packFlip";

type MenuScreen = "main" | "battle" | "profile" | "collection" | "deckEditor" | "friends" | "leaderboard" | "shop" | "ai";
type CollectionFilter = "all" | "owned" | "missing";
type CollectionSort = "cost-asc" | "cost-desc" | "rarity" | "name";
type FriendsPanel = "friends" | "recommended" | "add";
type PublicPlayerProfile = {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  winsCount: number;
  source: "好友" | "排行榜" | "邀請";
  rank?: number;
};
type MatchmakingState = {
  startedAtMs: number;
  status: "searching" | "joining" | "error";
};

type AnimationCue = {
  id: string;
  kind: AnimationKind;
  text: string;
  seat?: Seat;
  targetKey?: string;
  cardId?: string;
  attackerInstanceId?: string;
  amount?: number;
};

type ClientViewState = {
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

type ResolvedCardView = {
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

type ProfileRow = {
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

const PROFILE_SELECT =
  "user_id,display_name,avatar_url,gold,vouchers,owned_avatars,owned_titles,selected_title,login_days,current_login_streak,longest_login_streak,last_login_date";

type DeckRow = {
  id: string;
  user_id: string;
  name: string;
  card_catalog_version: string;
  card_ids: string[];
  cover_card_id?: string | null;
  updated_at?: string;
};

type CollectionRow = {
  card_id: string;
  quantity: number;
};

type MatchHistoryRow = {
  id: string;
  winner_seat?: Seat | null;
  result_reason: string;
  created_at?: string;
  finished_at?: string;
  player1_user_id?: string | null;
  player2_user_id?: string | null;
};

type PackOpeningReward =
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

type PurchaseShopResult = {
  itemId: string;
  kind: string;
  priceGold: number;
  remainingGold: number;
  rewards: Array<{ type: string; cardId?: string; id?: string; name?: string; path?: string; amount?: number }>;
};

const app = document.querySelector<HTMLDivElement>("#app")!;
const gameFrameWidth = 1600;
const gameFrameHeight = 900;
const defaultServerUrl = import.meta.env.VITE_COLYSEUS_URL || "ws://localhost:2567";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const forceDevAuth = isLocalDevHost() && new URLSearchParams(location.search).get("auth") === "dev";
const supabase: SupabaseClient | undefined =
  !forceDevAuth && supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : undefined;
const cardCatalog = new Map<string, CardDefinition>(CARD_CATALOG.map((card) => [card.id, card]));
const seats: Seat[] = ["player1", "player2"];
const bgmVolumeKey = "twcardgame.bgmVolume";
const sfxVolumeKey = "twcardgame.sfxVolume";
const bgmMutedKey = "twcardgame.bgmMuted";
const sfxMutedKey = "twcardgame.sfxMuted";
const bgmTrack = new Audio("/audio/bgm/Earthbound Ember.mp3");
const sfxPaths: Record<SoundCue, string> = {
  cardPlay: "/audio/sfx/LowCostMionion.mp3",
  attack: "/audio/sfx/HeavyHit.mp3",
  damage: "/audio/sfx/LightHit.mp3",
  heal: "/audio/sfx/card-draw.mp3",
  death: "/audio/sfx/MionionDeath.mp3",
  turn: "/audio/sfx/heavy_sandstone_click.mp3",
  reject: "/audio/sfx/Retreat.mp3",
  packFlip: "/audio/sfx/card-draw.mp3"
};
let audioUnlocked = false;
const rarityLabel: Record<string, string> = {
  COMMON: "普通", RARE: "精良", EPIC: "史詩", LEGENDARY: "傳說"
};

type PatchNoteItem = { title: string; desc: string; cardIds?: string[] };
type PatchNoteVersion = { version: string; date: string; items: PatchNoteItem[] };
const PATCH_NOTES: PatchNoteVersion[] = [
  {
    version: "v0.9.0", date: "2026-01-20",
    items: [
      { title: "[新增] 對戰系統", desc: "新增對戰系統，玩家可以與其他玩家進行對戰，為甚麼只有這一條更新，因為超難做" }
    ]
  },
  {
    version: "v0.8.0", date: "2026-01-20",
    items: [
      { title: "[新卡片] 王ADEN、卡車司機", desc: "", cardIds: ["TW074", "TW073"] },
      { title: "[新增] 好友系統、排行榜系統", desc: "新增好友系統，玩家可以添加好友、查看好友列表、發送好友邀請等。排行榜系統可以讓玩家查看目前伺服器上的玩家 並且以等級為排行" },
      { title: "[商店系統] 新增卡牌分解合成購買以及卡牌庫", desc: "新增卡牌分解合成功能，玩家可以將卡牌分解成消費券，再用消費券合成卡牌" },
      { title: "[音效] 新增卡牌落地和攻擊音效、背景音樂", desc: "新增卡牌落地和攻擊音效，讓遊戲更有互動性" }
    ]
  },
  {
    version: "v0.7.0", date: "2026-01-18",
    items: [
      { title: "[新增] 帳號創建系統", desc: "新增帳號密碼，玩家可以儲存自己的牌組、頭像等等" },
      { title: "[新功能] Mulligan", desc: "新增mulligan功能，玩家可以重新洗牌" },
      { title: "[架構] 程式碼重構", desc: "重構代碼結構，使代碼更易於維護和擴展" }
    ]
  },
  {
    version: "v0.6.1", date: "2026-01-15",
    items: [
      { title: "[視覺優化] 更新適應性畫面", desc: "保持每個解析度的畫面比例一致" }
    ]
  },
  {
    version: "v0.6.0", date: "2026-01-15",
    items: [
      { title: "[新卡片] 沉默不是金", desc: "", cardIds: ["S027"] },
      { title: "[新增] 預設牌組、對戰紀錄", desc: "提供多個預設牌組，對戰中可查看對戰紀錄以供玩家參考" },
      { title: "[視覺優化] 更新與AI對戰的選擇畫面", desc: "將難度以及牌組整合在同一個畫面" }
    ]
  },
  {
    version: "v0.5.0", date: "2026-01-14",
    items: [
      { title: "[新卡片] 蠻牛、死亡之握、TOYZ、卓榮泰、大法官、林佳龍", desc: "新增多張全新卡片，包含「蠻牛」(補血抽牌)、「死亡之握」(倒數三回合死亡)、「TOYZ」(高體質負面戰吼) 等。", cardIds: ["TW070", "TW071", "TW072", "TW067", "TW068", "TW069"] },
      { title: "[新增] 箭頭顏色、對戰提示", desc: "摧毀類型箭頭新增黑色並修改形式，新增對戰提示詞" },
      { title: "[修正] 幽靈動畫", desc: "當抽牌時左側有牌由下往上飄出" }
    ]
  },
  {
    version: "v0.4.0", date: "2026-01-13",
    items: [
      { title: "[新卡片] 8+9、無期徒刑、鉅額交保、普發一萬、停班停課、王定宇", desc: "", cardIds: ["TW065", "S023", "S024", "S025", "S026", "TW066"] },
      { title: "[機制] 群體鎖定與增益", desc: "新增集體沉默與集體增益機制，支援更複雜的控場與反制策略" },
      { title: "[新增] 遊戲主視覺", desc: "新增遊戲主視覺，包含主畫面、選卡畫面、對戰畫面、牌組編輯畫面" },
      { title: "[視覺] 新聞回血特效", desc: "當「王定宇」觸發新聞回血效果時，現在會有綠色的回復數字飄出" }
    ]
  },
  {
    version: "v0.3.1", date: "2026-01-11",
    items: [
      { title: "[新增功能] 自訂游標系統", desc: "全站啟用風格游標，滑鼠懸停互動元素時保持一致外觀，提供更佳的沈浸感。可使用卡牌會出現綠光提示" },
      { title: "[新卡片] 陳其邁、藍亦明、電子腳鐐、蘇貞昌、哈們、謝和弦、蔡想想、蔡樂樂、民進黨黨部、國民黨黨部、鋼鐵韓粉、青鳥大學生、老鳥中年", desc: "新增「陳其邁」(群體鎖定+召喚藍亦明)、「藍亦明」(存活機制)、「電子腳鐐」(沈默/鎖定)、「蘇貞昌」(衝鋒+回手) 與多張具備陣營特色的卡牌。", cardIds: ["TW061", "TW062", "S022", "TW060", "S021", "TW059", "TW058", "TW057", "TW056", "TW055", "TW054", "TW052", "TW053"] },
      { title: "[調整] 蔡英文、水電師傅", desc: "蔡英文現在會召喚蔡想想、蔡樂樂，水電師傅生命值提升至4->5" },
      { title: "[系統優化] 代碼重構與機制更新", desc: "分離卡牌資料結構以提升維護性，並實作新的攻守交換戰吼機制 (SWAP_ATTACK_HEALTH)。" }
    ]
  },
  {
    version: "v0.3.0", date: "2026-01-10",
    items: [
      { title: "[新卡片] 武漢肺炎、陳時中、陳建仁、網軍、側翼攻擊、八卦、緋聞、政治清算、查水表(重製)、炎上(重製)", desc: "新增「政治清算」造成單體巨額傷害。重製「查水表」與「炎上」效果。", cardIds: ["S015", "TW049", "TW050", "TW048", "S014", "S016", "S017", "S020", "S019", "S018"] },
      { title: "[機制修正] 減費效果與法力驗證系統", desc: "修正「陳建仁」等減費卡牌導致的「0費無法出牌」問題。全面重構法力驗證邏輯，確保顯示費用即為實際支付費用。" },
      { title: "[視覺優化] 震動反饋、波紋擴散、黑暗處決特效", desc: "新增「政治清算」的黑暗處決印記、「查水表」的全場搜查波紋、「武漢肺炎」的毒氣擴散，以及卡牌互動的震動反饋。" },
      { title: "[系統] 數字顯示與預覽修復", desc: "優化傷害數字顯示系統。修復拖曳預覽時的卡頓與遮擋問題。" }
    ]
  },
  {
    version: "v0.2.2", date: "2026-01-09",
    items: [
      { title: "[新卡片] 賴清德、高端疫苗、黃捷、抗中保台、芒果乾、蘇巧慧", desc: "新增 6 張全新卡片，包含與民進黨相關的強力效果。", cardIds: ["TW046", "S011", "TW044", "S012", "S013", "TW045"] },
      { title: "[優化] AI 主題牌組與測試模式", desc: "對戰改為選擇主題（綠/藍/白）進行挑戰。測試模式支援編輯電腦主題牌組。" }
    ]
  },
  {
    version: "v0.2.1", date: "2026-01-09",
    items: [
      { title: "[新卡片] 新增柯文哲(獄中)、蔡璧如、陳珮琪、陳珮琪(老公獄中)。", desc: "包含新的「自殘」與「滿血回復」機制。", cardIds: ["TW041", "TW042", "TW019", "TW043"] },
      { title: "[優化] AI 主題牌組與測試模式", desc: "對戰改為選擇主題（綠/藍/白）進行挑戰。測試模式支援編輯電腦主題牌組。" },
      { title: "[修正] 介面與名詞調整", desc: "「法術」卡全面更名為「新聞」。統一按鈕樣式與位置。優化受傷數值顯示與補血動畫顏色。" }
    ]
  },
  {
    version: "v0.2.0", date: "2026-01-09",
    items: [
      { title: "[新卡片] 老榮民、法院傳票、連勝文、倒閣、造勢晚會、921大地震", desc: "新增多張具備政治色彩與強力效果的傳奇/史詩卡片。", cardIds: ["TW037", "S008", "TW036", "S005", "S004", "S010"] },
      { title: "[優化/機制] 全場視覺特效、AI 智能決策、打擊感強化", desc: "整合碎石噴發特效與畫面震動，大幅提升隨從對陣時的打擊反饋。" }
    ]
  },
  {
    version: "v0.1.2", date: "2026-01-08",
    items: [
      { title: "[新卡片] 政治切割、謝龍介", desc: "新增具備棄牌連動機制的卡片。謝龍介被丟棄時會直接進入戰場！", cardIds: ["S009", "TW040"] },
      { title: "[機制] 棄牌召喚系統", desc: "完善了棄牌連鎖機制，現在卡片被隨機丟棄時能觸發自身或場上的特殊效果。" }
    ]
  },
  {
    version: "v0.1.1", date: "2026-01-08",
    items: [
      { title: "[新卡片] 傅崐萁、徐巧芯", desc: "新增「花蓮國王」傅崐萁及隨機棄牌連動。支援多重棄牌觸發系統。", cardIds: ["TW038", "TW039"] }
    ]
  },
  {
    version: "v0.1", date: "2026-01-08",
    items: [
      { title: "[初始卡片組] 45張", desc: "含多種卡牌包含新聞、隨從牌。" },
      { title: "[機制] 戰吼、光盾、嘲諷、衝鋒、遺志", desc: "新增多種卡牌機制。" },
      { title: "[優化] 介面佈局與棄牌邏輯", desc: "新增版本號顯示、更新日誌，並優化了棄牌類卡片的打出限制。" }
    ]
  }
];

const view: ClientViewState = {
  hand: [],
  presence: new Map(),
  rejectedHandIds: new Set(),
  mulliganSelection: new Set(),
  events: [],
  animationCues: [],
  joining: false,
  accountLoading: false,
  session: undefined,
  decks: [],
  collection: [],
  matchHistory: [],
  menuScreen: "main",
  collectionFilter: "owned",
  collectionSort: "cost-asc",
  collectionCategory: "all",
  collectionRarity: "all",
  collectionSearch: "",
  friends: [],
  friendRequests: [],
  friendsPanel: "friends",
  leaderboard: [],
  leaderboardSortBy: "wins",
  publicPlayerProfile: undefined,
  shopItems: [],
  aiDifficulty: "normal",
  aiTheme: AI_THEMES[0].id,
  bgmVolume: readStoredNumber(bgmVolumeKey, 0.22),
  sfxVolume: readStoredNumber(sfxVolumeKey, 0.72),
  bgmMuted: readStoredBool(bgmMutedKey, false),
  sfxMuted: readStoredBool(sfxMutedKey, false),
  settingsOpen: false,
  battleSettingsOpen: false,
  battleDeckOpen: false,
  changelogOpen: false
};

let renderScheduled = false;
let lastRenderedHtml = "";

ensureDragLayer();
installViewportGuards();
installAudioUnlock();
render();
void initializeAccount();

function render(): void {
  if (renderScheduled) return;
  renderScheduled = true;
  window.requestAnimationFrame(() => {
    renderScheduled = false;
    renderNow();
  });
}

function renderNow(): void {
  const status = readStatus();
  const shellClass = view.state ? "app-shell in-match" : "app-shell";
  const nextHtml = `
    <main class="${shellClass}">
      ${view.state ? renderGame(status) : renderLanding()}
      ${renderPublicPlayerProfileModal()}
      ${renderConfirmDialog()}
      ${renderToast()}
      ${renderLegacyShopPackOverlay()}
      ${renderHoverTooltip()}
    </main>
  `;

  if (nextHtml !== lastRenderedHtml) {
    const snapshot = captureRenderSnapshot();
    app.innerHTML = nextHtml;
    lastRenderedHtml = nextHtml;
    bindStaticActions();
    bindSelectionActions();
    restoreRenderSnapshot(snapshot);
  }
  applyPostRenderEffects();
  ensureBgm();
}

type RenderSnapshot = {
  activeSelector?: string;
  activeValue?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  scroll: Array<{ selector: string; top: number; left: number }>;
};

function captureRenderSnapshot(): RenderSnapshot {
  const active = document.activeElement;
  const input = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : undefined;
  const activeSelector = input ? stableElementSelector(input) : undefined;
  const selection = input ? readInputSelection(input) : undefined;
  return {
    activeSelector,
    activeValue: input?.value,
    selectionStart: selection?.start,
    selectionEnd: selection?.end,
    scroll: Array.from(document.querySelectorAll<HTMLElement>("[data-preserve-scroll]"))
      .map((el) => ({ selector: stableElementSelector(el), top: el.scrollTop, left: el.scrollLeft }))
      .filter((item) => item.selector)
  };
}

function readInputSelection(input: HTMLInputElement | HTMLTextAreaElement): { start: number | null; end: number | null } | undefined {
  try {
    return { start: input.selectionStart, end: input.selectionEnd };
  } catch {
    return undefined;
  }
}

function restoreRenderSnapshot(snapshot: RenderSnapshot): void {
  for (const item of snapshot.scroll) {
    const el = document.querySelector<HTMLElement>(item.selector);
    if (!el) continue;
    el.scrollTop = item.top;
    el.scrollLeft = item.left;
  }
  if (!snapshot.activeSelector) return;
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(snapshot.activeSelector);
  if (!input) return;
  if (snapshot.activeValue !== undefined && input.value !== snapshot.activeValue) input.value = snapshot.activeValue;
  input.focus();
  if (snapshot.selectionStart !== null && snapshot.selectionStart !== undefined) {
    try {
      input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd ?? snapshot.selectionStart);
    } catch {
      // Non-text inputs such as sliders do not support selection ranges.
    }
  }
}

function stableElementSelector(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${cssEscape(testId)}"]`;
  const screen = el.getAttribute("data-screen");
  if (screen) return `[data-screen="${cssEscape(screen)}"]`;
  const className = Array.from(el.classList)[0];
  return className ? `.${cssEscape(className)}` : "";
}

function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = parseFloat(raw);
    return isNaN(n) ? fallback : Math.max(0, Math.min(1, n));
  } catch {
    return fallback;
  }
}

function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function installViewportGuards(): void {
  syncAppScale();
  window.addEventListener("resize", syncAppScale);
  window.visualViewport?.addEventListener("resize", syncAppScale);

  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  document.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "+" || key === "-" || key === "=" || key === "_" || key === "0") {
      event.preventDefault();
    }
  });
}

function syncAppScale(): void {
  const scale = Math.min(window.innerWidth / gameFrameWidth, window.innerHeight / gameFrameHeight);
  app.style.setProperty("--app-scale", String(Math.max(0.1, scale)));
}

function saveAudioPrefs(): void {
  try {
    localStorage.setItem(bgmVolumeKey, String(view.bgmVolume));
    localStorage.setItem(sfxVolumeKey, String(view.sfxVolume));
    localStorage.setItem(bgmMutedKey, String(view.bgmMuted));
    localStorage.setItem(sfxMutedKey, String(view.sfxMuted));
  } catch {
    // Blocked storage; in-memory prefs still work.
  }
}

function installAudioUnlock(): void {
  bgmTrack.loop = true;
  bgmTrack.preload = "auto";
  bgmTrack.volume = view.bgmMuted ? 0 : view.bgmVolume;
  const unlock = () => {
    audioUnlocked = true;
    ensureBgm();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function ensureBgm(): void {
  if (!audioUnlocked) return;
  bgmTrack.volume = view.bgmMuted ? 0 : view.bgmVolume;
  if (view.bgmMuted) {
    bgmTrack.pause();
    return;
  }
  if (!bgmTrack.paused) return;
  void bgmTrack.play().catch(() => {
    // Browsers may still block playback until a stronger user gesture.
  });
}

function playSfx(cue: SoundCue, volume?: number): void {
  if (view.sfxMuted || !audioUnlocked) return;
  const audio = new Audio(sfxPaths[cue]);
  audio.preload = "auto";
  audio.volume = volume ?? view.sfxVolume;
  void audio.play().catch(() => {
    // Missing files or browser autoplay policy should never break gameplay.
  });
}

function setBgmVolume(v: number): void {
  view.bgmVolume = v;
  bgmTrack.volume = view.bgmMuted ? 0 : v;
  saveAudioPrefs();
}

function setSfxVolume(v: number): void {
  view.sfxVolume = v;
  saveAudioPrefs();
}

function toggleBgmMute(): void {
  view.bgmMuted = !view.bgmMuted;
  saveAudioPrefs();
  ensureBgm();
  render();
}

function toggleSfxMute(): void {
  view.sfxMuted = !view.sfxMuted;
  saveAudioPrefs();
  if (!view.sfxMuted) playSfx("turn");
  render();
}

function playEventAudio(events: GameEvent[]): void {
  const played = new Set<SoundCue>();
  for (const event of events) {
    const cue =
      event.type === "CARD_PLAYED" || event.type === "MINION_SUMMONED" ? "cardPlay"
      : event.type === "ATTACK" ? "attack"
      : event.type === "DAMAGE" ? "damage"
      : event.type === "HEAL" ? "heal"
      : event.type === "DESTROY" ? "death"
      : event.type === "TURN_STARTED" ? "turn"
      : event.type === "COMMAND_REJECTED" ? "reject"
      : undefined;
    if (!cue || played.has(cue)) continue;
    played.add(cue);
    playSfx(cue);
  }
}

function renderLanding(): string {
  if (supabase && !view.session) return renderAuthPanel();
  return renderMenu();
}

function renderMenu(): string {
  switch (view.menuScreen) {
    case "battle":
      return renderBattleScreen();
    case "profile":
      return renderProfileScreen();
    case "collection":
      return renderCollectionScreen();
    case "deckEditor":
      return renderDeckEditorScreen();
    case "friends":
      return renderFriendsScreen();
    case "leaderboard":
      return renderLeaderboardScreen();
    case "shop":
      return renderLegacyShopScreen();
    case "ai":
      return renderAiBattleSetupScreen();
    case "main":
    default:
      return renderMainMenu();
  }
}

function renderAuthPanel(): string {
  return `
    <section class="screen auth-screen" data-screen="auth">
      ${renderCloudLayer()}
      <div class="auth-container-v2">
        <h1 class="auth-page-title">帳號登入</h1>
        <div class="auth-card parchment-card">
          <div class="auth-tabs" aria-label="帳號操作">
            <button type="button" class="auth-tab active" ${view.accountLoading ? "disabled" : ""}>登入</button>
            <button type="button" id="sign-up" class="auth-tab" ${view.accountLoading ? "disabled" : ""}>註冊</button>
          </div>
        <form id="auth-form" class="auth-form">
          <label class="auth-label">
            <span>帳號</span>
            <input id="auth-email" type="email" autocomplete="email" placeholder="輸入用戶名" required />
          </label>
          <label class="auth-label">
            <span>密碼</span>
            <input id="auth-password" type="password" autocomplete="current-password" placeholder="輸入密碼" required />
          </label>
          <button type="button" id="google-sign-in" class="google-logo-button" aria-label="使用 Google 登入" title="使用 Google 登入" ${view.accountLoading ? "disabled" : ""}>
            <span class="google-g" aria-hidden="true">G</span>
          </button>
          <button type="submit" class="auth-submit" data-auth-mode="signin" data-testid="auth-signin" ${view.accountLoading ? "disabled" : ""}>確定登入</button>
        </form>
        </div>
      </div>
    </section>
  `;
}

function renderCloudLayer(): string {
  return `
    <div class="cloud-layer" aria-hidden="true">
      <div class="cloud cloud-1"></div>
      <div class="cloud cloud-2"></div>
      <div class="cloud cloud-3"></div>
      <div class="cloud cloud-4"></div>
    </div>
  `;
}

function renderMainMenu(): string {
  const displayName = view.profile?.display_name ?? "Player";
  const avatarUrl = view.profile?.avatar_url || "/images/avatars/avatar1.webp";
  const stats = computeMatchStats();
  const ownedCount = view.collection.filter((row) => row.quantity > 0).length;
  const totalCatalog = CARD_CATALOG.filter((card) => card.collectible !== false).length;
  const accountMode = Boolean(supabase);
  const xpFraction = stats.total > 0 ? Math.min((stats.wins % 10) / 10, 1) : 0;
  const level = Math.floor(stats.wins / 10) + 1;
  const playerTitle = "#菜鳥";
  return `
    <section class="screen main-menu" data-screen="main">
      ${renderCloudLayer()}
      <div class="version-corner">
        <span class="version-pill">${escapeHtml(CARD_CATALOG_VERSION)}</span>
      </div>
      <div class="main-menu-center">
        <h1 class="game-title">寶島遊戲王</h1>
        <nav class="menu-buttons" aria-label="Main menu">
          <button class="menu-button" data-menu-screen="profile" data-testid="menu-profile" ${accountMode ? "" : "disabled title='Sign in required'"}>個人頁面</button>
          <button class="menu-button menu-primary" data-menu-screen="battle" data-testid="menu-battle">進入戰鬥</button>
          <button class="menu-button menu-patch" id="changelog-open" data-testid="menu-patch">更新內容</button>
        </nav>
      </div>
      <nav class="menu-icon-rail" aria-label="側邊功能">
        <button id="settings-toggle" class="menu-icon-btn" data-testid="menu-settings" title="設定">⚙️</button>
        <button class="menu-icon-btn" data-menu-screen="leaderboard" data-testid="menu-leaderboard" title="排行榜">🏆</button>
        <button class="menu-icon-btn" data-menu-screen="friends" data-testid="menu-friends" title="好友" ${accountMode ? "" : "disabled"}>🤝</button>
      </nav>
      <div class="main-menu-bottom">
        <aside class="player-info-card" data-testid="player-chip">
          <img class="player-avatar" src="${escapeAttr(avatarUrl)}" alt="" onerror="this.src='/images/avatars/avatar1.webp'" />
          <div class="player-info-text">
            <strong>${escapeHtml(displayName)}</strong>
            <span class="player-title-text">${escapeHtml(playerTitle)}</span>
            <span class="player-level-row">Lv.${level} <span class="player-card-count">${ownedCount}/${totalCatalog}</span></span>
            <div class="xp-bar-track"><div class="xp-bar-fill" style="width:${Math.round(xpFraction * 100)}%"></div></div>
            <span class="player-stats">W ${stats.wins} · L ${stats.losses}</span>
          </div>
        </aside>
        <nav class="menu-corner-rail" aria-label="底部功能">
          <button class="menu-corner-btn" data-menu-screen="collection" data-testid="menu-collection" ${accountMode ? "" : "disabled title='Sign in required'"}>
            <img class="corner-icon" src="/images/ui/collection_logo.webp" alt="收藏庫" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
            <span class="corner-icon-emoji" style="display:none">🃏</span>
            <span class="corner-label">收藏庫</span>
          </button>
          <button class="menu-corner-btn" data-menu-screen="shop" data-testid="menu-shop" ${accountMode ? "" : "disabled"}>
            <img class="corner-icon" src="/images/ui/shop_logo.webp" alt="商店" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
            <span class="corner-icon-emoji" style="display:none">💰</span>
            <span class="corner-label">商店</span>
          </button>
        </nav>
      </div>
      ${view.settingsOpen ? renderSettingsModal() : ""}
      ${view.changelogOpen ? renderChangelogModal() : ""}
    </section>
  `;
}

function renderChangelogModal(): string {
  return `
    <div class="changelog-backdrop" id="changelog-backdrop" role="dialog" aria-modal="true" aria-label="更新日誌">
      <div class="changelog-modal parchment-card">
        <header class="settings-modal-header">
          <h3>更新日誌</h3>
          <button id="changelog-close" class="settings-close-btn" title="關閉">✕</button>
        </header>
        <div class="changelog-list" data-preserve-scroll>
          ${PATCH_NOTES.map((entry) => `
            <div class="changelog-version">
              <h4>版本 ${escapeHtml(entry.version)} (${escapeHtml(entry.date)})</h4>
              <ul>
                ${entry.items.map((item) => `
                  <li>
                    <strong>${escapeHtml(item.title)}</strong>
                    ${item.desc ? `<p>${escapeHtml(item.desc)}</p>` : ""}
                    ${item.cardIds && item.cardIds.length > 0 ? `
                      <div class="card-chips">
                        ${item.cardIds.map((id) => {
                          const card = cardCatalog.get(id);
                          return card ? `<span class="card-chip" data-hover-card-id="${escapeAttr(id)}">${escapeHtml(card.name)}</span>` : "";
                        }).filter(Boolean).join("")}
                      </div>
                    ` : ""}
                  </li>
                `).join("")}
              </ul>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderBattleScreen(): string {
  const selectedDeck = view.decks.find((deck) => deck.id === view.selectedDeckId);
  const accountMode = Boolean(supabase);
  const findDisabled = view.joining || Boolean(view.matchmaking) || (accountMode && (!view.session || !view.selectedDeckId));
  const aiEntryDisabled = view.joining || Boolean(view.matchmaking) || (accountMode && (!view.session || !view.selectedDeckId));
  const deckSlots = accountMode
    ? view.decks.map(renderSavedDeck).join("") || `<p class="battle-empty-note">尚未建立牌組，請先新增一組。</p>`
    : `<div class="deck-slot saved-deck selected dev-deck-slot">
        <button class="deck-select" type="button">
          <h3>Dev Deck</h3>
          <span class="slot-info">Server default deck</span>
        </button>
      </div>`;

  return `
    <section class="screen battle-pick v1-deck-selection" data-screen="battle">
      <div class="battle-selection-content">
        <button class="back-button neon-button secondary" data-menu-screen="main" data-testid="back-to-menu">返回</button>
        <h2 id="deck-select-title" class="sub-title">選擇牌組</h2>
        <div class="deck-slots-container" data-testid="battle-deck-list">
          ${deckSlots}
          <button id="new-deck" type="button" class="deck-slot add-deck-slot">
            <span class="plus-icon">+</span>
            <span class="slot-info">新增牌組</span>
          </button>
        </div>
        <div class="battle-selection-actions">
          <div class="battle-start-row">
            <button id="find-match" class="neon-button battle-start-btn" data-testid="find-match" ${findDisabled ? "disabled" : ""}>
              ${view.joining ? "連線中..." : "開始戰鬥"}
            </button>
            <button class="neon-button battle-start-btn" data-menu-screen="ai" data-testid="battle-ai-entry" ${aiEntryDisabled ? "disabled" : ""}>AI 對戰</button>
          </div>
          <div class="private-room-section battle-private-room">
            <button id="create-private-room" class="neon-button secondary" data-testid="create-private-room" ${findDisabled ? "disabled" : ""}>建立房間代碼</button>
            <form id="private-join-form" class="private-join-form">
              <input id="private-join-input" placeholder="輸入房間代碼" maxlength="10" />
              <button type="submit" class="neon-button secondary" data-testid="private-join-submit" ${findDisabled ? "disabled" : ""}>加入房間</button>
            </form>
            ${view.privateJoinCode ? renderPrivateCodeBanner(view.privateJoinCode!) : ""}
          </div>
          <details class="advanced-disclosure battle-advanced">
            <summary>進階設定</summary>
            <form id="join-form-advanced" class="advanced-form">
              <label>Server URL
                <input id="server-url-advanced" value="${escapeAttr(defaultServerUrl)}" />
              </label>
              ${accountMode ? "" : `<label>Display Name<input id="display-name-advanced" value="${escapeAttr(view.profile?.display_name ?? "Player")}" /></label>`}
            </form>
          </details>
          <p class="battle-selected-note">${selectedDeck ? `已選擇：${escapeHtml(selectedDeck!.name)}` : accountMode ? "請選擇一組完整 30 張牌組。" : "Dev mode 會使用伺服器預設牌組。"}</p>
        </div>
      </div>
      ${renderMatchmakingOverlay()}
    </section>
  `;
  const aiDisabled = view.joining || (accountMode && (!view.session || !view.selectedDeckId));
  const difficulties: { value: AiDifficulty; label: string }[] = [
    { value: "easy", label: "簡單" },
    { value: "normal", label: "普通" },
    { value: "hard", label: "困難" }
  ];
  return `
    <section class="screen battle-pick" data-screen="battle">
      ${renderCloudLayer()}
      <header class="screen-header">
        <button class="back-button" data-menu-screen="main" data-testid="back-to-menu">← 返回主選單</button>
        <h2>進入戰鬥</h2>
      </header>
      <div class="battle-pick-grid">
        <section class="parchment-card deck-pick">
          <div class="panel-heading">
            <h3>選擇牌組</h3>
            <button id="new-deck" class="ghost-button">+ 新牌組</button>
          </div>
          <div class="deck-list" data-testid="battle-deck-list">
            ${accountMode ? (view.decks.map(renderSavedDeck).join("") || `<p class="muted">尚未建立牌組，請先新增一組。</p>`) : `<p class="muted">Dev mode: server will assign a default deck.</p>`}
          </div>
          <p class="muted">${selectedDeck ? `已選：${escapeHtml(selectedDeck!.name)}` : accountMode ? "請選擇一套合法的 30 張牌組。" : "Dev mode 不需選牌組。"}</p>
        </section>
        <div class="battle-mode-panels">
          <section class="parchment-card match-panel">
            <h3>⚔️ 玩家對戰</h3>
            <p class="muted">系統自動配對另一位玩家。</p>
            <button id="find-match" class="primary-action" data-testid="find-match" ${findDisabled ? "disabled" : ""}>
              ${view.joining ? "配對中…" : "開始配對"}
            </button>
            <div class="private-room-section">
              <h4>私人房間</h4>
              <button id="create-private-room" class="ghost-button" data-testid="create-private-room" ${findDisabled ? "disabled" : ""}>建立房間並取得代碼</button>
              <form id="private-join-form" class="private-join-form">
                <input id="private-join-input" placeholder="輸入 6 碼代碼" maxlength="10" />
                <button type="submit" data-testid="private-join-submit" ${findDisabled ? "disabled" : ""}>加入房間</button>
              </form>
              ${view.privateJoinCode ? renderPrivateCodeBanner(view.privateJoinCode!) : ""}
            </div>
            <details class="advanced-disclosure">
              <summary>進階設定</summary>
              <form id="join-form-advanced" class="advanced-form">
                <label>Server URL
                  <input id="server-url-advanced" value="${escapeAttr(defaultServerUrl)}" />
                </label>
                ${accountMode ? "" : `<label>Display Name<input id="display-name-advanced" value="${escapeAttr(view.profile?.display_name ?? "Player")}" /></label>`}
              </form>
            </details>
          </section>
          <section class="parchment-card match-panel">
            <h3>🤖 電腦對戰</h3>
            <h4 class="ai-section-label">難度</h4>
            <div class="ai-difficulty-options">
              ${difficulties.map((opt) => `
                <label class="ai-difficulty-option ${view.aiDifficulty === opt.value ? "selected" : ""}">
                  <input type="radio" name="ai-difficulty" value="${opt.value}" ${view.aiDifficulty === opt.value ? "checked" : ""} />
                  <strong>${opt.label}</strong>
                </label>
              `).join("")}
            </div>
            <h4 class="ai-section-label">主題挑戰</h4>
            <div class="ai-theme-options" data-testid="ai-theme-options">
              ${AI_THEMES.map(renderAiThemeCard).join("")}
            </div>
            <button id="start-ai-match" class="primary-action" data-testid="start-ai-match" ${aiDisabled ? "disabled" : ""}>
              ${view.joining ? "連線中…" : "開始對戰"}
            </button>
          </section>
        </div>
      </div>
      ${renderMatchmakingOverlay()}
    </section>
  `;
}

function renderAiThemeCard(theme: (typeof AI_THEMES)[number]): string {
  const hero = cardCatalog.get(theme.heroCardId);
  const heroArt = hero ? assetUrl(hero.image) : "";
  const selected = view.aiTheme === theme.id;
  return `
    <button
      type="button"
      class="ai-theme-card ${selected ? "selected" : ""}"
      data-ai-theme="${escapeAttr(theme.id)}"
      data-testid="ai-theme-${escapeAttr(theme.id)}"
      aria-pressed="${selected}"
    >
      <span class="ai-theme-art" style="background-image:url('${escapeAttr(heroArt)}')"></span>
      <span class="ai-theme-meta">
        <strong class="ai-theme-name">${escapeHtml(theme.name)}</strong>
        <span class="ai-theme-party">${escapeHtml(theme.partyTag)}</span>
        <span class="ai-theme-label">${escapeHtml(theme.label)}</span>
      </span>
    </button>
  `;
}

function renderAiBattleSetupScreen(): string {
  const accountMode = Boolean(supabase);
  const aiDisabled = view.joining || (accountMode && (!view.session || !view.selectedDeckId));
  const difficulties: { value: AiDifficulty; label: string }[] = [
    { value: "easy", label: "簡單" },
    { value: "normal", label: "普通" },
    { value: "hard", label: "困難" }
  ];
  const selectedTheme = AI_THEMES.find((theme) => theme.id === view.aiTheme) ?? AI_THEMES[0];
  const selectedHero = selectedTheme ? cardCatalog.get(selectedTheme.heroCardId) : undefined;
  const selectedHeroArt = selectedHero ? assetUrl(selectedHero.image) : "";

  return `
    <section class="screen ai-battle-setup" data-screen="ai">
      <div class="battle-setup-container">
        <div class="setup-preview-panel">
          <div class="preview-image-container">
            ${selectedHeroArt ? `<img id="preview-image" src="${escapeAttr(selectedHeroArt)}" alt="${escapeAttr(selectedTheme?.name ?? "AI")}" />` : ""}
            <div class="preview-illustration-overlay active">
              <div id="preview-illustration-title" class="illustration-title">${escapeHtml(selectedTheme?.name ?? "AI")}</div>
              <div id="preview-illustration-subtitle" class="illustration-subtitle">${escapeHtml(selectedTheme?.partyTag ?? "")}</div>
            </div>
          </div>
          <div class="preview-description">
            <p>${escapeHtml(selectedTheme?.label ?? "選擇一個 AI 主題與難度。")}</p>
          </div>
        </div>
        <div class="setup-options-panel">
          <img src="/images/ui/AI_Selection.webp" class="ai-selection-decoration" alt="" />
          <div class="options-scroll-area">
            <div id="deck-options-container" data-testid="ai-theme-options">
              ${AI_THEMES.map((theme) => renderAiThemeOption(theme, difficulties)).join("")}
            </div>
          </div>
          <div class="setup-footer">
            <div id="start-battle-wrapper" class="${aiDisabled ? "disabled" : ""}">
              <button id="start-ai-match" class="hearth-select-btn" data-testid="start-ai-match" ${aiDisabled ? "disabled" : ""}>
                <div class="btn-ripple"></div>
                <span class="btn-text">${view.joining ? "連線" : "對戰"}</span>
                <div class="ring-glow"></div>
              </button>
            </div>
            <button class="neon-button secondary" data-menu-screen="battle">返回</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderAiThemeOption(theme: (typeof AI_THEMES)[number], difficulties: { value: AiDifficulty; label: string }[]): string {
  const selected = view.aiTheme === theme.id;
  return `
    <div class="deck-option-group ${selected ? "expanded selected" : ""}">
      <button
        type="button"
        class="option-item ai-theme-card ${selected ? "selected" : ""}"
        data-ai-theme="${escapeAttr(theme.id)}"
        data-testid="ai-theme-${escapeAttr(theme.id)}"
        aria-pressed="${selected}"
      >
        <span class="option-label">${escapeHtml(theme.name)}</span>
        <span class="ai-theme-party">${escapeHtml(theme.partyTag)}</span>
        <span class="expand-arrow">›</span>
      </button>
      <div class="difficulty-options">
        ${difficulties.map((opt) => `
          <label class="sub-difficulty-btn ${view.aiDifficulty === opt.value ? "selected" : ""}">
            <input type="radio" name="ai-difficulty" value="${opt.value}" ${view.aiDifficulty === opt.value ? "checked" : ""} />
            <span>${opt.label}</span>
          </label>
        `).join("")}
      </div>
    </div>
  `;
}

function renderMatchmakingOverlay(): string {
  if (!view.matchmaking) return "";
  const elapsedMs = Date.now() - view.matchmaking.startedAtMs;
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `
    <section class="matchmaking-overlay" data-testid="matchmaking-overlay">
      <div class="matchmaking-card parchment-card">
        <div class="searching-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        <h3>Looking for an opponent</h3>
        <p class="matchmaking-timer" data-testid="matchmaking-elapsed">${mm}:${ss}</p>
        <button id="matchmaking-cancel" class="danger" data-testid="matchmaking-cancel">Cancel</button>
      </div>
    </section>
  `;
}

function renderProfileScreen(): string {
  const accountMode = Boolean(supabase);
  if (!accountMode) {
    return `
      <section class="screen profile-screen" data-screen="profile">
        ${renderCloudLayer()}
        <header class="screen-header">
          <button class="back-button" data-menu-screen="main">← 返回主選單</button>
          <h2>個人頁面</h2>
        </header>
        <div class="parchment-card center-card">
          <p>請先登入才能使用個人頁面。</p>
        </div>
      </section>
    `;
  }
  const profile = view.profile;
  const displayName = view.editingDisplayName ?? profile?.display_name ?? "玩家";
  const avatarUrl = profile?.avatar_url || "/images/avatars/avatar1.webp";
  const stats = computeMatchStats();
  const winRateLabel = stats.total === 0 ? "—" : `${Math.round((stats.wins / stats.total) * 100)}%`;
  const level = deriveLbLevel(stats.wins);
  const ownedCardCount = view.collection.reduce((sum, row) => sum + row.quantity, 0);
  const title = profile?.selected_title || "未設定稱號";
  const avatars = ["avatar1", "avatar2", "avatar3", "avatar4"];
  const recent = view.matchHistory.slice(0, 10);
  const editing = view.editingDisplayNameActive ?? false;
  return `
    <section class="screen profile-screen" data-screen="profile">
      ${renderCloudLayer()}
      <header class="screen-header">
        <button class="back-button" data-menu-screen="main">← 返回主選單</button>
        <h2>個人頁面</h2>
      </header>
      <div class="parchment-card profile-panel" data-testid="profile-panel">
        <div class="profile-header" data-testid="profile-header">
          <div class="profile-avatar-block">
            <img class="profile-avatar" src="${escapeAttr(avatarUrl)}" alt="" onerror="this.src='/images/avatars/avatar1.webp'" />
            <button id="open-avatar-picker" class="ghost-button">更換頭像</button>
          </div>
          <div class="profile-identity">
            <form id="profile-form" class="profile-form">
              <div class="profile-name-row">
                ${editing
                  ? `<input id="profile-display-name" class="profile-name-input" value="${escapeAttr(displayName)}" maxlength="32" autofocus />`
                  : `<span class="profile-name-display">${escapeHtml(displayName)}</span>`
                }
                ${editing
                  ? `<button type="submit" class="profile-name-confirm-btn" data-testid="profile-save" ${view.accountLoading ? "disabled" : ""} title="儲存">✓</button>
                     <button type="button" id="cancel-edit-name" class="profile-name-cancel-btn" title="取消">✕</button>`
                  : `<button type="button" id="edit-display-name" class="profile-pencil-btn" title="編輯顯示名稱">✏️</button>`
                }
              </div>
            </form>
            <div class="profile-title-badge">${escapeHtml(title)}</div>
            <div class="profile-ribbon">
              <span>Lv. ${level}</span>
              <span>${stats.wins} 勝</span>
              <span>${winRateLabel} 勝率</span>
            </div>
          </div>
          ${view.avatarPickerOpen ? `
          <div class="avatar-picker" data-testid="avatar-picker">
            ${avatars.map((slug) => `
              <button type="button" data-pick-avatar="${slug}" class="avatar-option ${profile?.avatar_url?.includes(slug) ? "selected" : ""}">
                <img src="/images/avatars/${slug}.webp" alt="${slug}" />
              </button>
            `).join("")}
          </div>` : ""}
        </div>

        <div class="profile-section profile-section--wallet">
          <h3>帳號資源</h3>
          <div class="profile-resource-grid">
            <div class="profile-resource"><span>金幣</span><strong>${profile?.gold ?? 0}</strong></div>
            <div class="profile-resource"><span>消費券</span><strong>${profile?.vouchers ?? 0}</strong></div>
            <div class="profile-resource"><span>卡牌收藏</span><strong>${ownedCardCount}</strong></div>
            <div class="profile-resource"><span>牌組</span><strong>${view.decks.length}</strong></div>
          </div>
        </div>

        <div class="profile-section profile-section--stats">
          <h3>戰績統計</h3>
          <ul class="stat-list">
            <li><span>勝場</span><strong>${stats.wins}</strong></li>
            <li><span>敗場</span><strong>${stats.losses}</strong></li>
            <li><span>平局</span><strong>${stats.draws}</strong></li>
            <li><span>勝率</span><strong>${winRateLabel}</strong></li>
            <li><span>總場次</span><strong>${stats.total}</strong></li>
          </ul>
        </div>

        <div class="profile-section profile-section--login">
          <h3>登入紀錄</h3>
          <div class="profile-login-grid">
            <div><span>累積登入</span><strong>${profile?.login_days ?? 0}</strong></div>
            <div><span>目前連續</span><strong>${profile?.current_login_streak ?? 0}</strong></div>
            <div><span>最長連續</span><strong>${profile?.longest_login_streak ?? 0}</strong></div>
          </div>
        </div>

        <div class="profile-section profile-section--history">
          <h3>近期對戰</h3>
          <div class="history-list">
            ${recent.length === 0 ? `<p class="muted">尚無對戰紀錄。</p>` : recent.map(renderMatchHistoryRow).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSettingsModal(): string {
  const accountMode = Boolean(supabase);
  const bgmPct = Math.round(view.bgmVolume * 100);
  const sfxPct = Math.round(view.sfxVolume * 100);
  return `
    <div class="settings-backdrop" id="settings-backdrop" role="dialog" aria-modal="true" aria-label="設定">
      <div class="settings-modal parchment-card">
        <header class="settings-modal-header">
          <h3>設定</h3>
          <button id="settings-close" class="settings-close-btn" title="關閉">✕</button>
        </header>
        <h4 class="settings-section-title">🎵 音樂</h4>
        <div class="settings-volume-row">
          <button id="settings-bgm-mute" class="settings-mute-btn ${view.bgmMuted ? "muted" : ""}" title="${view.bgmMuted ? "取消靜音" : "靜音"}">
            ${view.bgmMuted ? "🔇" : "🔊"}
          </button>
          <input id="settings-bgm-volume" type="range" class="settings-volume-slider" min="0" max="1" step="0.01" value="${view.bgmVolume}" ${view.bgmMuted ? "disabled" : ""} />
          <span class="settings-volume-label">${bgmPct}%</span>
        </div>
        <h4 class="settings-section-title">🔔 音效</h4>
        <div class="settings-volume-row">
          <button id="settings-sfx-mute" class="settings-mute-btn ${view.sfxMuted ? "muted" : ""}" title="${view.sfxMuted ? "取消靜音" : "靜音"}">
            ${view.sfxMuted ? "🔇" : "🔊"}
          </button>
          <input id="settings-sfx-volume" type="range" class="settings-volume-slider" min="0" max="1" step="0.01" value="${view.sfxVolume}" ${view.sfxMuted ? "disabled" : ""} />
          <span class="settings-volume-label">${sfxPct}%</span>
        </div>
        ${accountMode ? `
        <div class="settings-divider"></div>
        <button id="settings-sign-out" class="settings-signout-btn danger" data-testid="settings-sign-out">登出</button>
        ` : ""}
      </div>
    </div>
  `;
}

function renderCollectionScreen(): string {
  return renderCollectionWorkspace("main", "收藏庫");
}

function renderCollectionWorkspace(backScreen: MenuScreen, title: string): string {
  const accountMode = Boolean(supabase);
  const collectionMap = new Map(view.collection.map((row) => [row.card_id, row.quantity]));
  const collectibles = CARD_CATALOG.filter((card) => card.collectible !== false);
  const filtered = filterCollectionCards(collectibles, collectionMap);
  const ownedTotal = collectibles.filter((card) => (collectionMap.get(card.id) ?? 0) > 0).length;
  const categories = uniqueCollectionCategories(collectibles);
  const rarities = uniqueCollectionRarities(collectibles);
  const deck = view.editingDeck;
  const selectedCounts = countCards(deck?.card_ids ?? []);
  const selectedTotal = deck?.card_ids.length ?? 0;
  return `
    <section class="screen collection-screen" data-screen="collection">
      <div class="collection-left-panel">
        <div class="collection-container">
          <header class="collection-header">
            <button class="back-button" data-menu-screen="${backScreen}" data-testid="back-to-menu">← 返回</button>
            <h2 class="collection-title">${escapeHtml(title)}</h2>
            <div class="collection-header-voucher" title="持有消費券">
              <span id="collection-vouchers"><span class="voucher-icon">券</span>${view.profile?.vouchers ?? 0}</span>
              ${accountMode ? `<button type="button" id="bulk-disenchant" class="bulk-disenchant-btn" title="一鍵分解所有超過 2 張的多餘卡牌" ${extraCopyEntries().length === 0 || view.cardOpBusy ? "disabled" : ""}>一鍵分解多餘卡</button>` : ""}
            </div>
          </header>
          <div class="collection-controls-bar">
            <span id="collection-progress">已收集卡片種類: ${ownedTotal}/${collectibles.length}</span>
            <label class="collection-select" aria-label="排序">
              <span>排序</span>
              <select id="collection-sort-select">
                ${collectionSortOptions().map((option) => `
                  <option value="${option.value}" ${view.collectionSort === option.value ? "selected" : ""}>${option.label}</option>
                `).join("")}
              </select>
            </label>
            <label class="collection-select" aria-label="分類篩選">
              <span>分類</span>
              <select id="collection-category-select">
                <option value="all" ${view.collectionCategory === "all" ? "selected" : ""}>全部分類</option>
                ${categories.map((category) => `
                  <option value="${escapeAttr(category)}" ${view.collectionCategory === category ? "selected" : ""}>${escapeHtml(category)}</option>
                `).join("")}
              </select>
            </label>
            <label class="collection-select" aria-label="稀有度篩選">
              <span>稀有度</span>
              <select id="collection-rarity-select">
                <option value="all" ${view.collectionRarity === "all" ? "selected" : ""}>全部稀有度</option>
                ${rarities.map((rarity) => `
                  <option value="${escapeAttr(rarity)}" ${view.collectionRarity === rarity ? "selected" : ""}>${escapeHtml(rarityLabel[rarity] ?? rarity)}</option>
                `).join("")}
              </select>
            </label>
            <label class="search-box" aria-label="搜尋卡牌">
              <input id="collection-search-input" value="${escapeAttr(view.collectionSearch)}" placeholder="搜尋卡牌名稱..." autocomplete="off" />
              <span class="search-icon">⌕</span>
            </label>
          </div>
          ${accountMode ? "" : `<p class="muted collection-note">登入後可查看收藏數量；目前顯示完整卡牌目錄。</p>`}
          <section class="collection-card-library" aria-label="卡牌庫">
            <label class="show-unowned-label">
              <input type="checkbox" id="show-unowned-checkbox" ${view.collectionFilter !== "owned" ? "checked" : ""} />
              顯示未擁有的卡牌
            </label>
            <div class="collection-grid" data-testid="collection-grid" data-preserve-scroll>
              ${filtered.length === 0 ? `<p class="muted collection-empty">沒有符合條件的卡牌。</p>` : filtered.map((card) => {
                const qty = collectionMap.get(card.id) ?? 0;
                return renderCollectionTile(card, qty, selectedCounts.get(card.id) ?? 0, selectedTotal);
              }).join("")}
            </div>
          </section>
        </div>
      </div>
      <aside class="collection-deck-column" aria-label="牌組">
        ${renderCollectionDeckColumnContent()}
      </aside>
      ${view.pinnedCollectionCardId ? renderPinnedCardDetail(view.pinnedCollectionCardId) : ""}
    </section>
  `;
}

function collectionSortOptions(): Array<{ value: CollectionSort; label: string }> {
  return [
    { value: "cost-asc", label: "費用低到高" },
    { value: "cost-desc", label: "費用高到低" },
    { value: "rarity", label: "稀有度" },
    { value: "name", label: "名稱" }
  ];
}

function uniqueCollectionCategories(cards: readonly CardDefinition[]): string[] {
  return [...new Set(cards.map((card) => card.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

function uniqueCollectionRarities(cards: readonly CardDefinition[]): string[] {
  return [...new Set(cards.map((card) => card.rarity))].sort((a, b) => rarityRank(a) - rarityRank(b));
}

function filterCollectionCards(cards: readonly CardDefinition[], collectionMap: Map<string, number>): CardDefinition[] {
  const search = view.collectionSearch.trim().toLowerCase();
  return cards
    .filter((card) => {
      const qty = collectionMap.get(card.id) ?? 0;
      if (view.collectionFilter === "owned" && qty <= 0) return false;
      if (view.collectionFilter === "missing" && qty > 0) return false;
      if (view.collectionCategory !== "all" && card.category !== view.collectionCategory) return false;
      if (view.collectionRarity !== "all" && card.rarity !== view.collectionRarity) return false;
      if (!search) return true;
      return (
        card.name.toLowerCase().includes(search) ||
        card.category.toLowerCase().includes(search) ||
        card.description.toLowerCase().includes(search)
      );
    })
    .sort(compareCollectionCards);
}

function compareCollectionCards(a: CardDefinition, b: CardDefinition): number {
  if (view.collectionSort === "cost-desc") return b.cost - a.cost || a.name.localeCompare(b.name, "zh-Hant");
  if (view.collectionSort === "rarity") return rarityRank(b.rarity) - rarityRank(a.rarity) || a.cost - b.cost || a.name.localeCompare(b.name, "zh-Hant");
  if (view.collectionSort === "name") return a.name.localeCompare(b.name, "zh-Hant");
  return a.cost - b.cost || a.name.localeCompare(b.name, "zh-Hant");
}

function rarityRank(rarity: string): number {
  if (rarity === "LEGENDARY") return 5;
  if (rarity === "EPIC") return 4;
  if (rarity === "RARE") return 3;
  if (rarity === "COMMON") return 2;
  return 1;
}

function renderCollectionTile(card: CardDefinition, quantity: number, selectedCount: number, selectedTotal: number): string {
  const owned = hasCollectionRows() ? quantity > 0 : true;
  const limit = deckCopyLimit(card);
  const effectiveOwned = hasCollectionRows() ? quantity : limit;
  const legendaryOk = canAddLegendary(card, view.editingDeck?.card_ids ?? []);
  const canAdd = Boolean(view.editingDeck) && owned && selectedTotal < 30 && selectedCount < limit && selectedCount < effectiveOwned && legendaryOk;
  const disabled = Boolean(view.editingDeck) && !canAdd;
  const resolved = resolveCatalogCard(card, `collection-${card.id}`);
  return `
    <button type="button" class="${classNames(["collection-card", "collection-tile", owned ? "owned" : "unowned", canAdd ? "can-add" : "cannot-add"])}" data-add-card="${escapeAttr(card.id)}" data-testid="collection-tile" title="${escapeAttr(card.description)}" ${disabled ? "disabled" : ""}>
      <span class="card-count-badge">x${quantity}</span>
      ${selectedCount > 0 ? `<span class="deck-count-badge">${selectedCount}/${limit}</span>` : ""}
      <div class="card rarity-${card.rarity.toLowerCase()}">
        ${renderCardFace(resolved, "mulligan")}
      </div>
    </button>
  `;
}

const VOUCHER_RATES: Record<string, { disenchant: number; craft: number }> = {
  COMMON: { disenchant: 20, craft: 50 },
  RARE: { disenchant: 60, craft: 200 },
  EPIC: { disenchant: 160, craft: 400 },
  LEGENDARY: { disenchant: 300, craft: 800 }
};

function voucherRate(rarity: string): { disenchant: number; craft: number } {
  return VOUCHER_RATES[rarity] ?? VOUCHER_RATES.COMMON;
}

function renderPinnedCardDetail(cardId: string): string {
  const card = cardCatalog.get(cardId);
  if (!card) return "";
  const resolved = resolveCatalogCard(card, `pinned-${card.id}`);
  const owned = view.collection.find((row) => row.card_id === cardId)?.quantity ?? 0;
  const vouchers = view.profile?.vouchers ?? 0;
  const rate = voucherRate(card.rarity);
  const collectible = card.collectible !== false;
  const accountReady = Boolean(view.session?.user);
  const busy = Boolean(view.cardOpBusy);
  const canDisenchant = accountReady && collectible && owned > 0 && !busy;
  const canCraft = accountReady && collectible && vouchers >= rate.craft && !busy;
  return `
    <div class="pinned-card-overlay" data-testid="pinned-card-overlay" id="pinned-card-overlay">
      <div class="pinned-card-content card-op-modal">
        <header class="card-op-header">
          <h3>${escapeHtml(card.name)}</h3>
          <button id="pinned-card-close" class="settings-close-btn" title="關閉" aria-label="關閉">✕</button>
        </header>
        <div class="card-op-body">
          <div class="card rarity-${resolved.rarity.toLowerCase()}">
            ${renderCardFace(resolved, "mulligan")}
          </div>
          <div class="card-op-side">
            <p class="card-op-count">擁有數量：<strong>${owned}</strong></p>
            ${collectible ? `
              <div class="card-op-actions">
                <button type="button" id="card-op-disenchant" class="card-op-btn disenchant" data-card-id="${escapeAttr(card.id)}" ${canDisenchant ? "" : "disabled"}>
                  <span class="card-op-label">分解</span>
                  <span class="card-op-value"><span class="voucher-icon">券</span>${rate.disenchant}</span>
                </button>
                <button type="button" id="card-op-craft" class="card-op-btn craft" data-card-id="${escapeAttr(card.id)}" ${canCraft ? "" : "disabled"}>
                  <span class="card-op-label">合成</span>
                  <span class="card-op-value"><span class="voucher-icon">券</span>${rate.craft}</span>
                </button>
              </div>
              <p class="card-op-hint muted">${accountReady ? `持有消費券：${vouchers}` : "登入後才能分解或合成卡牌。"}</p>
            ` : `<p class="card-op-hint muted">此卡牌無法分解或合成。</p>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderDeckEditorScreen(): string {
  return renderCollectionWorkspace("battle", "編輯牌組");
}

function computeMatchStats(): { wins: number; losses: number; draws: number; total: number } {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  const userId = view.session?.user?.id;
  for (const row of view.matchHistory) {
    const mySeatInRow: Seat | undefined =
      userId && row.player1_user_id === userId ? "player1"
      : userId && row.player2_user_id === userId ? "player2"
      : undefined;
    if (!row.winner_seat) {
      draws++;
      continue;
    }
    if (mySeatInRow && row.winner_seat === mySeatInRow) wins++;
    else if (mySeatInRow) losses++;
    else draws++;
  }
  const total = wins + losses + draws;
  return { wins, losses, draws, total };
}

function renderSavedDeck(deck: DeckRow): string {
  const selected = deck.id === view.selectedDeckId;
  const incomplete = deck.card_ids.length !== 30;
  return `
    <div class="deck-slot saved-deck ${selected ? "selected" : ""} ${incomplete ? "incomplete" : ""}">
      <button class="deck-select" data-select-deck="${escapeAttr(deck.id)}" ${incomplete ? `disabled title="牌組未滿 30 張，無法用於對戰"` : ""}>
        <h3>${escapeHtml(deck.name)}</h3>
        <span>${incomplete ? "⚠ " : ""}${deck.card_ids.length}/30 張</span>
      </button>
      <div class="deck-slot-actions">
        <button type="button" data-edit-deck="${escapeAttr(deck.id)}">編輯</button>
        <button type="button" class="danger btn-delete-deck" data-delete-deck="${escapeAttr(deck.id)}">×</button>
      </div>
    </div>
  `;
}

function renderCollectionDeckColumnContent(): string {
  const deck = view.editingDeck;
  const selectedTotal = deck?.card_ids.length ?? 0;
  return `
    <section class="deck-shelf">
      <div class="deck-shelf-heading">
        <h3>牌組</h3>
        <span>${view.decks.length} 組</span>
        <button type="button" id="new-deck" class="deck-shelf-new-btn">+ 新增</button>
      </div>
      <div class="deck-banner-list" data-testid="collection-deck-list" data-preserve-scroll>
        ${view.decks.map(renderCollectionDeckBanner).join("") || `<p class="muted deck-empty">尚未建立牌組。</p>`}
      </div>
    </section>
    ${deck ? `
      <form id="deck-form" class="collection-deck-editor">
        <div class="deck-editor-topline">
          ${renderDeckCoverThumb(deck)}
          <label class="deck-name-field">
            <span>牌組名稱</span>
            <input id="deck-name" value="${escapeAttr(deck.name)}" aria-label="Deck name" maxlength="40" />
          </label>
          <strong class="${selectedTotal === 30 ? "deck-complete" : "deck-count"}">${selectedTotal < 30 ? "⚠ " : ""}${selectedTotal}/30</strong>
        </div>
        <div class="deck-editor-actions">
          <button type="submit">儲存</button>
          <button type="button" id="edit-cover" ${deck.card_ids.length === 0 ? "disabled title='牌組需有卡片才能設定封面'" : ""}>編輯封面</button>
          <button type="button" id="autofill-deck">自動補滿</button>
          <button type="button" id="clear-deck">清空</button>
          ${deck.id ? `<button type="button" class="danger" data-delete-deck="${escapeAttr(deck.id)}">刪除</button>` : ""}
        </div>
        ${hasCollectionRows()
          ? ""
          : `<p class="muted deck-sync-note">收藏同步中；儲存時會再次確認持有數量。</p>`}
        <div class="deck-current-list" data-testid="deck-current-list" data-preserve-scroll>
          ${renderCurrentDeckCards(deck.card_ids)}
        </div>
      </form>
      ${view.coverPickerOpen ? renderCoverPicker(deck) : ""}
    ` : `
      <section class="collection-deck-editor deck-editor-placeholder">
        <p class="muted deck-empty">點選上方牌組開始編輯，或按「+ 新增」建立新牌組。</p>
      </section>
    `}
  `;
}

function renderDeckCoverThumb(deck: { cover_card_id?: string | null; card_ids: readonly string[] }): string {
  const coverCard = resolveDeckCoverCard(deck);
  const coverUrl = coverCard ? assetUrl(coverCard.image) : "/images/ui/collection_logo.webp";
  return `
    <button type="button" id="edit-cover-thumb" class="deck-cover-thumb" title="編輯封面" ${deck.card_ids.length === 0 ? "disabled" : ""}>
      <span class="deck-cover-thumb-art" style="background-image:url('${escapeAttr(coverUrl)}')"></span>
      <span class="deck-cover-thumb-label">封面</span>
    </button>
  `;
}

function renderCoverPicker(deck: { cover_card_id?: string | null; card_ids: readonly string[] }): string {
  const counts = countCards(deck.card_ids);
  const cards = [...counts.keys()]
    .map((id) => cardCatalog.get(id))
    .filter((card): card is CardDefinition => Boolean(card))
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, "zh-Hant"));
  const activeCover = resolveDeckCoverCard(deck)?.id;
  return `
    <div class="cover-picker-overlay" id="cover-picker-overlay" role="dialog" aria-modal="true" aria-label="編輯封面">
      <div class="cover-picker-modal parchment-card">
        <header class="settings-modal-header">
          <h3>選擇牌組封面</h3>
          <button type="button" id="cover-picker-close" class="settings-close-btn" title="關閉" aria-label="關閉">✕</button>
        </header>
        <div class="cover-picker-grid" data-preserve-scroll>
          ${cards.length === 0 ? `<p class="muted">牌組內沒有卡片。</p>` : cards.map((card) => `
            <button type="button" class="cover-picker-tile ${card.id === activeCover ? "selected" : ""}" data-cover-card="${escapeAttr(card.id)}" title="${escapeAttr(card.name)}">
              <span class="cover-picker-art" style="background-image:url('${escapeAttr(assetUrl(card.image))}')"></span>
              <span class="cover-picker-name">${escapeHtml(card.name)}</span>
            </button>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function resolveDeckCoverCard(deck: { cover_card_id?: string | null; card_ids: readonly string[] }): CardDefinition | undefined {
  if (deck.cover_card_id && deck.card_ids.includes(deck.cover_card_id)) {
    const explicit = cardCatalog.get(deck.cover_card_id);
    if (explicit) return explicit;
  }
  for (const id of deck.card_ids) {
    const card = cardCatalog.get(id);
    if (card) return card;
  }
  return undefined;
}

function renderCollectionDeckBanner(deck: DeckRow): string {
  const selected = deck.id === view.editingDeck?.id;
  const coverCard = resolveDeckCoverCard(deck);
  const coverUrl = coverCard ? assetUrl(coverCard.image) : "/images/ui/collection_logo.webp";
  const incomplete = deck.card_ids.length !== 30;
  return `
    <div class="deck-banner ${selected ? "selected" : ""}">
      <span class="deck-banner-art" style="background-image:url('${escapeAttr(coverUrl)}')"></span>
      <span class="deck-banner-main">
        <strong>${escapeHtml(deck.name)}</strong>
        <span>${incomplete ? "⚠ " : ""}${deck.card_ids.length}/30 張</span>
      </span>
      <div class="deck-banner-actions">
        <button type="button" class="deck-action-btn" data-edit-deck="${escapeAttr(deck.id)}">編輯</button>
        <button type="button" class="deck-action-btn danger" data-delete-deck="${escapeAttr(deck.id)}">刪除</button>
      </div>
    </div>
  `;
}

function renderCurrentDeckCards(cardIds: readonly string[]): string {
  if (cardIds.length === 0) return `<p class="muted deck-empty">從左側卡牌庫點選卡片加入牌組。</p>`;
  const counts = countCards(cardIds);
  const rows = [...counts.entries()]
    .map(([cardId, count]) => ({ card: cardCatalog.get(cardId), count }))
    .filter((row): row is { card: CardDefinition; count: number } => Boolean(row.card))
    .sort((a, b) => a.card.cost - b.card.cost || a.card.name.localeCompare(b.card.name, "zh-Hant"));
  return rows.map(({ card, count }) => `
    <div class="deck-current-row">
      <span class="deck-row-cost">${card.cost}</span>
      <span class="deck-row-art" style="background-image:url('${escapeAttr(assetUrl(card.image))}')"></span>
      <span class="deck-row-name">${escapeHtml(card.name)}</span>
      <span class="deck-row-count">x${count}</span>
      <button type="button" data-remove-card="${escapeAttr(card.id)}" title="移除">-</button>
    </div>
  `).join("");
}

function renderMatchHistoryRow(row: MatchHistoryRow): string {
  const finished = row.finished_at ? new Date(row.finished_at).toLocaleString() : row.id;
  const userId = view.session?.user?.id;
  const mySeatInRow: Seat | undefined =
    userId && row.player1_user_id === userId ? "player1"
    : userId && row.player2_user_id === userId ? "player2"
    : undefined;
  const outcome = !row.winner_seat ? "draw"
    : mySeatInRow && row.winner_seat === mySeatInRow ? "win"
    : mySeatInRow ? "loss"
    : "info";
  const label = outcome === "win" ? "勝" : outcome === "loss" ? "敗" : outcome === "draw" ? "平局" : (row.winner_seat ?? "—");
  return `
    <div class="history-row outcome-${outcome}">
      <strong class="history-outcome">${escapeHtml(label)}</strong>
      <span class="history-reason">${escapeHtml(row.result_reason)}</span>
      <small>${escapeHtml(finished)}</small>
    </div>
  `;
}

function renderGame(status: GameStatus | ""): string {
  const me = view.mySeat;
  const opponent = me ? otherSeat(me) : "player2";
  const opponentPlayer = readPlayer(opponent);
  const myPlayer = readPlayer(me ?? "player1");
  const activeSeat = readActiveSeat();
  const selectedCard = selectedHandCard();
  const targetHint = selectedCard
    ? cardNeedsTarget(selectedCard.cardId)
      ? view.selectedTarget
        ? `Target: ${targetLabel(view.selectedTarget)}`
        : "Choose target"
      : "Ready to play"
    : view.selectedAttackerId
      ? view.selectedTarget
        ? `Target: ${targetLabel(view.selectedTarget)}`
        : "Choose attack target"
      : "No selection";
  const hasCardPlayFocus = view.animationCues.some((cue) => cue.kind === "play");

  return `
    <section class="topbar battle-e2e-topbar" aria-hidden="true">
      <p>Seat: ${escapeHtml(view.mySeat ?? "none")}</p>
    </section>
    <section class="status battle-debug-status" data-testid="match-status">
      <span>Status: ${escapeHtml(status || "waiting")}</span>
      <span>Turn: ${readTurnNumber()}</span>
      <span>Active: ${escapeHtml(activeSeat || "none")}</span>
      <span>${escapeHtml(targetHint)}</span>
    </section>
    <section class="battle-surface ${view.animationCues.length ? "has-event-cues" : ""} ${hasCardPlayFocus ? "has-card-play-focus" : ""}" data-testid="battle-surface">
      ${renderBattleHistoryPanel()}
      ${renderConnectionBanner()}
      ${renderPlayerArea(opponent, opponentPlayer, "opponent")}
      ${renderCenterLine(activeSeat, opponentPlayer, myPlayer)}
      ${renderPlayerArea(me ?? "player1", myPlayer, "player")}
      ${renderBattlePlayerInfo(myPlayer)}
      ${renderEventCues()}
      ${renderMulliganOverlay(status)}
      ${renderResultOverlay(status)}
      ${view.settingsOpen ? renderSettingsModal() : ""}
      ${view.battleDeckOpen ? renderBattleDeckModal() : ""}
      ${renderConcedeModal()}
    </section>
  `;
}

function renderBattleHistoryPanel(): string {
  return `
    <section id="match-history-panel" class="log battle-history-panel" data-testid="event-log" data-preserve-scroll>
      <div class="history-tab" aria-hidden="true">▤</div>
      <div class="history-content">
        <div class="history-header">戰鬥紀錄</div>
        <div id="history-list">
          ${view.events.map(renderEventLine).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderBattlePlayerInfo(player: PublicPlayer | undefined): string {
  const displayName = player?.displayName || view.profile?.display_name || "玩家";
  return `
    <aside class="player-info-card battle-player-info">
      <div class="player-details">
        <div class="player-username">${escapeHtml(displayName)}</div>
        <div class="player-title">無稱號</div>
      </div>
    </aside>
  `;
}

function renderConnectionBanner(): string {
  if (!view.room || hasBothPlayers()) return "";
  const codePart = view.privateJoinCode
    ? ` · Room code: <code class="private-code">${escapeHtml(view.privateJoinCode)}</code>`
    : "";
  return `<div class="match-banner waiting" data-testid="private-code-banner">Waiting for opponent${codePart}</div>`;
}

function renderPlayerArea(seat: Seat, player: PublicPlayer | undefined, role: "player" | "opponent"): string {
  const isMe = seat === view.mySeat;
  const active = readActiveSeat() === seat;
  const board = Array.from(player?.board ?? []);
  const connected = player?.connected ?? true;
  const handCount = role === "player" ? view.hand.length : player?.handCount ?? 0;
  const areaClasses = classNames(["player-area", "player", role, isMe && "me", active && "active-turn", !connected && "disconnected"]);
  const boardClasses = classNames(["board", activeTargeting() && "targeting-board"]);

  return `
    <section class="${areaClasses}" data-seat="${seat}" data-testid="${role}-area">
      ${role === "opponent" ? renderOpponentHand(handCount) : ""}
      ${renderHero(seat, player, role)}
      <div class="status-cluster">
        ${renderMana(player?.mana?.current ?? 0, player?.mana?.max ?? 0, role)}
      </div>
      <div class="${boardClasses}" data-testid="${role}-board">
        ${board.map((minion) => renderMinion(seat, minion)).join("") || renderEmptySlots()}
      </div>
      ${role === "player" ? renderPlayerHand() : ""}
      ${!connected ? `<div class="disconnect-pill">Reconnecting</div>` : ""}
    </section>
  `;
}

function renderHero(seat: Seat, player: PublicPlayer | undefined, role: "player" | "opponent"): string {
  const target = targetAttr({ type: "HERO", side: seat });
  const hp = player?.hero?.hp ?? 0;
  const maxHp = player?.hero?.maxHp ?? 0;
  const name = player?.displayName || seat;
  const targetRef: TargetRef = { type: "HERO", side: seat };
  const targetKey = targetKeyFor(targetRef);
  const heroClasses = classNames([
    "hero",
    role === "player" ? "player-hero" : "opponent-hero",
    isTargetHighlighted(targetRef) && "valid-target",
    sameTarget(view.selectedTarget, targetRef) && "target-selected",
    hasCue(targetKey, "damage") && "taking-damage",
    hasCue(targetKey, "heal") && "receiving-heal"
  ]);

  return `
    <button class="${heroClasses}" data-target='${target}' data-target-key="${escapeAttr(targetKey)}" data-testid="${role}-hero" data-seat="${seat}" aria-label="${escapeAttr(name)} ${hp}/${maxHp}">
      <span class="avatar" aria-hidden="true"></span>
      <strong>${escapeHtml(name)}</strong>
      <span class="hero-hp">${hp}/${maxHp}</span>
      <span class="hero-mana">Mana ${player?.mana?.current ?? 0}/${player?.mana?.max ?? 0}</span>
      <span class="hero-meta">Hand ${player?.handCount ?? 0} - Deck ${player?.deckCount ?? 0}</span>
    </button>
  `;
}

function renderMana(current: number, max: number, role: "player" | "opponent"): string {
  const crystals = Array.from({ length: 10 }, (_, index) => {
    const crystalClass = index < current ? `mana-crystal ${role}-crystal active` : index < max ? "mana-crystal spent" : "mana-crystal locked";
    return `<span class="${crystalClass}" aria-hidden="true"></span>`;
  }).join("");

  return `
    <div class="mana-container frame-style" data-testid="${role}-mana">
      ${crystals}
      <span class="mana-text">${current}/${max}</span>
    </div>
  `;
}

function renderOpponentHand(count: number): string {
  return `
    <div class="hand opponent-hand" data-testid="opponent-hand">
      ${Array.from({ length: count }, (_, index) => `<span class="card card-back" style="${opponentFanStyle(index, count)}"></span>`).join("")}
    </div>
  `;
}

function renderPlayerHand(): string {
  return `
    <section class="hand" data-testid="player-hand">
      <div class="hand-row">
        ${view.hand.map((card, index) => renderHandCard(card, index, view.hand.length)).join("") || `<div class="muted">Waiting for private hand sync.</div>`}
      </div>
    </section>
  `;
}

function renderHandCard(card: HandCardView, index: number, total: number): string {
  const resolved = resolveHandCard(card);
  const selected = view.selectedHandId === card.instanceId;
  const mulliganSelected = view.mulliganSelection.has(card.instanceId);
  const playable = canAfford(card.cost);
  const needsTarget = cardNeedsTarget(card.cardId);
  const rejected = view.rejectedHandIds.has(card.instanceId);
  const e2eType = view.rejectedHandIds.has(card.instanceId) ? "REJECTED_CARD" : card.type;
  const classes = classNames([
    "card",
    `rarity-${resolved.rarity.toLowerCase()}`,
    selected && "selected",
    mulliganSelected && "mulligan-selected",
    playable && "can-play",
    needsTarget && "needs-target",
    rejected && "rejected-card"
  ]);

  return `
    <button
      class="${classes}"
      style="${fanStyle(index, total)}"
      data-hand-id="${escapeAttr(card.instanceId)}"
      data-card-type="${escapeAttr(card.type)}"
      data-e2e-card-type="${escapeAttr(e2eType)}"
      data-cost="${card.cost}"
      data-needs-target="${needsTarget ? "true" : "false"}"
      data-testid="hand-card"
      aria-pressed="${selected ? "true" : "false"}"
    >
      ${renderCardFace(resolved, "hand")}
      <span class="sr-e2e">Cost ${card.cost} ${e2eType}${card.attack !== undefined ? ` ${card.attack}/${card.health}` : ""}</span>
    </button>
  `;
}

function renderMinion(seat: Seat, minion: PublicMinion): string {
  const catalogCard = cardCatalog.get(minion.cardId);
  const attackClass = classNames(["stat-atk", valueDeltaClass(minion.attack, minion.baseAttack ?? catalogCard?.attack)]);
  const healthClass = classNames(["stat-hp", valueDeltaClass(minion.currentHealth, minion.health)]);
  const target: TargetRef = { type: "MINION", side: seat, instanceId: minion.instanceId };
  const mine = seat === view.mySeat;
  const targetKey = targetKeyFor(target);
  const classes = classNames([
    "minion",
    minion.taunt && "taunt",
    minion.divineShield && "shielded",
    minion.canAttack ? "can-attack" : "sleeping",
    minion.isEnraged && "enraged",
    selectedMinionClass(minion.instanceId, target),
    isTargetHighlighted(target) && "valid-target",
    hasCue(targetKey, "damage") && "taking-damage",
    hasCue(targetKey, "heal") && "receiving-heal",
    hasCue(targetKey, "buff") && "receiving-buff",
    hasCue(targetKey, "summon") && "summoning",
    hasCue(targetKey, "destroy") && "being-destroyed"
  ]);

  return `
    <button
      class="${classes}"
      ${mine ? `data-attacker-id="${escapeAttr(minion.instanceId)}"` : ""}
      data-target='${targetAttr(target)}'
      data-card-type="MINION"
      data-cost="${catalogCard?.cost ?? 0}"
      data-seat="${seat}"
      data-target-key="${escapeAttr(targetKey)}"
      data-testid="board-minion"
      aria-pressed="${view.selectedAttackerId === minion.instanceId || sameTarget(view.selectedTarget, target) ? "true" : "false"}"
    >
      <div class="minion-art" style="background-image: url('${escapeAttr(assetUrl(catalogCard?.image ?? ""))}')"></div>
      <strong class="card-title">${escapeHtml(catalogCard?.name ?? minion.cardId)}</strong>
      <small class="keyword-row">${minionKeywords(minion).join(" ")}</small>
      <div class="minion-stats">
        <span class="${attackClass}"><span>${minion.attack}</span></span>
        <span class="${healthClass}">${minion.currentHealth}</span>
      </div>
      <span class="sr-e2e">${minion.canAttack ? "ready" : ""} ${minion.taunt ? "taunt" : ""}</span>
    </button>
  `;
}

function renderCardFace(card: ResolvedCardView, _size?: "hand" | "mulligan"): string {
  const costClass = classNames(["card-cost", valueDeltaClass(card.cost, card.baseCost)]);
  const attackClass = classNames(["stat-atk", valueDeltaClass(card.attack, card.baseAttack)]);
  const healthClass = classNames(["stat-hp", valueDeltaClass(card.health, card.baseHealth)]);
  return `
    <span class="${costClass}"><span>${card.cost}</span></span>
    <strong class="card-title">${escapeHtml(card.name)}</strong>
    <img class="card-art-box" src="${escapeAttr(assetUrl(card.image))}" alt="" loading="lazy" />
    <span class="card-category">${escapeHtml(card.category)}</span>
    <span class="card-desc">${escapeHtml(card.description)}</span>
    ${
      card.type === "MINION"
        ? `<span class="minion-stats"><span class="${attackClass}"><span>${card.attack ?? 0}</span></span><span class="${healthClass}">${card.health ?? 0}</span></span>`
        : ""
    }
  `;
}

function valueDeltaClass(value: number | undefined, base: number | undefined): string {
  if (value === undefined || base === undefined) return "";
  if (value < base) return "stat-lower";
  if (value > base) return "stat-higher";
  return "";
}

function resolveCatalogCard(card: CardDefinition, instanceId: string): ResolvedCardView {
  return {
    cardId: card.id,
    instanceId,
    name: card.name,
    category: card.category,
    description: card.description,
    image: card.image,
    cost: card.cost,
    baseCost: card.cost,
    type: card.type,
    rarity: card.rarity,
    attack: card.attack,
    baseAttack: card.attack,
    health: card.health,
    baseHealth: card.health
  };
}

function renderCenterLine(activeSeat: Seat | "", opponentPlayer?: PublicPlayer, myPlayer?: PublicPlayer): string {
  const isMyTurn = activeSeat && activeSeat === view.mySeat;
  const selectedCard = selectedHandCard();
  const selectedNeedsTarget = selectedCard ? cardNeedsTarget(selectedCard.cardId) : false;
  const canPlay = Boolean(selectedCard && canAfford(selectedCard.cost) && (!selectedNeedsTarget || view.selectedTarget));
  const canAttack = Boolean(view.selectedAttackerId && view.selectedTarget && isLegalAttackTarget(view.selectedTarget));
  const primaryLabel = selectedCard ? (selectedNeedsTarget && !view.selectedTarget ? "Choose Target" : "Play Selected") : "Play Selected";

  return `
    <section class="center-line controls">
      <button id="battle-settings-toggle" class="battle-gear-btn" data-testid="battle-settings" title="設定" aria-label="設定">⚙</button>
      ${renderBattleSettingsMenu()}
      <div id="turn-indicator">Turn: ${readTurnNumber()}</div>
      <div class="turn-stack">
        <span id="indicator-opp" class="turn-light ${activeSeat === otherSeat(view.mySeat ?? "player1") ? "active" : ""}">Opponent</span>
        <span id="indicator-player" class="turn-light ${isMyTurn ? "active" : ""}">${isMyTurn ? "Your Turn" : "Waiting"}</span>
      </div>
      <div class="end-turn-group">
        <div class="deck-pile battle-deck-pile opponent-deck" title="Opponent deck">
          <span class="count-badge">${opponentPlayer?.deckCount ?? 0}</span>
        </div>
        <button id="end-turn" class="end-turn-btn" ${view.room ? "" : "disabled"} data-testid="end-turn">結束回合</button>
        <div class="deck-pile battle-deck-pile player-deck" title="Player deck">
          <span class="count-badge">${myPlayer?.deckCount ?? 0}</span>
        </div>
      </div>
      <div class="legacy-hidden-actions" aria-hidden="true">
        <button id="play" ${canPlay ? "" : "disabled"} data-testid="play-selected">${primaryLabel}</button>
        <button id="attack" ${canAttack ? "" : "disabled"} data-testid="attack-target">Attack Target</button>
      </div>
    </section>
  `;
}

function renderBattleSettingsMenu(): string {
  if (!view.battleSettingsOpen) return "";
  return `
    <div id="battle-settings-menu" class="battle-settings-menu" role="menu" aria-label="遊戲設定">
      <div class="battle-settings-title">遊戲設定</div>
      <button id="battle-view-deck" class="battle-settings-item" type="button" role="menuitem">
        <span class="menu-icon">📋</span>
        <span>查看牌組</span>
      </button>
      <button id="battle-audio-settings" class="battle-settings-item" type="button" role="menuitem">
        <span class="menu-icon">🔊</span>
        <span>音效選項</span>
      </button>
      <button id="concede" class="battle-settings-item danger" type="button" role="menuitem" data-testid="concede">
        <span class="menu-icon">⚑</span>
        <span>投降</span>
      </button>
    </div>
  `;
}

function renderBattleDeckModal(): string {
  const deck = resolveBattleDeckView();
  return `
    <section id="battle-deck-backdrop" class="battle-deck-backdrop" role="dialog" aria-modal="true" aria-label="查看牌組">
      <div class="battle-deck-modal parchment-card">
        <header class="settings-modal-header">
          <h3>${escapeHtml(deck.name)}</h3>
          <button id="battle-deck-close" class="settings-close-btn" title="關閉" aria-label="關閉">✕</button>
        </header>
        <div class="battle-deck-summary">${deck.cardIds.length}/30 張</div>
        <div class="battle-deck-list" data-preserve-scroll>
          ${renderBattleDeckRows(deck.cardIds)}
        </div>
      </div>
    </section>
  `;
}

function resolveBattleDeckView(): { name: string; cardIds: string[] } {
  const selectedDeck = view.selectedDeckId ? view.decks.find((deck) => deck.id === view.selectedDeckId) : undefined;
  if (selectedDeck) return { name: selectedDeck.name, cardIds: [...selectedDeck.card_ids] };
  return { name: "預設牌組", cardIds: defaultBattleDeckIds() };
}

function defaultBattleDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

function renderBattleDeckRows(cardIds: readonly string[]): string {
  const rows = [...countCards(cardIds).entries()]
    .map(([cardId, count]) => ({ card: cardCatalog.get(cardId), count }))
    .filter((row): row is { card: CardDefinition; count: number } => Boolean(row.card))
    .sort((a, b) => a.card.cost - b.card.cost || a.card.name.localeCompare(b.card.name, "zh-Hant"));

  if (rows.length === 0) return `<p class="muted deck-empty">目前沒有可顯示的牌組。</p>`;

  return rows.map(({ card, count }) => `
    <button type="button" class="battle-deck-row rarity-${card.rarity.toLowerCase()}" data-hover-card-id="${escapeAttr(card.id)}">
      <span class="battle-deck-cost">${card.cost}</span>
      <span class="battle-deck-name">${escapeHtml(card.name)}</span>
      <span class="battle-deck-category">${escapeHtml(card.category)}</span>
      <span class="battle-deck-count">x${count}</span>
    </button>
  `).join("");
}

function renderMulliganOverlay(status: GameStatus | ""): string {
  if (status !== "mulligan" || !view.room) return "";
  const ready = Boolean(view.mySeat && readPlayer(view.mySeat)?.mulliganReady);
  const selectedCount = view.mulliganSelection.size;

  return `
    <section id="mulligan-modal" class="mulligan-overlay ${ready ? "submitted" : ""}" data-testid="mulligan-overlay">
      <div class="mulligan-content">
        <h2>起手的手牌</h2>
        <p>${ready ? "等待對手完成換牌..." : "保留或更換卡牌"}</p>
        <div class="mulligan-card-area">
          ${view.hand.map((card) => renderMulliganCard(card, ready)).join("")}
        </div>
        <button id="mulligan" ${ready ? "disabled" : ""} data-testid="mulligan-confirm">
          ${ready ? "等待中" : `確定${selectedCount ? ` (${selectedCount})` : ""}`}
        </button>
      </div>
    </section>
  `;
}

function renderMulliganCard(card: HandCardView, disabled: boolean): string {
  const resolved = resolveHandCard(card);
  const selected = view.mulliganSelection.has(card.instanceId);
  return `
    <button
      class="card mulligan-card ${selected ? "selected" : ""}"
      data-mulligan-id="${escapeAttr(card.instanceId)}"
      data-card-type="${escapeAttr(card.type)}"
      data-cost="${card.cost}"
      ${disabled ? "disabled" : ""}
    >
      ${renderCardFace(resolved, "mulligan")}
      ${selected ? `<span class="mulligan-replace-tag">替換</span>` : ""}
      <span class="sr-e2e">Cost ${card.cost} ${card.type}</span>
    </button>
  `;
}

function renderResultOverlay(status: GameStatus | ""): string {
  if (status !== "finished" && status !== "abandoned") return "";
  const winnerSeat = view.publicSync?.result?.winnerSeat || view.state?.resultWinnerSeat || view.state?.result?.winnerSeat;
  const reason = view.publicSync?.result?.reason || view.state?.resultReason || view.state?.result?.reason || status;
  const won = winnerSeat && winnerSeat === view.mySeat;
  const title = status === "abandoned" ? "Match Abandoned" : won ? "Victory" : winnerSeat ? "Defeat" : "Game Finished";

  return `
    <section class="result-overlay" data-testid="result-overlay">
      <div class="result-content">
        <h2 class="result-text">${escapeHtml(title)}</h2>
        <p>${escapeHtml(reason)}</p>
        <button id="back-to-lobby" data-testid="back-to-lobby">Back to Lobby</button>
      </div>
    </section>
  `;
}

function renderEventCues(): string {
  if (view.animationCues.length === 0) return "";
  const hasCardPlayFocus = view.animationCues.some((cue) => cue.kind === "play");
  return `
    <div class="event-layer" data-testid="event-layer" aria-hidden="true">
      ${hasCardPlayFocus ? `<div class="event-focus-backdrop"></div>` : ""}
      ${view.animationCues.map(renderEventCue).join("")}
    </div>
  `;
}

function renderEventCue(cue: AnimationCue): string {
  const card = cue.cardId ? cardCatalog.get(cue.cardId) : undefined;
  if (cue.kind === "play" && card) {
    return `
      <div class="event-card-preview card ${cue.seat === view.mySeat ? "from-player" : "from-opponent"}">
        ${renderCardFace(resolveCatalogCard(card, cue.id), "mulligan")}
      </div>
    `;
  }
  if (cue.kind === "attackerMoves") {
    return "";
  }
  if (cue.kind === "summon") {
    return "";
  }
  if (cue.kind === "damage" || cue.kind === "heal") {
    if (!cue.targetKey || cue.amount === undefined) return "";
    const sign = cue.kind === "damage" ? "-" : "+";
    return `<div class="float-number ${cue.kind}" data-cue-id="${escapeAttr(cue.id)}" data-anchor-key="${escapeAttr(cue.targetKey)}" data-testid="float-number">${sign}${cue.amount}</div>`;
  }
  if (cue.kind === "destroy") {
    if (!cue.targetKey) return "";
    const particles = particleSpread(cue.id);
    return `<div class="death-burst" data-cue-id="${escapeAttr(cue.id)}" data-anchor-key="${escapeAttr(cue.targetKey)}" data-testid="death-burst">${particles}</div>`;
  }
  return `<div class="event-cue event-${cue.kind}">${escapeHtml(cue.text)}</div>`;
}

function particleSpread(seed: string): string {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const spans: string[] = [];
  for (let i = 0; i < 8; i++) {
    hash = Math.imul(hash ^ (i + 1), 2654435761) >>> 0;
    const angle = ((hash >>> 0) % 360) * (Math.PI / 180);
    const distance = 40 + ((hash >>> 8) % 30);
    const dx = Math.round(Math.cos(angle) * distance);
    const dy = Math.round(Math.sin(angle) * distance);
    spans.push(`<span style="--dx:${dx}px;--dy:${dy}px"></span>`);
  }
  return spans.join("");
}

function renderToast(): string {
  if (!view.toast) return "";
  return `<div class="toast show" data-testid="toast">${escapeHtml(view.toast)}</div>`;
}

function renderHoverTooltip(): string {
  if ((!view.hoveredCardId && !view.hoveredCard) || !view.hoverAnchor) return "";
  const catalogCard = view.hoveredCardId ? cardCatalog.get(view.hoveredCardId) : undefined;
  const resolved = view.hoveredCard ?? (catalogCard ? resolveCatalogCard(catalogCard, `tooltip-${catalogCard.id}`) : undefined);
  if (!resolved) return "";
  const margin = 16;
  const tooltipWidth = 224;
  const approxHeight = 322;
  const anchorLeft = view.hoverAnchor.x - view.hoverAnchor.width / 2;
  const anchorRight = view.hoverAnchor.x + view.hoverAnchor.width / 2;
  const roomOnRight = window.innerWidth - anchorRight - margin;
  const roomOnLeft = anchorLeft - margin;
  let left = anchorRight + margin;
  if (roomOnRight < tooltipWidth && roomOnLeft > roomOnRight) {
    left = anchorLeft - tooltipWidth - margin;
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));
  let top = view.hoverAnchor.y - approxHeight / 2;
  top = Math.max(margin, Math.min(top, window.innerHeight - approxHeight - margin));
  return `
    <div class="hover-tooltip" data-testid="hover-tooltip" style="left:${left}px;top:${top}px">
      <div class="card rarity-${resolved.rarity.toLowerCase()}">
        ${renderCardFace(resolved)}
      </div>
    </div>
  `;
}

function renderConcedeModal(): string {
  if (!view.confirmingConcede) return "";
  return `
    <section class="confirm-overlay" data-testid="concede-overlay">
      <div class="confirm-content">
        <h3>Concede this match?</h3>
        <div class="confirm-actions">
          <button id="concede-cancel" data-testid="concede-cancel">Stay</button>
          <button id="concede-confirm" class="danger" data-testid="concede-confirm">Concede</button>
        </div>
      </div>
    </section>
  `;
}

function themedConfirm(options: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    view.confirmDialog = {
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? "確定",
      cancelLabel: options.cancelLabel ?? "取消",
      danger: options.danger,
      resolve
    };
    render();
  });
}

function settleConfirmDialog(ok: boolean): void {
  const dialog = view.confirmDialog;
  if (!dialog) return;
  view.confirmDialog = undefined;
  dialog.resolve(ok);
  render();
}

function renderConfirmDialog(): string {
  const dialog = view.confirmDialog;
  if (!dialog) return "";
  return `
    <section class="confirm-overlay" id="themed-confirm-overlay" role="dialog" aria-modal="true">
      <div class="confirm-content">
        <h3>${escapeHtml(dialog.title)}</h3>
        ${dialog.message ? `<p class="confirm-message">${escapeHtml(dialog.message)}</p>` : ""}
        <div class="confirm-actions">
          <button id="themed-confirm-cancel">${escapeHtml(dialog.cancelLabel)}</button>
          <button id="themed-confirm-ok" class="${dialog.danger ? "danger" : ""}">${escapeHtml(dialog.confirmLabel)}</button>
        </div>
      </div>
    </section>
  `;
}

function renderEventLine(event: GameEvent): string {
  const payload = event.payload ? ` ${JSON.stringify(event.payload)}` : "";
  return `<p>${escapeHtml(`${event.type}#${event.seq ?? "?"}${payload}`)}</p>`;
}

function renderEmptySlots(): string {
  return Array.from({ length: 7 }, () => `<div class="slot" aria-hidden="true"></div>`).join("");
}

function bindStaticActions(): void {
  document.querySelector<HTMLButtonElement>("#themed-confirm-ok")?.addEventListener("click", () => settleConfirmDialog(true));
  document.querySelector<HTMLButtonElement>("#themed-confirm-cancel")?.addEventListener("click", () => settleConfirmDialog(false));
  document.querySelector<HTMLElement>("#themed-confirm-overlay")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) settleConfirmDialog(false);
  });
  document.querySelector<HTMLFormElement>("#join-form")?.addEventListener("submit", joinRoom);
  document.querySelector<HTMLFormElement>("#auth-form")?.addEventListener("submit", (event) => void signInWithPassword(event));
  document.querySelector<HTMLButtonElement>("#sign-up")?.addEventListener("click", () => void signUpWithPassword());
  document.querySelector<HTMLButtonElement>("#google-sign-in")?.addEventListener("click", () => void signInWithGoogle());
  document.querySelector<HTMLButtonElement>("#sign-out")?.addEventListener("click", () => void signOut());
  document.querySelector<HTMLButtonElement>("#refresh-account")?.addEventListener("click", () => void loadAccountData());
  document.querySelector<HTMLButtonElement>("#sync-collection")?.addEventListener("click", () => void syncCollection());
  document.querySelector<HTMLButtonElement>("#new-deck")?.addEventListener("click", () => {
    beginNewDeck();
  });
  document.querySelector<HTMLButtonElement>("#autofill-deck")?.addEventListener("click", autofillDeck);
  document.querySelector<HTMLButtonElement>("#clear-deck")?.addEventListener("click", clearDeck);
  document.querySelector<HTMLInputElement>("#deck-name")?.addEventListener("input", (event) => {
    if (!view.editingDeck) return;
    view.editingDeck = { ...view.editingDeck, name: (event.currentTarget as HTMLInputElement).value };
  });
  document.querySelector<HTMLFormElement>("#deck-form")?.addEventListener("submit", (event) => void saveEditingDeck(event));
  document.querySelector<HTMLButtonElement>("#mulligan")?.addEventListener("click", () => {
    send({ type: "submitMulligan", replaceHandInstanceIds: [...view.mulliganSelection] });
    view.mulliganSelection.clear();
    render();
  });
  document.querySelector<HTMLButtonElement>("#play")?.addEventListener("click", () => {
    if (!view.selectedHandId) return;
    const selectedCard = view.hand.find((card) => card.instanceId === view.selectedHandId);
    send({ type: "playCard", handInstanceId: view.selectedHandId, target: view.selectedTarget ?? inferDefaultTarget(selectedCard?.cardId) });
  });
  document.querySelector<HTMLButtonElement>("#attack")?.addEventListener("click", () => {
    if (!view.selectedAttackerId || !view.selectedTarget) return;
    send({ type: "attack", attackerInstanceId: view.selectedAttackerId, target: view.selectedTarget });
  });
  document.querySelector<HTMLButtonElement>("#end-turn")?.addEventListener("click", () => send({ type: "endTurn" }));
  document.querySelector<HTMLButtonElement>("#battle-settings-toggle")?.addEventListener("click", () => {
    view.battleSettingsOpen = !view.battleSettingsOpen;
    clearHoverTooltip();
    render();
  });
  document.querySelector<HTMLButtonElement>("#battle-view-deck")?.addEventListener("click", () => {
    view.battleDeckOpen = true;
    view.battleSettingsOpen = false;
    render();
  });
  document.querySelector<HTMLButtonElement>("#battle-audio-settings")?.addEventListener("click", () => {
    view.settingsOpen = true;
    view.battleSettingsOpen = false;
    render();
  });
  document.querySelector<HTMLButtonElement>("#concede")?.addEventListener("click", () => {
    view.battleSettingsOpen = false;
    view.confirmingConcede = true;
    clearHoverTooltip();
    render();
  });
  document.querySelector<HTMLButtonElement>("#concede-cancel")?.addEventListener("click", () => {
    view.confirmingConcede = false;
    render();
  });
  document.querySelector<HTMLButtonElement>("#concede-confirm")?.addEventListener("click", () => {
    view.confirmingConcede = false;
    send({ type: "concede" });
    render();
  });
  document.querySelector<HTMLButtonElement>("#battle-deck-close")?.addEventListener("click", () => {
    view.battleDeckOpen = false;
    clearHoverTooltip();
    render();
  });
  document.querySelector<HTMLElement>("#battle-deck-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      view.battleDeckOpen = false;
      clearHoverTooltip();
      render();
    }
  });
  document.querySelector<HTMLButtonElement>("#back-to-lobby")?.addEventListener("click", () => void backToLobby());

  for (const el of document.querySelectorAll<HTMLElement>("[data-select-deck]")) {
    el.addEventListener("click", () => {
      view.selectedDeckId = el.dataset.selectDeck;
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-edit-deck]")) {
    el.addEventListener("click", () => {
      const deck = view.decks.find((item) => item.id === el.dataset.editDeck);
      if (deck) {
        view.selectedDeckId = deck.id;
        view.editingDeck = { ...deck, card_ids: [...deck.card_ids] };
      }
      if (view.menuScreen === "battle") view.menuScreen = "deckEditor";
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-delete-deck]")) {
    el.addEventListener("click", () => void deleteDeck(el.dataset.deleteDeck));
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-add-card]")) {
    el.addEventListener("click", () => {
      if (view.editingDeck) {
        addCardToEditor(el.dataset.addCard);
      } else {
        view.pinnedCollectionCardId = el.dataset.addCard;
        render();
      }
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-remove-card]")) {
    el.addEventListener("click", () => removeCardFromEditor(el.dataset.removeCard));
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-menu-screen]")) {
    el.addEventListener("click", () => {
      const target = el.dataset.menuScreen as MenuScreen | undefined;
      if (!target) return;
      navigateToScreen(target);
    });
  }
  document.querySelector<HTMLButtonElement>("#find-match")?.addEventListener("click", () => void startMatchmaking());
  document.querySelector<HTMLButtonElement>("#matchmaking-cancel")?.addEventListener("click", () => void cancelMatchmaking());
  document.querySelector<HTMLFormElement>("#profile-form")?.addEventListener("submit", (event) => void saveProfile(event));
  document.querySelector<HTMLButtonElement>("#open-avatar-picker")?.addEventListener("click", () => {
    view.avatarPickerOpen = !view.avatarPickerOpen;
    render();
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-pick-avatar]")) {
    el.addEventListener("click", () => void pickAvatar(el.dataset.pickAvatar));
  }
  document.querySelector<HTMLInputElement>("#show-unowned-checkbox")?.addEventListener("change", (event) => {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    view.collectionFilter = checked ? "all" : "owned";
    render();
  });
  document.querySelector<HTMLSelectElement>("#collection-sort-select")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value as CollectionSort;
    view.collectionSort = value;
    render();
  });
  document.querySelector<HTMLSelectElement>("#collection-category-select")?.addEventListener("change", (event) => {
    view.collectionCategory = (event.currentTarget as HTMLSelectElement).value;
    render();
  });
  document.querySelector<HTMLSelectElement>("#collection-rarity-select")?.addEventListener("change", (event) => {
    view.collectionRarity = (event.currentTarget as HTMLSelectElement).value;
    render();
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-lb-sort]")) {
    el.addEventListener("click", () => {
      const value = el.dataset.lbSort as "wins" | "level" | undefined;
      if (!value) return;
      view.leaderboardSortBy = value;
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-view-player-profile]")) {
    el.addEventListener("click", () => {
      const userId = el.dataset.viewPlayerProfile;
      if (userId) openPublicPlayerProfile(userId);
    });
  }
  document.querySelector<HTMLElement>("#public-profile-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      view.publicPlayerProfile = undefined;
      render();
    }
  });
  document.querySelector<HTMLButtonElement>("#close-public-profile")?.addEventListener("click", () => {
    view.publicPlayerProfile = undefined;
    render();
  });
  document.querySelector<HTMLInputElement>("#collection-search-input")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    view.collectionSearch = input.value;
    render();
    requestAnimationFrame(() => {
      const nextInput = document.querySelector<HTMLInputElement>("#collection-search-input");
      nextInput?.focus();
      nextInput?.setSelectionRange(nextInput.value.length, nextInput.value.length);
    });
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-collection-card]")) {
    el.addEventListener("click", () => {
      view.pinnedCollectionCardId = el.dataset.collectionCard;
      render();
    });
  }
  document.querySelector<HTMLButtonElement>("#pinned-card-close")?.addEventListener("click", () => {
    view.pinnedCollectionCardId = undefined;
    render();
  });
  document.querySelector<HTMLElement>("#pinned-card-overlay")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      view.pinnedCollectionCardId = undefined;
      render();
    }
  });
  document.querySelector<HTMLButtonElement>("#card-op-disenchant")?.addEventListener("click", (event) => {
    const cardId = (event.currentTarget as HTMLButtonElement).dataset.cardId;
    if (cardId) void disenchantCard(cardId, 1);
  });
  document.querySelector<HTMLButtonElement>("#card-op-craft")?.addEventListener("click", (event) => {
    const cardId = (event.currentTarget as HTMLButtonElement).dataset.cardId;
    if (cardId) void craftCard(cardId);
  });
  document.querySelector<HTMLButtonElement>("#bulk-disenchant")?.addEventListener("click", () => void bulkDisenchantExtras());
  document.querySelector<HTMLButtonElement>("#edit-display-name")?.addEventListener("click", () => {
    view.editingDisplayNameActive = true;
    view.editingDisplayName = view.profile?.display_name ?? "";
    render();
    requestAnimationFrame(() => {
      const inp = document.querySelector<HTMLInputElement>("#profile-display-name");
      inp?.focus();
      inp?.select();
    });
  });
  document.querySelector<HTMLButtonElement>("#cancel-edit-name")?.addEventListener("click", () => {
    view.editingDisplayNameActive = false;
    view.editingDisplayName = undefined;
    render();
  });
  const displayInput = document.querySelector<HTMLInputElement>("#profile-display-name");
  if (displayInput) {
    displayInput.addEventListener("input", () => {
      view.editingDisplayName = displayInput.value;
    });
  }
  document.querySelector<HTMLFormElement>("#add-friend-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#add-friend-input");
    void sendFriendRequest(input?.value ?? "");
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-friends-panel]")) {
    el.addEventListener("click", () => {
      const panel = el.dataset.friendsPanel as FriendsPanel | undefined;
      if (!panel) return;
      view.friendsPanel = panel;
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-remove-friend]")) {
    el.addEventListener("click", () => {
      const id = el.dataset.removeFriend;
      if (id) void removeFriend(id);
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-accept-friend-request]")) {
    el.addEventListener("click", () => {
      const id = el.dataset.acceptFriendRequest;
      if (id) void respondFriendRequest("accept", id);
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-decline-friend-request]")) {
    el.addEventListener("click", () => {
      const id = el.dataset.declineFriendRequest;
      if (id) void respondFriendRequest("decline", id);
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-cancel-friend-request]")) {
    el.addEventListener("click", () => {
      const id = el.dataset.cancelFriendRequest;
      if (id) void respondFriendRequest("cancel", id);
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-challenge-friend]")) {
    el.addEventListener("click", () => {
      void createPrivateChallenge();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-copy-code]")) {
    el.addEventListener("click", () => {
      const code = el.dataset.copyCode ?? "";
      if (!code) return;
      void navigator.clipboard?.writeText(code).catch(() => {
        // Clipboard might be blocked in some browsers; the code is visible on-screen.
      });
      showToast(`已複製代碼 ${code}`);
    });
  }
  document.querySelector<HTMLButtonElement>("#cancel-private-room")?.addEventListener("click", () => {
    void cancelMatchmaking();
    view.privateJoinCode = undefined;
    render();
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-claim-shop]")) {
    el.addEventListener("click", () => {
      const id = el.dataset.claimShop;
      if (id) void claimShopItem(id);
    });
  }
  bindPackOpeningActions();
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name="ai-difficulty"]')) {
    el.addEventListener("change", () => {
      const value = el.value as AiDifficulty;
      if (value === "easy" || value === "normal" || value === "hard") {
        view.aiDifficulty = value;
        render();
      }
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-ai-theme]")) {
    el.addEventListener("click", () => {
      const theme = AI_THEMES.find((entry) => entry.id === el.dataset.aiTheme);
      if (theme) {
        view.aiTheme = theme.id;
        render();
      }
    });
  }
  document.querySelector<HTMLButtonElement>("#start-ai-match")?.addEventListener("click", () => {
    void startAiMatch();
  });
  document.querySelector<HTMLFormElement>("#private-join-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#private-join-input");
    void joinPrivateByCode(input?.value ?? "");
  });
  document.querySelector<HTMLButtonElement>("#create-private-room")?.addEventListener("click", () => {
    void createPrivateChallenge();
  });
  document.querySelector<HTMLButtonElement>("#settings-toggle")?.addEventListener("click", () => {
    view.settingsOpen = true;
    render();
  });
  document.querySelector<HTMLButtonElement>("#settings-close")?.addEventListener("click", () => {
    view.settingsOpen = false;
    render();
  });
  document.querySelector<HTMLElement>("#settings-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) { view.settingsOpen = false; render(); }
  });
  document.querySelector<HTMLButtonElement>("#changelog-open")?.addEventListener("click", () => {
    view.changelogOpen = true;
    render();
  });
  document.querySelector<HTMLButtonElement>("#changelog-close")?.addEventListener("click", () => {
    view.changelogOpen = false;
    render();
  });
  document.querySelector<HTMLElement>("#changelog-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) { view.changelogOpen = false; render(); }
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-hover-card-id]")) {
    bindHoverPreview(el, () => {
      const card = el.dataset.hoverCardId ? cardCatalog.get(el.dataset.hoverCardId) : undefined;
      return card ? resolveCatalogCard(card, `tooltip-${card.id}`) : undefined;
    });
  }
  document.querySelector<HTMLButtonElement>("#settings-sign-out")?.addEventListener("click", () => void signOut());
  document.querySelector<HTMLButtonElement>("#settings-bgm-mute")?.addEventListener("click", toggleBgmMute);
  document.querySelector<HTMLButtonElement>("#settings-sfx-mute")?.addEventListener("click", toggleSfxMute);
  document.querySelector<HTMLInputElement>("#settings-bgm-volume")?.addEventListener("input", (e) => {
    setBgmVolume(parseFloat((e.currentTarget as HTMLInputElement).value));
  });
  document.querySelector<HTMLInputElement>("#settings-sfx-volume")?.addEventListener("input", (e) => {
    setSfxVolume(parseFloat((e.currentTarget as HTMLInputElement).value));
  });
}

function bindCollectionDeckControls(root: ParentNode): void {
  root.querySelector<HTMLButtonElement>("#new-deck")?.addEventListener("click", beginNewDeck);
  root.querySelector<HTMLButtonElement>("#autofill-deck")?.addEventListener("click", autofillDeck);
  root.querySelector<HTMLButtonElement>("#clear-deck")?.addEventListener("click", clearDeck);
  root.querySelector<HTMLInputElement>("#deck-name")?.addEventListener("input", (event) => {
    if (!view.editingDeck) return;
    view.editingDeck = { ...view.editingDeck, name: (event.currentTarget as HTMLInputElement).value };
  });
  root.querySelector<HTMLFormElement>("#deck-form")?.addEventListener("submit", (event) => void saveEditingDeck(event));
  for (const el of root.querySelectorAll<HTMLElement>("[data-edit-deck]")) {
    el.addEventListener("click", () => {
      const deck = view.decks.find((item) => item.id === el.dataset.editDeck);
      if (deck) {
        view.selectedDeckId = deck.id;
        view.editingDeck = { ...deck, card_ids: [...deck.card_ids] };
      }
      refreshCollectionDeckWorkspace();
    });
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-delete-deck]")) {
    el.addEventListener("click", () => void deleteDeck(el.dataset.deleteDeck));
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-remove-card]")) {
    el.addEventListener("click", () => removeCardFromEditor(el.dataset.removeCard));
  }
  const openCoverPicker = (): void => {
    if (!view.editingDeck || view.editingDeck.card_ids.length === 0) return;
    view.coverPickerOpen = true;
    refreshCollectionDeckWorkspace();
  };
  root.querySelector<HTMLButtonElement>("#edit-cover")?.addEventListener("click", openCoverPicker);
  root.querySelector<HTMLButtonElement>("#edit-cover-thumb")?.addEventListener("click", openCoverPicker);
  root.querySelector<HTMLButtonElement>("#cover-picker-close")?.addEventListener("click", () => {
    view.coverPickerOpen = false;
    refreshCollectionDeckWorkspace();
  });
  root.querySelector<HTMLElement>("#cover-picker-overlay")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      view.coverPickerOpen = false;
      refreshCollectionDeckWorkspace();
    }
  });
  for (const el of root.querySelectorAll<HTMLElement>("[data-cover-card]")) {
    el.addEventListener("click", () => {
      if (!view.editingDeck) return;
      view.editingDeck = { ...view.editingDeck, cover_card_id: el.dataset.coverCard };
      view.coverPickerOpen = false;
      refreshCollectionDeckWorkspace();
    });
  }
}

function beginNewDeck(): void {
  startNewDeck(false);
  if (view.menuScreen === "battle") view.menuScreen = "deckEditor";
  if (document.querySelector(".collection-deck-column")) refreshCollectionDeckWorkspace();
  else render();
}

function refreshCollectionDeckWorkspace(): void {
  const column = document.querySelector<HTMLElement>(".collection-deck-column");
  if (!column) {
    render();
    return;
  }
  column.innerHTML = renderCollectionDeckColumnContent();
  lastRenderedHtml = "";
  bindCollectionDeckControls(column);
  updateCollectionCardButtons();
}

function updateCollectionCardButtons(): void {
  const selectedCounts = countCards(view.editingDeck?.card_ids ?? []);
  const selectedTotal = view.editingDeck?.card_ids.length ?? 0;
  const collectionMap = new Map(view.collection.map((row) => [row.card_id, row.quantity]));
  for (const el of document.querySelectorAll<HTMLButtonElement>(".collection-card[data-add-card]")) {
    const cardId = el.dataset.addCard;
    const card = cardId ? cardCatalog.get(cardId) : undefined;
    if (!card || !cardId) continue;
    const quantity = collectionMap.get(cardId) ?? 0;
    const selectedCount = selectedCounts.get(cardId) ?? 0;
    const limit = deckCopyLimit(card);
    const effectiveOwned = hasCollectionRows() ? quantity : limit;
    const legendaryOk = canAddLegendary(card, view.editingDeck?.card_ids ?? []);
    const canAdd = Boolean(view.editingDeck) && quantity > 0 && selectedTotal < 30 && selectedCount < limit && selectedCount < effectiveOwned && legendaryOk;
    el.disabled = !canAdd;
    el.classList.toggle("can-add", canAdd);
    el.classList.toggle("cannot-add", !canAdd);

    let badge = el.querySelector<HTMLElement>(".deck-count-badge");
    if (selectedCount > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "deck-count-badge";
        el.insertBefore(badge, el.querySelector(".card"));
      }
      badge.textContent = `${selectedCount}/${limit}`;
    } else {
      badge?.remove();
    }
  }
}

function bindPackOpeningActions(): void {
  const overlay = document.querySelector("#pack-opening-overlay");
  if (!overlay) return;
  for (const el of overlay.querySelectorAll<HTMLElement>("[data-flip-index]")) {
    el.addEventListener("click", () => {
      if (!view.packOpeningFlipped || !view.packOpeningRewards) return;
      const idx = parseInt(el.dataset.flipIndex ?? "-1", 10);
      if (idx < 0 || view.packOpeningFlipped[idx]) return;
      view.packOpeningFlipped[idx] = true;
      playSfx("packFlip", 0.6);
      flipPackRewardCard(idx);
    });
  }
  document.querySelector<HTMLButtonElement>("#btn-pack-done")?.addEventListener("click", () => {
    view.packOpeningRewards = undefined;
    view.packOpeningFlipped = undefined;
    view.packOpeningKind = undefined;
    document.querySelector("#pack-opening-overlay")?.remove();
    lastRenderedHtml = "";
  });
}

function navigateToScreen(target: MenuScreen): void {
  if (view.matchmaking && target !== "battle") return;
  view.menuScreen = target;
  view.avatarPickerOpen = false;
  view.pinnedCollectionCardId = undefined;
  if (target !== "profile") { view.editingDisplayName = undefined; view.editingDisplayNameActive = false; }
  if (target === "friends") void loadFriends();
  if (target === "leaderboard") void loadLeaderboard();
  if (target === "shop") void loadShopItems();
  render();
}

function flipPackRewardCard(index: number): void {
  const wrapper = document.querySelector<HTMLElement>(`[data-flip-index="${index}"]`);
  if (!wrapper || !view.packOpeningRewards) return;
  const reward = view.packOpeningRewards[index];
  const rarity = reward?.type === "card" ? reward.rarity.toUpperCase() : "RARE";
  wrapper.classList.add("flipped", rarity);
  if (view.packOpeningFlipped?.every(Boolean)) {
    document.querySelector<HTMLButtonElement>("#btn-pack-done")?.classList.add("visible");
  }
}

// ─── Phase 5 screens ──────────────────────────────────────────────────────────

function renderFriendsScreen(): string {
  const accountMode = Boolean(supabase);
  if (!accountMode || !view.session) {
    return signInRequiredScreen("好友 · Friends");
  }
  const friends = view.friends;
  const incoming = view.friendRequests.filter((request) => request.direction === "incoming");
  const outgoing = view.friendRequests.filter((request) => request.direction === "outgoing");
  const panel = view.friendsPanel;
  return `
    <section class="screen friends-screen" data-screen="friends">
      ${renderCloudLayer()}
      <header class="screen-header">
        <button class="back-button" data-menu-screen="main">← 返回主選單</button>
        <h2>好友 · Friends</h2>
      </header>
      <div class="friends-grid">
        <nav class="friends-tabs" aria-label="好友分類">
          <button type="button" class="friends-tab ${panel === "friends" ? "active" : ""}" data-friends-panel="friends" aria-pressed="${panel === "friends"}">好友</button>
          <button type="button" class="friends-tab ${panel === "recommended" ? "active" : ""}" data-friends-panel="recommended" aria-pressed="${panel === "recommended"}">推薦</button>
          <button type="button" class="friends-tab ${panel === "add" ? "active" : ""}" data-friends-panel="add" aria-pressed="${panel === "add"}">新增</button>
        </nav>
        <section class="parchment-card friends-panel">
          ${renderFriendsPanel(panel, friends, incoming, outgoing)}
        </section>
      </div>
      ${view.privateJoinCode ? renderPrivateCodeBanner(view.privateJoinCode) : ""}
    </section>
  `;
}

function renderFriendsPanel(panel: FriendsPanel, friends: FriendRow[], incoming: FriendRequestRow[], outgoing: FriendRequestRow[]): string {
  if (panel === "add") {
    return `
      <div class="friends-panel-head">
        <h3>新增好友</h3>
      </div>
      <form id="add-friend-form" class="friends-add-form">
        <label>對方的顯示名稱
          <input id="add-friend-input" placeholder="顯示名稱" maxlength="32" required />
        </label>
        <button type="submit" data-testid="add-friend-submit" ${view.friendsLoading ? "disabled" : ""}>送出邀請</button>
      </form>
      <p class="muted">輸入完整的顯示名稱後送出，對方接受後才會成為好友。</p>
    `;
  }

  if (panel === "recommended") {
    return `
      <div class="friends-panel-head">
        <h3>推薦</h3>
        <span class="friends-count">${incoming.length + outgoing.length}</span>
      </div>
      <div class="friends-request-groups">
        <section class="friends-request-group">
          <h4>收到的邀請 (${incoming.length})</h4>
          ${incoming.length === 0
            ? `<p class="muted">目前沒有待處理的好友邀請。</p>`
            : `<ul class="friends-list">
                ${incoming.map(renderIncomingFriendRequestRow).join("")}
              </ul>`}
        </section>
        <section class="friends-request-group">
          <h4>送出的邀請 (${outgoing.length})</h4>
          ${outgoing.length === 0
            ? `<p class="muted">目前沒有等待對方回覆的邀請。</p>`
            : `<ul class="friends-list">
                ${outgoing.map(renderOutgoingFriendRequestRow).join("")}
              </ul>`}
        </section>
      </div>
    `;
  }

  return `
    <div class="friends-panel-head">
      <h3>我的好友</h3>
      <span class="friends-count">${friends.length}</span>
    </div>
    ${view.friendsLoading ? `<p class="muted">載入中…</p>` : friends.length === 0
      ? `<p class="muted">還沒有好友。先邀請一位玩家吧！</p>`
      : `<ul class="friends-list">
          ${friends.map((friend) => renderFriendRow(friend)).join("")}
        </ul>`}
  `;
}

function renderFriendRow(friend: FriendRow): string {
  const avatar = friend.avatar_url || "/images/avatars/avatar1.webp";
  return `
    <li class="friend-row" data-testid="friend-row">
      <img class="friend-avatar" src="${escapeAttr(avatar)}" alt="" onerror="this.src='/images/avatars/avatar1.webp'" />
      <div class="friend-meta">
        <strong>${escapeHtml(friend.display_name)}</strong>
        <span class="muted">Wins ${friend.wins_count}</span>
      </div>
      <div class="friend-actions">
        <button class="ghost-button" data-view-player-profile="${escapeAttr(friend.friend_user_id)}" data-testid="view-friend-profile">查看</button>
        <button class="ghost-button" data-challenge-friend="${escapeAttr(friend.friend_user_id)}" data-testid="challenge-friend">挑戰</button>
        <button class="danger" data-remove-friend="${escapeAttr(friend.friend_user_id)}" data-testid="remove-friend">刪除</button>
      </div>
    </li>
  `;
}

function renderIncomingFriendRequestRow(request: FriendRequestRow): string {
  return renderFriendRequestRow(request, `
    <button class="ghost-button" data-accept-friend-request="${escapeAttr(request.request_id)}" data-testid="accept-friend-request">接受</button>
    <button class="danger" data-decline-friend-request="${escapeAttr(request.request_id)}" data-testid="decline-friend-request">拒絕</button>
  `);
}

function renderOutgoingFriendRequestRow(request: FriendRequestRow): string {
  return renderFriendRequestRow(request, `
    <button class="danger" data-cancel-friend-request="${escapeAttr(request.request_id)}" data-testid="cancel-friend-request">取消</button>
  `);
}

function renderFriendRequestRow(request: FriendRequestRow, actions: string): string {
  const avatar = request.avatar_url || "/images/avatars/avatar1.webp";
  return `
    <li class="friend-row" data-testid="friend-request-row">
      <img class="friend-avatar" src="${escapeAttr(avatar)}" alt="" onerror="this.src='/images/avatars/avatar1.webp'" />
      <div class="friend-meta">
        <strong>${escapeHtml(request.display_name)}</strong>
        <span class="muted">Wins ${request.wins_count}</span>
      </div>
      <div class="friend-actions">
        <button class="ghost-button" data-view-player-profile="${escapeAttr(request.other_user_id)}" data-testid="view-request-profile">查看</button>
        ${actions}
      </div>
    </li>
  `;
}

function renderPrivateCodeBanner(code: string): string {
  return `
    <div class="private-code-banner parchment-card" data-testid="private-code-banner">
      <p>分享這個房間代碼給好友：</p>
      <code class="private-code">${escapeHtml(code)}</code>
      <button class="ghost-button" data-copy-code="${escapeAttr(code)}">複製</button>
      <button class="danger" id="cancel-private-room">取消房間</button>
    </div>
  `;
}

function deriveLbLevel(wins: number): number {
  return Math.floor(wins / 10) + 1;
}

function renderPublicPlayerProfileModal(): string {
  const player = view.publicPlayerProfile;
  if (!player) return "";
  const avatarUrl = player.avatarUrl || "/images/avatars/avatar1.webp";
  const level = deriveLbLevel(player.winsCount);
  const rankText = player.rank ? `#${player.rank}` : "—";
  return `
    <section id="public-profile-backdrop" class="public-profile-backdrop" role="dialog" aria-modal="true" aria-label="玩家個人頁面">
      <div class="parchment-card public-profile-card">
        <button id="close-public-profile" class="public-profile-close" title="關閉">×</button>
        <div class="public-profile-hero">
          <img class="public-profile-avatar" src="${escapeAttr(avatarUrl)}" alt="" onerror="this.src='/images/avatars/avatar1.webp'" />
          <div class="public-profile-info">
            <span class="public-profile-source">${escapeHtml(player.source)}</span>
            <h3>${escapeHtml(player.displayName)}</h3>
            <div class="public-profile-title">#菜鳥</div>
          </div>
        </div>
        <div class="public-profile-stats">
          <div><span>等級</span><strong>Lv. ${level}</strong></div>
          <div><span>勝場</span><strong>${player.winsCount}</strong></div>
          <div><span>排行</span><strong>${escapeHtml(rankText)}</strong></div>
        </div>
      </div>
    </section>
  `;
}

function openPublicPlayerProfile(userId: string): void {
  if (view.session?.user.id === userId) {
    view.publicPlayerProfile = undefined;
    navigateToScreen("profile");
    return;
  }
  const friend = view.friends.find((row) => row.friend_user_id === userId);
  if (friend) {
    view.publicPlayerProfile = {
      userId,
      displayName: friend.display_name,
      avatarUrl: friend.avatar_url,
      winsCount: friend.wins_count,
      source: "好友"
    };
    render();
    return;
  }
  const request = view.friendRequests.find((row) => row.other_user_id === userId);
  if (request) {
    view.publicPlayerProfile = {
      userId,
      displayName: request.display_name,
      avatarUrl: request.avatar_url,
      winsCount: request.wins_count,
      source: "邀請"
    };
    render();
    return;
  }
  const sorted = [...view.leaderboard].sort((a, b) =>
    view.leaderboardSortBy === "level"
      ? deriveLbLevel(b.wins_count) - deriveLbLevel(a.wins_count) || b.wins_count - a.wins_count
      : b.wins_count - a.wins_count
  );
  const leaderboardRow = sorted.find((row) => row.user_id === userId);
  if (leaderboardRow) {
    view.publicPlayerProfile = {
      userId,
      displayName: leaderboardRow.display_name,
      avatarUrl: leaderboardRow.avatar_url,
      winsCount: leaderboardRow.wins_count,
      source: "排行榜",
      rank: sorted.findIndex((row) => row.user_id === userId) + 1
    };
    render();
  }
}

function renderLeaderboardPlayerCard(row: LeaderboardRow, displayRank: number, sortBy: "wins" | "level"): string {
  const rankClass = displayRank <= 3 ? ` lb-card-rank-${displayRank}` : "";
  const rankBadge = displayRank === 1 ? "🥇" : displayRank === 2 ? "🥈" : displayRank === 3 ? "🥉" : `#${displayRank}`;
  const avatarUrl = row.avatar_url || "/images/avatars/avatar1.webp";
  const level = deriveLbLevel(row.wins_count);
  const statLabel = sortBy === "level" ? `Lv. ${level}` : `${row.wins_count} 勝`;
  return `
    <div class="lb-player-card${rankClass}">
      <div class="lb-rank-badge">${rankBadge}</div>
      <img class="lb-avatar" src="${escapeAttr(avatarUrl)}" alt="" onerror="this.src='/images/avatars/avatar1.webp'" />
      <div class="lb-player-info">
        <div class="lb-player-name">${escapeHtml(row.display_name)}</div>
        <div class="lb-player-title">#菜鳥</div>
      </div>
      <div class="lb-stat-pill">${escapeHtml(statLabel)}</div>
      <button class="lb-action-btn" data-view-player-profile="${escapeAttr(row.user_id)}" title="查看個人頁面">查看</button>
    </div>
  `;
}

function renderLeaderboardScreen(): string {
  const sortBy = view.leaderboardSortBy;
  const sorted = [...view.leaderboard].sort((a, b) =>
    sortBy === "level"
      ? deriveLbLevel(b.wins_count) - deriveLbLevel(a.wins_count) || b.wins_count - a.wins_count
      : b.wins_count - a.wins_count
  );
  const titleText = sortBy === "level" ? "等級排行榜" : "勝場排行榜";
  return `
    <section class="screen leaderboard-screen" data-screen="leaderboard">
      <div class="lb-modal-content">
        <div class="lb-modal-header">
          <h2 class="lb-modal-title">🏆 ${titleText}</h2>
          <button class="lb-close-btn" data-menu-screen="main">關閉</button>
        </div>
        <div class="lb-tabs" role="tablist">
          <button class="lb-tab ${sortBy === "wins" ? "active" : ""}" data-lb-sort="wins" role="tab">勝場排行</button>
          <button class="lb-tab ${sortBy === "level" ? "active" : ""}" data-lb-sort="level" role="tab">等級排行</button>
        </div>
        ${view.leaderboardLoading
          ? `<p class="lb-empty">載入中…</p>`
          : `<div class="lb-list" data-testid="leaderboard-table" data-preserve-scroll>
                ${sorted.length === 0
                  ? `<p class="lb-empty">暫無排行榜資料</p>`
                  : sorted.map((row, i) => renderLeaderboardPlayerCard(row, i + 1, sortBy)).join("")}
              </div>`}
      </div>
    </section>
  `;
}

function renderShopScreen(): string {
  const accountMode = Boolean(supabase);
  if (!accountMode || !view.session) {
    return signInRequiredScreen("商店 · Shop");
  }
  return `
    <section class="screen shop-screen" data-screen="shop">
      <div class="shop-container">
        <header class="shop-header">
          <button class="shop-back-btn" data-menu-screen="main">← 返回</button>
          <h2 class="shop-title">商店</h2>
          <div class="shop-gold-display">
            <img class="gold-icon" src="/images/ui/gold_coin.webp" alt="金幣"
              onerror="this.style.display='none'">
            <span id="shop-gold-amount">--</span>
          </div>
        </header>
        <div class="shop-products" data-preserve-scroll>
          ${view.shopLoading
            ? `<p class="muted">載入中…</p>`
            : view.shopItems.length === 0
              ? `<p class="muted">目前沒有可購買的商品。</p>`
              : view.shopItems.map(renderShopItem).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderShopItem(item: ShopItemRow): string {
  const cardIds = item.contents?.cards ?? [];
  const cards = cardIds.map((id) => cardCatalog.get(id)).filter(Boolean) as CardDefinition[];
  const icon = item.kind === "CARD_PACK" ? "📖" : "✨";

  const ratesHtml = cards.length > 0 ? `
    <div class="product-rates-side">
      <div class="rates-title">內容</div>
      <div class="product-drop-rates">
        ${cards.map((card) => `
          <div class="rate-row ${card.rarity.toLowerCase()}">
            <span>${escapeHtml(card.name)}</span>
            <span class="rate-val">${escapeHtml(rarityLabel[card.rarity] ?? card.rarity)}</span>
          </div>
        `).join("")}
      </div>
    </div>
  ` : "";

  return `
    <section class="product-card" data-testid="shop-item">
      <div class="product-top-row">
        <div class="product-image">${icon}</div>
        <h3>${escapeHtml(item.display_name)}</h3>
      </div>
      <div class="product-details-bottom">
        <div class="product-info-side">
          ${item.description ? `<p class="product-desc">${escapeHtml(item.description)}</p>` : ""}
          <div class="product-price">
            <img class="price-coin" src="/images/ui/gold_coin.webp" alt="金幣"
              onerror="this.style.display='none'">
            <span>免費</span>
          </div>
          <button class="btn-buy" data-claim-shop="${escapeAttr(item.id)}" data-testid="claim-shop">免費領取</button>
        </div>
        ${ratesHtml}
      </div>
    </section>
  `;
}


function renderPackOpeningOverlay(): string {
  if (!view.packOpeningCards || view.packOpeningCards.length === 0) return "";
  const cards = view.packOpeningCards;
  const flipped = view.packOpeningFlipped ?? cards.map(() => false);
  const allFlipped = flipped.every(Boolean);

  const cardItems = cards.map((card, i) => {
    const catalogCard = cardCatalog.get(card.cardId);
    const rarity = card.rarity.toUpperCase();
    const rarityClass = card.rarity.toLowerCase();
    const label = rarityLabel[card.rarity] ?? card.rarity;
    return `
      <div class="pack-card-wrapper rarity-${rarityClass}${flipped[i] ? ` flipped ${rarity}` : ""}"
        data-flip-index="${i}" role="button" aria-label="翻開卡牌">
        <div class="pack-card-inner">
          <div class="pack-card-back">
            <img src="/images/ui/card_back.webp" alt="card back"
              onerror="this.src='/images/card_back.webp'">
          </div>
          <div class="pack-card-front">
            ${catalogCard
              ? `<div class="card pack-face-card rarity-${rarityClass}">${renderCardFace(resolveCatalogCard(catalogCard, `pack-${catalogCard.id}-${i}`), "mulligan")}</div>`
              : `<div class="pack-card-content rarity-${rarityClass}">
                <div class="pack-card-img-wrap">
                  <img src="${escapeAttr(assetUrl(card.image))}" alt="${escapeAttr(card.name)}" onerror="this.style.display='none'">
                </div>
                <div class="pack-card-name">${escapeHtml(card.name)}</div>
                <div class="pack-card-rarity">${escapeHtml(label)}</div>
              </div>`}
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="pack-overlay" id="pack-opening-overlay" data-testid="pack-overlay">
      <h2 class="pack-title">開包！</h2>
      <div class="pack-cards-container" style="--pack-count:${Math.min(cards.length, 5)}">${cardItems}</div>
      <button id="btn-pack-done" class="${allFlipped ? "visible" : ""}">完成</button>
    </div>
  `;
}

function renderLegacyShopScreen(): string {
  const accountMode = Boolean(supabase);
  if (!accountMode || !view.session) {
    return signInRequiredScreen("商店");
  }
  const gold = view.profile?.gold ?? 0;
  return `
    <section class="screen shop-screen" data-screen="shop">
      <div class="shop-container">
        <header class="shop-header">
          <button class="shop-back-btn" data-menu-screen="main">← 返回</button>
          <h2 class="shop-title">商店</h2>
          <div class="shop-gold-display">
            <img class="gold-icon" src="/images/ui/gold_coin.webp" alt="金幣" onerror="this.style.display='none'">
            <span id="shop-gold-amount">${gold}</span>
          </div>
        </header>
        <div class="shop-products" data-preserve-scroll>
          ${view.shopLoading
            ? `<p class="muted">載入商店中...</p>`
            : view.shopItems.length === 0
              ? `<p class="muted">目前沒有可購買的商品。</p>`
              : view.shopItems.map(renderLegacyShopItem).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderLegacyShopItem(item: ShopItemRow): string {
  const isCardPack = item.kind === "CARD_PACK";
  const affordable = (view.profile?.gold ?? 0) >= item.price_gold;
  const icon = isCardPack
    ? `<img src="/images/card_pack_book.webp" alt="卡牌包" onerror="this.style.display='none';this.parentElement.textContent='🎴'">`
    : `<span aria-hidden="true">✨</span>`;
  const rates = item.contents?.dropRates ?? legacyShopDropRates(item.kind);
  const ratesHtml = rates.length > 0 ? `
    <div class="product-rates-side">
      <div class="rates-title">${isCardPack ? "獲得機率" : "內容機率"}</div>
      <div class="product-drop-rates">
        ${rates.map((rate) => `
          <div class="rate-row ${rate.rarity?.toLowerCase() ?? rate.type ?? ""}">
            <span>${escapeHtml(rate.label)}</span>
            <span class="rate-val">${rate.rate}%</span>
          </div>
        `).join("")}
      </div>
      ${item.contents?.note ? `<small class="product-note">${escapeHtml(item.contents.note)}</small>` : ""}
    </div>
  ` : "";

  return `
    <section class="product-card" data-testid="shop-item" data-product="${escapeAttr(item.id)}">
      <div class="product-top-row">
        <div class="product-image">${icon}</div>
        <h3>${escapeHtml(item.display_name)}</h3>
      </div>
      <div class="product-details-bottom">
        <div class="product-info-side">
          ${item.description ? `<p class="product-desc">${escapeHtml(item.description)}</p>` : ""}
          <div class="product-price">
            <img class="price-coin" src="/images/ui/gold_coin.webp" alt="金幣" onerror="this.style.display='none'">
            <span>${item.price_gold}</span>
          </div>
          <button class="btn-buy" data-claim-shop="${escapeAttr(item.id)}" data-testid="claim-shop" ${affordable ? "" : "disabled"}>購買</button>
        </div>
        ${ratesHtml}
      </div>
    </section>
  `;
}

function legacyShopDropRates(kind: string): NonNullable<ShopItemRow["contents"]["dropRates"]> {
  if (kind === "CARD_PACK") {
    return [
      { label: "普通", rarity: "COMMON", rate: 60 },
      { label: "精良", rarity: "RARE", rate: 26 },
      { label: "史詩", rarity: "EPIC", rate: 10 },
      { label: "傳說", rarity: "LEGENDARY", rate: 4 }
    ];
  }
  if (kind === "COSMETIC_PACK") {
    return [
      { label: "個人頭像", type: "avatar", rate: 50 },
      { label: "專屬稱號", type: "title", rate: 50 }
    ];
  }
  return [];
}

function renderLegacyShopPackOverlay(): string {
  if (!view.packOpeningRewards || view.packOpeningRewards.length === 0) return "";
  const rewards = view.packOpeningRewards;
  const flipped = view.packOpeningFlipped ?? rewards.map(() => false);
  const allFlipped = flipped.every(Boolean);
  const cardItems = rewards.map((reward, i) => {
    const rarity = reward.type === "card" ? reward.rarity.toUpperCase() : "RARE";
    const rarityClass = reward.type === "card" ? reward.rarity.toLowerCase() : reward.type;
    const wrapperClasses = classNames([
      "pack-card-wrapper",
      `rarity-${rarityClass}`,
      `pack-reward-${reward.type}`,
      flipped[i] && `flipped ${rarity}`
    ]);
    return `
      <div class="${wrapperClasses}" data-flip-index="${i}" role="button" aria-label="翻開獎勵">
        <div class="pack-card-inner">
          <div class="pack-card-back">
            <img src="/images/ui/card_back.webp" alt="card back" onerror="this.src='/images/card_back.webp'">
          </div>
          <div class="pack-card-front">
            ${renderPackRewardFace(reward, rarityClass)}
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="pack-overlay" id="pack-opening-overlay" data-testid="pack-overlay">
      <h2 class="pack-title">${view.packOpeningKind === "cosmetic" ? "開包結果" : "開包！"}</h2>
      <div class="pack-cards-container" style="--pack-count:${Math.min(rewards.length, 5)}">${cardItems}</div>
      <button id="btn-pack-done" class="${allFlipped ? "visible" : ""}">完成</button>
    </div>
  `;
}

function renderPackRewardFace(reward: PackOpeningReward, rarityClass: string): string {
  if (reward.type === "card") {
    const resolved: ResolvedCardView = {
      cardId: reward.cardId,
      instanceId: `pack-${reward.cardId}`,
      name: reward.name,
      category: reward.category,
      description: reward.description,
      image: reward.image,
      cost: reward.cost,
      baseCost: reward.cost,
      type: reward.cardType,
      rarity: reward.rarity,
      attack: reward.attack,
      baseAttack: reward.attack,
      health: reward.health,
      baseHealth: reward.health
    };
    return `
      <div class="card pack-face-card rarity-${rarityClass}">
        ${renderCardFace(resolved, "mulligan")}
      </div>
    `;
  }
  return `
    <div class="pack-card-content rarity-${rarityClass}">
      ${renderRewardVisual(reward)}
      <div class="pack-card-name">${escapeHtml(rewardName(reward))}</div>
      <div class="pack-card-rarity">${escapeHtml(rewardLabel(reward))}</div>
    </div>
  `;
}

function renderRewardVisual(reward: PackOpeningReward): string {
  if (reward.type === "card") {
    const imgSrc = escapeAttr(assetUrl(reward.image));
    return `<div class="pack-card-img-wrap"><img src="${imgSrc}" alt="${escapeAttr(reward.name)}" onerror="this.style.display='none'"></div>`;
  }
  if (reward.type === "avatar") {
    return `<div class="pack-card-img-wrap reward-cosmetic-wrap"><img class="reward-avatar-img" src="${escapeAttr(reward.path)}" alt="${escapeAttr(reward.name)}" onerror="this.style.display='none'"></div>`;
  }
  if (reward.type === "title") {
    return `<div class="pack-card-img-wrap reward-cosmetic-wrap"><span class="reward-title-badge">#${escapeHtml(reward.name)}</span></div>`;
  }
  return `<div class="pack-card-img-wrap reward-cosmetic-wrap"><span class="reward-voucher-badge">券 ${reward.amount}</span></div>`;
}

function rewardName(reward: PackOpeningReward): string {
  if (reward.type === "voucher") return `${reward.amount} 消費券`;
  return reward.name;
}

function rewardLabel(reward: PackOpeningReward): string {
  if (reward.type === "card") return rarityLabel[reward.rarity] ?? reward.rarity;
  if (reward.type === "avatar") return "個人頭像";
  if (reward.type === "title") return "專屬稱號";
  return reward.name;
}

function signInRequiredScreen(title: string): string {
  return `
    <section class="screen friends-screen" data-screen="friends">
      ${renderCloudLayer()}
      <header class="screen-header">
        <button class="back-button" data-menu-screen="main">← 返回主選單</button>
        <h2>${escapeHtml(title)}</h2>
      </header>
      <div class="parchment-card center-card">
        <p>請先登入以使用此功能。</p>
      </div>
    </section>
  `;
}

async function loadFriends(): Promise<void> {
  if (!supabase || !view.session) return;
  view.friendsLoading = true;
  render();
  try {
    const [friendsResult, requestsResult] = await Promise.all([
      supabase.rpc("list_friends"),
      supabase.rpc("list_friend_requests")
    ]);
    if (friendsResult.error) throw friendsResult.error;
    if (requestsResult.error) throw requestsResult.error;
    view.friends = (friendsResult.data as FriendRow[]) ?? [];
    view.friendRequests = (requestsResult.data as FriendRequestRow[]) ?? [];
  } catch (error) {
    showAlert(errorMessage(error));
  } finally {
    view.friendsLoading = false;
    render();
  }
}

async function sendFriendRequest(displayName: string): Promise<void> {
  if (!supabase || !view.session) return;
  const target = displayName.trim();
  if (!target) {
    showAlert("請輸入顯示名稱。");
    return;
  }
  view.friendsLoading = true;
  render();
  try {
    const { error } = await supabase.rpc("send_friend_request", { p_target_display_name: target });
    if (error) throw error;
    showToast(`已送出好友邀請給 ${target}。`);
    await loadFriends();
  } catch (error) {
    showAlert(errorMessage(error));
    view.friendsLoading = false;
    render();
  }
}

async function removeFriend(friendUserId: string): Promise<void> {
  if (!supabase || !view.session) return;
  try {
    const { error } = await supabase.rpc("remove_friend", { p_friend_user_id: friendUserId });
    if (error) throw error;
    showToast("好友已移除。");
    await loadFriends();
  } catch (error) {
    showAlert(errorMessage(error));
  }
}

async function respondFriendRequest(action: "accept" | "decline" | "cancel", requestId: string): Promise<void> {
  if (!supabase || !view.session) return;
  view.friendsLoading = true;
  render();
  try {
    const rpcName =
      action === "accept" ? "accept_friend_request"
      : action === "decline" ? "decline_friend_request"
      : "cancel_friend_request";
    const { error } = await supabase.rpc(rpcName, { p_request_id: requestId });
    if (error) throw error;
    showToast(action === "accept" ? "已接受好友邀請。" : "好友邀請已更新。");
    await loadFriends();
  } catch (error) {
    showAlert(errorMessage(error));
    view.friendsLoading = false;
    render();
  }
}

async function loadLeaderboard(): Promise<void> {
  if (!supabase) {
    view.leaderboard = [];
    return;
  }
  view.leaderboardLoading = true;
  render();
  try {
    const { data, error } = await supabase.rpc("get_leaderboard", { p_limit: 50 });
    if (error) throw error;
    view.leaderboard = (data as LeaderboardRow[]) ?? [];
  } catch (error) {
    showAlert(error instanceof Error ? error.message : "Failed to load leaderboard.");
  } finally {
    view.leaderboardLoading = false;
    render();
  }
}

async function loadShopItems(): Promise<void> {
  if (!supabase || !view.session) return;
  view.shopLoading = true;
  render();
  try {
    const { data, error } = await supabase
      .from("shop_items")
      .select("id,kind,display_name,description,price_gold,contents")
      .eq("active", true)
      .order("price_gold", { ascending: false });
    if (error) throw error;
    view.shopItems = (data as ShopItemRow[]) ?? [];
  } catch (error) {
    showAlert(error instanceof Error ? error.message : "Failed to load shop.");
  } finally {
    view.shopLoading = false;
    render();
  }
}

async function claimShopItem(itemId: string): Promise<void> {
  if (!supabase || !view.session) return;
  try {
    const { data, error } = await supabase.rpc("purchase_shop_item", { p_item_id: itemId });
    if (error) throw error;
    const result = data as PurchaseShopResult | null;
    view.packOpeningRewards = normalizeShopRewards(result);
    view.packOpeningKind = result?.kind === "COSMETIC_PACK" ? "cosmetic" : "card";
    view.packOpeningFlipped = view.packOpeningRewards.map(() => false);
    view.packOpeningCards = undefined;
    showToast("購買成功！");
    await loadAccountDataRaw();
    updateShopGoldDisplay(result);
    mountPackOpeningOverlay();
  } catch (error) {
    showAlert(error instanceof Error ? error.message : "購買失敗。");
  }
}

function updateShopGoldDisplay(result: PurchaseShopResult | null): void {
  const gold = view.profile?.gold ?? result?.remainingGold;
  const goldEl = document.querySelector<HTMLElement>("#shop-gold-amount");
  if (goldEl && typeof gold === "number") goldEl.textContent = String(gold);
}

function mountPackOpeningOverlay(): void {
  const html = renderLegacyShopPackOverlay();
  if (!html) return;
  document.querySelector("#pack-opening-overlay")?.remove();
  const host = document.querySelector(".app-shell") ?? app;
  host.insertAdjacentHTML("beforeend", html);
  bindPackOpeningActions();
}

function normalizeShopRewards(result: PurchaseShopResult | null): PackOpeningReward[] {
  const rewards = result?.rewards ?? [];
  return rewards
    .map((reward): PackOpeningReward | undefined => {
      if (reward.type === "card" && reward.cardId) {
        const card = cardCatalog.get(reward.cardId);
        if (!card) return undefined;
        return {
          type: "card",
          cardId: card.id,
          name: card.name,
          category: card.category,
          description: card.description,
          cost: card.cost,
          cardType: card.type,
          rarity: card.rarity,
          image: card.image,
          attack: card.attack,
          health: card.health
        };
      }
      if (reward.type === "avatar" && reward.id && reward.name && reward.path) {
        return { type: "avatar", id: reward.id, name: reward.name, path: reward.path };
      }
      if (reward.type === "title" && reward.id && reward.name) {
        return { type: "title", id: reward.id, name: reward.name };
      }
      if (reward.type === "voucher" && typeof reward.amount === "number") {
        return { type: "voucher", amount: reward.amount, name: reward.name ?? "重複補償" };
      }
      return undefined;
    })
    .filter((reward): reward is PackOpeningReward => Boolean(reward));
}

async function startAiMatch(): Promise<void> {
  if (view.joining || view.room) return;
  if (supabase && (!view.session || !view.selectedDeckId)) {
    showAlert("請先選擇已儲存的牌組才能開始對戰。");
    return;
  }
  const serverUrl = defaultServerUrl;
  view.joining = true;
  render();
  try {
    const client = new Client(serverUrl);
    const joinOptions: Record<string, unknown> = supabase
      ? {
          displayName: view.profile?.display_name,
          accessToken: view.session?.access_token,
          deckId: view.selectedDeckId,
          difficulty: view.aiDifficulty,
          theme: view.aiTheme
        }
      : {
          displayName: view.profile?.display_name ?? "Player",
          difficulty: view.aiDifficulty,
          theme: view.aiTheme
        };
    const room = await client.joinOrCreate("pve", joinOptions, GameStateSchema);
    bindRoomMessages(room);
  } catch (error) {
    showAlert(error instanceof Error ? error.message : "Unable to start AI match.");
  } finally {
    view.joining = false;
    render();
  }
}

async function createPrivateChallenge(): Promise<void> {
  if (view.joining || view.room) return;
  if (supabase && (!view.session || !view.selectedDeckId)) {
    showAlert("請先選擇已儲存的牌組才能挑戰好友。");
    return;
  }
  view.joining = true;
  render();
  try {
    const client = new Client(defaultServerUrl);
    const joinOptions: Record<string, unknown> = supabase
      ? {
          displayName: view.profile?.display_name,
          accessToken: view.session?.access_token,
          deckId: view.selectedDeckId,
          private: true
        }
      : { displayName: view.profile?.display_name ?? "Player", private: true };
    const room = await client.create("pvp", joinOptions, GameStateSchema);
    bindRoomMessages(room);
    room.onMessage("joinCode", (message: { code: string }) => {
      view.privateJoinCode = message.code;
      render();
    });
    // Request the join code explicitly after listener is attached,
    // in case the server's push arrived before the listener was ready.
    setTimeout(() => room.send("getJoinCode", {}), 300);
  } catch (error) {
    showAlert(error instanceof Error ? error.message : "Unable to create private room.");
  } finally {
    view.joining = false;
    render();
  }
}

async function joinPrivateByCode(rawCode: string): Promise<void> {
  if (view.joining || view.room) return;
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    showAlert("請輸入房間代碼。");
    return;
  }
  if (supabase && (!view.session || !view.selectedDeckId)) {
    showAlert("請先選擇已儲存的牌組才能加入私人對戰。");
    return;
  }
  view.joining = true;
  render();
  try {
    const client = new Client(defaultServerUrl);
    const joinOptions: Record<string, unknown> = supabase
      ? {
          displayName: view.profile?.display_name,
          accessToken: view.session?.access_token,
          deckId: view.selectedDeckId,
          joinCode: code
        }
      : { displayName: view.profile?.display_name ?? "Player", joinCode: code };
    const room = await client.joinOrCreate("pvp", joinOptions, GameStateSchema);
    bindRoomMessages(room);
  } catch (error) {
    showAlert(error instanceof Error ? error.message : "找不到對應的房間代碼。");
  } finally {
    view.joining = false;
    render();
  }
}

function bindRoomMessages(joined: Room): void {
  view.room = joined;
  view.eventStatus = undefined;
  view.publicSync = undefined;
  view.presence.clear();
  view.rejectedHandIds.clear();
  view.matchmaking = undefined;
  stopMatchmakingTick();
  (window as any).__room = joined;

  joined.onStateChange((nextState: any) => {
    view.state = nextState;
    publishDebugState();
    pruneSelections();
    render();
  });
  joined.onMessage("seat", (message: { seat: Seat }) => {
    view.mySeat = message.seat;
    render();
  });
  joined.onMessage("hand", (message: { cards: HandCardView[] }) => {
    view.hand = message.cards;
    pruneSelections();
    render();
  });
  joined.onMessage("presence", (message: { seat: Seat; connected: boolean; reconnectUntilMs?: number }) => {
    view.presence.set(message.seat, { connected: message.connected, reconnectUntilMs: message.reconnectUntilMs });
    render();
  });
  joined.onMessage(
    "publicSync",
    (message: {
      status?: GameStatus;
      activeSeat?: Seat;
      turnNumber?: number;
      actionSeq?: number;
      result?: any;
      players?: Partial<Record<Seat, PublicPlayer>>;
    }) => {
      view.publicSync = message;
      render();
    }
  );
  joined.onMessage("events", (message: GameEvent[]) => {
    handleEvents(message);
  });
}

async function startMatchmaking(): Promise<void> {
  if (view.matchmaking || view.joining || view.room) return;
  view.matchmaking = { startedAtMs: Date.now(), status: "searching" };
  scheduleMatchmakingTick();
  render();
  await joinRoomFromBattleScreen();
}

function scheduleMatchmakingTick(): void {
  if (view.matchmakingTimer !== undefined) return;
  view.matchmakingTimer = window.setInterval(() => {
    if (!view.matchmaking) {
      stopMatchmakingTick();
      return;
    }
    updateMatchmakingTimer();
  }, 1000);
}

function updateMatchmakingTimer(): void {
  if (!view.matchmaking) return;
  const el = document.querySelector<HTMLElement>("[data-testid='matchmaking-elapsed']");
  if (!el) return;
  const elapsedMs = Date.now() - view.matchmaking.startedAtMs;
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  el.textContent = `${mm}:${ss}`;
}

function stopMatchmakingTick(): void {
  if (view.matchmakingTimer !== undefined) {
    window.clearInterval(view.matchmakingTimer);
    view.matchmakingTimer = undefined;
  }
}

async function cancelMatchmaking(): Promise<void> {
  const room = view.room;
  view.matchmaking = undefined;
  stopMatchmakingTick();
  if (room) {
    try {
      await room.leave(true);
    } catch {
      // ignore
    }
    view.room = undefined;
    view.mySeat = undefined;
    view.state = undefined;
    view.publicSync = undefined;
  }
  render();
}

async function joinRoomFromBattleScreen(): Promise<void> {
  const advancedServer = document.querySelector<HTMLInputElement>("#server-url-advanced")?.value;
  const advancedName = document.querySelector<HTMLInputElement>("#display-name-advanced")?.value;
  const createdInputs: HTMLInputElement[] = [];
  const ensureHiddenInput = (id: string, value: string | undefined) => {
    if (value === undefined) return;
    const existing = document.querySelector<HTMLInputElement>(`#${id}`);
    if (existing) {
      existing.value = value;
      return;
    }
    const inp = document.createElement("input");
    inp.id = id;
    inp.value = value;
    inp.style.display = "none";
    document.body.appendChild(inp);
    createdInputs.push(inp);
  };
  ensureHiddenInput("server-url", advancedServer ?? defaultServerUrl);
  ensureHiddenInput("display-name", advancedName ?? view.profile?.display_name);
  const synthetic = { preventDefault: () => {}, target: null } as unknown as Event;
  try {
    await joinRoom(synthetic);
  } finally {
    for (const inp of createdInputs) inp.remove();
  }
}

async function saveProfile(event: Event): Promise<void> {
  event.preventDefault();
  if (!supabase || !view.session?.user) return;
  const name = (view.editingDisplayName ?? view.profile?.display_name ?? "").trim();
  if (!name) {
    showAlert("顯示名稱不能為空。");
    return;
  }
  await withAccountLoading(async () => {
    const { error } = await supabase.from("profiles").update({ display_name: name }).eq("user_id", view.session!.user.id);
    if (error) throw error;
    showToast("個人資料已更新。");
    view.editingDisplayName = undefined;
    view.editingDisplayNameActive = false;
    await loadAccountDataRaw();
  });
}

async function pickAvatar(slug: string | undefined): Promise<void> {
  if (!supabase || !view.session?.user || !slug) return;
  const avatarUrl = `/images/avatars/${slug}.webp`;
  await withAccountLoading(async () => {
    const { error } = await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("user_id", view.session!.user.id);
    if (error) throw error;
    showToast("頭像已更新。");
    view.avatarPickerOpen = false;
    await loadAccountDataRaw();
  });
}

function bindSelectionActions(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-hand-id]")) {
    el.addEventListener("click", () => {
      const handId = el.dataset.handId;
      const card = view.hand.find((item) => item.instanceId === handId);
      if (handId && card && view.selectedHandId === handId && canAfford(card.cost) && !cardNeedsTarget(card.cardId)) {
        send({ type: "playCard", handInstanceId: handId, target: inferDefaultTarget(card.cardId) });
        view.selectedHandId = undefined;
        view.selectedAttackerId = undefined;
        view.selectedTarget = undefined;
        render();
        return;
      }
      view.selectedHandId = view.selectedHandId === handId ? undefined : handId;
      view.selectedAttackerId = undefined;
      view.selectedTarget = undefined;
      render();
    });
    el.addEventListener("pointerdown", (event) => {
      clearHoverTooltip();
      attachHandPointerDrag(event, el);
    });
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-attacker-id]")) {
    el.addEventListener("click", (event) => {
      event.stopImmediatePropagation();
      view.selectedAttackerId = el.dataset.attackerId;
      view.selectedHandId = undefined;
      view.selectedTarget = undefined;
      render();
    });
    el.addEventListener("pointerdown", (event) => {
      clearHoverTooltip();
      attachAttackerPointerDrag(event, el);
    });
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-testid='board-minion']")) {
    bindHoverPreview(el, () => minionCardFromElement(el));
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-target]")) {
    el.addEventListener("click", () => {
      const target = JSON.parse(el.dataset.target!) as TargetRef;
      if (!isTargetHighlighted(target)) return;
      if (view.selectedAttackerId && isLegalAttackTarget(target)) {
        send({ type: "attack", attackerInstanceId: view.selectedAttackerId, target });
        view.selectedAttackerId = undefined;
        view.selectedHandId = undefined;
        view.selectedTarget = undefined;
      } else {
        const card = selectedHandCard();
        if (card && isLegalCardTarget(target)) {
          send({ type: "playCard", handInstanceId: card.instanceId, target });
          view.selectedAttackerId = undefined;
          view.selectedHandId = undefined;
          view.selectedTarget = undefined;
        } else if (confirmSelectedTarget(target)) {
          view.selectedAttackerId = undefined;
          view.selectedHandId = undefined;
          view.selectedTarget = undefined;
        } else {
          view.selectedTarget = target;
        }
      }
      render();
    });
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-mulligan-id]")) {
    el.addEventListener("click", () => {
      const id = el.dataset.mulliganId;
      if (!id) return;
      if (view.mulliganSelection.has(id)) view.mulliganSelection.delete(id);
      else view.mulliganSelection.add(id);
      render();
    });
  }
}

const hoverState: { timer?: number; lastCardId?: string; lastEl?: HTMLElement } = {};
const hoverCapable = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches;

function bindHoverPreview(el: HTMLElement, resolve: () => ResolvedCardView | undefined): void {
  if (!hoverCapable) return;
  el.addEventListener("mouseenter", (event) => {
    if (view.confirmingConcede) return;
    const card = resolve();
    if (!card) return;
    window.clearTimeout(hoverState.timer);
    hoverState.lastEl = el;
    const rect = el.getBoundingClientRect();
    const anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
    hoverState.timer = window.setTimeout(() => {
      if (hoverState.lastEl !== el) return;
      view.hoveredCardId = card.cardId;
      view.hoveredCard = card;
      view.hoverAnchor = anchor;
      hoverState.lastCardId = card.cardId;
      render();
    }, 220);
    void event;
  });
  el.addEventListener("mouseleave", () => {
    if (hoverState.lastEl === el) hoverState.lastEl = undefined;
    window.clearTimeout(hoverState.timer);
    hoverState.timer = undefined;
    if (view.hoveredCardId) {
      view.hoveredCardId = undefined;
      view.hoveredCard = undefined;
      view.hoverAnchor = undefined;
      render();
    }
  });
}

function clearHoverTooltip(): void {
  window.clearTimeout(hoverState.timer);
  hoverState.timer = undefined;
  hoverState.lastEl = undefined;
  if (view.hoveredCardId) {
    view.hoveredCardId = undefined;
    view.hoveredCard = undefined;
    view.hoverAnchor = undefined;
  }
}

function minionCardFromElement(el: HTMLElement): ResolvedCardView | undefined {
  const seat = el.dataset.seat as Seat | undefined;
  const targetKey = el.dataset.targetKey;
  if (!seat || !targetKey) return undefined;
  const player = readPlayer(seat);
  const minion = player?.board?.find((item) => item.instanceId === targetKey);
  if (!minion) return undefined;
  const catalogCard = cardCatalog.get(minion.cardId);
  return {
    cardId: minion.cardId,
    instanceId: `tooltip-${minion.instanceId}`,
    name: catalogCard?.name ?? minion.cardId,
    category: catalogCard?.category ?? "MINION",
    description: catalogCard?.description ?? "",
    image: catalogCard?.image ?? "",
    cost: catalogCard?.cost ?? 0,
    baseCost: catalogCard?.cost,
    type: "MINION",
    rarity: catalogCard?.rarity ?? "COMMON",
    attack: minion.attack,
    baseAttack: minion.baseAttack ?? catalogCard?.attack,
    health: minion.currentHealth,
    baseHealth: minion.health
  };
}

const DRAG_THRESHOLD_PX = 6;

function suppressNextClick(): void {
  const handler = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    document.removeEventListener("click", handler, true);
  };
  document.addEventListener("click", handler, true);
  window.setTimeout(() => document.removeEventListener("click", handler, true), 500);
}

function attachHandPointerDrag(event: PointerEvent, sourceEl: HTMLElement): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const handId = sourceEl.dataset.handId;
  if (!handId) return;
  const card = view.hand.find((item) => item.instanceId === handId);
  if (!card) return;
  if (!canAfford(card.cost)) return;
  const cardDef = cardCatalog.get(card.cardId);
  const isMinion = (cardDef?.type ?? card.type) === "MINION";
  const needsTarget = cardNeedsTarget(card.cardId);
  const lineKind = classifyEffectKind(cardDef?.keywords?.battlecry?.type);
  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;

  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onCancel);
    window.removeEventListener("pointercancel", onCancel);

    view.selectedHandId = handId;
    view.selectedAttackerId = undefined;
    view.selectedTarget = undefined;
    suppressNextClick();
    render();

    const refreshedSource =
      document.querySelector<HTMLElement>(`[data-hand-id="${cssEscape(handId)}"]`) ?? sourceEl;
    const playerBoardEl = document.querySelector<HTMLElement>('[data-testid="player-board"]');

    beginHandDrag({
      pointerId,
      startX,
      startY,
      sourceEl: refreshedSource,
      lineKind,
      needsTarget,
      isMinion,
      playerBoardEl,
      isEligibleTarget: (targetEl) => {
        const target = parseTargetAttr(targetEl);
        return Boolean(target && isLegalCardTarget(target));
      },
      onResolve: ({ insertionIndex, targetEl }) => {
        const target = targetEl ? parseTargetAttr(targetEl) : undefined;
        if (needsTarget && !target) {
          finalizeHandDrag(undefined);
          return;
        }
        if (!needsTarget && isMinion && insertionIndex < 0) {
          finalizeHandDrag(undefined);
          return;
        }
        send({
          type: "playCard",
          handInstanceId: handId,
          target: target ?? inferDefaultTarget(card.cardId),
          boardIndex: isMinion && insertionIndex >= 0 ? insertionIndex : undefined
        });
        finalizeHandDrag(handId);
      },
      onCancel: () => finalizeHandDrag(undefined)
    });
  };

  const onCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onCancel);
    window.removeEventListener("pointercancel", onCancel);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onCancel);
  window.addEventListener("pointercancel", onCancel);
}

function finalizeHandDrag(_handIdConsumed: string | undefined): void {
  view.selectedHandId = undefined;
  view.selectedTarget = undefined;
  render();
}

function attachAttackerPointerDrag(event: PointerEvent, sourceEl: HTMLElement): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const attackerId = sourceEl.dataset.attackerId;
  if (!attackerId) return;
  const minion = findMinion(attackerId);
  if (!minion?.canAttack) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;

  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onCancel);
    window.removeEventListener("pointercancel", onCancel);

    view.selectedAttackerId = attackerId;
    view.selectedHandId = undefined;
    view.selectedTarget = undefined;
    suppressNextClick();
    render();

    beginAttackDrag({
      pointerId,
      startX,
      startY,
      sourceEl,
      isEligibleTarget: (targetEl) => {
        const target = parseTargetAttr(targetEl);
        return Boolean(target && isLegalAttackTarget(target));
      },
      onResolve: (targetEl) => {
        const target = parseTargetAttr(targetEl);
        if (target && isLegalAttackTarget(target)) {
          send({ type: "attack", attackerInstanceId: attackerId, target });
        }
        view.selectedAttackerId = undefined;
        view.selectedTarget = undefined;
        render();
      },
      onCancel: () => {
        view.selectedAttackerId = undefined;
        view.selectedTarget = undefined;
        render();
      }
    });
  };

  const onCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onCancel);
    window.removeEventListener("pointercancel", onCancel);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onCancel);
  window.addEventListener("pointercancel", onCancel);
}

function parseTargetAttr(el: HTMLElement | null): TargetRef | undefined {
  if (!el) return undefined;
  const raw = el.getAttribute("data-target");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as TargetRef;
  } catch {
    return undefined;
  }
}

function cssEscape(value: string): string {
  if (typeof (window as any).CSS?.escape === "function") return (window as any).CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

async function backToLobby(): Promise<void> {
  const room = view.room;
  view.room = undefined;
  view.mySeat = undefined;
  view.hand = [];
  view.state = undefined;
  view.publicSync = undefined;
  view.presence.clear();
  view.rejectedHandIds.clear();
  view.selectedHandId = undefined;
  view.mulliganSelection.clear();
  view.selectedAttackerId = undefined;
  view.selectedTarget = undefined;
  view.events = [];
  view.animationCues = [];
  view.eventStatus = undefined;
  view.toast = undefined;
  view.matchmaking = undefined;
  view.privateJoinCode = undefined;
  stopMatchmakingTick();
  view.menuScreen = "main";
  if (room) {
    try {
      await room.leave(true);
    } catch {
      // The room may already be closed after match cleanup.
    }
  }
  if (supabase && view.session) await loadAccountData();
  else render();
}

async function joinRoom(event: Event): Promise<void> {
  event.preventDefault();
  if (view.joining || view.room) return;
  const serverUrl = (document.querySelector<HTMLInputElement>("#server-url")?.value || defaultServerUrl).trim();
  const displayName = (document.querySelector<HTMLInputElement>("#display-name")?.value || "Player").trim();
  view.joining = true;
  render();

  const client = new Client(serverUrl);

  try {
    if (supabase && !view.session) throw new Error("Sign in before joining PvP.");
    if (supabase && !view.selectedDeckId) throw new Error("Select a saved deck before joining PvP.");
    const reconnectToken = new URLSearchParams(location.search).get("reconnect");
    const joinOptions = supabase
      ? {
          displayName: view.profile?.display_name ?? displayName,
          accessToken: view.session?.access_token,
          deckId: view.selectedDeckId
        }
      : { displayName };
    const joined: Room = reconnectToken
      ? await (client as any).reconnect(reconnectToken, GameStateSchema)
      : await client.joinOrCreate("pvp", joinOptions, GameStateSchema);

    view.room = joined;
    view.eventStatus = undefined;
    view.publicSync = undefined;
    view.presence.clear();
    view.rejectedHandIds.clear();
    view.matchmaking = undefined;
    stopMatchmakingTick();
    (window as any).__room = joined;

    joined.onStateChange((nextState: any) => {
      view.state = nextState;
      publishDebugState();
      pruneSelections();
      render();
    });
    joined.onMessage("seat", (message: { seat: Seat }) => {
      view.mySeat = message.seat;
      render();
    });
    joined.onMessage("hand", (message: { cards: HandCardView[] }) => {
      view.hand = message.cards;
      pruneSelections();
      render();
    });
    joined.onMessage("presence", (message: { seat: Seat; connected: boolean; reconnectUntilMs?: number }) => {
      view.presence.set(message.seat, { connected: message.connected, reconnectUntilMs: message.reconnectUntilMs });
      render();
    });
    joined.onMessage(
      "publicSync",
      (message: {
        status?: GameStatus;
        activeSeat?: Seat;
        turnNumber?: number;
        actionSeq?: number;
        result?: any;
        players?: Partial<Record<Seat, PublicPlayer>>;
      }) => {
      view.publicSync = message;
      render();
      }
    );
    joined.onMessage("events", (message: GameEvent[]) => {
      handleEvents(message);
    });
  } catch (error) {
    showAlert(error instanceof Error ? error.message : "Unable to join room.");
    view.matchmaking = undefined;
    stopMatchmakingTick();
  } finally {
    view.joining = false;
    render();
  }
}

async function initializeAccount(): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  view.session = data.session;
  if (view.session) await loadAccountData();
  supabase.auth.onAuthStateChange((event, session) => {
    const previousUserId = view.session?.user?.id;
    const nextUserId = session?.user?.id;
    view.session = session;
    if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
    if (event === "SIGNED_IN" && previousUserId === nextUserId) return;
    if (session) {
      if (previousUserId !== nextUserId) view.menuScreen = "main";
      void loadAccountData();
    } else {
      view.profile = undefined;
      view.decks = [];
      view.collection = [];
      view.matchHistory = [];
      view.friends = [];
      view.friendRequests = [];
      view.selectedDeckId = undefined;
      view.editingDeck = undefined;
      view.menuScreen = "main";
      render();
    }
  });
  render();
}

async function signInWithPassword(event: Event): Promise<void> {
  event.preventDefault();
  if (!supabase) return;
  const credentials = readAuthFields();
  await withAccountLoading(async () => {
    const { error } = await supabase.auth.signInWithPassword(credentials);
    if (error) throw error;
    pendingWelcomeToast = true;
  });
}

async function signUpWithPassword(): Promise<void> {
  if (!supabase) return;
  const { email, password } = readAuthFields();
  await withAccountLoading(async () => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: email.split("@")[0] || "Player" } }
    });
    if (error) throw error;
    showToast("帳號已建立，請確認信箱後登入。");
  });
}

async function signInWithGoogle(): Promise<void> {
  if (!supabase) return;
  await withAccountLoading(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname }
    });
    if (error) throw error;
  });
}

async function signOut(): Promise<void> {
  if (!supabase) return;
  await withAccountLoading(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    showToast("已登出。");
  });
}

async function recordDailyLoginIfAvailable(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  const { error } = await supabase.rpc("record_daily_login");
  if (error) {
    console.warn("daily login tracking failed", error);
  }
}

async function loadAccountData(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  await withAccountLoading(async () => {
    await ensureProfile();
    await ensureCollection();
    await recordDailyLoginIfAvailable();

    const userId = view.session!.user.id;
    const [profileResult, decksResult, collectionResult, historyResult] = await Promise.all([
      supabase
        .from("profiles")
        .select(PROFILE_SELECT)
        .eq("user_id", userId)
        .single(),
      supabase
        .from("decks")
        .select("id,user_id,name,card_catalog_version,card_ids,cover_card_id,updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("card_collections")
        .select("card_id,quantity")
        .eq("user_id", userId)
        .eq("card_catalog_version", CARD_CATALOG_VERSION)
        .order("card_id", { ascending: true }),
      supabase
        .from("match_history")
        .select("id,winner_seat,result_reason,created_at,finished_at,player1_user_id,player2_user_id")
        .order("finished_at", { ascending: false })
        .limit(20)
    ]);

    if (profileResult.error) throw profileResult.error;
    if (decksResult.error) throw decksResult.error;
    if (collectionResult.error) throw collectionResult.error;
    if (historyResult.error) throw historyResult.error;

    view.profile = profileResult.data as ProfileRow;
    view.decks = (decksResult.data ?? []) as DeckRow[];
    view.collection = (collectionResult.data ?? []) as CollectionRow[];
    view.matchHistory = (historyResult.data ?? []) as MatchHistoryRow[];
    if (!view.selectedDeckId || !view.decks.some((deck) => deck.id === view.selectedDeckId)) {
      view.selectedDeckId = view.decks[0]?.id;
    }
    if (view.editingDeck?.id) {
      const editingDeck = view.decks.find((deck) => deck.id === view.editingDeck?.id);
      view.editingDeck = editingDeck ? { ...editingDeck, card_ids: [...editingDeck.card_ids] } : undefined;
    }
    if (pendingWelcomeToast) {
      pendingWelcomeToast = false;
      showToast(`歡迎回來，${view.profile?.display_name ?? "玩家"}！`);
    }
  });
}

async function syncCollection(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  await withAccountLoading(async () => {
    await ensureCollection();
    showToast("收藏已同步。");
    await loadAccountDataRaw();
  });
}

async function loadAccountDataRaw(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  const userId = view.session.user.id;
  const [profileResult, decksResult, collectionResult, historyResult] = await Promise.all([
    supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("user_id", userId)
      .single(),
    supabase
      .from("decks")
      .select("id,user_id,name,card_catalog_version,card_ids,cover_card_id,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("card_collections")
      .select("card_id,quantity")
      .eq("user_id", userId)
      .eq("card_catalog_version", CARD_CATALOG_VERSION)
      .order("card_id", { ascending: true }),
    supabase
      .from("match_history")
      .select("id,winner_seat,result_reason,created_at,finished_at")
      .order("finished_at", { ascending: false })
      .limit(20)
  ]);

  if (profileResult.error) throw profileResult.error;
  if (decksResult.error) throw decksResult.error;
  if (collectionResult.error) throw collectionResult.error;
  if (historyResult.error) throw historyResult.error;

  view.profile = profileResult.data as ProfileRow;
  view.decks = (decksResult.data ?? []) as DeckRow[];
  view.collection = (collectionResult.data ?? []) as CollectionRow[];
  view.matchHistory = (historyResult.data ?? []) as MatchHistoryRow[];
  if (!view.selectedDeckId || !view.decks.some((deck) => deck.id === view.selectedDeckId)) {
    view.selectedDeckId = view.decks[0]?.id;
  }
  if (view.editingDeck?.id) {
    const editingDeck = view.decks.find((deck) => deck.id === view.editingDeck?.id);
    view.editingDeck = editingDeck ? { ...editingDeck, card_ids: [...editingDeck.card_ids] } : undefined;
  }
}

async function ensureCollection(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("ensure_full_seed_collection", {
    target_version: CARD_CATALOG_VERSION
  });
  if (error) throw error;
}

async function ensureProfile(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  const user = view.session.user;
  const metadata = user.user_metadata ?? {};
  const displayName =
    (typeof metadata.display_name === "string" && metadata.display_name) ||
    (typeof metadata.name === "string" && metadata.name) ||
    user.email?.split("@")[0] ||
    "Player";
  const { error } = await supabase.from("profiles").upsert({
    user_id: user.id,
    display_name: displayName,
    avatar_url: typeof metadata.avatar_url === "string" ? metadata.avatar_url : null
  });
  if (error) throw error;
}

async function saveEditingDeck(event: Event): Promise<void> {
  event.preventDefault();
  if (!supabase || !view.editingDeck) return;
  const name = (document.querySelector<HTMLInputElement>("#deck-name")?.value ?? view.editingDeck.name).trim();
  const cardIds = view.editingDeck.card_ids;
  const coverCardId =
    view.editingDeck.cover_card_id && cardIds.includes(view.editingDeck.cover_card_id)
      ? view.editingDeck.cover_card_id
      : null;
  await withAccountLoading(async () => {
    const { data, error } = await supabase.rpc("save_user_deck", {
      p_deck_id: view.editingDeck?.id ?? null,
      p_name: name,
      p_card_catalog_version: CARD_CATALOG_VERSION,
      p_card_ids: cardIds,
      p_cover_card_id: coverCardId
    });
    if (error) throw error;
    const saved = data as DeckRow;
    showToast(`牌組「${saved.name}」已儲存。`);
    view.selectedDeckId = saved.id;
    view.editingDeck = undefined;
    await loadAccountData();
  });
}

async function deleteDeck(deckId: string | undefined): Promise<void> {
  if (!supabase || !deckId) return;
  await withAccountLoading(async () => {
    const { error } = await supabase.rpc("delete_user_deck", { p_deck_id: deckId });
    if (error) throw error;
    showToast("牌組已刪除。");
    if (view.selectedDeckId === deckId) view.selectedDeckId = undefined;
    if (view.editingDeck?.id === deckId) view.editingDeck = undefined;
    await loadAccountData();
  });
}

async function disenchantCard(cardId: string, count: number): Promise<void> {
  if (!supabase || !view.session?.user || view.cardOpBusy) return;
  const card = cardCatalog.get(cardId);
  if (!card) return;
  const gain = voucherRate(card.rarity).disenchant * count;
  const ok = await themedConfirm({
    title: "分解卡牌",
    message: `確定要分解 ${count} 張「${card.name}」嗎？分解後將獲得 ${gain} 點消費券。`,
    confirmLabel: "分解",
    danger: true
  });
  if (!ok) return;
  view.cardOpBusy = true;
  render();
  try {
    const { error } = await supabase.rpc("disenchant_card", { p_card_id: cardId, p_count: count });
    if (error) throw error;
    await loadAccountDataRaw();
    showToast(`分解成功！獲得 ${gain} 點消費券。`);
  } catch (error) {
    showToast(`分解失敗：${errorMessage(error)}`);
  } finally {
    view.cardOpBusy = false;
    render();
  }
}

async function craftCard(cardId: string): Promise<void> {
  if (!supabase || !view.session?.user || view.cardOpBusy) return;
  const card = cardCatalog.get(cardId);
  if (!card) return;
  const cost = voucherRate(card.rarity).craft;
  const ok = await themedConfirm({
    title: "合成卡牌",
    message: `確定要合成「${card.name}」嗎？合成將消耗 ${cost} 點消費券。`,
    confirmLabel: "合成"
  });
  if (!ok) return;
  view.cardOpBusy = true;
  render();
  try {
    const { error } = await supabase.rpc("craft_card", { p_card_id: cardId });
    if (error) throw error;
    await loadAccountDataRaw();
    showToast(`合成成功！消耗 ${cost} 點消費券。`);
  } catch (error) {
    showToast(`合成失敗：${errorMessage(error)}`);
  } finally {
    view.cardOpBusy = false;
    render();
  }
}

function extraCopyEntries(): Array<{ cardId: string; extra: number }> {
  const entries: Array<{ cardId: string; extra: number }> = [];
  for (const row of view.collection) {
    const card = cardCatalog.get(row.card_id);
    if (!card || card.collectible === false) continue;
    const extra = row.quantity - DECK_COPY_LIMIT;
    if (extra > 0) entries.push({ cardId: row.card_id, extra });
  }
  return entries;
}

async function bulkDisenchantExtras(): Promise<void> {
  if (!supabase || !view.session?.user || view.cardOpBusy) return;
  const entries = extraCopyEntries();
  if (entries.length === 0) {
    showToast("沒有超過 2 張的卡牌可分解。");
    return;
  }
  let totalCards = 0;
  let totalGain = 0;
  for (const { cardId, extra } of entries) {
    const card = cardCatalog.get(cardId);
    if (!card) continue;
    totalCards += extra;
    totalGain += voucherRate(card.rarity).disenchant * extra;
  }
  const ok = await themedConfirm({
    title: "一鍵分解多餘卡",
    message: `分解所有超過 2 張的多餘卡牌？共 ${totalCards} 張，可獲得約 ${totalGain} 點消費券。`,
    confirmLabel: "一鍵分解",
    danger: true
  });
  if (!ok) return;
  view.cardOpBusy = true;
  render();
  try {
    for (const { cardId, extra } of entries) {
      const { error } = await supabase.rpc("disenchant_card", { p_card_id: cardId, p_count: extra });
      if (error) throw error;
    }
    await loadAccountDataRaw();
    showToast(`一鍵分解完成！分解 ${totalCards} 張，獲得 ${totalGain} 點消費券。`);
  } catch (error) {
    showToast(`一鍵分解失敗：${errorMessage(error)}`);
  } finally {
    view.cardOpBusy = false;
    render();
  }
}

function startNewDeck(doRender = true): void {
  view.editingDeck = { name: "New Deck", card_ids: [] };
  view.selectedDeckId = undefined;
  if (doRender) render();
}

function autofillDeck(): void {
  if (!view.editingDeck) return;
  const ids: string[] = [];
  const collectionMap = new Map(view.collection.map((row) => [row.card_id, row.quantity]));
  let legendaryCount = 0;
  for (const card of CARD_CATALOG) {
    if (card.collectible === false) continue;
    const owned = hasCollectionRows() ? (collectionMap.get(card.id) ?? 0) : deckCopyLimit(card);
    const copies = Math.min(deckCopyLimit(card), owned);
    for (let i = 0; i < copies && ids.length < 30; i++) {
      if (card.rarity === "LEGENDARY") {
        if (legendaryCount >= DECK_LEGENDARY_LIMIT) break;
        legendaryCount++;
      }
      ids.push(card.id);
    }
    if (ids.length >= 30) break;
  }
  view.editingDeck = { ...view.editingDeck!, card_ids: ids };
  refreshCollectionDeckWorkspace();
}

function clearDeck(): void {
  if (!view.editingDeck) return;
  view.editingDeck = { ...view.editingDeck, card_ids: [], cover_card_id: null };
  refreshCollectionDeckWorkspace();
}

function addCardToEditor(cardId: string | undefined): void {
  if (!cardId) return;
  if (!view.editingDeck) return;
  const card = cardCatalog.get(cardId);
  if (!card) return;
  const counts = countCards(view.editingDeck!.card_ids);
  const limit = deckCopyLimit(card);
  const owned = hasCollectionRows()
    ? (view.collection.find((row) => row.card_id === cardId)?.quantity ?? 0)
    : limit;
  if (owned <= 0 || (counts.get(cardId) ?? 0) >= Math.min(limit, owned) || view.editingDeck!.card_ids.length >= 30) return;
  if (!canAddLegendary(card, view.editingDeck!.card_ids)) {
    showToast(`傳說卡牌在牌組中最多只能放 ${DECK_LEGENDARY_LIMIT} 張！`);
    return;
  }
  view.editingDeck = { ...view.editingDeck!, card_ids: [...view.editingDeck!.card_ids, cardId] };
  refreshCollectionDeckWorkspace();
}

function removeCardFromEditor(cardId: string | undefined): void {
  if (!cardId || !view.editingDeck) return;
  const index = view.editingDeck.card_ids.indexOf(cardId);
  if (index < 0) return;
  const cardIds = [...view.editingDeck.card_ids];
  cardIds.splice(index, 1);
  const coverStillValid = view.editingDeck.cover_card_id ? cardIds.includes(view.editingDeck.cover_card_id) : true;
  view.editingDeck = {
    ...view.editingDeck,
    card_ids: cardIds,
    cover_card_id: coverStillValid ? view.editingDeck.cover_card_id : null
  };
  refreshCollectionDeckWorkspace();
}

async function withAccountLoading(action: () => Promise<void>): Promise<void> {
  view.accountLoading = true;
  render();
  try {
    await action();
  } catch (error) {
    showAlert(errorMessage(error));
  } finally {
    view.accountLoading = false;
    render();
  }
}

function showAlert(message: string, title = "提示"): void {
  document.getElementById("alert-overlay")?.remove();
  const overlay = document.createElement("section");
  overlay.id = "alert-overlay";
  overlay.className = "confirm-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="confirm-content">
      <h3>${escapeHtml(title)}</h3>
      <p class="confirm-message">${escapeHtml(message)}</p>
      <div class="confirm-actions">
        <button id="alert-ok">確定</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const dismiss = (): void => { overlay.remove(); };
  overlay.querySelector<HTMLButtonElement>("#alert-ok")?.addEventListener("click", dismiss);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
  (overlay.querySelector<HTMLButtonElement>("#alert-ok"))?.focus();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let pendingWelcomeToast = false;
function showToast(message: string): void {
  let el = document.getElementById("medieval-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "medieval-toast";
    el.className = "medieval-toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  if (toastTimer !== undefined) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el!.classList.remove("show");
    toastTimer = undefined;
  }, 2500);
}

function readAuthFields(): { email: string; password: string } {
  const email = document.querySelector<HTMLInputElement>("#auth-email")?.value.trim() ?? "";
  const password = document.querySelector<HTMLInputElement>("#auth-password")?.value ?? "";
  if (!email || !password) throw new Error("Email and password are required.");
  return { email, password };
}

function send(command: GameCommand): void {
  if (!view.room) return;
  const expectedActionSeq = view.publicSync?.actionSeq ?? view.state?.turn?.actionSeq ?? 0;
  const message: ClientCommandMessage = {
    commandId: `${view.mySeat ?? "client"}-${crypto.randomUUID()}`,
    expectedActionSeq,
    command
  };
  view.room.send("command", message);
  if (command.type !== "submitMulligan" && command.type !== "reconnect") {
    view.publicSync = { ...view.publicSync, actionSeq: expectedActionSeq + 1 };
  }
}

function handleEvents(message: GameEvent[]): void {
  view.events = [...message, ...view.events].slice(0, 50);
  enqueueEventCues(message);
  playEventAudio(message);
  const rejection = message.find((item) => item.type === "COMMAND_REJECTED");
  if (rejection) {
    if (view.selectedHandId) view.rejectedHandIds.add(view.selectedHandId);
    view.toast = String(rejection.payload?.reason ?? "Command rejected.");
    window.setTimeout(() => {
      view.toast = undefined;
      render();
    }, 2200);
  }
  if (message.some((item) => item.type === "GAME_FINISHED")) {
    view.eventStatus = "finished";
  } else if (message.some((item) => item.type === "TURN_STARTED")) {
    view.eventStatus = "in_progress";
  }
  render();
}

function enqueueEventCues(events: GameEvent[]): void {
  const cues = events.map(eventToCue).filter((cue): cue is AnimationCue => Boolean(cue));
  if (cues.length === 0) return;
  view.animationCues = [...cues, ...view.animationCues].slice(0, 12);
  for (const cue of cues) {
    const lifetime =
      cue.kind === "play" ? 1250
      : cue.kind === "attackerMoves" ? 460
      : cue.kind === "damage" || cue.kind === "heal" ? 1150
      : cue.kind === "destroy" ? 700
      : cue.kind === "summon" ? 1600
      : 900;
    window.setTimeout(() => {
      view.animationCues = view.animationCues.filter((item) => item.id !== cue.id);
      render();
    }, lifetime);
  }
}

function eventToCue(event: GameEvent): AnimationCue | undefined {
  const payload = event.payload ?? {};
  const target = typeof payload.target === "string" ? payload.target : undefined;
  const amount = typeof payload.amount === "number" ? payload.amount : undefined;
  const cardId = typeof payload.cardId === "string" ? payload.cardId : undefined;
  const id = `${event.seq}-${event.type}-${crypto.randomUUID()}`;
  if (event.type === "CARD_PLAYED") {
    const playedCardId = typeof payload.cardId === "string" ? payload.cardId : undefined;
    return { id, kind: "play", text: cardName(playedCardId) ?? "Card played", seat: event.seat, cardId: playedCardId };
  }
  if (event.type === "MINION_SUMMONED") {
    return { id, kind: "summon", text: "Summoned", seat: event.seat, targetKey: target, cardId };
  }
  if (event.type === "ATTACK") {
    const attackerInstanceId = typeof payload.attackerInstanceId === "string" ? payload.attackerInstanceId : undefined;
    const targetRef = (payload.target ?? undefined) as TargetRef | undefined;
    const targetKey = targetRef ? targetKeyFor(targetRef) : undefined;
    return { id, kind: "attackerMoves", text: "", seat: event.seat, attackerInstanceId, targetKey };
  }
  if (event.type === "DAMAGE") return { id, kind: "damage", text: amount ? `-${amount}` : "Damage", seat: event.seat, targetKey: target, amount };
  if (event.type === "HEAL") return { id, kind: "heal", text: amount ? `+${amount}` : "Heal", seat: event.seat, targetKey: target, amount };
  if (event.type === "BUFF" || event.type === "SHIELD_POPPED") return { id, kind: "buff", text: "Buff", seat: event.seat, targetKey: target };
  if (event.type === "DESTROY") return { id, kind: "destroy", text: "Destroyed", seat: event.seat, targetKey: target, cardId };
  if (event.type === "TURN_STARTED") return { id, kind: "turn", text: event.seat === view.mySeat ? "Your Turn" : "Opponent Turn", seat: event.seat };
  if (event.type === "COMMAND_REJECTED") return { id, kind: "reject", text: String(payload.reason ?? "Command rejected"), seat: event.seat };
  return undefined;
}

function pruneSelections(): void {
  const handIds = new Set(view.hand.map((card) => card.instanceId));
  if (view.selectedHandId && !handIds.has(view.selectedHandId)) view.selectedHandId = undefined;
  for (const id of view.rejectedHandIds) {
    if (!handIds.has(id)) view.rejectedHandIds.delete(id);
  }
  for (const id of view.mulliganSelection) {
    if (!handIds.has(id)) view.mulliganSelection.delete(id);
  }
  if (view.selectedAttackerId && !findMinion(view.selectedAttackerId)) view.selectedAttackerId = undefined;
  if (view.selectedTarget) {
    const target = view.selectedTarget;
    if (view.selectedAttackerId && !isLegalAttackTarget(target)) view.selectedTarget = undefined;
    if (view.selectedHandId && cardNeedsTarget(selectedHandCard()?.cardId ?? "") && !isLegalCardTarget(target)) {
      view.selectedTarget = undefined;
    }
  }
}

function readPlayer(seat: Seat): PublicPlayer | undefined {
  return applyPresenceOverride(seat, view.publicSync?.players?.[seat] ?? (view.state ? readPlayerFromState(view.state, seat) : undefined));
}

function readPlayerFromState(source: any, seat: Seat): PublicPlayer | undefined {
  return source.players?.get?.(seat) ?? source.players?.[seat] ?? source[seat];
}

function applyPresenceOverride(seat: Seat, player: PublicPlayer | undefined): PublicPlayer | undefined {
  const presence = view.presence.get(seat);
  if (!player || !presence) return player;
  return {
    ...player,
    connected: presence.connected,
    reconnectUntilMs: presence.reconnectUntilMs ?? player.reconnectUntilMs
  };
}

function readStatus(): GameStatus | "" {
  const status = view.state?.status ?? "";
  if (view.publicSync?.status) return view.publicSync.status;
  if (view.eventStatus === "in_progress" && status === "mulligan") return "in_progress";
  return status === "finished" || status === "abandoned" ? status : view.eventStatus ?? status;
}

function readActiveSeat(): Seat | "" {
  if (view.publicSync?.activeSeat) return view.publicSync.activeSeat;
  const turnStarted = view.events.find((event) => event.type === "TURN_STARTED");
  const eventSeat = turnStarted?.payload?.activeSeat;
  if (eventSeat === "player1" || eventSeat === "player2") return eventSeat;
  return view.state?.turn?.activeSeat ?? "";
}

function readTurnNumber(): number {
  return view.publicSync?.turnNumber ?? view.state?.turn?.number ?? 0;
}

function hasBothPlayers(): boolean {
  return seats.every((seat) => Boolean(readPlayer(seat)?.displayName));
}

function otherSeat(seat: Seat): Seat {
  return seat === "player1" ? "player2" : "player1";
}

function resolveHandCard(card: HandCardView): ResolvedCardView {
  const catalogCard = cardCatalog.get(card.cardId);
  return {
    cardId: card.cardId,
    instanceId: card.instanceId,
    name: catalogCard?.name ?? card.cardId,
    category: catalogCard?.category ?? card.type,
    description: catalogCard?.description ?? "",
    image: catalogCard?.image ?? "",
    cost: card.cost,
    baseCost: catalogCard?.cost,
    type: card.type,
    rarity: catalogCard?.rarity ?? "COMMON",
    attack: card.attack ?? catalogCard?.attack,
    baseAttack: catalogCard?.attack,
    health: card.health ?? catalogCard?.health,
    baseHealth: catalogCard?.health
  };
}

function selectedMinionClass(instanceId: string, target: TargetRef): string {
  if (view.selectedAttackerId === instanceId) return "selected attacker-selected";
  if (sameTarget(view.selectedTarget, target)) return "selected target-selected";
  return "";
}

function isTargetHighlighted(target: TargetRef): boolean {
  if (sameTarget(view.selectedTarget, target)) return true;
  if (view.selectedAttackerId) return isLegalAttackTarget(target);
  if (view.selectedHandId) return isLegalCardTarget(target);
  return false;
}

function activeTargeting(): boolean {
  return Boolean(view.selectedAttackerId || (selectedHandCard() && cardNeedsTarget(selectedHandCard()!.cardId)));
}

function selectedHandCard(): HandCardView | undefined {
  return view.hand.find((card) => card.instanceId === view.selectedHandId);
}

function isLegalAttackTarget(target: TargetRef): boolean {
  if (!view.mySeat || !view.selectedAttackerId || target.side === view.mySeat) return false;
  const attacker = Array.from(readPlayer(view.mySeat)?.board ?? []).find((minion) => minion.instanceId === view.selectedAttackerId);
  if (!attacker?.canAttack) return false;
  const enemy = otherSeat(view.mySeat);
  const enemyTaunts = Array.from(readPlayer(enemy)?.board ?? []).filter((minion) => minion.taunt);
  if (enemyTaunts.length === 0) return target.side === enemy;
  return target.side === enemy && target.type === "MINION" && enemyTaunts.some((minion) => minion.instanceId === target.instanceId);
}

function isLegalCardTarget(target: TargetRef): boolean {
  const card = selectedHandCard();
  if (!card || !view.mySeat) return false;
  const rule = cardCatalog.get(card.cardId)?.keywords?.battlecry?.target;
  if (!rule) return false;
  const expectedSides = targetRuleSides(rule.side);
  const expectedTypes = targetRuleTypes(rule.type);
  return Boolean(target.side && expectedSides.includes(target.side) && expectedTypes.includes(target.type));
}

function targetRuleSides(side: "FRIENDLY" | "ENEMY" | "ALL" | undefined): Seat[] {
  if (!view.mySeat) return [];
  if (side === "FRIENDLY") return [view.mySeat];
  if (side === "ENEMY") return [otherSeat(view.mySeat)];
  return [view.mySeat, otherSeat(view.mySeat)];
}

function targetRuleTypes(type: "MINION" | "HERO" | "ALL" | undefined): Array<TargetRef["type"]> {
  if (type === "MINION") return ["MINION"];
  if (type === "HERO") return ["HERO"];
  return ["HERO", "MINION"];
}

function confirmSelectedTarget(target: TargetRef): boolean {
  if (!sameTarget(view.selectedTarget, target)) return false;
  if (view.selectedAttackerId && isLegalAttackTarget(target)) {
    send({ type: "attack", attackerInstanceId: view.selectedAttackerId, target });
    return true;
  }
  const card = selectedHandCard();
  if (card && isLegalCardTarget(target)) {
    send({ type: "playCard", handInstanceId: card.instanceId, target });
    return true;
  }
  return false;
}

function targetKeyFor(target: TargetRef): string {
  if (target.type === "HERO") return `${target.side}:hero`;
  return target.instanceId ?? "";
}

function hasCue(targetKey: string | undefined, kind?: AnimationKind): boolean {
  if (!targetKey) return false;
  return view.animationCues.some((cue) => cue.targetKey === targetKey && (!kind || cue.kind === kind));
}

const appliedLunges = new Set<string>();

function applyPostRenderEffects(): void {
  const surface = document.querySelector<HTMLElement>(".battle-surface");
  const eventLayer = document.querySelector<HTMLElement>(".event-layer");
  for (const cue of view.animationCues) {
    if (cue.kind === "attackerMoves" && cue.attackerInstanceId && cue.targetKey && !appliedLunges.has(cue.id)) {
      const attacker = document.querySelector<HTMLElement>(`[data-target-key="${cssEscape(cue.attackerInstanceId)}"]`);
      const target = document.querySelector<HTMLElement>(`[data-target-key="${cssEscape(cue.targetKey)}"]`);
      if (attacker && target) {
        const a = attacker.getBoundingClientRect();
        const t = target.getBoundingClientRect();
        const dx = Math.round(t.left + t.width / 2 - (a.left + a.width / 2));
        const dy = Math.round(t.top + t.height / 2 - (a.top + a.height / 2));
        attacker.style.setProperty("--lunge-dx", `${dx}px`);
        attacker.style.setProperty("--lunge-dy", `${dy}px`);
        attacker.classList.add("lunging");
        appliedLunges.add(cue.id);
        window.setTimeout(() => {
          attacker.classList.remove("lunging");
          attacker.style.removeProperty("--lunge-dx");
          attacker.style.removeProperty("--lunge-dy");
          appliedLunges.delete(cue.id);
        }, 460);
      }
    }
  }
  if (surface && eventLayer) {
    const surfaceRect = surface.getBoundingClientRect();
    for (const node of eventLayer.querySelectorAll<HTMLElement>("[data-anchor-key]")) {
      if (node.dataset.anchored === "true") continue;
      const anchorKey = node.dataset.anchorKey ?? "";
      const target = document.querySelector<HTMLElement>(`[data-target-key="${cssEscape(anchorKey)}"]`);
      if (!target) continue;
      const r = target.getBoundingClientRect();
      const x = r.left + r.width / 2 - surfaceRect.left;
      const y = r.top + r.height / 2 - surfaceRect.top;
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.dataset.anchored = "true";
    }
  }
}


function cardName(cardId: string | undefined): string | undefined {
  return cardId ? cardCatalog.get(cardId)?.name ?? cardId : undefined;
}

function sameTarget(a: TargetRef | undefined, b: TargetRef): boolean {
  return Boolean(a && a.type === b.type && a.side === b.side && a.instanceId === b.instanceId);
}

function targetLabel(target: TargetRef): string {
  return target.type === "HERO" ? `${target.side} hero` : `${target.side} ${target.instanceId}`;
}

function targetAttr(target: TargetRef): string {
  return escapeAttr(JSON.stringify(target));
}

function findMinion(instanceId: string): PublicMinion | undefined {
  for (const seat of seats) {
    const minion = Array.from(readPlayer(seat)?.board ?? []).find((item) => item.instanceId === instanceId);
    if (minion) return minion;
  }
  return undefined;
}

function minionKeywords(minion: PublicMinion): string[] {
  return [
    minion.taunt ? "taunt" : "",
    minion.divineShield ? "shield" : "",
    minion.canAttack ? "ready" : "",
    minion.lockedTurns > 0 ? `lock ${minion.lockedTurns}` : "",
    minion.deathTimer !== undefined && minion.deathTimer >= 0 ? `timer ${minion.deathTimer}` : "",
    minion.questTurns !== undefined && minion.questTurns >= 0 ? `quest ${minion.questTurns}` : ""
  ].filter(Boolean);
}

function canAfford(cost: number): boolean {
  const player = view.mySeat ? readPlayer(view.mySeat) : undefined;
  return Boolean(player && player.mana.current >= cost && readActiveSeat() === view.mySeat);
}

function cardNeedsTarget(cardId: string): boolean {
  const effect = cardCatalog.get(cardId)?.keywords?.battlecry;
  return Boolean(effect?.target);
}

function inferDefaultTarget(cardId: string | undefined): TargetRef | undefined {
  if (!cardId || !view.mySeat) return undefined;
  const rule = cardCatalog.get(cardId)?.keywords?.battlecry?.target;
  if (!rule) return undefined;
  const enemy = otherSeat(view.mySeat);
  if (rule.type === "HERO" || rule.type === "ALL") {
    if (rule.side === "FRIENDLY") return { type: "HERO", side: view.mySeat };
    return { type: "HERO", side: enemy };
  }
  if (rule.type !== "MINION") return undefined;

  const sideOrder: Seat[] =
    rule.side === "FRIENDLY" ? [view.mySeat] : rule.side === "ENEMY" ? [enemy] : [enemy, view.mySeat];
  for (const side of sideOrder) {
    const minion = Array.from(readPlayer(side)?.board ?? [])[0];
    if (minion) return { type: "MINION", side, instanceId: minion.instanceId };
  }
  return undefined;
}

function countCards(cardIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of cardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

const DECK_COPY_LIMIT = 2;
const DECK_LEGENDARY_LIMIT = 2;

function deckCopyLimit(card: CardDefinition): number {
  if (card.collectible === false) return 0;
  return DECK_COPY_LIMIT;
}

function deckLegendaryCount(cardIds: readonly string[]): number {
  let total = 0;
  for (const id of cardIds) {
    if (cardCatalog.get(id)?.rarity === "LEGENDARY") total++;
  }
  return total;
}

function canAddLegendary(card: CardDefinition, cardIds: readonly string[]): boolean {
  if (card.rarity !== "LEGENDARY") return true;
  return deckLegendaryCount(cardIds) < DECK_LEGENDARY_LIMIT;
}

function hasCollectionRows(): boolean {
  return view.collection.length > 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const maybe = error as { message?: unknown; error_description?: unknown; details?: unknown; hint?: unknown };
    const parts = [maybe.message, maybe.error_description, maybe.details, maybe.hint]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
    if (parts.length > 0) return parts.join(" ");
  }
  if (typeof error === "string" && error.trim()) return error;
  return "Account action failed. Check Supabase configuration and browser console.";
}

function isLocalDevHost(): boolean {
  return ["localhost", "127.0.0.1", "0.0.0.0", ""].includes(location.hostname);
}

function publishDebugState(): void {
  if ((window as any).__gameState) return;
  const debugState: any = {
    players: {
      get: (seat: Seat) => debugPlayer(view.state, seat)
    }
  };
  Object.defineProperties(debugState, {
    status: { get: () => readStatus() },
    turn: { get: () => view.state?.turn },
    player1: { get: () => debugPlayer(view.state, "player1") },
    player2: { get: () => debugPlayer(view.state, "player2") }
  });
  Object.defineProperties(debugState.players, {
    player1: { get: () => debugPlayer(view.state, "player1") },
    player2: { get: () => debugPlayer(view.state, "player2") }
  });
  (window as any).__gameState = debugState;
}

function debugPlayer(source: any, seat: Seat): PublicPlayer | undefined {
  const player = readPlayerFromState(source, seat);
  if (!player) return undefined;
  const reconnectUntilMs = player.reconnectUntilMs ?? -1;
  return applyPresenceOverride(seat, {
    ...player,
    connected: reconnectUntilMs > 0 ? false : player.connected
  });
}
