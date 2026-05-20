import { Client, type Room } from "@colyseus/sdk";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { CARD_CATALOG, CARD_CATALOG_VERSION, type CardDefinition } from "@twcardgame/cards";
import type {
  AiDifficulty,
  ClientCommandMessage,
  FriendRow,
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
import { assetUrl, classNames, escapeAttr, escapeHtml, fanStyle } from "./ui.js";
import { beginAttackDrag, beginHandDrag, classifyEffectKind, ensureDragLayer } from "./drag.js";
import { installGlobalErrorHandlers } from "./logger.js";
import "./styles.css";

installGlobalErrorHandlers();

type AnimationKind = "play" | "summon" | "attack" | "attackerMoves" | "damage" | "heal" | "buff" | "destroy" | "turn" | "reject";
type SoundCue = "cardPlay" | "attack" | "damage" | "heal" | "death" | "turn" | "reject" | "packFlip";

type MenuScreen = "main" | "battle" | "profile" | "collection" | "deckEditor" | "friends" | "leaderboard" | "shop" | "ai";
type CollectionFilter = "all" | "owned" | "missing";
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
  joinError?: string;
  accountLoading: boolean;
  accountError?: string;
  accountMessage?: string;
  session?: Session | null;
  profile?: ProfileRow;
  decks: DeckRow[];
  collection: CollectionRow[];
  matchHistory: MatchHistoryRow[];
  selectedDeckId?: string;
  editingDeck?: Partial<DeckRow> & Pick<DeckRow, "name" | "card_ids">;
  hoveredCardId?: string;
  hoverAnchor?: { x: number; y: number };
  confirmingConcede?: boolean;
  menuScreen: MenuScreen;
  matchmaking?: MatchmakingState;
  matchmakingTimer?: number;
  collectionFilter: CollectionFilter;
  collectionSearch: string;
  pinnedCollectionCardId?: string;
  avatarPickerOpen?: boolean;
  editingDisplayName?: string;
  friends: FriendRow[];
  friendsLoading?: boolean;
  friendsMessage?: string;
  friendsError?: string;
  leaderboard: LeaderboardRow[];
  leaderboardLoading?: boolean;
  leaderboardError?: string;
  shopItems: ShopItemRow[];
  shopLoading?: boolean;
  shopMessage?: string;
  shopError?: string;
  packOpeningCards?: Array<{ cardId: string; name: string; rarity: string; image: string }>;
  packOpeningFlipped?: boolean[];
  aiDifficulty: AiDifficulty;
  privateJoinCode?: string;
  privateJoinCodeInput?: string;
  bgmVolume: number;
  sfxVolume: number;
  bgmMuted: boolean;
  sfxMuted: boolean;
  settingsOpen: boolean;
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
  type: string;
  rarity: string;
  attack?: number;
  health?: number;
};

type ProfileRow = {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
};

type DeckRow = {
  id: string;
  user_id: string;
  name: string;
  card_catalog_version: string;
  card_ids: string[];
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
  COMMON: "普通", RARE: "精良", EPIC: "史詩", LEGENDARY: "傳說", REPIC: "特殊"
};

type PatchNoteItem = { title: string; desc: string };
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
      { title: "[新卡片] 王ADEN、卡車司機", desc: "" },
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
      { title: "[新卡片] 沉默不是金", desc: "" },
      { title: "[新增] 預設牌組、對戰紀錄", desc: "提供多個預設牌組，對戰中可查看對戰紀錄以供玩家參考" },
      { title: "[視覺優化] 更新與AI對戰的選擇畫面", desc: "將難度以及牌組整合在同一個畫面" }
    ]
  },
  {
    version: "v0.5.0", date: "2026-01-14",
    items: [
      { title: "[新卡片] 蠻牛、死亡之握、TOYZ、卓榮泰、大法官、林佳龍", desc: "新增多張全新卡片，包含「蠻牛」(補血抽牌)、「死亡之握」(倒數三回合死亡)、「TOYZ」(高體質負面戰吼) 等。" },
      { title: "[新增] 箭頭顏色、對戰提示", desc: "摧毀類型箭頭新增黑色並修改形式，新增對戰提示詞" },
      { title: "[修正] 幽靈動畫", desc: "當抽牌時左側有牌由下往上飄出" }
    ]
  },
  {
    version: "v0.4.0", date: "2026-01-13",
    items: [
      { title: "[新卡片] 8+9、無期徒刑、鉅額交保、普發一萬、停班停課、王定宇", desc: "" },
      { title: "[機制] 群體鎖定與增益", desc: "新增集體沉默與集體增益機制，支援更複雜的控場與反制策略" },
      { title: "[新增] 遊戲主視覺", desc: "新增遊戲主視覺，包含主畫面、選卡畫面、對戰畫面、牌組編輯畫面" },
      { title: "[視覺] 新聞回血特效", desc: "當「王定宇」觸發新聞回血效果時，現在會有綠色的回復數字飄出" }
    ]
  },
  {
    version: "v0.3.1", date: "2026-01-11",
    items: [
      { title: "[新增功能] 自訂游標系統", desc: "全站啟用風格游標，滑鼠懸停互動元素時保持一致外觀，提供更佳的沈浸感。可使用卡牌會出現綠光提示" },
      { title: "[新卡片] 陳其邁、藍亦明、電子腳鐐、蘇貞昌、哈們、謝和弦、蔡想想、蔡樂樂、民進黨黨部、國民黨黨部、鋼鐵韓粉、青鳥大學生、老鳥中年", desc: "新增「陳其邁」(群體鎖定+召喚藍亦明)、「藍亦明」(存活機制)、「電子腳鐐」(沈默/鎖定)、「蘇貞昌」(衝鋒+回手) 與多張具備陣營特色的卡牌。" },
      { title: "[調整] 蔡英文、水電師傅", desc: "蔡英文現在會召喚蔡想想、蔡樂樂，水電師傅生命值提升至4->5" },
      { title: "[系統優化] 代碼重構與機制更新", desc: "分離卡牌資料結構以提升維護性，並實作新的攻守交換戰吼機制 (SWAP_ATTACK_HEALTH)。" }
    ]
  },
  {
    version: "v0.3.0", date: "2026-01-10",
    items: [
      { title: "[新卡片] 武漢肺炎、陳時中、陳建仁、網軍、側翼攻擊、八卦、緋聞、政治清算、查水表(重製)、炎上(重製)", desc: "新增「政治清算」造成單體巨額傷害。重製「查水表」與「炎上」效果。" },
      { title: "[機制修正] 減費效果與法力驗證系統", desc: "修正「陳建仁」等減費卡牌導致的「0費無法出牌」問題。全面重構法力驗證邏輯，確保顯示費用即為實際支付費用。" },
      { title: "[視覺優化] 震動反饋、波紋擴散、黑暗處決特效", desc: "新增「政治清算」的黑暗處決印記、「查水表」的全場搜查波紋、「武漢肺炎」的毒氣擴散，以及卡牌互動的震動反饋。" },
      { title: "[系統] 數字顯示與預覽修復", desc: "優化傷害數字顯示系統。修復拖曳預覽時的卡頓與遮擋問題。" }
    ]
  },
  {
    version: "v0.2.2", date: "2026-01-09",
    items: [
      { title: "[新卡片] 賴清德、高端疫苗、黃捷、抗中保台、芒果乾、蘇巧慧", desc: "新增 6 張全新卡片，包含與民進黨相關的強力效果。" },
      { title: "[優化] AI 主題牌組與測試模式", desc: "對戰改為選擇主題（綠/藍/白）進行挑戰。測試模式支援編輯電腦主題牌組。" }
    ]
  },
  {
    version: "v0.2.1", date: "2026-01-09",
    items: [
      { title: "[新卡片] 新增柯文哲(獄中)、蔡璧如、陳珮琪、陳珮琪(老公獄中)。", desc: "包含新的「自殘」與「滿血回復」機制。" },
      { title: "[優化] AI 主題牌組與測試模式", desc: "對戰改為選擇主題（綠/藍/白）進行挑戰。測試模式支援編輯電腦主題牌組。" },
      { title: "[修正] 介面與名詞調整", desc: "「法術」卡全面更名為「新聞」。統一按鈕樣式與位置。優化受傷數值顯示與補血動畫顏色。" }
    ]
  },
  {
    version: "v0.2.0", date: "2026-01-09",
    items: [
      { title: "[新卡片] 老榮民、法院傳票、連勝文、倒閣、造勢晚會、921大地震", desc: "新增多張具備政治色彩與強力效果的傳奇/史詩卡片。" },
      { title: "[優化/機制] 全場視覺特效、AI 智能決策、打擊感強化", desc: "整合碎石噴發特效與畫面震動，大幅提升隨從對陣時的打擊反饋。" }
    ]
  },
  {
    version: "v0.1.2", date: "2026-01-08",
    items: [
      { title: "[新卡片] 政治切割、謝龍介", desc: "新增具備棄牌連動機制的卡片。謝龍介被丟棄時會直接進入戰場！" },
      { title: "[機制] 棄牌召喚系統", desc: "完善了棄牌連鎖機制，現在卡片被隨機丟棄時能觸發自身或場上的特殊效果。" }
    ]
  },
  {
    version: "v0.1.1", date: "2026-01-08",
    items: [
      { title: "[新卡片] 傅崐萁、徐巧芯", desc: "新增「花蓮國王」傅崐萁及隨機棄牌連動。支援多重棄牌觸發系統。" }
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
  collectionFilter: "all",
  collectionSearch: "",
  friends: [],
  leaderboard: [],
  shopItems: [],
  aiDifficulty: "normal",
  bgmVolume: readStoredNumber(bgmVolumeKey, 0.22),
  sfxVolume: readStoredNumber(sfxVolumeKey, 0.72),
  bgmMuted: readStoredBool(bgmMutedKey, false),
  sfxMuted: readStoredBool(sfxMutedKey, false),
  settingsOpen: false,
  changelogOpen: false
};

ensureDragLayer();
installViewportGuards();
installAudioUnlock();
render();
void initializeAccount();

function render(): void {
  const status = readStatus();
  const shellClass = view.state ? "app-shell in-match" : "app-shell";
  app.innerHTML = `
    <main class="${shellClass}">
      ${view.state ? renderGame(status) : renderLanding()}
      ${renderToast()}
      ${renderPackOpeningOverlay()}
    </main>
  `;

  bindStaticActions();
  bindSelectionActions();
  applyPostRenderEffects();
  ensureBgm();
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
      return renderShopScreen();
    case "ai":
      return renderBattleScreen();
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
        ${view.accountError ? `<p class="error-text">${escapeHtml(view.accountError)}</p>` : ""}
        ${view.accountMessage ? `<p class="success-text">${escapeHtml(view.accountMessage)}</p>` : ""}
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
      <div class="main-menu-center">
        <h1 class="game-title">寶島遊戲王</h1>
        <span class="version-pill">${escapeHtml(CARD_CATALOG_VERSION)}</span>
        ${view.accountError ? `<p class="error-text menu-status">${escapeHtml(view.accountError)}</p>` : ""}
        ${view.accountMessage ? `<p class="success-text menu-status">${escapeHtml(view.accountMessage)}</p>` : ""}
        ${view.joinError ? `<p class="error-text menu-status">${escapeHtml(view.joinError)}</p>` : ""}
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
            <img class="corner-icon" src="/images/ui/collection_logo.webp" alt="卡牌庫" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
            <span class="corner-icon-emoji" style="display:none">🃏</span>
            <span class="corner-label">卡牌庫</span>
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
        <div class="changelog-list">
          ${PATCH_NOTES.map((entry) => `
            <div class="changelog-version">
              <h4>版本 ${escapeHtml(entry.version)} (${escapeHtml(entry.date)})</h4>
              <ul>
                ${entry.items.map((item) => `
                  <li>
                    <strong>${escapeHtml(item.title)}</strong>
                    ${item.desc ? `<p>${escapeHtml(item.desc)}</p>` : ""}
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
      ${view.accountError ? `<p class="error-text menu-status">${escapeHtml(view.accountError)}</p>` : ""}
      ${view.joinError ? `<p class="error-text menu-status">${escapeHtml(view.joinError)}</p>` : ""}
      <div class="battle-pick-grid">
        <section class="parchment-card deck-pick">
          <div class="panel-heading">
            <h3>選擇牌組</h3>
            <button id="new-deck" class="ghost-button">+ 新牌組</button>
          </div>
          <div class="deck-list" data-testid="battle-deck-list">
            ${accountMode ? (view.decks.map(renderSavedDeck).join("") || `<p class="muted">尚未建立牌組，請先新增一組。</p>`) : `<p class="muted">Dev mode: server will assign a default deck.</p>`}
          </div>
          <p class="muted">${selectedDeck ? `已選：${escapeHtml(selectedDeck.name)}` : accountMode ? "請選擇一套合法的 30 張牌組。" : "Dev mode 不需選牌組。"}</p>
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
              ${view.privateJoinCode ? renderPrivateCodeBanner(view.privateJoinCode) : ""}
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
            <div class="ai-difficulty-options">
              ${difficulties.map((opt) => `
                <label class="ai-difficulty-option ${view.aiDifficulty === opt.value ? "selected" : ""}">
                  <input type="radio" name="ai-difficulty" value="${opt.value}" ${view.aiDifficulty === opt.value ? "checked" : ""} />
                  <strong>${opt.label}</strong>
                </label>
              `).join("")}
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
          <h2>個人頁面 · Profile</h2>
        </header>
        <div class="parchment-card center-card">
          <p>Sign in with Supabase to use the profile.</p>
        </div>
      </section>
    `;
  }
  const profile = view.profile;
  const displayName = view.editingDisplayName ?? profile?.display_name ?? "Player";
  const avatarUrl = profile?.avatar_url || "/images/avatars/avatar1.webp";
  const stats = computeMatchStats();
  const winRateLabel = stats.total === 0 ? "—" : `${Math.round((stats.wins / stats.total) * 100)}%`;
  const avatars = ["avatar1", "avatar2", "avatar3", "avatar4"];
  const recent = view.matchHistory.slice(0, 10);
  return `
    <section class="screen profile-screen" data-screen="profile">
      ${renderCloudLayer()}
      <header class="screen-header">
        <button class="back-button" data-menu-screen="main">← 返回主選單</button>
        <h2>個人頁面 · Profile</h2>
      </header>
      ${view.accountError ? `<p class="error-text menu-status">${escapeHtml(view.accountError)}</p>` : ""}
      ${view.accountMessage ? `<p class="success-text menu-status">${escapeHtml(view.accountMessage)}</p>` : ""}
      <div class="profile-grid">
        <section class="parchment-card profile-header" data-testid="profile-header">
          <div class="profile-avatar-block">
            <img class="profile-avatar" src="${escapeAttr(avatarUrl)}" alt="" onerror="this.src='/images/avatars/avatar1.webp'" />
            <button id="open-avatar-picker" class="ghost-button">Change avatar</button>
          </div>
          <form id="profile-form" class="profile-form">
            <label>顯示名稱 · Display Name
              <input id="profile-display-name" value="${escapeAttr(displayName)}" maxlength="32" />
            </label>
            <p class="profile-meta">Level <strong>—</strong> · XP placeholder</p>
            <button type="submit" data-testid="profile-save" ${view.accountLoading ? "disabled" : ""}>Save</button>
          </form>
          ${view.avatarPickerOpen ? `
          <div class="avatar-picker" data-testid="avatar-picker">
            ${avatars.map((slug) => `
              <button type="button" data-pick-avatar="${slug}" class="avatar-option ${profile?.avatar_url?.includes(slug) ? "selected" : ""}">
                <img src="/images/avatars/${slug}.webp" alt="${slug}" />
              </button>
            `).join("")}
          </div>` : ""}
        </section>
        <section class="parchment-card profile-stats">
          <h3>Stats</h3>
          <ul class="stat-list">
            <li><span>Wins</span><strong>${stats.wins}</strong></li>
            <li><span>Losses</span><strong>${stats.losses}</strong></li>
            <li><span>Draws</span><strong>${stats.draws}</strong></li>
            <li><span>Win rate</span><strong>${winRateLabel}</strong></li>
            <li><span>Total</span><strong>${stats.total}</strong></li>
          </ul>
        </section>
        <section class="parchment-card profile-history">
          <h3>Recent Matches</h3>
          <div class="history-list">
            ${recent.length === 0 ? `<p class="muted">No completed matches yet.</p>` : recent.map(renderMatchHistoryRow).join("")}
          </div>
        </section>
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
  const accountMode = Boolean(supabase);
  const collectionMap = new Map(view.collection.map((row) => [row.card_id, row.quantity]));
  const collectibles = CARD_CATALOG.filter((card) => card.collectible !== false);
  const filter = view.collectionFilter;
  const search = view.collectionSearch.trim().toLowerCase();
  const filtered = collectibles.filter((card) => {
    const qty = collectionMap.get(card.id) ?? 0;
    if (filter === "owned" && qty <= 0) return false;
    if (filter === "missing" && qty > 0) return false;
    if (search) {
      return (
        card.name.toLowerCase().includes(search) ||
        card.category.toLowerCase().includes(search) ||
        card.description.toLowerCase().includes(search)
      );
    }
    return true;
  });
  const ownedTotal = collectibles.filter((card) => (collectionMap.get(card.id) ?? 0) > 0).length;
  return `
    <section class="screen collection-screen" data-screen="collection">
      <div class="collection-container">
        <header class="collection-header">
          <button class="back-button" data-menu-screen="main" data-testid="back-to-menu">← 返回</button>
          <h2 class="collection-title">卡牌圖鑑</h2>
        </header>
        <div class="collection-controls-bar">
          <div class="controls-left">
            <span id="collection-progress">已收集卡片種類: ${ownedTotal}/${collectibles.length}</span>
          </div>
          <div class="controls-center collection-filters" role="tablist">
            ${(["all", "owned", "missing"] as CollectionFilter[]).map((value) => `
              <button class="collection-filter ${filter === value ? "active" : ""}" data-collection-filter="${value}" data-testid="filter-${value}" role="tab">
                ${collectionFilterLabel(value)}
              </button>
            `).join("")}
          </div>
          <div class="controls-right">
            <label class="search-box" aria-label="搜尋卡牌">
              <input id="collection-search-input" value="${escapeAttr(view.collectionSearch)}" placeholder="搜尋卡牌名稱..." autocomplete="off" />
              <span class="search-icon">⌕</span>
            </label>
            <div class="collection-stats" title="持有消費券">
              <span id="collection-vouchers"><span class="voucher-icon">券</span>20</span>
            </div>
          </div>
        </div>
        ${accountMode ? "" : `<p class="muted collection-note">登入後可查看收藏數量；目前顯示完整卡牌目錄。</p>`}
        <div class="collection-grid" data-testid="collection-grid">
          ${filtered.length === 0 ? `<p class="muted collection-empty">沒有符合條件的卡牌。</p>` : filtered.map((card) => {
            const qty = collectionMap.get(card.id) ?? 0;
            return renderCollectionTile(card, qty);
          }).join("")}
        </div>
      </div>
      ${view.pinnedCollectionCardId ? renderPinnedCardDetail(view.pinnedCollectionCardId) : ""}
    </section>
  `;
}

function collectionFilterLabel(filter: CollectionFilter): string {
  if (filter === "owned") return "已擁有";
  if (filter === "missing") return "未擁有";
  return "全部";
}

function renderCollectionTile(card: CardDefinition, quantity: number): string {
  const owned = quantity > 0;
  const resolved: ResolvedCardView = {
    cardId: card.id,
    instanceId: `collection-${card.id}`,
    name: card.name,
    category: card.category,
    description: card.description,
    image: card.image,
    cost: card.cost,
    type: card.type,
    rarity: card.rarity,
    attack: card.attack,
    health: card.health
  };
  return `
    <button type="button" class="${classNames(["collection-card", "collection-tile", owned ? "owned" : "unowned"])}" data-collection-card="${escapeAttr(card.id)}" data-testid="collection-tile" title="${escapeAttr(card.description)}">
      <span class="card-count-badge">x${quantity}</span>
      <div class="card rarity-${card.rarity.toLowerCase()}">
        ${renderCardFace(resolved, "mulligan")}
      </div>
    </button>
  `;
}

function renderPinnedCardDetail(cardId: string): string {
  const card = cardCatalog.get(cardId);
  if (!card) return "";
  const resolved: ResolvedCardView = {
    cardId: card.id,
    instanceId: `pinned-${card.id}`,
    name: card.name,
    category: card.category,
    description: card.description,
    image: card.image,
    cost: card.cost,
    type: card.type,
    rarity: card.rarity,
    attack: card.attack,
    health: card.health
  };
  return `
    <div class="pinned-card-overlay" data-testid="pinned-card-overlay">
      <div class="pinned-card-content">
        <div class="card rarity-${resolved.rarity.toLowerCase()}">
          ${renderCardFace(resolved, "mulligan")}
        </div>
        <button id="pinned-card-close" class="ghost-button">Close</button>
      </div>
    </div>
  `;
}

function renderDeckEditorScreen(): string {
  return `
    <section class="screen deck-editor-screen" data-screen="deckEditor">
      ${renderCloudLayer()}
      <header class="screen-header">
        <button class="back-button" data-menu-screen="battle">← 返回戰鬥</button>
        <h2>編輯牌組 · Deck Editor</h2>
      </header>
      ${view.accountError ? `<p class="error-text menu-status">${escapeHtml(view.accountError)}</p>` : ""}
      ${view.accountMessage ? `<p class="success-text menu-status">${escapeHtml(view.accountMessage)}</p>` : ""}
      <section class="parchment-card editor-panel">
        ${renderDeckEditor()}
      </section>
    </section>
  `;
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
  return `
    <div class="saved-deck ${selected ? "selected" : ""}">
      <button class="deck-select" data-select-deck="${escapeAttr(deck.id)}">
        <strong>${escapeHtml(deck.name)}</strong>
        <span>${deck.card_ids.length} cards</span>
      </button>
      <button data-edit-deck="${escapeAttr(deck.id)}">Edit</button>
      <button class="danger" data-delete-deck="${escapeAttr(deck.id)}">Delete</button>
    </div>
  `;
}

function renderDeckEditor(): string {
  const deck = view.editingDeck;
  const selectedCounts = countCards(deck?.card_ids ?? []);
  const selectedTotal = deck?.card_ids.length ?? 0;
  const cards = CARD_CATALOG.filter((card) => card.collectible !== false);
  const collectionReady = hasCollectionRows();

  return `
    <form id="deck-form" class="deck-editor">
      <div class="editor-heading">
        <h3>${deck?.id ? "Edit Deck" : "New Deck"}</h3>
        <span>${selectedTotal}/30</span>
      </div>
      <input id="deck-name" value="${escapeAttr(deck?.name ?? "New Deck")}" aria-label="Deck name" />
      ${
        collectionReady
          ? ""
          : `<p class="muted">Collection is still syncing. You can build now; Save Deck will confirm ownership with Supabase.</p>`
      }
      <div class="editor-actions">
        <button type="submit" ${selectedTotal !== 30 ? "disabled" : ""}>Save Deck</button>
        <button type="button" id="autofill-deck">Autofill</button>
        <button type="button" id="clear-deck">Clear</button>
      </div>
      <div class="deck-card-list">
        ${cards.map((card) => renderDeckBuilderCard(card, selectedCounts.get(card.id) ?? 0)).join("")}
      </div>
    </form>
  `;
}

function renderDeckBuilderCard(card: CardDefinition, count: number): string {
  const limit = deckCopyLimit(card);
  return `
    <div class="deck-builder-card">
      <button type="button" data-add-card="${escapeAttr(card.id)}" ${count >= limit ? "disabled" : ""} title="Add card">+</button>
      <button type="button" data-remove-card="${escapeAttr(card.id)}" ${count <= 0 ? "disabled" : ""}>-</button>
      <span class="deck-card-name">${escapeHtml(card.name)}</span>
      <span>${count}/${limit}</span>
    </div>
  `;
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
  const label = outcome === "win" ? "Win" : outcome === "loss" ? "Loss" : outcome === "draw" ? "Draw" : (row.winner_seat ?? "—");
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

  return `
    <section class="status" data-testid="match-status">
      <span>Status: ${escapeHtml(status || "waiting")}</span>
      <span>Turn: ${readTurnNumber()}</span>
      <span>Active: ${escapeHtml(activeSeat || "none")}</span>
      <span>${escapeHtml(targetHint)}</span>
    </section>
    <section class="battle-surface ${view.animationCues.length ? "has-event-cues" : ""}" data-testid="battle-surface">
      ${renderConnectionBanner()}
      ${renderPlayerArea(opponent, opponentPlayer, "opponent")}
      ${renderCenterLine(activeSeat)}
      ${renderPlayerArea(me ?? "player1", myPlayer, "player")}
      ${renderEventCues()}
      ${renderMulliganOverlay(status)}
      ${renderResultOverlay(status)}
      ${renderConcedeModal()}
    </section>
    ${renderHoverTooltip()}
    <section class="log" data-testid="event-log">
      ${view.events.map(renderEventLine).join("")}
    </section>
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
      <div class="status-cluster">
        ${renderHero(seat, player, role)}
        ${renderMana(player?.mana?.current ?? 0, player?.mana?.max ?? 0, role)}
        <div class="pile-row">
          <div class="deck-pile" title="Deck">${player?.deckCount ?? 0}</div>
          <div class="graveyard-pile" title="Graveyard">${player?.graveyardCount ?? 0}</div>
        </div>
      </div>
      ${role === "opponent" ? renderOpponentHand(handCount) : ""}
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
    <div class="mana-container ${role === "player" ? "frame-style" : ""}" data-testid="${role}-mana">
      ${crystals}
      <span class="mana-text">Mana ${current}/${max}</span>
    </div>
  `;
}

function renderOpponentHand(count: number): string {
  return `
    <div class="hand opponent-hand" data-testid="opponent-hand">
      ${Array.from({ length: count }, (_, index) => `<span class="card card-back" style="${fanStyle(index, count)}"></span>`).join("")}
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
        <span class="stat-atk"><span>${minion.attack}</span></span>
        <span class="stat-hp">${minion.currentHealth}/${minion.health}</span>
      </div>
      <span class="sr-e2e">${minion.canAttack ? "ready" : ""} ${minion.taunt ? "taunt" : ""}</span>
    </button>
  `;
}

function renderCardFace(card: ResolvedCardView, size: "hand" | "mulligan"): string {
  return `
    <span class="card-cost"><span>${card.cost}</span></span>
    <strong class="card-title">${escapeHtml(card.name)}</strong>
    <img class="card-art-box" src="${escapeAttr(assetUrl(card.image))}" alt="" loading="lazy" />
    <span class="card-category">${escapeHtml(card.category)}</span>
    <span class="card-desc ${size === "mulligan" ? "large-desc" : ""}">${escapeHtml(card.description)}</span>
    ${
      card.type === "MINION"
        ? `<span class="minion-stats"><span class="stat-atk"><span>${card.attack ?? 0}</span></span><span class="stat-hp">${card.health ?? 0}</span></span>`
        : ""
    }
  `;
}

function renderCenterLine(activeSeat: Seat | ""): string {
  const isMyTurn = activeSeat && activeSeat === view.mySeat;
  const selectedCard = selectedHandCard();
  const selectedNeedsTarget = selectedCard ? cardNeedsTarget(selectedCard.cardId) : false;
  const canPlay = Boolean(selectedCard && canAfford(selectedCard.cost) && (!selectedNeedsTarget || view.selectedTarget));
  const canAttack = Boolean(view.selectedAttackerId && view.selectedTarget && isLegalAttackTarget(view.selectedTarget));
  const primaryLabel = selectedCard ? (selectedNeedsTarget && !view.selectedTarget ? "Choose Target" : "Play Selected") : "Play Selected";

  return `
    <section class="center-line controls">
      <button id="concede" class="danger" data-testid="concede">Concede</button>
      <div class="turn-stack">
        <span id="indicator-opp" class="turn-light ${activeSeat === otherSeat(view.mySeat ?? "player1") ? "active" : ""}">Opponent</span>
        <span id="indicator-player" class="turn-light ${isMyTurn ? "active" : ""}">${isMyTurn ? "Your Turn" : "Waiting"}</span>
      </div>
      <button id="play" ${canPlay ? "" : "disabled"} data-testid="play-selected">${primaryLabel}</button>
      <button id="attack" ${canAttack ? "" : "disabled"} data-testid="attack-target">Attack Target</button>
      <button id="end-turn" class="end-turn-btn" ${view.room ? "" : "disabled"} data-testid="end-turn">End Turn</button>
    </section>
  `;
}

function renderMulliganOverlay(status: GameStatus | ""): string {
  if (status !== "mulligan" || !view.room) return "";
  const ready = Boolean(view.mySeat && readPlayer(view.mySeat)?.mulliganReady);
  const selectedCount = view.mulliganSelection.size;

  return `
    <section id="mulligan-modal" class="mulligan-overlay ${ready ? "submitted" : ""}" data-testid="mulligan-overlay">
      <div class="mulligan-content">
        <h2>Mulligan</h2>
        <p>${ready ? "Waiting for opponent" : "Select cards to replace, then confirm."}</p>
        <div class="mulligan-card-area">
          ${view.hand.map((card) => renderMulliganCard(card, ready)).join("")}
        </div>
        <button id="mulligan" ${ready ? "disabled" : ""} data-testid="mulligan-confirm">
          ${ready ? "Ready" : `Confirm${selectedCount ? ` (${selectedCount})` : ""}`}
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
      ${selected ? `<span class="mulligan-replace-tag">Replace</span>` : ""}
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
  return `
    <div class="event-layer" data-testid="event-layer" aria-hidden="true">
      ${view.animationCues.map(renderEventCue).join("")}
    </div>
  `;
}

function renderEventCue(cue: AnimationCue): string {
  const card = cue.cardId ? cardCatalog.get(cue.cardId) : undefined;
  if (cue.kind === "play" && card) {
    return `
      <div class="event-card-preview card ${cue.seat === view.mySeat ? "from-player" : "from-opponent"}">
        ${renderCardFace(
          {
            cardId: card.id,
            instanceId: cue.id,
            name: card.name,
            category: card.category,
            description: card.description,
            image: card.image,
            cost: card.cost,
            type: card.type,
            rarity: card.rarity,
            attack: card.attack,
            health: card.health
          },
          "mulligan"
        )}
      </div>
    `;
  }
  if (cue.kind === "attackerMoves") {
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
  if (!view.hoveredCardId || !view.hoverAnchor) return "";
  const card = cardCatalog.get(view.hoveredCardId);
  if (!card) return "";
  const margin = 16;
  const tooltipWidth = 260;
  const approxHeight = 360;
  let left = view.hoverAnchor.x + margin;
  if (left + tooltipWidth > window.innerWidth - margin) {
    left = Math.max(margin, view.hoverAnchor.x - tooltipWidth - margin);
  }
  let top = view.hoverAnchor.y - approxHeight / 2;
  top = Math.max(margin, Math.min(top, window.innerHeight - approxHeight - margin));
  const resolved: ResolvedCardView = {
    cardId: card.id,
    instanceId: `tooltip-${card.id}`,
    name: card.name,
    category: card.category,
    description: card.description,
    image: card.image,
    cost: card.cost,
    type: card.type,
    rarity: card.rarity,
    attack: card.attack,
    health: card.health
  };
  return `
    <div class="hover-tooltip" data-testid="hover-tooltip" style="left:${left}px;top:${top}px">
      <div class="card rarity-${resolved.rarity.toLowerCase()}">
        ${renderCardFace(resolved, "mulligan")}
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

function renderEventLine(event: GameEvent): string {
  const payload = event.payload ? ` ${JSON.stringify(event.payload)}` : "";
  return `<p>${escapeHtml(`${event.type}#${event.seq ?? "?"}${payload}`)}</p>`;
}

function renderEmptySlots(): string {
  return Array.from({ length: 7 }, () => `<div class="slot" aria-hidden="true"></div>`).join("");
}

function bindStaticActions(): void {
  document.querySelector<HTMLFormElement>("#join-form")?.addEventListener("submit", joinRoom);
  document.querySelector<HTMLFormElement>("#auth-form")?.addEventListener("submit", (event) => void signInWithPassword(event));
  document.querySelector<HTMLButtonElement>("#sign-up")?.addEventListener("click", () => void signUpWithPassword());
  document.querySelector<HTMLButtonElement>("#google-sign-in")?.addEventListener("click", () => void signInWithGoogle());
  document.querySelector<HTMLButtonElement>("#sign-out")?.addEventListener("click", () => void signOut());
  document.querySelector<HTMLButtonElement>("#refresh-account")?.addEventListener("click", () => void loadAccountData());
  document.querySelector<HTMLButtonElement>("#sync-collection")?.addEventListener("click", () => void syncCollection());
  document.querySelector<HTMLButtonElement>("#new-deck")?.addEventListener("click", () => {
    startNewDeck(false);
    view.menuScreen = "deckEditor";
    render();
  });
  document.querySelector<HTMLButtonElement>("#autofill-deck")?.addEventListener("click", autofillDeck);
  document.querySelector<HTMLButtonElement>("#clear-deck")?.addEventListener("click", clearDeck);
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
  document.querySelector<HTMLButtonElement>("#concede")?.addEventListener("click", () => {
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
      if (deck) view.editingDeck = { ...deck, card_ids: [...deck.card_ids] };
      view.menuScreen = "deckEditor";
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-delete-deck]")) {
    el.addEventListener("click", () => void deleteDeck(el.dataset.deleteDeck));
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-add-card]")) {
    el.addEventListener("click", () => addCardToEditor(el.dataset.addCard));
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
  for (const el of document.querySelectorAll<HTMLElement>("[data-collection-filter]")) {
    el.addEventListener("click", () => {
      const value = el.dataset.collectionFilter as CollectionFilter | undefined;
      if (!value) return;
      view.collectionFilter = value;
      render();
    });
  }
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
  for (const el of document.querySelectorAll<HTMLElement>("[data-remove-friend]")) {
    el.addEventListener("click", () => {
      const id = el.dataset.removeFriend;
      if (id) void removeFriend(id);
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
      view.friendsMessage = `已複製代碼 ${code}`;
      render();
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
  for (const el of document.querySelectorAll<HTMLElement>("[data-flip-index]")) {
    el.addEventListener("click", () => {
      if (!view.packOpeningFlipped || !view.packOpeningCards) return;
      const idx = parseInt(el.dataset.flipIndex ?? "-1", 10);
      if (idx < 0 || view.packOpeningFlipped[idx]) return;
      view.packOpeningFlipped[idx] = true;
      playSfx("packFlip", 0.6);
      render();
    });
  }
  document.querySelector<HTMLButtonElement>("#btn-pack-done")?.addEventListener("click", () => {
    view.packOpeningCards = undefined;
    view.packOpeningFlipped = undefined;
    render();
  });
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name="ai-difficulty"]')) {
    el.addEventListener("change", () => {
      const value = el.value as AiDifficulty;
      if (value === "easy" || value === "normal" || value === "hard") {
        view.aiDifficulty = value;
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

function navigateToScreen(target: MenuScreen): void {
  if (view.matchmaking && target !== "battle") return;
  view.menuScreen = target;
  view.accountError = undefined;
  view.accountMessage = undefined;
  view.joinError = undefined;
  view.avatarPickerOpen = false;
  view.pinnedCollectionCardId = undefined;
  if (target !== "profile") view.editingDisplayName = undefined;
  if (target === "friends") void loadFriends();
  if (target === "leaderboard") void loadLeaderboard();
  if (target === "shop") void loadShopItems();
  render();
}

// ─── Phase 5 screens ──────────────────────────────────────────────────────────

function renderFriendsScreen(): string {
  const accountMode = Boolean(supabase);
  if (!accountMode || !view.session) {
    return signInRequiredScreen("好友 · Friends");
  }
  const friends = view.friends;
  return `
    <section class="screen friends-screen" data-screen="friends">
      ${renderCloudLayer()}
      <header class="screen-header">
        <button class="back-button" data-menu-screen="main">← 返回主選單</button>
        <h2>好友 · Friends</h2>
      </header>
      ${view.friendsError ? `<p class="error-text menu-status">${escapeHtml(view.friendsError)}</p>` : ""}
      ${view.friendsMessage ? `<p class="success-text menu-status">${escapeHtml(view.friendsMessage)}</p>` : ""}
      <div class="friends-grid">
        <section class="parchment-card friends-add">
          <h3>新增好友</h3>
          <form id="add-friend-form" class="friends-add-form">
            <label>對方的顯示名稱
              <input id="add-friend-input" placeholder="顯示名稱" maxlength="32" required />
            </label>
            <button type="submit" data-testid="add-friend-submit">送出好友邀請</button>
          </form>
          <p class="muted">輸入完整的顯示名稱後送出，雙方會立即成為好友。</p>
        </section>
        <section class="parchment-card friends-list-card">
          <h3>我的好友 (${friends.length})</h3>
          ${view.friendsLoading ? `<p class="muted">載入中…</p>` : friends.length === 0
            ? `<p class="muted">還沒有好友。先邀請一位玩家吧！</p>`
            : `<ul class="friends-list">
                ${friends.map((friend) => renderFriendRow(friend)).join("")}
              </ul>`}
        </section>
      </div>
      ${view.privateJoinCode ? renderPrivateCodeBanner(view.privateJoinCode) : ""}
    </section>
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
        <button class="ghost-button" data-challenge-friend="${escapeAttr(friend.friend_user_id)}" data-testid="challenge-friend">挑戰</button>
        <button class="danger" data-remove-friend="${escapeAttr(friend.friend_user_id)}" data-testid="remove-friend">移除</button>
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

function renderLeaderboardScreen(): string {
  return `
    <section class="screen leaderboard-screen" data-screen="leaderboard">
      ${renderCloudLayer()}
      <header class="screen-header">
        <button class="back-button" data-menu-screen="main">← 返回主選單</button>
        <h2>排行榜 · Leaderboard</h2>
      </header>
      ${view.leaderboardError ? `<p class="error-text menu-status">${escapeHtml(view.leaderboardError)}</p>` : ""}
      <section class="parchment-card leaderboard-card">
        ${view.leaderboardLoading
          ? `<p class="muted">載入中…</p>`
          : view.leaderboard.length === 0
            ? `<p class="muted">目前還沒有任何上榜紀錄。</p>`
            : `<table class="leaderboard-table" data-testid="leaderboard-table">
                <thead><tr><th>#</th><th>玩家</th><th>勝場</th></tr></thead>
                <tbody>
                  ${view.leaderboard.map((row) => `
                    <tr>
                      <td class="leaderboard-rank">${row.rank}</td>
                      <td>${escapeHtml(row.display_name)}</td>
                      <td class="leaderboard-wins">${row.wins_count}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>`}
      </section>
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
        ${view.shopError ? `<p class="error-text menu-status">${escapeHtml(view.shopError)}</p>` : ""}
        ${view.shopMessage ? `<p class="success-text menu-status">${escapeHtml(view.shopMessage)}</p>` : ""}
        <div class="shop-products">
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
    const imgSrc = escapeAttr(assetUrl(card.image));
    const rarity = card.rarity.toUpperCase();
    const rarityClass = card.rarity.toLowerCase();
    const label = rarityLabel[card.rarity] ?? card.rarity;
    return `
      <div class="pack-card-wrapper${flipped[i] ? ` flipped ${rarity}` : ""}"
        data-flip-index="${i}" role="button" aria-label="翻開卡牌">
        <div class="pack-card-inner">
          <div class="pack-card-back">
            <img src="/images/ui/card_back.webp" alt="card back"
              onerror="this.src='/images/card_back.webp'">
          </div>
          <div class="pack-card-front">
            <div class="pack-card-content rarity-${rarityClass}">
              <div class="pack-card-img-wrap">
                <img src="${imgSrc}" alt="${escapeAttr(card.name)}"
                  onerror="this.style.display='none'">
              </div>
              <div class="pack-card-name">${escapeHtml(card.name)}</div>
              <div class="pack-card-rarity">${escapeHtml(label)}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="pack-overlay" id="pack-opening-overlay" data-testid="pack-overlay">
      <h2 class="pack-title">開包！</h2>
      <div class="pack-cards-container">${cardItems}</div>
      <button id="btn-pack-done" class="${allFlipped ? "visible" : ""}">完成</button>
    </div>
  `;
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
  view.friendsError = undefined;
  render();
  try {
    const { data, error } = await supabase.rpc("list_friends");
    if (error) throw error;
    view.friends = (data as FriendRow[]) ?? [];
  } catch (error) {
    view.friendsError = error instanceof Error ? error.message : "Failed to load friends.";
  } finally {
    view.friendsLoading = false;
    render();
  }
}

async function sendFriendRequest(displayName: string): Promise<void> {
  if (!supabase || !view.session) return;
  const target = displayName.trim();
  if (!target) {
    view.friendsError = "Display name is required.";
    render();
    return;
  }
  view.friendsLoading = true;
  view.friendsError = undefined;
  view.friendsMessage = undefined;
  render();
  try {
    const { error } = await supabase.rpc("send_friend_request", { p_target_display_name: target });
    if (error) throw error;
    view.friendsMessage = `已將 ${target} 加為好友。`;
    await loadFriends();
  } catch (error) {
    view.friendsError = error instanceof Error ? error.message : "Failed to add friend.";
    view.friendsLoading = false;
    render();
  }
}

async function removeFriend(friendUserId: string): Promise<void> {
  if (!supabase || !view.session) return;
  view.friendsError = undefined;
  view.friendsMessage = undefined;
  try {
    const { error } = await supabase.rpc("remove_friend", { p_friend_user_id: friendUserId });
    if (error) throw error;
    view.friendsMessage = "好友已移除。";
    await loadFriends();
  } catch (error) {
    view.friendsError = error instanceof Error ? error.message : "Failed to remove friend.";
    render();
  }
}

async function loadLeaderboard(): Promise<void> {
  if (!supabase) {
    view.leaderboard = [];
    return;
  }
  view.leaderboardLoading = true;
  view.leaderboardError = undefined;
  render();
  try {
    const { data, error } = await supabase.rpc("get_leaderboard", { p_limit: 50 });
    if (error) throw error;
    view.leaderboard = (data as LeaderboardRow[]) ?? [];
  } catch (error) {
    view.leaderboardError = error instanceof Error ? error.message : "Failed to load leaderboard.";
  } finally {
    view.leaderboardLoading = false;
    render();
  }
}

async function loadShopItems(): Promise<void> {
  if (!supabase || !view.session) return;
  view.shopLoading = true;
  view.shopError = undefined;
  render();
  try {
    const { data, error } = await supabase
      .from("shop_items")
      .select("id,kind,display_name,description,contents")
      .eq("active", true)
      .order("display_name", { ascending: true });
    if (error) throw error;
    view.shopItems = (data as ShopItemRow[]) ?? [];
  } catch (error) {
    view.shopError = error instanceof Error ? error.message : "Failed to load shop.";
  } finally {
    view.shopLoading = false;
    render();
  }
}

async function claimShopItem(itemId: string): Promise<void> {
  if (!supabase || !view.session) return;
  view.shopError = undefined;
  view.shopMessage = undefined;
  render();
  try {
    const { error } = await supabase.rpc("purchase_shop_item", { p_item_id: itemId });
    if (error) throw error;
    const item = view.shopItems.find((i) => i.id === itemId);
    const cardIds = item?.contents?.cards ?? [];
    view.packOpeningCards = cardIds
      .map((id) => {
        const card = cardCatalog.get(id);
        if (!card) return undefined;
        return { cardId: card.id, name: card.name, rarity: card.rarity, image: card.image };
      })
      .filter(Boolean) as Array<{ cardId: string; name: string; rarity: string; image: string }>;
    view.packOpeningFlipped = view.packOpeningCards.map(() => false);
    await loadAccountDataRaw();
    render();
  } catch (error) {
    view.shopError = error instanceof Error ? error.message : "Failed to claim shop item.";
    render();
  }
}

async function startAiMatch(): Promise<void> {
  if (view.joining || view.room) return;
  if (supabase && (!view.session || !view.selectedDeckId)) {
    view.joinError = "Select a saved deck before starting a match.";
    render();
    return;
  }
  const serverUrl = defaultServerUrl;
  view.joining = true;
  view.joinError = undefined;
  render();
  try {
    const client = new Client(serverUrl);
    const joinOptions: Record<string, unknown> = supabase
      ? {
          displayName: view.profile?.display_name,
          accessToken: view.session?.access_token,
          deckId: view.selectedDeckId,
          difficulty: view.aiDifficulty
        }
      : { displayName: view.profile?.display_name ?? "Player", difficulty: view.aiDifficulty };
    const room = await client.joinOrCreate("pve", joinOptions, GameStateSchema);
    bindRoomMessages(room);
  } catch (error) {
    view.joinError = error instanceof Error ? error.message : "Unable to start AI match.";
  } finally {
    view.joining = false;
    render();
  }
}

async function createPrivateChallenge(): Promise<void> {
  if (view.joining || view.room) return;
  if (supabase && (!view.session || !view.selectedDeckId)) {
    view.joinError = "Select a saved deck before challenging a friend.";
    render();
    return;
  }
  view.joining = true;
  view.joinError = undefined;
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
    view.joinError = error instanceof Error ? error.message : "Unable to create private room.";
  } finally {
    view.joining = false;
    render();
  }
}

async function joinPrivateByCode(rawCode: string): Promise<void> {
  if (view.joining || view.room) return;
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    view.joinError = "請輸入房間代碼。";
    render();
    return;
  }
  if (supabase && (!view.session || !view.selectedDeckId)) {
    view.joinError = "Select a saved deck before joining a private match.";
    render();
    return;
  }
  view.joining = true;
  view.joinError = undefined;
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
    view.joinError = error instanceof Error ? error.message : "找不到對應的房間代碼。";
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
  view.joinError = undefined;
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
    render();
  }, 1000);
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
    view.accountError = "Display name cannot be empty.";
    render();
    return;
  }
  await withAccountLoading(async () => {
    const { error } = await supabase.from("profiles").update({ display_name: name }).eq("user_id", view.session!.user.id);
    if (error) throw error;
    view.accountMessage = "Profile updated.";
    view.editingDisplayName = undefined;
    await loadAccountDataRaw();
  });
}

async function pickAvatar(slug: string | undefined): Promise<void> {
  if (!supabase || !view.session?.user || !slug) return;
  const avatarUrl = `/images/avatars/${slug}.webp`;
  await withAccountLoading(async () => {
    const { error } = await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("user_id", view.session!.user.id);
    if (error) throw error;
    view.accountMessage = "Avatar updated.";
    view.avatarPickerOpen = false;
    await loadAccountDataRaw();
  });
}

function bindSelectionActions(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-hand-id]")) {
    el.addEventListener("click", () => {
      view.selectedHandId = view.selectedHandId === el.dataset.handId ? undefined : el.dataset.handId;
      view.selectedAttackerId = undefined;
      view.selectedTarget = undefined;
      render();
    });
    el.addEventListener("pointerdown", (event) => {
      clearHoverTooltip();
      attachHandPointerDrag(event, el);
    });
    bindHoverPreview(el, () => {
      const handId = el.dataset.handId;
      const card = handId ? view.hand.find((item) => item.instanceId === handId) : undefined;
      return card?.cardId;
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
    bindHoverPreview(el, () => minionCardIdFromElement(el));
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-target]")) {
    el.addEventListener("click", () => {
      const target = JSON.parse(el.dataset.target!) as TargetRef;
      if (!isTargetHighlighted(target)) return;
      if (confirmSelectedTarget(target)) {
        view.selectedAttackerId = undefined;
        view.selectedHandId = undefined;
        view.selectedTarget = undefined;
      } else {
        view.selectedTarget = target;
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

function bindHoverPreview(el: HTMLElement, resolve: () => string | undefined): void {
  if (!hoverCapable) return;
  el.addEventListener("mouseenter", (event) => {
    if (view.confirmingConcede) return;
    const cardId = resolve();
    if (!cardId) return;
    window.clearTimeout(hoverState.timer);
    hoverState.lastEl = el;
    const rect = el.getBoundingClientRect();
    const anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    hoverState.timer = window.setTimeout(() => {
      if (hoverState.lastEl !== el) return;
      view.hoveredCardId = cardId;
      view.hoverAnchor = anchor;
      hoverState.lastCardId = cardId;
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
    view.hoverAnchor = undefined;
  }
}

function minionCardIdFromElement(el: HTMLElement): string | undefined {
  const seat = el.dataset.seat as Seat | undefined;
  const targetKey = el.dataset.targetKey;
  if (!seat || !targetKey) return undefined;
  const player = readPlayer(seat);
  const minion = player?.board?.find((item) => item.instanceId === targetKey);
  return minion?.cardId;
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
  view.joinError = undefined;
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
    view.joinError = error instanceof Error ? error.message : "Unable to join room.";
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
  supabase.auth.onAuthStateChange((_event, session) => {
    view.session = session;
    if (session) {
      view.menuScreen = "main";
      void loadAccountData();
    } else {
      view.profile = undefined;
      view.decks = [];
      view.collection = [];
      view.matchHistory = [];
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
    view.accountMessage = "Signed in.";
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
    view.accountMessage = "Account created. Confirm email if your Supabase project requires it, then sign in.";
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
    view.accountMessage = "Signed out.";
  });
}

async function loadAccountData(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  await withAccountLoading(async () => {
    await ensureProfile();
    await ensureCollection();

    const userId = view.session!.user.id;
    const [profileResult, decksResult, collectionResult, historyResult] = await Promise.all([
      supabase.from("profiles").select("user_id,display_name,avatar_url").eq("user_id", userId).single(),
      supabase
        .from("decks")
        .select("id,user_id,name,card_catalog_version,card_ids,updated_at")
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
    if (!view.editingDeck) startNewDeck(false);
  });
}

async function syncCollection(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  await withAccountLoading(async () => {
    await ensureCollection();
    view.accountMessage = "Collection synced.";
    await loadAccountDataRaw();
  });
}

async function loadAccountDataRaw(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  const userId = view.session.user.id;
  const [profileResult, decksResult, collectionResult, historyResult] = await Promise.all([
    supabase.from("profiles").select("user_id,display_name,avatar_url").eq("user_id", userId).single(),
    supabase
      .from("decks")
      .select("id,user_id,name,card_catalog_version,card_ids,updated_at")
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
  if (!view.editingDeck) startNewDeck(false);
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
  await withAccountLoading(async () => {
    const { data, error } = await supabase.rpc("save_user_deck", {
      p_deck_id: view.editingDeck?.id ?? null,
      p_name: name,
      p_card_catalog_version: CARD_CATALOG_VERSION,
      p_card_ids: cardIds
    });
    if (error) throw error;
    const saved = data as DeckRow;
    view.accountMessage = `Saved ${saved.name}.`;
    view.selectedDeckId = saved.id;
    view.editingDeck = { ...saved, card_ids: [...saved.card_ids] };
    await loadAccountData();
  });
}

async function deleteDeck(deckId: string | undefined): Promise<void> {
  if (!supabase || !deckId) return;
  await withAccountLoading(async () => {
    const { error } = await supabase.rpc("delete_user_deck", { p_deck_id: deckId });
    if (error) throw error;
    view.accountMessage = "Deck deleted.";
    if (view.selectedDeckId === deckId) view.selectedDeckId = undefined;
    if (view.editingDeck?.id === deckId) startNewDeck(false);
    await loadAccountData();
  });
}

function startNewDeck(doRender = true): void {
  view.editingDeck = { name: "New Deck", card_ids: [] };
  if (doRender) render();
}

function autofillDeck(): void {
  if (!view.editingDeck) startNewDeck(false);
  const ids: string[] = [];
  for (const card of CARD_CATALOG) {
    if (card.collectible === false) continue;
    const copies = deckCopyLimit(card);
    for (let i = 0; i < copies && ids.length < 30; i++) ids.push(card.id);
    if (ids.length >= 30) break;
  }
  view.editingDeck = { ...view.editingDeck!, card_ids: ids };
  render();
}

function clearDeck(): void {
  if (!view.editingDeck) return;
  view.editingDeck = { ...view.editingDeck, card_ids: [] };
  render();
}

function addCardToEditor(cardId: string | undefined): void {
  if (!cardId) return;
  if (!view.editingDeck) startNewDeck(false);
  const card = cardCatalog.get(cardId);
  if (!card) return;
  const counts = countCards(view.editingDeck!.card_ids);
  const limit = deckCopyLimit(card);
  if ((counts.get(cardId) ?? 0) >= limit || view.editingDeck!.card_ids.length >= 30) return;
  view.editingDeck = { ...view.editingDeck!, card_ids: [...view.editingDeck!.card_ids, cardId] };
  render();
}

function removeCardFromEditor(cardId: string | undefined): void {
  if (!cardId || !view.editingDeck) return;
  const index = view.editingDeck.card_ids.indexOf(cardId);
  if (index < 0) return;
  const cardIds = [...view.editingDeck.card_ids];
  cardIds.splice(index, 1);
  view.editingDeck = { ...view.editingDeck, card_ids: cardIds };
  render();
}

async function withAccountLoading(action: () => Promise<void>): Promise<void> {
  view.accountLoading = true;
  view.accountError = undefined;
  view.accountMessage = undefined;
  render();
  try {
    await action();
  } catch (error) {
    view.accountError = errorMessage(error);
  } finally {
    view.accountLoading = false;
    render();
  }
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
      cue.kind === "play" ? 1050
      : cue.kind === "attackerMoves" ? 460
      : cue.kind === "damage" || cue.kind === "heal" ? 1150
      : cue.kind === "destroy" ? 700
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
    type: card.type,
    rarity: catalogCard?.rarity ?? "COMMON",
    attack: card.attack ?? catalogCard?.attack,
    health: card.health ?? catalogCard?.health
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

function deckCopyLimit(card: CardDefinition): number {
  if (card.collectible === false) return 0;
  return card.rarity === "LEGENDARY" ? 1 : 2;
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
