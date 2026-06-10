import { Client, type Room } from "@colyseus/sdk";
import { AMPLIFICATION_DB, CARD_CATALOG, CARD_CATALOG_VERSION, type CardDefinition } from "@twcardgame/cards";
import { AI_THEMES, getXPRequiredForLevel, MAX_LEVEL } from "@twcardgame/shared";
import type {
  AiDifficulty,
  AmplificationOption,
  AmplificationSelection,
  ClientCommandMessage,
  DevTestMatchSetup,
  FriendRow,
  FriendRequestRow,
  GameCommand,
  GameEvent,
  GameStatus,
  HandCardView,
  LeaderboardRow,
  Phase,
  PublicMinion,
  PublicPlayer,
  RewardSummary,
  Seat,
  TargetRef
} from "@twcardgame/shared";
import { GameStateSchema } from "./schema.js";
import { assetUrl, classNames, escapeAttr, escapeHtml, fanStyle, opponentFanStyle } from "./ui.js";
import {
  beginAttackDrag,
  beginBattlecryTargeting,
  beginHandDrag,
  classifyEffectKind,
  endBattlecryTargeting,
  ensureDragLayer,
  type DragLineKind
} from "./drag.js";
import {
  bgmMutedKey,
  bgmVolumeKey,
  configureAudio,
  ensureBgm,
  installAudioUnlock,
  playEventAudio,
  playSfx,
  setBgmVolume,
  setSfxVolume,
  sfxMutedKey,
  sfxVolumeKey,
  toggleBgmMute,
  toggleSfxMute,
  type SoundCue
} from "./app/audio.js";
import { betaDbResetEnabled, defaultServerUrl, forceDevAuth, isLocalDevHost, serverHttpUrl, supabase as configuredSupabase } from "./app/config.js";
import {
  buildCollectionMap,
  collectionQuantity,
  ownedCollectionCards,
  ownedCollectionTypeCount,
  compareCollectionCards as compareCollectionCardsBySort
} from "./app/collection.js";
import { installClickEffect } from "./app/click-effect.js";
import { playPveTransition } from "./app/transition-video.js";
import { setAppContext } from "./app/context.js";
import {
  isHandCardAnimating,
  noteOpponentHandSync,
  notePlayerHandSync,
  resetDrawTracking
} from "./app/draw-animation.js";
import { DISCARD_CARD_BODY_MS, playDiscardAnimations } from "./app/discard-animation.js";
import { playVoteRoulette, resetVoteRoulette, voteRouletteActive, VOTE_REVEAL_HOLD_MS, VOTE_ROULETTE_TOTAL_MS, type VoteRouletteChoice } from "./app/vote-roulette.js";
import { cssEscape } from "./app/dom.js";
import { classifyBatchScopes, findEffectSourceKey, mapEventToCueKind, type AoeCluster } from "./app/cue-scope.js";
import { bindOnce, patchHtml } from "./app/dom-patch.js";
import { captureRenderSnapshot, restoreRenderSnapshot } from "./app/render-snapshot.js";
import { readStoredBool, readStoredNumber } from "./app/storage.js";
import {
  clearActiveMatch,
  isActiveMatchFresh,
  readActiveMatch,
  rememberActiveMatch,
  touchActiveMatch,
  type ActiveMatchRecord
} from "./app/activeMatch.js";
import { PATCH_NOTES } from "./app/patch-notes.js";
import type {
  AnimationCue,
  AnimationKind,
  AuthMode,
  BattlecryPreviewState,
  BattleLogBadge,
  BattleLogCardRef,
  BattleLogEntry,
  BattleMode,
  ClientViewState,
  CollectionFilter,
  CollectionRow,
  CollectionSort,
  DeckRow,
  FriendsPanel,
  MatchHistoryRow,
  MenuScreen,
  PackOpeningReward,
  ProfileRow,
  PurchaseShopResult,
  ResolvedCardView,
  ShopItemRow
} from "./app/types.js";
import { installViewportGuards } from "./app/viewport.js";
import {
  renderRewardOverlay,
  resetRewardScreen,
  skipRewardAnimation,
  startRewardAnimation
} from "./app/reward-screen.js";
import {
  TRAINING_LEVELS,
  advanceTraining,
  createTrainingSession,
  createTrainingRewardSummary,
  handleTrainingCommand,
  trainingBlocksBattle,
  trainingCanEndTurn,
  trainingCanSelectAttacker,
  trainingCanSelectHand,
  trainingHasHighlight,
  trainingPrompt,
  trainingPublicState,
  type TrainingCommandResult,
  type TrainingHighlight,
  type TrainingLevelId,
  type TrainingSession
} from "./app/training.js";

const PROFILE_SELECT =
  "user_id,display_name,display_name_set,avatar_url,gold,vouchers,xp,level,owned_avatars,owned_titles,selected_title,login_days,current_login_streak,longest_login_streak,last_login_date";
const DEFAULT_AVATAR_URL = "/images/avatars/ai_default.webp";
const FALLBACK_PROFILE_AVATAR_URL = "/images/avatars/avatar1.webp";
const TITLE_LABELS: Record<string, string> = {
  beginner: "菜鳥",
  salary_thief: "薪水小偷",
  monument_smoker: "古蹟菸客",
  busy_worker: "忙碌社畜",
  wehavemusic: "我們有音樂",
  heartbroken_dog: "傷心狗狗"
};
const TURN_ANNOUNCEMENT_LOCK_MS = 1650;
const ATTACK_LUNGE_MS = 800;
const ATTACK_IMPACT_DELAY_MS = Math.round(ATTACK_LUNGE_MS * 0.7);
// Hero death shatter is deliberately slower than the minion one (0.78s) for a
// dramatic finish; the victory/defeat overlay is held until it finishes plus a
// short settle pause.
const HERO_SHATTER_MS = 1600;
const RESULT_OVERLAY_PAUSE_MS = 400;
const APP_VERSION = "v1.1.0";
const POST_ATTACK_STATE_SYNC_LAG_MS = 120;
/** Pause inserted between a quest-complete flash and its downstream effects (damage/destroy/summon). */
const QUEST_COMPLETE_EFFECT_DELAY_MS = 700;
const PUBLIC_SYNC_EVENT_GRACE_MS = 50;
const AMP_REROLL_FLIP_OUT_MS = 260;
const AMP_REROLL_FLIP_IN_MS = 320;

const BATTLECRY_LOG = true;
function blog(label: string, data?: Record<string, unknown>): void {
  if (!BATTLECRY_LOG) return;
  const t = performance.now().toFixed(1);
  let payload = "";
  if (data) {
    try {
      payload = " " + JSON.stringify(data);
    } catch {
      payload = " [unserializable]";
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[battlecry +${t}ms] ${label}${payload}`);
}

const app = document.querySelector<HTMLDivElement>("#app")!;
const supabase = configuredSupabase;
const devTestModeAvailable = import.meta.env.DEV && isLocalDevHost();
let devTestPanel: typeof import("./app/dev-test.js") | undefined;
const cardCatalog = new Map<string, CardDefinition>(CARD_CATALOG.map((card) => [card.id, card]));
const amplificationCatalog = new Map(AMPLIFICATION_DB.map((augment) => [augment.id, augment]));
const seats: Seat[] = ["player1", "player2"];
/**
 * Remembers each minion's card identity by `instanceId` for the battle log. Populated when a minion
 * is summoned so `ATTACK` / `DAMAGE` / `DESTROY` events (which reference an `instanceId` that may
 * already have left the board) can still resolve a display name and art. Cleared per match.
 */
const battleLogMinions = new Map<string, { cardId: string; name: string }>();
/** How many of the most recent battle-log entries the panel shows at once (newest at the bottom). */
const BATTLE_LOG_VISIBLE = 10;
const rarityLabel: Record<string, string> = {
  COMMON: "普通", RARE: "精良", EPIC: "史詩", LEGENDARY: "傳說"
};

const AI_THEME_ILLUSTRATIONS: Record<string, string> = {
  dpp: "/images/illustrations/lai_illustration.webp",
  dpp2: "/images/illustrations/tsai_illustration.webp",
  kmt: "/images/illustrations/han_illustration.webp",
  kmt2: "/images/illustrations/fu_kun_chi.webp",
  tpp: "/images/illustrations/ko_illustration.webp"
};

const AI_THEME_DESCRIPTIONS: Record<string, string> = {
  dpp: "透過賴清德強力的新聞數值造成高傷害的疊加牌組",
  dpp2: "透過沉默、回手牌使戰場扭轉局面的奇幻蔡英文牌組",
  kmt: "以韓國瑜為核心透過不斷來回進出戰場來增加體質強度的黏濁牌組",
  kmt2: "透過傅崐萁反覆進出戰場與遺志效果，累積資源並拖垮對手",
  tpp: "柯文哲為核心賦予治療光盾以及強化的簡單強力牌組"
};

const AI_DIFFICULTY_REWARDS: Record<AiDifficulty, number> = {
  easy: 100,
  normal: 200,
  hard: 300
};

function createClientId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const view: ClientViewState = {
  hand: [],
  presence: new Map(),
  rejectedHandIds: new Set(),
  mulliganSelection: new Set(),
  events: [],
  battleLog: [],
  animationCues: [],
  joining: false,
  accountLoading: false,
  authMode: "signin",
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
  aiDifficultySelected: true,
  aiTheme: AI_THEMES[0].id,
  battleMode: "challenge",
  bgmVolume: readStoredNumber(bgmVolumeKey, 0.22),
  sfxVolume: readStoredNumber(sfxVolumeKey, 0.72),
  bgmMuted: readStoredBool(bgmMutedKey, false),
  sfxMuted: readStoredBool(sfxMutedKey, false),
  settingsOpen: false,
  battleSettingsOpen: false,
  battleDeckOpen: false,
  changelogOpen: false
};

const decheckeredCache = new Map<string, string>();

function processImageDechecker(url: string): string {
  if (decheckeredCache.has(url)) {
    return decheckeredCache.get(url)!;
  }
  decheckeredCache.set(url, url);

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  img.onload = () => {
    const canvas = document.createElement("canvas");
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const isBg = (r: number, g: number, b: number) => {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      return (max - min < 20) && (min > 190);
    };

    const visited = new Uint8Array(w * h);
    const queue: [number, number][] = [];

    for (let x = 0; x < w; x++) {
      if (isBg(data[x * 4], data[x * 4 + 1], data[x * 4 + 2])) {
        queue.push([x, 0]);
        visited[0 * w + x] = 1;
      }
      const bottomY = h - 1;
      const idx = bottomY * w + x;
      if (isBg(data[idx * 4], data[idx * 4 + 1], data[idx * 4 + 2])) {
        queue.push([x, bottomY]);
        visited[idx] = 1;
      }
    }
    for (let y = 0; y < h; y++) {
      const idxLeft = y * w;
      if (isBg(data[idxLeft * 4], data[idxLeft * 4 + 1], data[idxLeft * 4 + 2])) {
        queue.push([0, y]);
        visited[idxLeft] = 1;
      }
      const idxRight = y * w + (w - 1);
      if (isBg(data[idxRight * 4], data[idxRight * 4 + 1], data[idxRight * 4 + 2])) {
        queue.push([w - 1, y]);
        visited[idxRight] = 1;
      }
    }

    let head = 0;
    while (head < queue.length) {
      const [cx, cy] = queue[head++];
      const idx = cy * w + cx;
      data[idx * 4 + 3] = 0;

      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const nidx = ny * w + nx;
          if (visited[nidx] === 0) {
            if (isBg(data[nidx * 4], data[nidx * 4 + 1], data[nidx * 4 + 2])) {
              visited[nidx] = 1;
              queue.push([nx, ny]);
            }
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      decheckeredCache.set(url, dataUrl);
      render();
    } catch (e) {
      console.error("Failed to dechecker image", e);
    }
  };

  return url;
}

let renderScheduled = false;
let trainingSession: TrainingSession | undefined;
let remoteTrainingCompletions = new Set<string>();
let lastRenderedHtml = "";
let turnAnnouncementTimer: number | undefined;
let turnCountdownTimer: number | undefined;
let turnCountdownWakeTimer: number | undefined;
let turnCountdownWakeDeadlineAtMs: number | undefined;
let amplificationRerollTimer: number | undefined;
let lastTurnAnnouncementKey: string | undefined;
let trainingRewardAnimationTimer: number | undefined;
const minionDomKeys = new Map<string, string>();
const appliedDeathShatters = new Set<string>();
// The losing hero's portrait shatters once per match on GAME_FINISHED; this gate
// stops repeat renders from re-spawning it. resultOverlayHoldUntilMs defers the
// VICTORY/DEFEAT overlay (and reward animation) until that shatter has finished.
// Both reset on each new match in resetMinionVisualTracking().
let heroShatterFired = false;
let resultOverlayHoldUntilMs = 0;
// Seat of the hero currently shattering; renderHero hides its intact portrait
// (via .hero-shattering) so only the flying fragments are seen. Set the moment
// the shatter spawns, cleared on the next match. (Inline styles/classes added
// imperatively are stripped by the render morph, so this must drive the template.)
let shatteringHeroSeat: Seat | undefined;
const appliedDeathrattles = new Set<string>();
// Battlecry flying knives are animated imperatively (like death shatter / attack
// lunge) rather than as a declarative cue node, because the re-rendered node had
// its CSS animation-delay reset on every morph patch — so a knife with a long
// delay (fast play → effect waits for the landing to settle) never finished
// flying. Firing once into a body-level element sidesteps the render churn.
const appliedKnives = new Set<string>();
// Last-seen on-screen rect per unit instanceId, so a deathrattle (遺志) plume can
// anchor on a minion whose DOM has already been removed by its DESTROY (R4).
const recentUnitRects = new Map<string, { rect: DOMRect; atMs: number }>();
const summonPreviewedTargets = new Set<string>();
const loggedSummonPreviewSlots = new Set<string>();
const loggedSkippedSummonAnimations = new Set<string>();

function resetMinionVisualTracking(): void {
  minionDomKeys.clear();
  summonPreviewedTargets.clear();
  loggedSummonPreviewSlots.clear();
  loggedSkippedSummonAnimations.clear();
  heroShatterFired = false;
  resultOverlayHoldUntilMs = 0;
  shatteringHeroSeat = undefined;
}

export function startApp(): void {
  setAppContext({ view, render, supabase, cardCatalog, seats });
  configureAudio(view, render);
  ensureDragLayer();
  installViewportGuards();
  installAudioUnlock();
  installClickEffect();
  if (devTestModeAvailable && shouldOpenDevTestFromUrl()) view.menuScreen = "test";
  if (devTestModeAvailable) {
    void import("./app/dev-test.js").then((module) => {
      devTestPanel = module;
      render();
    });
  }
  render();
  // Best-effort: stamp the active-match record at the moment of unload so the
  // startup resume prompt can judge whether the server room is still alive.
  window.addEventListener("pagehide", () => {
    if (view.room) touchActiveMatch();
  });
  void initializeAccount().finally(() => {
    void maybePromptResumeMatch();
  });
}

function shouldOpenDevTestFromUrl(): boolean {
  const params = new URLSearchParams(location.search);
  return params.get("testMode") === "1" || params.get("devTest") === "1";
}

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
      ${renderAugmentTooltip()}
    </main>
  `;

  if (nextHtml !== lastRenderedHtml) {
    const snapshot = captureRenderSnapshot();
    if (app.firstChild) patchHtml(app, nextHtml);
    else app.innerHTML = nextHtml;
    lastRenderedHtml = nextHtml;
    bindStaticActions();
    bindSelectionActions();
    restoreRenderSnapshot(snapshot);
  }
  applyPostRenderEffects();
  syncTurnCountdownTick(status);
  ensureBgm();
}

function on(
  target: EventTarget | null | undefined,
  type: string,
  key: string,
  listener: (event: any) => void,
  options?: AddEventListenerOptions | boolean
): void {
  bindOnce(target, type, key, listener as EventListener, options);
}

function renderLanding(): string {
  if (devTestModeAvailable && view.menuScreen === "test") return renderMenu();
  if (supabase && !view.session) return renderAuthPanel();
  if (supabase && view.session && needsPlayerIdSetup()) return renderPlayerIdSetupPanel();
  return renderMenu();
}

function renderComputerPlaceholderScreen(): string {
  const selectedDeck = view.decks.find((deck) => deck.id === view.selectedDeckId);
  const accountMode = Boolean(supabase);
  const aiModeDisabled = view.joining || Boolean(view.matchmaking) || !view.aiDifficultySelected || (accountMode && (!view.session || !view.selectedDeckId));
  const difficulties: { value: AiDifficulty; label: string }[] = [
    { value: "easy", label: "簡單" },
    { value: "normal", label: "普通" },
    { value: "hard", label: "困難" }
  ];
  const deckSlots = accountMode
    ? view.decks.map(renderSavedDeck).join("") || `<p class="battle-empty-note">尚未建立牌組，請先新增一組。</p>`
    : `<div class="deck-slot saved-deck selected dev-deck-slot" data-dom-key="deck-dev">
        <button class="deck-select" type="button">
          <h3>Dev Deck</h3>
          <span class="slot-info">Server default deck</span>
        </button>
      </div>`;

  return `
    <section class="screen placeholder-screen" data-screen="computer-placeholder" style="background: #000000; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 20px; padding: 40px; overflow-y: auto;">
      <h2 style="color: #ffffff; font-size: 38px; text-shadow: 0 0 10px rgba(255,255,255,0.5); font-family: var(--font-display); margin: 0;">電腦模式</h2>
      
      <div class="deck-slots-container" data-testid="battle-deck-list" style="margin: 10px 0;">
        ${deckSlots}
        <button id="new-deck" type="button" class="deck-slot add-deck-slot">
          <span class="plus-icon">+</span>
          <span class="slot-info">新增牌組</span>
        </button>
      </div>

      <p class="battle-selected-note" style="margin: 0; font-size: 16px;">
        ${selectedDeck ? `已選擇：${escapeHtml(selectedDeck!.name)}` : accountMode ? "請選擇一組完整 30 張牌組。" : "Dev mode 會使用伺服器預設牌組。"}
      </p>

      <div class="battle-ai-mode-section" style="display: flex; flex-direction: column; align-items: center; gap: 14px; margin-top: 10px;">
        <h4 class="ai-section-label" style="margin: 0; color: #f4e4bc; font-size: 18px; text-shadow: 0 2px 5px #000;">難度</h4>
        <div class="ai-difficulty-options" style="display: flex; flex-direction: row; gap: 14px;">
          ${difficulties.map((opt) => `
            <label class="ai-difficulty-option ${view.aiDifficultySelected && view.aiDifficulty === opt.value ? "selected" : ""}" data-dom-key="battle-difficulty-${opt.value}">
              <input type="radio" name="ai-difficulty" value="${opt.value}" ${view.aiDifficultySelected && view.aiDifficulty === opt.value ? "checked" : ""} />
              <strong>${escapeHtml(opt.label)}</strong>
            </label>
          `).join("")}
        </div>
        <button id="start-ai-mode-match" class="neon-button battle-start-btn" data-testid="start-ai-mode-match" ${aiModeDisabled ? "disabled" : ""} style="min-width: 170px; min-height: 56px; font-size: 22px; margin-top: 10px;">
          ${view.joining ? "連線中..." : "開始對戰"}
        </button>
      </div>

      <button class="back-button neon-button secondary" data-menu-screen="battle" style="min-width: 140px; min-height: 48px; font-size: 18px; margin-top: 10px;">返回</button>
    </section>
  `;
}

function renderPvpPlaceholderScreen(): string {
  const selectedDeck = view.decks.find((deck) => deck.id === view.selectedDeckId);
  const accountMode = Boolean(supabase);
  const findDisabled = view.joining || Boolean(view.matchmaking) || (accountMode && (!view.session || !view.selectedDeckId));
  const deckSlots = accountMode
    ? view.decks.map(renderSavedDeck).join("") || `<p class="battle-empty-note">尚未建立牌組，請先新增一組。</p>`
    : `<div class="deck-slot saved-deck selected dev-deck-slot" data-dom-key="deck-dev">
        <button class="deck-select" type="button">
          <h3>Dev Deck</h3>
          <span class="slot-info">Server default deck</span>
        </button>
      </div>`;

  return `
    <section class="screen placeholder-screen" data-screen="pvp-placeholder" style="background: #000000; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 20px; padding: 40px; overflow-y: auto;">
      <h2 style="color: #ffffff; font-size: 38px; text-shadow: 0 0 10px rgba(255,255,255,0.5); font-family: var(--font-display); margin: 0;">玩家模式</h2>
      
      <div class="deck-slots-container" data-testid="battle-deck-list" style="margin: 10px 0;">
        ${deckSlots}
        <button id="new-deck" type="button" class="deck-slot add-deck-slot">
          <span class="plus-icon">+</span>
          <span class="slot-info">新增牌組</span>
        </button>
      </div>

      <p class="battle-selected-note" style="margin: 0; font-size: 16px;">
        ${selectedDeck ? `已選擇：${escapeHtml(selectedDeck!.name)}` : accountMode ? "請選擇一組完整 30 張牌組。" : "Dev mode 會使用伺服器預設牌組。"}
      </p>

      <div class="battle-selection-actions" style="display: flex; flex-direction: column; align-items: center; gap: 14px; margin-top: 10px;">
        <button id="find-match" class="neon-button battle-start-btn" data-testid="find-match" ${findDisabled ? "disabled" : ""} style="min-width: 170px; min-height: 56px; font-size: 22px;">
          ${view.joining ? "連線中..." : "開始排隊"}
        </button>
        
        <details class="advanced-disclosure battle-advanced" style="color: #cbbca2; font-size: 14px; cursor: pointer; display: block;">
          <summary>進階設定</summary>
          <form id="join-form-advanced" class="advanced-form" style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px; text-align: left;">
            <label>Server URL
              <input id="server-url-advanced" value="${escapeAttr(defaultServerUrl)}" style="margin-left: 8px; padding: 4px;" />
            </label>
            ${accountMode ? "" : `<label>Display Name<input id="display-name-advanced" value="${escapeAttr(view.profile?.display_name ?? "Player")}" style="margin-left: 8px; padding: 4px;" /></label>`}
          </form>
        </details>
      </div>

      <button class="back-button neon-button secondary" data-menu-screen="battle" style="min-width: 140px; min-height: 48px; font-size: 18px; margin-top: 10px;">返回</button>
    </section>
  `;
}

function renderMenu(): string {
  switch (view.menuScreen) {
    case "battle":
      return renderBattleScreen();
    case "training":
      return renderTrainingScreen();
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
    case "computer_placeholder":
      return renderComputerPlaceholderScreen();
    case "pvp_placeholder":
      return renderPvpPlaceholderScreen();
    case "test":
      return devTestModeAvailable ? devTestPanel?.renderDevTestPanel(Boolean(view.joining || view.room)) ?? `<section class="screen" data-screen="test"></section>` : renderMainMenu();
    case "main":
    default:
      return renderMainMenu();
  }
}

function renderAuthPanel(): string {
  const mode = view.authMode;
  const isSignup = mode === "signup";
  return `
    <section class="screen auth-screen" data-screen="auth">
      ${renderCloudLayer()}
      <div class="auth-container-v2">
        <h1 class="auth-page-title">${isSignup ? "帳號註冊" : "帳號登入"}</h1>
        <div class="auth-card parchment-card">
          <div class="auth-tabs" aria-label="帳號操作">
            <button type="button" id="auth-signin-tab" class="auth-tab ${mode === "signin" ? "active" : ""}" ${view.accountLoading ? "disabled" : ""}>登入</button>
            <button type="button" id="auth-signup-tab" class="auth-tab ${isSignup ? "active" : ""}" ${view.accountLoading ? "disabled" : ""}>註冊</button>
          </div>
        <form id="auth-form" class="auth-form">
          <label class="auth-label">
            <span>帳號</span>
            <input id="auth-email" type="email" autocomplete="email" placeholder="輸入用戶名" required />
          </label>
          <label class="auth-label">
            <span>密碼</span>
            <input id="auth-password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" placeholder="輸入密碼" required />
          </label>
          ${isSignup
            ? `<label class="auth-label">
                <span>確認密碼</span>
                <input id="auth-confirm-password" type="password" autocomplete="new-password" placeholder="再次輸入密碼" required />
              </label>`
            : `<button type="button" id="google-sign-in" class="google-logo-button" aria-label="使用 Google 登入" title="使用 Google 登入" ${view.accountLoading ? "disabled" : ""}>
                <span class="google-g" aria-hidden="true">G</span>
              </button>`
          }
          <button type="submit" class="auth-submit" data-auth-mode="${mode}" data-testid="${isSignup ? "auth-signup" : "auth-signin"}" ${view.accountLoading ? "disabled" : ""}>${isSignup ? "建立帳號" : "確定登入"}</button>
        </form>
        </div>
      </div>
    </section>
  `;
}

function renderPlayerIdSetupPanel(): string {
  const value = view.editingDisplayName ?? "";
  return `
    <section class="screen auth-screen" data-screen="player-id">
      ${renderCloudLayer()}
      <div class="auth-container-v2">
        <h1 class="auth-page-title">設定玩家 ID</h1>
        <div class="auth-card parchment-card">
          <form id="player-id-form" class="auth-form">
            <label class="auth-label">
              <span>玩家 ID</span>
              <input id="player-id-input" type="text" autocomplete="nickname" maxlength="32" value="${escapeAttr(value)}" placeholder="輸入玩家 ID" required autofocus />
            </label>
            <button type="submit" class="auth-submit" data-testid="player-id-submit" ${view.accountLoading ? "disabled" : ""}>開始遊戲</button>
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
  const avatarUrl = view.profile?.avatar_url || DEFAULT_AVATAR_URL;
  const stats = computeMatchStats();
  const collectionMap = buildCollectionMap(view.collection);
  const collectibles = CARD_CATALOG.filter((card) => card.collectible !== false);
  const ownedCount = ownedCollectionTypeCount(collectibles, collectionMap);
  const totalCatalog = collectibles.length;
  const accountMode = Boolean(supabase);
  const level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(view.profile?.level ?? 1)));
  const xp = Math.max(0, Math.floor(view.profile?.xp ?? 0));
  const xpRequired = getXPRequiredForLevel(level);
  const xpFraction = level >= MAX_LEVEL || xpRequired <= 0 ? 1 : Math.min(1, xp / xpRequired);
  const xpDisplay = level >= MAX_LEVEL ? "MAX" : `${xp}/${xpRequired} XP`;
  const playerTitle = view.profile?.selected_title ? `#${titleLabel(view.profile.selected_title)}` : "未設定稱號";
  return `
    <section class="screen main-menu" data-screen="main">
      ${renderCloudLayer()}
      <div class="version-corner">
        <span class="version-pill">${APP_VERSION}</span>
      </div>
      <div class="main-menu-center">
        <h1 class="game-title">寶島遊戲王</h1>
        <nav class="menu-buttons" aria-label="Main menu">
          <button class="menu-button" data-menu-screen="profile" data-testid="menu-profile" ${accountMode ? "" : "disabled title='Sign in required'"}>個人頁面</button>
          <button class="menu-button menu-primary" data-menu-screen="battle" data-testid="menu-battle">進入戰鬥</button>
          <button class="menu-button menu-patch" id="changelog-open" data-testid="menu-patch">更新內容</button>
          ${devTestModeAvailable && devTestPanel ? `<button class="menu-button" data-menu-screen="test">${escapeHtml(devTestPanel.menuLabel)}</button>` : ""}
        </nav>
      </div>
      <nav class="menu-icon-rail" aria-label="側邊功能">
        <button id="settings-toggle" class="menu-icon-btn menu-image-btn" data-testid="menu-settings" title="設定">
          <img class="rail-icon-image" src="/images/ui/Setting.webp" alt="設定" />
        </button>
        <button class="menu-icon-btn menu-image-btn" data-menu-screen="leaderboard" data-testid="menu-leaderboard" title="排行榜">
          <img class="rail-icon-image" src="/images/ui/Dashboard.webp" alt="排行榜" />
        </button>
        <button class="menu-icon-btn menu-image-btn" data-menu-screen="friends" data-testid="menu-friends" title="好友" ${accountMode ? "" : "disabled"}>
          <img class="rail-icon-image" src="/images/ui/Friend.webp" alt="好友" />
        </button>
      </nav>
      <div class="main-menu-bottom">
        <aside class="player-info-card" data-testid="player-chip">
          <img class="player-avatar" src="${escapeAttr(avatarUrl)}" alt="" onerror="this.src='${DEFAULT_AVATAR_URL}'" />
          <div class="player-info-text">
            <strong>${escapeHtml(displayName)}</strong>
            <span class="player-title-text">${escapeHtml(playerTitle)}</span>
            <span class="player-level-row">Lv.${level}</span>
            <div class="xp-bar-track"><div class="xp-bar-fill" style="width:${Math.round(xpFraction * 100)}%"></div></div>
            <span class="player-xp-readout">${xpDisplay}</span>
            <span class="player-stats">W ${stats.wins} · L ${stats.losses}</span>
          </div>
        </aside>
        <nav class="menu-corner-rail" aria-label="底部功能">
          <button class="menu-corner-btn" data-menu-screen="collection" data-testid="menu-collection">
            <img class="corner-icon" src="/images/ui/Vault.webp" alt="收藏庫" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
            <span class="corner-icon-emoji" style="display:none">🃏</span>
            <span class="corner-label">收藏庫</span>
          </button>
          <button class="menu-corner-btn" data-menu-screen="shop" data-testid="menu-shop" ${accountMode ? "" : "disabled"}>
            <img class="corner-icon" src="/images/ui/Shop.webp" alt="商店" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
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
  const activeMode = view.battleMode;

  return `
    <section class="screen battle-pick v1-deck-selection battle-mode-${activeMode}" data-screen="battle" data-dom-key="screen-battle">
      <div class="battle-map-stage" aria-label="戰鬥地圖入口">
        <button
          type="button"
          class="battle-map-hotspot battle-map-hotspot--challenge"
          data-battle-mode="pvp"
          data-dom-key="battle-map-hotspot-challenge"
          data-testid="battle-map-hotspot-challenge"
          aria-label="玩家模式"
        >
          <img src="${processImageDechecker("/images/ui/gamemode-arena-hotspot.webp")}" alt="" draggable="false" />
          <div class="mode-banner-container">
            <img src="${processImageDechecker("/images/ui/Banner.webp")}" class="mode-banner-bg" alt="" draggable="false" />
            <span class="mode-banner-text">玩家對戰</span>
          </div>
        </button>
        <button
          type="button"
          class="battle-map-hotspot battle-map-hotspot--ai"
          data-battle-mode="challenge"
          data-dom-key="battle-map-hotspot-ai"
          data-testid="battle-map-hotspot-ai"
          aria-label="挑戰模式"
        >
          <img src="${processImageDechecker("/images/ui/gamemode-president.webp")}" alt="" draggable="false" />
          <div class="mode-banner-container">
            <img src="${processImageDechecker("/images/ui/Banner.webp")}" class="mode-banner-bg" alt="" draggable="false" />
            <span class="mode-banner-text">挑戰模式</span>
          </div>
        </button>
        <button
          type="button"
          class="battle-map-hotspot battle-map-hotspot--pvp"
          data-battle-mode="ai"
          data-dom-key="battle-map-hotspot-pvp"
          data-testid="battle-map-hotspot-pvp"
          aria-label="電腦模式"
        >
          <img src="${processImageDechecker("/images/ui/gamemode-towel.webp")}" alt="" draggable="false" />
          <div class="mode-banner-container">
            <img src="${processImageDechecker("/images/ui/Banner.webp")}" class="mode-banner-bg" alt="" draggable="false" />
            <span class="mode-banner-text">電腦模式</span>
          </div>
        </button>
        <button
          type="button"
          class="battle-map-hotspot battle-map-hotspot--training"
          data-battle-mode="training"
          data-dom-key="battle-map-hotspot-training"
          data-testid="battle-map-hotspot-training"
          aria-label="訓練場"
        >
          <img src="${processImageDechecker("/images/ui/gamemode-training.webp")}" alt="" draggable="false" />
          <div class="mode-banner-container">
            <img src="${processImageDechecker("/images/ui/Banner.webp")}" class="mode-banner-bg" alt="" draggable="false" />
            <span class="mode-banner-text">訓練場</span>
          </div>
        </button>
      </div>
      <div class="battle-selection-content" style="grid-template-rows: auto auto 1fr;">
        <button class="back-button neon-button secondary" data-menu-screen="main" data-testid="back-to-menu">返回</button>
        <h2 id="deck-select-title" class="sub-title" style="margin-top: 20px;">選擇戰鬥模式</h2>
      </div>
      ${renderMatchmakingOverlay()}
    </section>
  `;
}

function renderTrainingScreen(): string {
  return `
    <section class="screen training-screen" data-screen="training">
      <header class="screen-header">
        <button class="back-button" data-menu-screen="battle" data-testid="training-back">← 返回</button>
        <h2>訓練場</h2>
      </header>
      <p class="training-screen-intro">從基礎到進階，逐關認識遊戲機制。完成一關才會解鎖下一關。</p>
      <div class="training-level-grid">
        ${renderTrainingLevelCards()}
      </div>
    </section>
  `;
}

function renderTrainingLevelCards(): string {
  return TRAINING_LEVELS.map((level, index) => {
    const unlocked = trainingLevelUnlocked(level.id);
    const completed = trainingLevelCompleted(level.id);
    const disabled = view.joining || Boolean(view.room) || !unlocked;
    const title = `第${index + 1}關：${level.name}`;
    const description = level.description;
    const status = completed ? "已完成" : unlocked ? "可開始" : "完成前一關後解鎖";
    return `
      <div class="battle-training-card">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)}</span>
        <span class="battle-training-note">${escapeHtml(status)}</span>
        <button
          class="neon-button battle-start-btn"
          data-start-training="${escapeAttr(level.id)}"
          data-testid="start-training-${escapeAttr(level.id)}"
          ${disabled ? "disabled" : ""}
        >
          ${completed ? "再次訓練" : "開始訓練"}
        </button>
      </div>
    `;
  }).join("");
}

function renderAiBattleSetupScreen(): string {
  const accountMode = Boolean(supabase);
  const aiDisabled = view.joining || !view.aiDifficultySelected || (accountMode && (!view.session || !view.selectedDeckId));
  const difficulties: { value: AiDifficulty; label: string; reward: number }[] = [
    { value: "easy", label: "普通級", reward: AI_DIFFICULTY_REWARDS.easy },
    { value: "normal", label: "專家級", reward: AI_DIFFICULTY_REWARDS.normal },
    { value: "hard", label: "大師級", reward: AI_DIFFICULTY_REWARDS.hard }
  ];
  const selectedTheme = AI_THEMES.find((theme) => theme.id === view.aiTheme) ?? AI_THEMES[0];
  const selectedHeroArt = AI_THEME_ILLUSTRATIONS[selectedTheme.id] ?? "";
  const selectedThemeLabel = formatAiThemeLabel(selectedTheme.label);
  const [selectedThemeName, selectedThemeSubtitle = selectedTheme.partyTag] = selectedThemeLabel.split("-");
  const selectedThemeDescription = AI_THEME_DESCRIPTIONS[selectedTheme.id] ?? selectedThemeLabel;

  return `
    <section class="screen ai-battle-setup" data-screen="ai" data-dom-key="screen-ai">
      <div class="battle-setup-container">
        <div class="setup-preview-panel">
          <div class="preview-image-container">
            ${selectedHeroArt ? `<img id="preview-image" src="${escapeAttr(selectedHeroArt)}" alt="${escapeAttr(selectedTheme?.name ?? "AI")}" />` : ""}
            <div class="preview-illustration-overlay active">
              <div id="preview-illustration-title" class="illustration-title">${escapeHtml(selectedThemeName)}</div>
              <div id="preview-illustration-subtitle" class="illustration-subtitle">${escapeHtml(selectedThemeSubtitle)}</div>
            </div>
          </div>
          <div class="preview-description">
            <p>${escapeHtml(selectedThemeDescription)}</p>
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
                <span class="btn-text">${view.joining ? "連線" : "選擇"}</span>
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

function renderAiThemeOption(theme: (typeof AI_THEMES)[number], difficulties: { value: AiDifficulty; label: string; reward: number }[]): string {
  const selected = view.aiTheme === theme.id;
  const themeLabel = formatAiThemeLabel(theme.label);
  return `
    <div class="deck-option-group ${selected ? "expanded selected" : ""}" data-dom-key="ai-theme-group-${escapeAttr(theme.id)}">
      <button
        type="button"
        class="option-item ai-theme-card ${selected ? "selected" : ""}"
        data-ai-theme="${escapeAttr(theme.id)}"
        data-dom-key="ai-theme-${escapeAttr(theme.id)}"
        data-testid="ai-theme-${escapeAttr(theme.id)}"
        aria-pressed="${selected}"
      >
        <span class="option-label">${escapeHtml(themeLabel)}</span>
        <span class="expand-arrow">›</span>
      </button>
      <div class="difficulty-options">
        ${difficulties.map((opt) => `
          <label class="sub-difficulty-btn ${view.aiDifficultySelected && view.aiDifficulty === opt.value ? "selected" : ""}" data-dom-key="ai-theme-${escapeAttr(theme.id)}-difficulty-${opt.value}">
            <input type="radio" name="ai-difficulty" value="${opt.value}" ${view.aiDifficultySelected && view.aiDifficulty === opt.value ? "checked" : ""} />
            <span>${opt.label}</span>
            <span class="difficulty-reward"><img src="/images/ui/Coin.webp" alt="" />${opt.reward}</span>
          </label>
        `).join("")}
      </div>
    </div>
  `;
}

function formatAiThemeLabel(label: string): string {
  return label.replace(/\s+—\s+/g, "-");
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
        <h3>排隊配對中</h3>
        <p class="matchmaking-subtitle">正在為你尋找對手，請稍候…</p>
        <p class="matchmaking-timer" data-testid="matchmaking-elapsed">${mm}:${ss}</p>
        <button id="matchmaking-cancel" class="danger" data-testid="matchmaking-cancel">取消排隊</button>
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
  const avatarUrl = profile?.avatar_url || DEFAULT_AVATAR_URL;
  const stats = computeMatchStats();
  const winRateLabel = stats.total === 0 ? "—" : `${Math.round((stats.wins / stats.total) * 100)}%`;
  const level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(profile?.level ?? 1)));
  const xp = Math.max(0, Math.floor(profile?.xp ?? 0));
  const xpRequired = getXPRequiredForLevel(level);
  const xpProgress = level >= MAX_LEVEL || xpRequired <= 0 ? 100 : Math.min(100, Math.round((xp / xpRequired) * 100));
  const xpDisplay = level >= MAX_LEVEL ? "MAX" : `${xp}/${xpRequired} XP`;
  const ownedCardCount = [...buildCollectionMap(view.collection).values()].reduce((sum, quantity) => sum + quantity, 0);
  const title = profile?.selected_title ? `#${titleLabel(profile.selected_title)}` : "未設定稱號";
  const avatars = ["avatar1", "avatar2", "avatar3", "avatar4"];
  const ownedAvatars = avatars.filter((slug) => profile?.owned_avatars?.includes(slug));
  const ownedTitles = profile?.owned_titles ?? [];
  const googleAvatarUrl = googleProfileAvatarUrl();
  const showGoogleAvatar = Boolean(googleAvatarUrl);
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
            <button id="open-avatar-picker" class="profile-avatar-btn" aria-label="更換頭像">
              <img class="profile-avatar" src="${escapeAttr(avatarUrl)}" alt="" onerror="this.src='${DEFAULT_AVATAR_URL}'" />
              <span class="profile-avatar-edit-overlay" aria-hidden="true">✏️</span>
            </button>
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
            <div class="profile-title-row">
              ${ownedTitles.length > 0
                ? `<button type="button" id="open-title-picker" class="profile-title-badge profile-title-btn" aria-label="更換稱號">
                     ${escapeHtml(title)}
                     <span class="profile-title-edit-overlay" aria-hidden="true">✏️</span>
                   </button>`
                : `<div class="profile-title-badge">${escapeHtml(title)}</div>`
              }
            </div>
            <div class="profile-ribbon">
              <span>Lv. ${level}</span>
              <span>${stats.wins} 勝</span>
              <span>${winRateLabel} 勝率</span>
            </div>
            <div class="profile-xp" data-testid="profile-xp-bar">
              <div class="profile-xp-top">
                <span>經驗值</span>
                <strong>${xpDisplay}</strong>
              </div>
              <div
                class="profile-xp-track"
                role="progressbar"
                aria-label="經驗值"
                aria-valuemin="0"
                aria-valuemax="${level >= MAX_LEVEL ? 100 : xpRequired}"
                aria-valuenow="${level >= MAX_LEVEL ? 100 : Math.min(xp, xpRequired)}"
              >
                <div class="profile-xp-fill" style="width: ${xpProgress}%"></div>
              </div>
            </div>
          </div>
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
      ${view.avatarPickerOpen ? `
      <div class="picker-backdrop" id="avatar-picker-backdrop" role="dialog" aria-modal="true" aria-label="選擇頭像">
        <div class="picker-modal parchment-card">
          <header class="settings-modal-header">
            <h3>選擇頭像</h3>
            <button id="avatar-picker-close" class="settings-close-btn" title="關閉">✕</button>
          </header>
          <div class="avatar-picker" data-testid="avatar-picker">
            ${showGoogleAvatar ? `
              <button type="button" data-pick-google-avatar="1" class="avatar-option ${profile?.avatar_url === googleAvatarUrl ? "selected" : ""}" title="Google 頭像">
                <img src="${escapeAttr(googleAvatarUrl!)}" alt="Google 頭像" />
              </button>
            ` : ""}
            ${ownedAvatars.length === 0 ? `<p class="muted">尚未擁有頭像。</p>` : ownedAvatars.map((slug) => `
              <button type="button" data-pick-avatar="${slug}" class="avatar-option ${profile?.avatar_url?.includes(slug) ? "selected" : ""}">
                <img src="/images/avatars/${slug}.webp" alt="${slug}" />
              </button>
            `).join("")}
          </div>
        </div>
      </div>` : ""}
      ${view.titlePickerOpen ? `
      <div class="picker-backdrop" id="title-picker-backdrop" role="dialog" aria-modal="true" aria-label="選擇稱號">
        <div class="picker-modal parchment-card">
          <header class="settings-modal-header">
            <h3>選擇稱號</h3>
            <button id="title-picker-close" class="settings-close-btn" title="關閉">✕</button>
          </header>
          <div class="title-picker" data-testid="title-picker">
            ${ownedTitles.length === 0 ? `<p class="muted">尚未擁有稱號。</p>` : ownedTitles.map((id) => `
              <button type="button" data-pick-title="${escapeAttr(id)}" class="title-option ${profile?.selected_title === id ? "selected" : ""}">
                #${escapeHtml(titleLabel(id))}
              </button>
            `).join("")}
          </div>
        </div>
      </div>` : ""}
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
        ${betaDbResetEnabled ? `
        <div class="settings-divider"></div>
        <h4 class="settings-section-title">測試版資料</h4>
        <p class="settings-danger-note">清除帳號、個人資料、收藏、牌組、好友與對戰紀錄。卡牌目錄與商店設定會保留。</p>
        <button id="settings-beta-reset-db" class="settings-signout-btn danger" data-testid="settings-beta-reset-db" ${view.accountLoading ? "disabled" : ""}>一鍵清除 DB 資料</button>
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
  const collectionMap = buildCollectionMap(view.collection);
  const collectibles = CARD_CATALOG.filter((card) => card.collectible !== false);
  const ownedCards = usesDbCollectionOwnership() ? ownedCollectionCards(collectibles, collectionMap) : collectibles;
  const filterOptionCards = view.collectionFilter === "owned" ? ownedCards : collectibles;
  const filtered = filterCollectionCards(collectibles, collectionMap);
  const ownedTotal = usesDbCollectionOwnership()
    ? ownedCollectionTypeCount(collectibles, collectionMap)
    : collectibles.filter((card) => collectionQuantityFor(card, collectionMap) > 0).length;
  const categories = uniqueCollectionCategories(filterOptionCards);
  const rarities = uniqueCollectionRarities(filterOptionCards);
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
              <span id="collection-vouchers"><span class="voucher-icon" aria-hidden="true"></span>${view.profile?.vouchers ?? 0}</span>
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
            <div class="collection-filter-tabs" aria-label="收藏篩選">
              ${renderCollectionFilterButton("all", "全部", "filter-all")}
              ${renderCollectionFilterButton("owned", "已擁有", "filter-owned")}
              ${renderCollectionFilterButton("missing", "未擁有", "filter-missing")}
            </div>
            <div class="collection-grid" data-testid="collection-grid" data-preserve-scroll>
              ${filtered.length === 0 ? `<p class="muted collection-empty">沒有符合條件的卡牌。</p>` : filtered.map((card) => {
                const qty = collectionQuantityFor(card, collectionMap);
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

function renderCollectionFilterButton(filter: CollectionFilter, label: string, testId: string): string {
  const active = view.collectionFilter === filter;
  return `
    <button
      type="button"
      class="collection-filter-tab ${active ? "active" : ""}"
      data-collection-filter="${filter}"
      data-testid="${testId}"
      aria-pressed="${active}"
    >${label}</button>
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
      const qty = collectionQuantityFor(card, collectionMap);
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

function collectionQuantityFor(card: CardDefinition, collectionMap: Map<string, number>): number {
  return usesDbCollectionOwnership() ? collectionQuantity(card, collectionMap) : hasCollectionRows() ? (collectionMap.get(card.id) ?? 0) : deckCopyLimit(card);
}

function compareCollectionCards(a: CardDefinition, b: CardDefinition): number {
  return compareCollectionCardsBySort(a, b, view.collectionSort);
}

function rarityRank(rarity: string): number {
  if (rarity === "LEGENDARY") return 5;
  if (rarity === "EPIC") return 4;
  if (rarity === "RARE") return 3;
  if (rarity === "COMMON") return 2;
  return 1;
}

function renderCollectionTile(card: CardDefinition, quantity: number, selectedCount: number, selectedTotal: number): string {
  const owned = usesDbCollectionOwnership() || hasCollectionRows() ? quantity > 0 : true;
  const limit = deckCopyLimit(card);
  const effectiveOwned = usesDbCollectionOwnership() || hasCollectionRows() ? quantity : limit;
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
  const owned = buildCollectionMap(view.collection).get(cardId) ?? 0;
  if (usesDbCollectionOwnership() && owned <= 0) return "";
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
            ${renderKeywordGlossary(card.id, "right")}
            <p class="card-op-count">擁有數量：<strong>${owned}</strong></p>
            ${collectible ? `
              <div class="card-op-actions">
                <button type="button" id="card-op-disenchant" class="card-op-btn disenchant" data-card-id="${escapeAttr(card.id)}" ${canDisenchant ? "" : "disabled"}>
                  <span class="card-op-label">分解</span>
                  <span class="card-op-value"><span class="voucher-icon" aria-hidden="true"></span>${rate.disenchant}</span>
                </button>
                <button type="button" id="card-op-craft" class="card-op-btn craft" data-card-id="${escapeAttr(card.id)}" ${canCraft ? "" : "disabled"}>
                  <span class="card-op-label">合成</span>
                  <span class="card-op-value"><span class="voucher-icon" aria-hidden="true"></span>${rate.craft}</span>
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
    <div class="deck-slot saved-deck ${selected ? "selected" : ""} ${incomplete ? "incomplete" : ""}" data-dom-key="deck-${escapeAttr(deck.id)}">
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
  const battleLocked = isBattleActionLocked();
  const targetHint = view.pendingBattlecry?.phase === "aiming"
    ? view.pendingBattlecry.isMinion
      ? "請選擇觸發的目標！"
      : "請選擇目標！"
    : selectedCard
    ? handCardNeedsTarget(selectedCard)
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
    <section class="battle-surface ${view.animationCues.length ? "has-event-cues" : ""} ${hasCardPlayFocus ? "has-card-play-focus" : ""} ${battleLocked ? "battle-locked" : ""} ${trainingSession ? "training-active" : ""}" data-testid="battle-surface">
      <button id="battle-settings-toggle" class="battle-gear-btn" data-testid="battle-settings" title="設定" aria-label="設定">⚙</button>
      ${renderBattleSettingsMenu()}
      ${renderBattleHistoryPanel()}
      ${renderConnectionBanner()}
      ${renderPlayerArea(opponent, opponentPlayer, "opponent")}
      ${renderCenterLine(activeSeat, opponentPlayer, myPlayer)}
      ${renderPlayerArea(me ?? "player1", myPlayer, "player")}
      ${renderBattlePlayerInfo(myPlayer)}
      ${renderEventCues()}
      ${renderTurnAnnouncementOverlay()}
      ${renderMulliganOverlay(status)}
      ${renderAmplificationOverlay()}
      ${renderVotingOverlay()}
      ${renderOpponentDisconnectOverlay(status)}
      ${renderResultOverlay(status)}
      ${renderTrainingOverlay()}
      ${view.settingsOpen ? renderSettingsModal() : ""}
      ${view.battleDeckOpen ? renderBattleDeckModal() : ""}
      ${renderConcedeModal()}
    </section>
  `;
}

function renderBattleHistoryPanel(): string {
  const emptyClass = view.battleLog.length === 0 ? " battle-log-panel--empty" : "";
  return `
    <section id="match-history-panel" class="battle-log-panel${emptyClass}" data-testid="event-log">
      <div class="battle-log-list">
        ${view.battleLog.slice(-BATTLE_LOG_VISIBLE).map(renderBattleLogEntry).join("")}
      </div>
      <div id="history-list" class="event-log-raw" aria-hidden="true">
        ${view.events.map(renderEventLine).join("")}
      </div>
    </section>
  `;
}

function renderBattlePlayerInfo(player: PublicPlayer | undefined): string {
  const displayName = player?.displayName || view.profile?.display_name || "玩家";
  return `
    <div class="battle-player-hud">
    <aside class="player-info-card battle-player-info">
      <div class="player-details">
        <div class="player-username">${escapeHtml(displayName)}</div>
        <div class="player-title">無稱號</div>
      </div>
    </aside>
    ${renderTurnCounter()}
    </div>
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
  const boardHasActiveAttackLunge = board.some((minion) => activeAttackLunges.has(minion.instanceId));
  const boardClasses = classNames(["board", boardHasActiveAttackLunge && "lunging-board", activeTargeting() && "targeting-board", view.selectedAttackerId && "attacking-board", readBoardLimit() < 7 && "distanced-board"]);

  return `
    <section class="${areaClasses}" data-seat="${seat}" data-testid="${role}-area">
      ${role === "opponent" ? renderOpponentHand(handCount) : ""}
      ${renderHero(seat, player, role)}
      <div class="status-cluster">
        ${renderMana(player?.mana?.current ?? 0, player?.mana?.max ?? 0, role, seat)}
      </div>
      <div class="${boardClasses}" data-testid="${role}-board" data-target-key="board:${seat}">
        ${renderBoardContents(seat, board, role)}
      </div>
      ${role === "player" ? renderPlayerHand() : ""}
      ${!connected ? `<div class="disconnect-pill">Reconnecting</div>` : ""}
    </section>
  `;
}

/**
 * Renders the minions on a board, splicing in the battlecry preview minion at
 * its chosen slot while a targeted-battlecry minion is mid two-stage play.
 */
function renderBoardContents(seat: Seat, board: PublicMinion[], role: "player" | "opponent"): string {
  const cells = board.map((minion, index) => renderMinion(seat, minion, index));
  const summonPreviews = summonPreviewSlotsForBoard(seat, board);
  const pending = activeBattlecryPreview();
  let splicedPreview = false;
  if (
    pending?.isMinion &&
    pending.phase !== "landing" &&
    role === "player" &&
    battlecryReplacementIndex(board, pending) === -1
  ) {
    const slot = Math.max(0, Math.min(pending.boardIndex, cells.length));
    cells.splice(slot, 0, renderBattlecryPreview(pending.cardId));
    splicedPreview = true;
  }
  for (const preview of summonPreviews) {
    const html = renderSummonPreview(preview.cue);
    if (!html) continue;
    if (preview.index === undefined) {
      cells.push(html);
    } else {
      cells.splice(Math.max(0, Math.min(preview.index, cells.length)), 0, html);
    }
  }
  if (role === "player" && (pending || board.length > 0)) {
    blog("renderBoardContents player", {
      boardCount: board.length,
      hasPending: Boolean(pending),
      pendingPhase: pending?.phase,
      replacementIdx: pending ? battlecryReplacementIndex(board, pending) : undefined,
      splicedPreview,
      summonPreviewIds: summonPreviews.map(({ cue }) => cue.targetKey),
      boardIds: board.map((m) => m.instanceId)
    });
  }
  return cells.join("") || renderEmptySlots();
}

type SummonPreviewSlot = { cue: AnimationCue; index?: number };

function summonPreviewSlotsForBoard(seat: Seat, board: PublicMinion[]): SummonPreviewSlot[] {
  const boardIds = new Set(board.map((minion) => minion.instanceId));
  const battlecry = activeBattlecryPreview();
  const seen = new Set<string>();
  const slots: SummonPreviewSlot[] = [];
  const futureBoard = pendingPublicBoardForSeat(seat);
  for (const cue of view.animationCues) {
    if (cue.kind !== "summon" || cue.seat !== seat || !cue.targetKey || !cue.cardId || !cueIsReady(cue)) continue;
    if (battlecry?.isMinion && battlecry.phase !== "landing" && seat === view.mySeat && cue.cardId === battlecry.cardId) continue;
    if (boardIds.has(cue.targetKey) || seen.has(cue.targetKey)) continue;
    seen.add(cue.targetKey);
    summonPreviewedTargets.add(cue.targetKey);
    const futureIndex = futureBoard?.findIndex((minion) => minion.instanceId === cue.targetKey);
    const index = futureIndex !== undefined && futureIndex >= 0 ? futureIndex : undefined;
    const logKey = `${seat}:${cue.targetKey}`;
    if (!loggedSummonPreviewSlots.has(logKey)) {
      loggedSummonPreviewSlots.add(logKey);
      blog("summon preview slot", {
        seat,
        targetKey: cue.targetKey,
        futureIndex: index,
        currentBoardIds: board.map((minion) => minion.instanceId),
        futureBoardIds: futureBoard?.map((minion) => minion.instanceId)
      });
    }
    slots.push({ cue, index });
  }
  return slots.sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER));
}

function pendingPublicBoardForSeat(seat: Seat): PublicMinion[] | undefined {
  const sync = pendingPublicSync as typeof view.publicSync | undefined;
  const board = sync?.players?.[seat]?.board;
  return board ? Array.from(board) : undefined;
}

function pendingMinionCurrentHealth(seat: Seat, instanceId: string): number | undefined {
  return pendingPublicBoardForSeat(seat)?.find(m => m.instanceId === instanceId)?.currentHealth;
}

function pendingHeroHp(seat: Seat): number | undefined {
  const sync = pendingPublicSync as typeof view.publicSync | undefined;
  return sync?.players?.[seat]?.hero?.hp;
}

/**
 * A non-interactive minion shown on the board while its battlecry is being
 * aimed. Uses the exact same `<button class="minion">` markup as `renderMinion`
 * (LEGACY v1 parity: a battlecry card is no different from any other) so it is
 * pixel-identical to a real minion — just without target / attacker / hover
 * hooks. `pointer-events: none` keeps it out of the way of target hit-tests.
 */
function renderBattlecryPreview(cardId: string): string {
  const card = cardCatalog.get(cardId);
  if (!card) return "";
  const battlecry = activeBattlecryPreview();
  const domKey = battlecry ? `battlecry-preview-${battlecry.handInstanceId}` : `battlecry-preview-${cardId}`;
  return `
    <button class="minion battlecry-preview" type="button" tabindex="-1" aria-hidden="true" data-card-type="MINION" data-dom-key="${escapeAttr(domKey)}" data-testid="battlecry-preview">
      <div class="minion-art" style="background-image: url('${escapeAttr(assetUrl(card.image))}')"></div>
      <strong class="card-title">${escapeHtml(card.name)}</strong>
      <small class="keyword-row"></small>
      <div class="minion-stats">
        <span class="stat-atk"><span>${card.attack ?? 0}</span></span>
        <span class="stat-hp">${card.health ?? 0}</span>
      </div>
      <span class="sr-e2e"></span>
    </button>
  `;
}

function renderSummonPreview(cue: AnimationCue): string {
  const card = cue.cardId ? cardCatalog.get(cue.cardId) : undefined;
  if (!card || !cue.targetKey || !cue.seat) return "";
  const target: TargetRef = { type: "MINION", side: cue.seat, instanceId: cue.targetKey };
  const targetKey = targetKeyFor(target);
  const classes = classNames([
    "minion",
    "summon-preview",
    !cue.suppressBoardAnimation && "summoning",
    (hasCue(targetKey, "damage") || hasCue(targetKey, "effectStrike")) && "taking-damage",
    hasCue(targetKey, "heal") && "receiving-heal",
    hasCue(targetKey, "buff") && "receiving-buff",
    hasCue(targetKey, "shieldPop") && "shield-popping",
    hasCue(targetKey, "lock") && "locked-fx",
    hasCue(targetKey, "bounce") && "receiving-bounce",
    hasCue(targetKey, "destroy") && "being-destroyed"
  ]);
  return `
    <button
      class="${classes}"
      type="button"
      tabindex="-1"
      aria-hidden="true"
      data-target='${targetAttr(target)}'
      data-target-key="${escapeAttr(targetKey)}"
      data-dom-key="minion-${cue.seat}-${escapeAttr(cue.targetKey)}"
      data-card-type="MINION"
      data-seat="${cue.seat}"
      data-testid="summon-preview"
    >
      <div class="minion-art" style="background-image: url('${escapeAttr(assetUrl(card.image))}')"></div>
      <strong class="card-title">${escapeHtml(card.name)}</strong>
      <div class="minion-stats">
        <span class="stat-atk"><span>${card.attack ?? 0}</span></span>
        <span class="stat-hp">${card.health ?? 0}</span>
      </div>
      <span class="sr-e2e"></span>
    </button>
  `;
}

function renderHero(seat: Seat, player: PublicPlayer | undefined, role: "player" | "opponent"): string {
  const target = targetAttr({ type: "HERO", side: seat });
  const maxHp = player?.hero?.maxHp ?? 0;
  const name = player?.displayName || seat;
  const targetRef: TargetRef = { type: "HERO", side: seat };
  const targetKey = targetKeyFor(targetRef);
  // Show post-damage/heal HP immediately when the cue fires, same as renderMinion.
  const hasHeroDmgHealCue = hasCue(targetKey, "damage") || hasCue(targetKey, "heal");
  const hp = (hasHeroDmgHealCue ? pendingHeroHp(seat) : undefined) ?? player?.hero?.hp ?? 0;
  const heroClasses = classNames([
    "hero",
    role === "player" ? "player-hero" : "opponent-hero",
    trainingHighlightClass({ type: "hero", seat }),
    trainingHighlightClass({ type: "unit", seat }),
    isTargetHighlighted(targetRef) && "valid-target",
    sameTarget(view.selectedTarget, targetRef) && "target-selected",
    (hasCue(targetKey, "damage") || hasCue(targetKey, "effectStrike")) && "taking-damage",
    hasCue(targetKey, "heal") && "receiving-heal",
    seat === shatteringHeroSeat && "hero-shattering"
  ]);

  return `
    <div class="hero-frame" data-seat="${seat}">
      <button class="${heroClasses}" data-target='${target}' data-target-key="${escapeAttr(targetKey)}" data-testid="${role}-hero" data-seat="${seat}" aria-label="${escapeAttr(name)} ${hp}/${maxHp}">
        <span class="avatar" aria-hidden="true"></span>
        <strong>${escapeHtml(name)}</strong>
        <span class="hero-hp">${hp}/${maxHp}</span>
        <span class="hero-mana">Mana ${player?.mana?.current ?? 0}/${player?.mana?.max ?? 0}</span>
        <span class="hero-meta">Hand ${player?.handCount ?? 0} - Deck ${player?.deckCount ?? 0}</span>
      </button>
      ${renderAmplificationBadge(player)}
    </div>
  `;
}

/**
 * Circular 增幅 indicators beside the hero — one per bound augment (0..2). Each
 * carries `data-augment-id` so `applyAugmentGlow` can pulse the right one when
 * that augment fires (AUGMENT_TRIGGERED). Falls back to the single most-recent
 * `amplification` for back-compat.
 */
function renderAmplificationBadge(player: PublicPlayer | undefined): string {
  const augments = player?.augments?.length ? player.augments : player?.amplification ? [player.amplification] : [];
  if (augments.length === 0) return "";
  const dots = augments
    .map((aug) => {
      const tierClass = AMP_TIER_CLASS[aug.tier] ?? "amp-tier-low";
      return `<button class="hero-augment-dot ${tierClass}" type="button" data-augment-id="${escapeAttr(aug.id)}" aria-label="${escapeAttr(`${aug.tier} ${aug.name}`)}">${escapeHtml(aug.name.slice(0, 2))}</button>`;
    })
    .join("");
  return `<span class="hero-augments" aria-hidden="false">${dots}</span>`;
}

function renderMana(current: number, max: number, role: "player" | "opponent", seat: Seat): string {
  const activeCount = Math.max(0, Math.min(30, Math.floor(current)));
  const maxCount = Math.max(0, Math.min(30, Math.floor(max)));
  const rows = maxCount <= 10 ? 1 : maxCount <= 20 ? 2 : 3;
  const layout = rows === 1 ? "single" : rows === 2 ? "double" : "triple";
  const crystals = Array.from({ length: 30 }, (_, index) => {
    const row = Math.floor(index / 10) + 1;
    const col = (index % 10) + 1;
    const stateClass = index < activeCount ? `${role}-crystal active` : index < maxCount ? "spent" : "locked";
    const crystalClass = `mana-crystal ${stateClass} mana-row-${row}`;
    return `<span class="${crystalClass}" style="--mana-row:${row};--mana-col:${col}" aria-hidden="true"></span>`;
  }).join("");
  const highlight = trainingHighlightClass({ type: "mana", seat });
  const highlightClass = highlight ? `${highlight} training-highlight-mana` : "";

  return `
    <div class="mana-container frame-style mana-layout-${layout} ${highlightClass}" style="--mana-rows:${rows}" data-testid="${role}-mana">
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
  const needsTarget = handCardNeedsTarget(card);
  const rejected = view.rejectedHandIds.has(card.instanceId);
  const e2eType = view.rejectedHandIds.has(card.instanceId) ? "REJECTED_CARD" : card.type;
  const classes = classNames([
    "card",
    `rarity-${resolved.rarity.toLowerCase()}`,
    trainingHighlightClass({ type: "hand", instanceId: card.instanceId }),
    selected && "selected",
    mulliganSelected && "mulligan-selected",
    playable && "can-play",
    needsTarget && "needs-target",
    rejected && "rejected-card"
  ]);

  // A card mid draw-animation is rendered hidden so only the flying clone shows;
  // draw-animation.ts restores opacity once the clone lands. A card mid
  // battlecry targeting is hidden too — it "became" the preview minion on the
  // field (or the targeting arrow for a NEWS card).
  const hiddenForBattlecry = activeBattlecryPreview()?.handInstanceId === card.instanceId;
  const hiddenForDrag = view.draggingHandId === card.instanceId;
  const drawingStyle =
    isHandCardAnimating(card.instanceId) || hiddenForBattlecry || hiddenForDrag ? " opacity: 0; pointer-events: none;" : "";

  return `
    <button
      class="${classes}"
      style="${fanStyle(index, total)}${drawingStyle}"
      data-hand-id="${escapeAttr(card.instanceId)}"
      data-dom-key="hand-${escapeAttr(card.instanceId)}"
      data-card-id="${escapeAttr(card.cardId)}"
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

function renderMinion(seat: Seat, minion: PublicMinion, index = -1): string {
  const catalogCard = cardCatalog.get(minion.cardId);
  // Hold a freshly-summoned, augment-buffed minion at its printed base stats until
  // the glow reveal lands, so the buff reads as a distinct beat AFTER the glow.
  const holdBaseStat =
    augmentHoldBaseStatIds.has(minion.instanceId) &&
    typeof catalogCard?.attack === "number" &&
    typeof catalogCard?.health === "number";
  const shownAttack = holdBaseStat ? catalogCard!.attack : minion.attack;
  // Show post-damage/heal HP immediately when the cue fires (at impact, ~560ms into
  // the lunge) instead of waiting for the full publicSync flush at ~920ms.
  const hasDmgHealCue = hasCue(minion.instanceId, "damage") || hasCue(minion.instanceId, "heal");
  const pendingHealth = hasDmgHealCue ? pendingMinionCurrentHealth(seat, minion.instanceId) : undefined;
  const shownHealth = holdBaseStat ? catalogCard!.health : (pendingHealth ?? minion.currentHealth);
  const attackClass = classNames([
    "stat-atk",
    holdBaseStat ? "" : valueDeltaClass(minion.attack, minion.baseAttack ?? catalogCard?.attack)
  ]);
  const healthClass = classNames([
    "stat-hp",
    holdBaseStat ? "" : valueDeltaClass(shownHealth, catalogCard?.health)
  ]);
  const target: TargetRef = { type: "MINION", side: seat, instanceId: minion.instanceId };
  const mine = seat === view.mySeat;
  const targetKey = targetKeyFor(target);
  const domKey = minionDomKey(seat, minion, index);
  const attackLunge = activeAttackLunges.get(minion.instanceId);
  const attackLungeStyle = attackLunge ? ` style="--lunge-dx: ${attackLunge.dx}px; --lunge-dy: ${attackLunge.dy}px;"` : "";
  const canAttackNow = mine && canUseMinionAsAttacker(minion);
  const hasSuppressedSummonCue = view.animationCues.some(
    (cue) => cue.kind === "summon" && cue.targetKey === targetKey && cue.suppressBoardAnimation && cueIsReady(cue)
  );
  const adoptedBattlecryKey = minionDomKeys.get(minion.instanceId)?.startsWith("battlecry-preview-") ?? false;
  const skipSummonAnimation = summonPreviewedTargets.has(minion.instanceId) || hasSuppressedSummonCue || adoptedBattlecryKey;
  if (skipSummonAnimation && hasCue(targetKey, "summon") && !loggedSkippedSummonAnimations.has(minion.instanceId)) {
    loggedSkippedSummonAnimations.add(minion.instanceId);
    blog("summon animation skipped after preview", {
      seat,
      targetKey: minion.instanceId,
      previewed: summonPreviewedTargets.has(minion.instanceId),
      suppressedCue: hasSuppressedSummonCue,
      adoptedBattlecryKey
    });
  }
  const classes = classNames([
    "minion",
    trainingHighlightClass({ type: "unit", seat, instanceId: minion.instanceId }),
    minion.taunt && "taunt",
    minion.divineShield && "shielded",
    minion.divineShield && "divine-shield",
    canAttackNow && "can-attack",
    minion.isEnraged && "enraged",
    minion.hasOngoing && "has-ongoing",
    minion.lockedTurns > 0 && "locked",
    attackLunge && "lunging",
    selectedMinionClass(minion.instanceId, target),
    isTargetHighlighted(target) && "valid-target",
    (hasCue(targetKey, "damage") || hasCue(targetKey, "effectStrike")) && "taking-damage",
    hasCue(targetKey, "heal") && "receiving-heal",
    hasCue(targetKey, "buff") && "receiving-buff",
    hasCue(targetKey, "shieldPop") && "shield-popping",
    hasCue(targetKey, "lock") && "locked-fx",
    hasCue(targetKey, "bounce") && "receiving-bounce",
    hasCue(targetKey, "summon") && !skipSummonAnimation && "summoning",
    hasCue(targetKey, "destroy") && "being-destroyed"
  ]);

  return `
    <button
      class="${classes}"
      ${attackLungeStyle}
      ${mine ? `data-attacker-id="${escapeAttr(minion.instanceId)}"` : ""}
      data-target='${targetAttr(target)}'
      data-dom-key="${escapeAttr(domKey)}"
      data-card-type="MINION"
      data-cost="${catalogCard?.cost ?? 0}"
      data-seat="${seat}"
      data-target-key="${escapeAttr(targetKey)}"
      data-testid="board-minion"
      aria-pressed="${view.selectedAttackerId === minion.instanceId || sameTarget(view.selectedTarget, target) ? "true" : "false"}"
    >
      <div class="minion-art" style="background-image: url('${escapeAttr(assetUrl(catalogCard?.image ?? ""))}')"></div>
      ${minion.hasOngoing ? `<span class="ongoing-aura" aria-hidden="true"><i></i><i></i></span>` : ""}
      ${renderCountdownBadges(minion)}
      <strong class="card-title">${escapeHtml(catalogCard?.name ?? minion.cardId)}</strong>
      <div class="minion-stats">
        <span class="${attackClass} ${trainingHighlightClass({ type: "minionStat", instanceId: minion.instanceId, stat: "attack" })}"><span>${shownAttack}</span></span>
        <span class="${healthClass} ${trainingHighlightClass({ type: "minionStat", instanceId: minion.instanceId, stat: "health" })}">${shownHealth}</span>
      </div>
      <span class="sr-e2e">${canAttackNow ? "ready" : ""} ${minion.taunt ? "taunt" : ""}</span>
    </button>
  `;
}

function minionDomKey(seat: Seat, minion: PublicMinion, index: number): string {
  const existing = minionDomKeys.get(minion.instanceId);
  if (existing) return existing;
  const pending = activeBattlecryPreview();
  const shouldAdoptPreviewKey =
    pending?.phase === "committed" &&
    pending.isMinion &&
    seat === view.mySeat &&
    index === battlecryReplacementIndex(Array.from(readPlayer(seat)?.board ?? []), pending);
  const key = shouldAdoptPreviewKey
    ? `battlecry-preview-${pending.handInstanceId}`
    : `minion-${seat}-${minion.instanceId}`;
  minionDomKeys.set(minion.instanceId, key);
  return key;
}

function hasBattlecryReplacement(
  board: PublicMinion[],
  pending: BattlecryPreviewState
): boolean {
  return battlecryReplacementIndex(board, pending) !== -1;
}

function battlecryReplacementIndex(
  board: PublicMinion[],
  pending: BattlecryPreviewState
): number {
  if (pending.phase !== "committed") return -1;
  const candidates = board
    .map((minion, index) => ({ minion, index }))
    .filter(({ minion }) =>
      minion.cardId === pending.cardId &&
      !pending.boardInstanceIdsBefore.includes(minion.instanceId)
    );
  candidates.sort((a, b) =>
    Math.abs(a.index - pending.boardIndex) - Math.abs(b.index - pending.boardIndex)
  );
  return candidates[0]?.index ?? -1;
}

function renderCardFace(card: ResolvedCardView, _size?: "hand" | "mulligan"): string {
  // While an augment glow is pending for this freshly-changed card, show its base
  // cost (suppressing the discount tint) so the reveal drops it on the glow beat.
  const holdBaseCost = augmentHoldBaseCostIds.has(card.instanceId) && typeof card.baseCost === "number";
  const shownCost = holdBaseCost ? (card.baseCost as number) : card.cost;
  const costClass = classNames([
    "card-cost",
    trainingHighlightClass({ type: "cardCost", instanceId: card.instanceId }),
    holdBaseCost ? "" : valueDeltaClass(card.cost, card.baseCost)
  ]);
  const attackClass = classNames(["stat-atk", valueDeltaClass(card.attack, card.baseAttack)]);
  const healthClass = classNames(["stat-hp", valueDeltaClass(card.health, card.baseHealth)]);
  return `
    <span class="${costClass}"><span>${shownCost}</span></span>
    <strong class="card-title">${escapeHtml(card.name)}</strong>
    <img class="card-art-box" src="${escapeAttr(assetUrl(card.image))}" alt="" loading="lazy" draggable="false" />
    <span class="card-category">${escapeHtml(card.category)}</span>
    <span class="card-desc">${renderCardDescription(card)}</span>
    ${
      card.type === "MINION"
        ? `<span class="minion-stats"><span class="${attackClass}"><span>${card.attack ?? 0}</span></span><span class="${healthClass}">${card.health ?? 0}</span></span>`
        : ""
    }
  `;
}

function renderCardDescription(card: ResolvedCardView): string {
  const replacements = [
    { base: card.baseEffectValue, value: card.effectValue },
    { base: card.baseEffectBonusValue, value: card.effectBonusValue }
  ].filter((item): item is { base: number; value: number } =>
    typeof item.base === "number" && typeof item.value === "number" && item.value !== item.base
  );
  if (replacements.length === 0) return escapeHtml(card.description);

  const pending = [...replacements];
  return card.description.split(/(\d+)/g).map((part) => {
    if (!/^\d+$/.test(part)) return escapeHtml(part);
    const numeric = Number(part);
    const index = pending.findIndex((item) => item.base === numeric);
    if (index < 0) return escapeHtml(part);
    const [replacement] = pending.splice(index, 1);
    return `<span class="effect-value-buffed">${replacement.value}</span>`;
  }).join("");
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

function applyVisibleNewsPowerPreview(card: CardDefinition, resolved: ResolvedCardView, seat: Seat | undefined): void {
  const effect = card.keywords?.battlecry;
  if (card.type !== "NEWS" || !effect?.type || typeof effect.value !== "number" || !seat) return;
  const isDamage = effect.type.includes("DAMAGE");
  const isHeal = effect.type.includes("HEAL") || effect.type.includes("RECOVER");
  const excluded =
    effect.type.includes("DRAW") ||
    effect.type.includes("COST") ||
    effect.type.includes("REDUCE") ||
    effect.type === "FULL_HEAL_BUFF_TARGET_CATEGORY_BONUS";
  if ((!isDamage && !isHeal) || excluded) return;
  const bonus = visibleNewsPowerForSeat(seat);
  if (bonus <= 0) return;
  resolved.baseEffectValue = effect.value;
  resolved.effectValue = effect.value + bonus;
  if (typeof effect.bonus_value === "number") {
    resolved.baseEffectBonusValue = effect.bonus_value;
    resolved.effectBonusValue = effect.bonus_value + bonus;
  }
}

function visibleNewsPowerForSeat(seat: Seat): number {
  const player = readPlayer(seat);
  return Array.from(player?.board ?? []).reduce((sum, minion) => {
    return sum + (cardCatalog.get(minion.cardId)?.keywords?.newsPower ?? 0);
  }, 0);
}

function turnCounterTickClass(turn: number, offset: number): string {
  const special = turn === 6 || turn === 14 ? " amplification" : turn === 20 ? " vote" : "";
  const current = offset === 0 ? " current" : "";
  const edge = Math.abs(offset) === 2 ? ` edge edge-${offset < 0 ? "left" : "right"}` : "";
  return `turn-counter-tick${current}${edge}${special}`;
}

function turnCounterSpecialKind(turn: number): "amplification" | "vote" | undefined {
  if (turn === 6 || turn === 14) return "amplification";
  if (turn === 20) return "vote";
  return undefined;
}

function renderTurnCounter(): string {
  const currentTurn = readTurnNumber();
  const currentSpecial = turnCounterSpecialKind(currentTurn);
  const nextSpecial = turnCounterSpecialKind(currentTurn + 1);
  const highlightedSpecial = currentSpecial ?? nextSpecial;
  const specialLabel = highlightedSpecial === "amplification" ? "增幅回合" : highlightedSpecial === "vote" ? "公投回合" : "";
  const tooltip = currentSpecial ? `本回合是${specialLabel}` : nextSpecial ? `下一回合是${specialLabel}` : "";
  const stateClass = currentSpecial
    ? ` is-${currentSpecial} has-special-tooltip`
    : nextSpecial
      ? ` is-${nextSpecial}-preview has-special-tooltip`
      : "";
  const offsets = [-2, -1, 0, 1, 2] as const;
  const ticks = offsets.map((offset) => {
    const turn = currentTurn + offset;
    const label = turn > 0 ? String(turn) : "";
    return `
      <span class="${turnCounterTickClass(turn, offset)}" data-offset="${offset}" aria-hidden="true">
        <span>${label}</span>
      </span>
    `;
  }).join("");

  return `
    <div class="turn-counter${stateClass}" role="img" aria-label="目前第 ${currentTurn} 回合${tooltip ? `，${tooltip}` : ""}"
      ${tooltip ? `data-tooltip="${tooltip}" tabindex="0"` : ""} data-testid="turn-counter">
      <div class="turn-counter-numbers" data-dom-key="turn-counter-wheel-${currentTurn}">${ticks}</div>
      <img class="turn-counter-frame" src="/images/ui/turn_counter_fan.webp" alt="" draggable="false">
      <img class="turn-counter-overlay" src="/images/ui/turn_counter_fan_overlay.webp" alt="" draggable="false">
      <div class="turn-counter-glass" aria-hidden="true"></div>
    </div>
  `;
}

function renderCenterLine(activeSeat: Seat | "", opponentPlayer?: PublicPlayer, myPlayer?: PublicPlayer): string {
  const isMyTurn = activeSeat && activeSeat === view.mySeat;
  const battleLocked = isBattleActionLocked();
  const localTraining = Boolean(trainingSession);
  const selectedCard = selectedHandCard();
  const selectedNeedsTarget = handCardNeedsTarget(selectedCard);
  const canPlay = Boolean(selectedCard && canAfford(selectedCard.cost) && (!selectedNeedsTarget || view.selectedTarget));
  const canAttack = Boolean(!battleLocked && view.selectedAttackerId && view.selectedTarget && isLegalAttackTarget(view.selectedTarget));
  const canEndTurn = Boolean(isMyTurn && !battleLocked && (localTraining ? trainingCanEndTurn(trainingSession) : view.room));
  const endTurnHighlight = trainingHighlightClass({ type: "endTurn" });
  const primaryLabel = selectedCard ? (selectedNeedsTarget && !view.selectedTarget ? "Choose Target" : "Play Selected") : "Play Selected";

  return `
    <section class="center-line controls">
      <div id="turn-indicator">Turn: ${readTurnNumber()}</div>
      <div class="turn-stack">
        <span id="indicator-opp" class="turn-light ${activeSeat === otherSeat(view.mySeat ?? "player1") ? "active" : ""}">Opponent</span>
        <span id="indicator-player" class="turn-light ${isMyTurn ? "active" : ""}">${isMyTurn ? "Your Turn" : "Waiting"}</span>
      </div>
      ${renderTurnCountdown("turn")}
      <div class="end-turn-group">
        <div class="deck-pile battle-deck-pile opponent-deck" title="Opponent deck">
          <span class="count-badge">${opponentPlayer?.deckCount ?? 0}</span>
        </div>
        <span class="end-turn-wrap${isMyTurn && !battleLocked && !hasAnyLegalAction() ? " can-end" : ""} ${endTurnHighlight}">
          <button id="end-turn" class="end-turn-btn" ${canEndTurn ? "" : "disabled"} data-testid="end-turn">結束回合</button>
        </span>
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
        ${renderTurnCountdown("mulligan")}
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
      data-dom-key="mulligan-${escapeAttr(card.instanceId)}"
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

const AMP_TIER_CLASS: Record<string, string> = { 加減賺: "amp-tier-low", 穩穩仔賺: "amp-tier-mid", 卯死: "amp-tier-high" };

function renderPhaseCountdown(label: string): string {
  const seconds = phaseCountdownSeconds();
  if (seconds === undefined) return "";
  return `
    <div class="turn-countdown-badge phase ${seconds <= 5 ? "urgent" : ""}" data-testid="phase-countdown" role="status" aria-live="polite">
      <span class="turn-countdown-label">${escapeHtml(label)}</span>
      <span class="turn-countdown-value">${seconds}</span>
    </div>
  `;
}

/** Turn 6/14 deck-amplification chooser — presented mulligan-style with three highlighted picks. */
function renderSpecialPhasePeekOverlay(kind: "amplification" | "vote"): string {
  const title = kind === "amplification" ? "增幅選擇中" : "公投事件選擇中";
  return `
    <section class="special-peek-overlay" data-testid="${kind === "amplification" ? "amplification" : "voting"}-peek-overlay">
      <div class="special-peek-toolbar">
        <span>${title}</span>
        ${renderPhaseCountdown(kind === "amplification" ? "增幅倒數" : "事件倒數")}
        <button type="button" class="special-phase-btn primary" data-special-return>返回選項</button>
      </div>
    </section>
  `;
}

function renderSpecialPhaseActions(opts: {
  submitted: boolean;
  canReroll?: boolean;
  rerollUsed?: boolean;
  rerollRemaining?: number;
  rerolling?: boolean;
}): string {
  const rerollRemaining = opts.rerollRemaining ?? (opts.rerollUsed ? 0 : 1);
  const rerollDisabled = !opts.canReroll || opts.submitted || rerollRemaining <= 0 || opts.rerolling;
  const rerollLabel = opts.rerolling
    ? "重抽中..."
    : rerollRemaining <= 0
      ? "已重抽"
      : rerollRemaining > 1
        ? `重抽增幅 x${rerollRemaining}`
        : "重抽增幅";
  return `
    <div class="special-phase-actions">
      <button type="button" class="special-phase-btn" data-special-peek ${opts.submitted ? "disabled" : ""}>透視</button>
      ${
        opts.canReroll !== undefined
          ? `<button type="button" class="special-phase-btn accent" data-amp-reroll ${rerollDisabled ? "disabled" : ""}>${rerollLabel}</button>`
          : ""
      }
    </div>
  `;
}

function renderAmplificationOverlay(): string {
  if (readPhase() !== "AMPLIFICATION_PHASE" || (!view.room && !trainingSession)) return "";
  if (view.specialPhasePeek) return renderSpecialPhasePeekOverlay("amplification");
  const options = view.amplificationOptions ?? [];
  const mySeat = view.mySeat;
  const sp = view.state?.specialPhase;
  // Use the per-phase "selected" flag, not the persistent bound amplification —
  // the latter stays set from turn 6 and would wrongly hide the turn-14 options.
  const submitted = Boolean(sp && mySeat && (mySeat === "player1" ? sp.ampSelectedP1 : sp.ampSelectedP2)) || options.length === 0;
  const rerollUsed = Boolean(sp && mySeat && (mySeat === "player1" ? sp.ampRerollUsedP1 : sp.ampRerollUsedP2));
  const rerollRemaining = sp && mySeat ? (mySeat === "player1" ? sp.ampRerollRemainingP1 : sp.ampRerollRemainingP2) : undefined;
  const rerolling = Boolean(view.amplificationRerollStage);
  const contentClass = classNames(["mulligan-content", "amp-content", rerolling && `amp-reroll-${view.amplificationRerollStage}`]);
  return `
    <section id="amplification-modal" class="mulligan-overlay amp-overlay ${submitted ? "submitted" : ""}" data-testid="amplification-overlay">
      <div class="${contentClass}">
        <h2>好運一番賞</h2>
        <p>${submitted ? "已選擇，等待對手…" : "依你的牌組陣營，選擇一項增幅"}</p>
        ${renderPhaseCountdown("增幅倒數")}
        ${renderSpecialPhaseActions({ submitted, canReroll: Boolean(view.room), rerollUsed, rerollRemaining, rerolling })}
        <div class="mulligan-card-area amp-card-area">
          ${options.map((option) => renderAmplificationOption(option, submitted || rerolling)).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderAmplificationOption(option: AmplificationOption, disabled: boolean): string {
  const tierClass = AMP_TIER_CLASS[option.tier] ?? "amp-tier-low";
  return `
    <button
      class="card mulligan-card amp-option ${tierClass}"
      data-amp-id="${escapeAttr(option.id)}"
      data-dom-key="amp-${escapeAttr(option.id)}"
      ${disabled ? "disabled" : ""}
    >
      <span class="amp-tier-badge">${escapeHtml(option.tier)}</span>
      <span class="amp-option-name">${escapeHtml(option.name)}</span>
      <span class="amp-option-desc">${escapeHtml(option.description)}</span>
    </button>
  `;
}

/** Turn 20 inverse-HP referendum ballot — three highlighted events, mulligan-style. */
function renderVotingOverlay(): string {
  if (readPhase() !== "VOTING_PHASE" || (!view.room && !trainingSession)) return "";
  if (view.specialPhasePeek) return renderSpecialPhasePeekOverlay("vote");
  const sp = view.state?.specialPhase;
  const events: Array<{ id: string; name: string; options: string[] }> = sp
    ? Array.from(sp.voteEvents ?? []).map((event: any) => ({
        id: event.id,
        name: event.name,
        options: [event.option0, event.option1, event.option2]
      }))
    : [];
  const mySeat = view.mySeat;
  const submitted = Boolean(
    sp && mySeat && (mySeat === "player1" ? sp.voteSubmittedP1 : sp.voteSubmittedP2)
  );
  const myWeight = sp ? (mySeat === "player1" ? sp.voteWeightP1 : sp.voteWeightP2) : 0;
  return `
    <section id="voting-modal" class="mulligan-overlay vote-overlay ${submitted ? "submitted" : ""}" data-testid="voting-overlay">
      <div class="mulligan-content vote-content">
        <h2>中選會公投</h2>
        <p>
          ${submitted ? "已投票，等待開票…" : "投下你支持的公投案"}
          <span class="vote-weight-tag">你的中選率 ${myWeight}%（弱勢族群加成）</span>
        </p>
        ${renderPhaseCountdown("公投倒數")}
        ${renderSpecialPhaseActions({ submitted })}
        <div class="mulligan-card-area vote-card-area">
          ${events.map((event, index) => renderVoteOption(event, index, submitted)).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderVoteOption(event: { id: string; name: string; options: string[] }, index: number, disabled: boolean): string {
  return `
    <button
      class="card mulligan-card vote-option"
      data-vote-index="${index}"
      data-dom-key="vote-${escapeAttr(event.id)}"
      ${disabled ? "disabled" : ""}
    >
      <span class="vote-option-name">${escapeHtml(event.name)}</span>
      <span class="vote-option-desc">${escapeHtml(event.options[0] ?? "")}</span>
    </button>
  `;
}

function renderResultOverlay(status: GameStatus | ""): string {
  if (status !== "finished" && status !== "abandoned") return "";
  // Hold the VICTORY/DEFEAT screen until the losing hero's death shatter has
  // finished. scheduleHeroDeathSequence set this deadline on GAME_FINISHED and
  // scheduled a render at it; until then keep the battlefield visible.
  if (resultOverlayHoldUntilMs !== 0 && performance.now() < resultOverlayHoldUntilMs) return "";
  // The animated post-match reward screen replaces the old static overlay.
  // If we don't yet have a RewardSummary from the server, fall back to a
  // synthesized loss summary so the player sees DEFEAT without blocking.
  if (!view.rewardSummary) ensureFallbackRewardSummary(status);
  return renderRewardOverlay(view);
}

function renderTrainingOverlay(): string {
  if (!trainingSession) return "";
  const prompt = trainingPrompt(trainingSession);
  if (!prompt || prompt.allowedAction !== "next" || readStatus() === "finished") return "";
  const showNext = prompt.allowedAction === "next";
  return `
    <section class="training-coach" data-testid="training-coach" role="dialog" aria-live="polite">
      <div class="training-coach-copy">
        <strong>${escapeHtml(prompt.title)}</strong>
        <p>${escapeHtml(prompt.body)}</p>
      </div>
      <div class="training-coach-actions">
        ${showNext ? `<button id="training-next" class="neon-button" type="button" data-testid="training-next">下一步</button>` : `<span class="training-action-lock">請照指示操作</span>`}
      </div>
    </section>
  `;
}

function trainingHighlightClass(highlight: TrainingHighlight): string | undefined {
  return trainingHasHighlight(trainingSession, highlight) ? "training-highlight" : undefined;
}

let rewardFallbackTimer: number | undefined;
function ensureFallbackRewardSummary(status: GameStatus | ""): void {
  if (view.rewardSummary || rewardFallbackTimer !== undefined) return;
  // Server pushes reward_summary after persistence; give it a beat first.
  rewardFallbackTimer = window.setTimeout(() => {
    rewardFallbackTimer = undefined;
    if (view.rewardSummary) return;
    const winnerSeat = view.publicSync?.result?.winnerSeat ?? view.state?.result?.winnerSeat;
    const won = Boolean(view.mySeat && winnerSeat === view.mySeat);
    view.rewardSummary = {
      result: won ? "win" : "loss",
      mode: "pvp",
      source: "none",
      diagnostic: "missing_reward_summary",
      aiTheme: null,
      aiDifficulty: null,
      xp: { before: view.profile?.xp ?? 0, after: view.profile?.xp ?? 0, gained: 0 },
      level: { before: view.profile?.level ?? 1, after: view.profile?.level ?? 1 },
      levelUps: [],
      gold: { before: view.profile?.gold ?? 0, after: view.profile?.gold ?? 0, gained: 0, breakdown: {} }
    };
    void status; // status param kept for future symmetry; currently unused.
    startRewardAnimation(view, render);
    render();
  }, 800);
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

function renderTurnAnnouncementOverlay(): string {
  const announcement = activeTurnAnnouncement();
  if (!announcement) return "";
  return `
    <section class="turn-announcement-overlay active" data-testid="turn-announcement-overlay" aria-live="polite">
      <div class="turn-announcement-text">${escapeHtml(announcement.text)}</div>
    </section>
  `;
}

function renderEventCue(cue: AnimationCue): string {
  const card = cue.cardId ? cardCatalog.get(cue.cardId) : undefined;
  const cueStyle = cueStyleAttr(cue);
  if (cue.kind === "play" && card) {
    // The big card preview is rendered imperatively via #card-play-overlay so its
    // animation is not restarted by the surrounding DOM being re-rendered.
    return "";
  }
  if (cue.kind === "attackerMoves") {
    return "";
  }
  if (cue.kind === "summon") {
    return "";
  }
  if (cue.kind === "buff") {
    if (!cue.targetKey || !cueIsReady(cue)) return "";
    const burstStyle = inPlaceBurstStyle(cue);
    const sparks = particleSpread(cue.id, cue.scope === "aoe" ? 4 : 7);
    return `<div class="buff-burst${cue.scope === "aoe" ? " aoe" : ""}"${burstStyle} data-cue-id="${escapeAttr(cue.id)}" data-dom-key="cue-${escapeAttr(cue.id)}" data-anchor-key="${escapeAttr(cue.targetKey)}" data-testid="buff-burst">${sparks}</div>`;
  }
  if (cue.kind === "shieldPop") {
    if (!cue.targetKey || !cueIsReady(cue)) return "";
    const burstStyle = inPlaceBurstStyle(cue);
    const shards = particleSpread(cue.id, 7);
    return `<div class="shield-shatter"${burstStyle} data-cue-id="${escapeAttr(cue.id)}" data-dom-key="cue-${escapeAttr(cue.id)}" data-anchor-key="${escapeAttr(cue.targetKey)}" data-testid="shield-shatter"><span class="shield-shatter-ring"></span>${shards}</div>`;
  }
  if (cue.kind === "lock") {
    if (!cue.targetKey || !cueIsReady(cue)) return "";
    const burstStyle = inPlaceBurstStyle(cue);
    const shards = particleSpread(cue.id, 6);
    return `<div class="lock-clamp"${burstStyle} data-cue-id="${escapeAttr(cue.id)}" data-dom-key="cue-${escapeAttr(cue.id)}" data-anchor-key="${escapeAttr(cue.targetKey)}" data-testid="lock-clamp"><span class="lock-clamp-ring"></span>${shards}</div>`;
  }
  if (cue.kind === "deathrattle") {
    // Rendered imperatively by applyDeathrattlePlume — the dead minion's DOM is
    // already gone after DESTROY, so we anchor off its captured rect (see R4).
    return "";
  }
  if (cue.kind === "aoeSweep") {
    if (!cue.targetKey) return "";
    const variant = cue.variant ?? "damage";
    const healPluses = variant === "heal" && cueIsReady(cue) ? renderAoeHealPluses(cue.id) : "";
    return `<div class="aoe-sweep aoe-sweep-${variant}"${cueStyle} data-cue-id="${escapeAttr(cue.id)}" data-dom-key="cue-${escapeAttr(cue.id)}" data-anchor-key="${escapeAttr(cue.targetKey)}" data-testid="aoe-sweep"><span class="aoe-sweep-wave"></span><span class="aoe-sweep-glow"></span>${healPluses}</div>`;
  }
  if (cue.kind === "bounce") {
    if (!cue.targetKey || !cueIsReady(cue)) return "";
    const burstStyle = inPlaceBurstStyle(cue);
    return `<div class="bounce-burst"${burstStyle} data-cue-id="${escapeAttr(cue.id)}" data-dom-key="cue-${escapeAttr(cue.id)}" data-anchor-key="${escapeAttr(cue.targetKey)}" data-testid="bounce-burst"><span></span><span></span><span></span></div>`;
  }
  if (cue.kind === "damage" || cue.kind === "heal" || cue.kind === "effectStrike") {
    if (!cue.targetKey || !cueIsReady(cue)) return "";
    // The unit flash (.taking-damage / .receiving-heal) is gated by cueIsReady with
    // no CSS delay, so it fires at readyAtMs. Animate the number + burst delay-free
    // off the same ready gate (see inPlaceBurstStyle) so they fire on the same render
    // — otherwise --cue-delay gets reset by morph re-renders and the digits trail the
    // flash by the play delay, worst on the opponent's view.
    const burstStyle = inPlaceBurstStyle(cue);
    const isHeal = cue.kind === "heal";
    const sign = isHeal ? "+" : "-";
    // The readable -N / +N stays (it is data, not decoration); the particles wrap it.
    const number = cue.amount !== undefined
      ? `<div class="float-number ${isHeal ? "heal" : "damage"}"${burstStyle} data-cue-id="${escapeAttr(cue.id)}" data-dom-key="cue-${escapeAttr(cue.id)}" data-anchor-key="${escapeAttr(cue.targetKey)}" data-testid="float-number">${sign}${cue.amount}</div>`
      : "";
    // Heal keeps its green motes; combat damage a red spark, effect / spell damage the magenta strike.
    const burst = isHeal
      ? renderHealBurst(cue, burstStyle)
      : renderEffectStrike(cue, burstStyle, cue.kind === "effectStrike" ? "effect" : "combat");
    return `${burst}${number}`;
  }
  if (cue.kind === "destroy") {
    if (!cue.targetKey) return "";
    const particles = particleSpread(cue.id);
    return `<div class="death-burst"${cueStyle} data-cue-id="${escapeAttr(cue.id)}" data-dom-key="cue-${escapeAttr(cue.id)}" data-anchor-key="${escapeAttr(cue.targetKey)}" data-testid="death-burst"><i class="death-burst-ring"></i>${particles}</div>`;
  }
  if (cue.kind === "questComplete") {
    if (!cue.targetKey) return "";
    const sparks = particleSpread(cue.id, 10);
    return `<div class="quest-complete-burst"${cueStyle} data-cue-id="${escapeAttr(cue.id)}" data-dom-key="cue-${escapeAttr(cue.id)}" data-anchor-key="${escapeAttr(cue.targetKey)}" data-testid="quest-complete-burst"><span class="quest-complete-ring"></span>${sparks}</div>`;
  }
  return `<div class="event-cue event-${cue.kind}"${cueStyle} data-dom-key="cue-${escapeAttr(cue.id)}">${escapeHtml(cue.text)}</div>`;
}

function renderHealBurst(cue: AnimationCue, cueStyle: string): string {
  if (!cue.targetKey) return "";
  // 綠色細 "+" 此起彼落地在卡牌四周冒出：位置隨機散布（非環狀），出現時間各自錯開，
  // 營造「持續被治療」的層次感。滿血、單體、全體（如柯文哲全場回滿）都會繪製。
  const isAoe = cue.scope === "aoe";
  const count = isAoe ? 6 : 9;
  // 由 cue.id 衍生的確定性亂數，讓每個 cue 的散布固定（避免 re-render 跳動）。
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < cue.id.length; i += 1) {
    hash ^= cue.id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const rand = (): number => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822519) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 13), 3266489917) >>> 0;
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
  };
  const spans: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = i === 0 ? 0 : Math.round((rand() * 2 - 1) * 72); // 卡牌寬度範圍散布
    const y = i === 0 ? -88 : Math.round((rand() * 2 - 1) * 100); // 卡牌高度範圍散布
    const size = i === 0 ? 40 : 18 + Math.round(rand() * 14);
    const delay = i === 0 ? 0 : Math.round(rand() * 650); // 0–650ms 錯開出現，呈現此起彼落
    spans.push(
      `<span style="--x:${x}px;--y:${y}px;--size:${size}px;--particle-delay:${delay}ms">+</span>`
    );
  }
  return `<div class="heal-burst${isAoe ? " aoe" : ""}"${cueStyle} data-cue-id="${escapeAttr(cue.id)}" data-dom-key="cue-${escapeAttr(cue.id)}-heal-burst" data-anchor-key="${escapeAttr(cue.targetKey)}" data-testid="heal-burst">${spans.join("")}</div>`;
}

function renderAoeHealPluses(seed: string): string {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const rand = (): number => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822519) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 13), 3266489917) >>> 0;
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
  };
  const spans: string[] = [];
  for (let i = 0; i < 18; i += 1) {
    const x = Math.round(8 + rand() * 84);
    const y = Math.round(12 + rand() * 76);
    const size = 24 + Math.round(rand() * 18);
    const delay = Math.round(rand() * 560);
    spans.push(
      `<span class="aoe-heal-plus" style="--x:${x}%;--y:${y}%;--size:${size}px;--particle-delay:${delay}ms">+</span>`
    );
  }
  return `<span class="aoe-heal-plus-layer">${spans.join("")}</span>`;
}

/**
 * Damage impact: a core flash plus radial shards. `tone` "effect" = magenta
 * spell strike (非普通攻擊); "combat" = red spark for a basic attack hit.
 */
function renderEffectStrike(cue: AnimationCue, cueStyle: string, tone: "effect" | "combat" = "effect"): string {
  if (!cue.targetKey) return "";
  const shards = particleSpread(cue.id, cue.scope === "aoe" ? 4 : 9);
  // 命中爆光(magenta strike)。觸發飛刀本身改由 applyKnifeStrike 命令式繪製(body
  // 層級、不受 re-render 重置),這裡不再放宣告式 sprite —— 命中點只留爆光,不留刀刃。
  return `<div class="effect-strike ${tone}${cue.scope === "aoe" ? " aoe" : ""}"${cueStyle} data-cue-id="${escapeAttr(cue.id)}" data-dom-key="cue-${escapeAttr(cue.id)}-strike" data-anchor-key="${escapeAttr(cue.targetKey)}" data-testid="effect-strike"><span class="effect-strike-core"></span>${shards}</div>`;
}

function cueStyleAttr(cue: AnimationCue): string {
  const styles: string[] = [];
  const delay = Math.max(0, Math.round(cue.delayMs ?? 0));
  if (delay > 0) styles.push(`--cue-delay:${delay}ms`);
  if (cue.anchorX !== undefined && cue.anchorY !== undefined) {
    styles.push(`left:${Math.round(cue.anchorX)}px`, `top:${Math.round(cue.anchorY)}px`);
  }
  return styles.length > 0 ? ` style="${styles.join(";")}"` : "";
}

/**
 * Style for an in-place burst overlay (heal/buff/shieldPop/lock/bounce + the damage
 * number and effect-strike core). Each pairs with a unit-flash class
 * (`.receiving-heal`, `.receiving-buff`, `.taking-damage`, …) that is gated by
 * `cueIsReady` and carries NO CSS delay, so the flash fires at `readyAtMs`. If the
 * overlay animates via `--cue-delay` instead, morph re-renders (publicSync held
 * during a play — worst on the opponent's view, where the play preview holds longer)
 * keep resetting that countdown and the burst trails the flash by the play delay.
 *
 * Fix: gate the overlay on `cueIsReady` (callers `return ""` until ready) and animate
 * it delay-free, so flash + burst fire on the same render and look identical on both
 * sides. Safe because every path that sets `delayMs` also sets `readyAtMs`, so the
 * ready gate already encodes the intended delay; and the overlay HTML is deterministic
 * (seeded by `cue.id`), so once ready, morph leaves it untouched (no restart).
 */
function inPlaceBurstStyle(cue: AnimationCue): string {
  return cueStyleAttr({ ...cue, delayMs: 0 });
}

function particleSpread(seed: string, count = 8): string {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const spans: string[] = [];
  for (let i = 0; i < count; i++) {
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
  const shell = document.querySelector<HTMLElement>(".app-shell");
  const anchor = shell ? localAnchorFromViewport(shell, view.hoverAnchor) : view.hoverAnchor;
  const margin = 16;
  const gap = 24;
  const cardWidth = 224;
  const glossaryWidth = 216;
  const tooltipHeight = 322;
  const viewportWidth = shell?.offsetWidth || window.innerWidth;
  const viewportHeight = shell?.offsetHeight || window.innerHeight;
  const anchorLeft = anchor.x - anchor.width / 2;
  const anchorRight = anchor.x + anchor.width / 2;
  const roomOnRight = viewportWidth - anchorRight - gap - margin;
  const roomOnLeft = anchorLeft - gap - margin;
  const preferRight = roomOnRight >= cardWidth || roomOnRight >= roomOnLeft;
  // Glossary panel sits opposite the card so the combined block grows away from the
  // viewport edge; include its width in the clamp so nothing spills off-screen.
  const glossarySide: "left" | "right" = preferRight ? "right" : "left";
  const glossary = renderKeywordGlossary(view.hoveredCardId, glossarySide);
  const tooltipWidth = glossary ? cardWidth + glossaryWidth : cardWidth;
  let left = preferRight ? anchorRight + gap : anchorLeft - tooltipWidth - gap;
  left = Math.max(margin, Math.min(left, viewportWidth - tooltipWidth - margin));
  if (left < anchorRight && left + tooltipWidth > anchorLeft) {
    left = preferRight
      ? Math.min(viewportWidth - tooltipWidth - margin, anchorRight + gap)
      : Math.max(margin, anchorLeft - tooltipWidth - gap);
  }
  let top = anchor.y - tooltipHeight / 2;
  top = Math.max(margin, Math.min(top, viewportHeight - tooltipHeight - margin));
  const card = `
      <div class="card rarity-${resolved.rarity.toLowerCase()}">
        ${renderCardFace(resolved)}
      </div>`;
  return `
    <div class="hover-tooltip${glossary ? " has-glossary" : ""}" data-testid="hover-tooltip" style="left:${left}px;top:${top}px">
      ${glossarySide === "left" && glossary ? glossary + card : card + glossary}
    </div>
  `;
}

function renderAugmentTooltip(): string {
  if (!view.hoveredAugment || !view.augmentHoverAnchor) return "";
  const shell = document.querySelector<HTMLElement>(".app-shell");
  const anchor = shell ? localAnchorFromViewport(shell, view.augmentHoverAnchor) : view.augmentHoverAnchor;
  const margin = 16;
  const gap = 18;
  const tooltipWidth = 250;
  const tooltipHeight = 128;
  const viewportWidth = shell?.offsetWidth || window.innerWidth;
  const viewportHeight = shell?.offsetHeight || window.innerHeight;
  const anchorLeft = anchor.x - anchor.width / 2;
  const anchorRight = anchor.x + anchor.width / 2;
  const preferRight = viewportWidth - anchorRight >= anchorLeft;
  let left = preferRight ? anchorRight + gap : anchorLeft - tooltipWidth - gap;
  left = Math.max(margin, Math.min(left, viewportWidth - tooltipWidth - margin));
  let top = anchor.y - tooltipHeight / 2;
  top = Math.max(margin, Math.min(top, viewportHeight - tooltipHeight - margin));
  const tierClass = AMP_TIER_CLASS[view.hoveredAugment.tier] ?? "amp-tier-low";
  return `
    <div class="augment-tooltip ${tierClass}" data-testid="augment-tooltip" style="left:${left}px;top:${top}px">
      <div class="augment-tooltip-tier">${escapeHtml(view.hoveredAugment.tier)}</div>
      <div class="augment-tooltip-name">${escapeHtml(view.hoveredAugment.name)}</div>
      <div class="augment-tooltip-desc">${escapeHtml(view.hoveredAugment.description ?? "")}</div>
    </div>
  `;
}

function localPointFromViewport(container: HTMLElement, x: number, y: number): { x: number; y: number } {
  const rect = container.getBoundingClientRect();
  const scaleX = rect.width > 0 ? container.offsetWidth / rect.width : 1;
  const scaleY = rect.height > 0 ? container.offsetHeight / rect.height : 1;
  return {
    x: (x - rect.left) * scaleX,
    y: (y - rect.top) * scaleY
  };
}

function localAnchorFromViewport(
  container: HTMLElement,
  anchor: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const rect = container.getBoundingClientRect();
  const scaleX = rect.width > 0 ? container.offsetWidth / rect.width : 1;
  const scaleY = rect.height > 0 ? container.offsetHeight / rect.height : 1;
  const point = localPointFromViewport(container, anchor.x, anchor.y);
  return {
    x: point.x,
    y: point.y,
    width: anchor.width * scaleX,
    height: anchor.height * scaleY
  };
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

/**
 * Hidden machine-readable event line (`TYPE#seq {payload}`) kept for the e2e oracle and quick
 * debugging — the visible battle log is rendered from `view.battleLog` instead.
 */
function renderEventLine(event: GameEvent): string {
  const payload = event.payload ? ` ${JSON.stringify(event.payload)}` : "";
  return `<p>${escapeHtml(`${event.type}#${event.seq ?? "?"}${payload}`)}</p>`;
}

/**
 * Inline SVG icons for the battle log — clean single-color glyphs that inherit `currentColor`
 * (so a badge stays dark-on-gold, a placeholder stays parchment) and are sized purely by CSS.
 */
const BATTLE_LOG_SVG: Record<string, string> = {
  // Crossed swords — attack.
  sword: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.5 3 7 3l9 9-2.5 2.5-9-9L2.5 3Zm19 0L17 3l-4 4 2.5 2.5L21.5 7 21.5 3ZM5 16l3 3-2 2H3v-3l2-2Zm14 0 2 2v3h-3l-2-2 3-3Z"/></svg>`,
  // Starburst — direct damage.
  burst: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.5l2 5 5-2-2 5 5 2-5 2 2 5-5-2-2 5-2-5-5 2 2-5-5-2 5-2-2-5 5 2 2-5z"/></svg>`,
  // Heart — heal.
  heart: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`,
  // Upward arrow — stat buff.
  arrow: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 4l7 7h-4v9h-6v-9H5l7-7z"/></svg>`,
  // Four-point sparkle — summon.
  sparkle: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.4 3.6 1.4 4.6 5 5-3.6.4-4.6 1.4-5 5-.4-3.6-1.4-4.6-5-5 3.6-.4 4.6-1.4 5-5z"/></svg>`,
  // Skull — death.
  skull: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C7.6 2 4 5.6 4 10c0 2.4 1.1 4.6 2.8 6V19c0 .6.4 1 1 1H9v-2h2v2h2v-2h2v2h1.2c.6 0 1-.4 1-1v-3c1.7-1.4 2.8-3.6 2.8-6 0-4.4-3.6-8-8-8zM9 13a1.9 1.9 0 110-3.8A1.9 1.9 0 019 13zm6 0a1.9 1.9 0 110-3.8A1.9 1.9 0 0115 13z"/></svg>`,
  // Muted speaker — silence / lock.
  silence: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  // Arrow into a holder — bounce (return to hand).
  bounce: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3v8m0 0l-3.2-3.2M12 11l3.2-3.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="4" y="14" width="16" height="6" rx="1.5"/></svg>`,
  // Shield — hero placeholder (no card art).
  shield: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V5l8-3z"/></svg>`,
  // Five-point star — unknown-card placeholder.
  star: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.3L22 9.2l-5 4.6L18.2 21 12 17.3 5.8 21 7 13.8l-5-4.6 7.1-.9L12 2z"/></svg>`
};

/** The inline SVG markup for a named battle-log icon. */
function logIcon(name: keyof typeof BATTLE_LOG_SVG): string {
  return BATTLE_LOG_SVG[name] ?? "";
}

/** Card art block for a log card ref, at `tile` (strip) or `big` (tooltip) size. */
function renderLogCardArt(ref: BattleLogCardRef, size: "tile" | "big"): string {
  const cls = size === "big" ? "log-card-art log-card-art-big" : "log-card-art";
  if (ref.thumb) return `<span class="${cls}" style="background-image:url('${escapeAttr(ref.thumb)}')" aria-hidden="true"></span>`;
  if (ref.hero) return `<span class="${cls} log-card-hero" aria-hidden="true">${logIcon("shield")}</span>`;
  return `<span class="${cls} log-card-empty" aria-hidden="true">${logIcon("star")}</span>`;
}

/** The rich card tooltip revealed on hover: actor art, an optional action flow to one or many targets, and a label. */
function renderLogTooltip(entry: BattleLogEntry): string {
  const signedAmount =
    entry.amount === undefined ? "" : `${entry.kind === "heal" ? "+" : "-"}${entry.amount}`;
  const icon = logIcon(entry.badge ?? "sword");
  let flow = "";
  const flowTargets = entry.flowTargets ?? entry.buffTargets;
  if (flowTargets?.length) {
    const targets = flowTargets
      .map(
        (t) => {
          const targetAmount =
            "amount" in t && t.amount !== undefined ? `${entry.kind === "heal" ? "+" : "-"}${t.amount}` : "";
          const targetDetail = t.detail ?? targetAmount;
          const amountClass = t.detail ? "buff" : entry.kind;
          return `
            <span class="log-flow-target">
              ${renderLogCardArt(t.ref, "big")}
              ${targetDetail ? `<span class="log-amount log-amount-${amountClass}">${escapeHtml(targetDetail)}</span>` : ""}
            </span>`;
        }
      )
      .join("");
    flow = `
        <span class="log-flow-icon" aria-hidden="true">${icon}</span>
        <span class="log-flow-targets">${targets}</span>`;
  } else if (entry.flowTo) {
    flow = `
        <span class="log-flow-icon" aria-hidden="true">${icon}</span>
        <span class="log-flow-target">
          ${renderLogCardArt(entry.flowTo, "big")}
          ${signedAmount ? `<span class="log-amount log-amount-${entry.kind}">${escapeHtml(signedAmount)}</span>` : ""}
        </span>`;
  }
  const hasFlow = Boolean(flowTargets?.length || entry.flowTo);
  return `
    <div class="log-tooltip" role="tooltip">
      <div class="log-tooltip-flow log-tooltip-flow-${entry.kind}">
        <span class="log-flow-source">
          ${renderLogCardArt(entry.tile, "big")}
          ${entry.kind === "death" ? `<span class="log-death-mark" aria-hidden="true">${logIcon("skull")}</span>` : ""}
          ${!hasFlow && signedAmount ? `<span class="log-amount log-amount-${entry.kind}">${escapeHtml(signedAmount)}</span>` : ""}
          ${!hasFlow && entry.detail ? `<span class="log-amount log-amount-buff">${escapeHtml(entry.detail)}</span>` : ""}
        </span>
        ${flow}
      </div>
      <div class="log-tooltip-label">${escapeHtml(entry.label)}</div>
    </div>
  `;
}

function renderBattleLogEntry(entry: BattleLogEntry): string {
  const side = entry.seat ? (entry.seat === view.mySeat ? "log-mine" : "log-enemy") : "";
  // The summon entry shows no corner badge at all (no SVG, no glyph).
  const badge = entry.badge && entry.badge !== "sparkle"
    ? `<span class="log-badge log-badge-${entry.badge}" aria-hidden="true">${logIcon(entry.badge)}</span>`
    : "";
  const deathOverlay = entry.kind === "death" ? `<span class="log-death-overlay" aria-hidden="true">${logIcon("skull")}</span>` : "";
  return `
    <div class="log-entry log-${entry.kind} ${side}" data-dom-key="log-${entry.seq}" data-testid="log-entry">
      <span class="log-tile">
        ${renderLogCardArt(entry.tile, "tile")}
        ${badge}
        ${deathOverlay}
      </span>
      ${renderLogTooltip(entry)}
    </div>
  `;
}

function renderEmptySlots(): string {
  return Array.from({ length: 7 }, () => `<div class="slot" aria-hidden="true"></div>`).join("");
}

function bindStaticActions(): void {
  on(document.querySelector<HTMLButtonElement>("#themed-confirm-ok"), "click", "themed-confirm-ok", () => settleConfirmDialog(true));
  on(document.querySelector<HTMLButtonElement>("#themed-confirm-cancel"), "click", "themed-confirm-cancel", () => settleConfirmDialog(false));
  on(document.querySelector<HTMLElement>("#themed-confirm-overlay"), "click", "themed-confirm-overlay", (event) => {
    if (event.target === event.currentTarget) settleConfirmDialog(false);
  });
  on(document.querySelector<HTMLFormElement>("#join-form"), "submit", "join-form", joinRoom);
  on(document.querySelector<HTMLFormElement>("#auth-form"), "submit", "auth-form", submitAuthForm);
  on(document.querySelector<HTMLFormElement>("#player-id-form"), "submit", "player-id-form", (event) => void savePlayerId(event));
  const playerIdInput = document.querySelector<HTMLInputElement>("#player-id-input");
  if (playerIdInput) {
    on(playerIdInput, "input", "player-id-input", () => {
      view.editingDisplayName = playerIdInput.value;
    });
  }
  on(document.querySelector<HTMLButtonElement>("#auth-signin-tab"), "click", "auth-signin-tab", () => setAuthMode("signin"));
  on(document.querySelector<HTMLButtonElement>("#auth-signup-tab"), "click", "auth-signup-tab", () => setAuthMode("signup"));
  on(document.querySelector<HTMLButtonElement>("#google-sign-in"), "click", "google-sign-in", () => void signInWithGoogle());
  on(document.querySelector<HTMLButtonElement>("#sign-out"), "click", "sign-out", () => void signOut());
  on(document.querySelector<HTMLButtonElement>("#refresh-account"), "click", "refresh-account", () => void loadAccountData());
  on(document.querySelector<HTMLButtonElement>("#sync-collection"), "click", "sync-collection", () => void syncCollection());
  on(document.querySelector<HTMLButtonElement>("#new-deck"), "click", "new-deck", () => {
    beginNewDeck();
  });
  on(document.querySelector<HTMLButtonElement>("#autofill-deck"), "click", "autofill-deck", autofillDeck);
  on(document.querySelector<HTMLButtonElement>("#clear-deck"), "click", "clear-deck", clearDeck);
  on(document.querySelector<HTMLInputElement>("#deck-name"), "input", "deck-name", (event) => {
    if (!view.editingDeck) return;
    view.editingDeck = { ...view.editingDeck, name: (event.currentTarget as HTMLInputElement).value };
  });
  on(document.querySelector<HTMLFormElement>("#deck-form"), "submit", "deck-form", (event) => void saveEditingDeck(event));
  on(document.querySelector<HTMLButtonElement>("#mulligan"), "click", "mulligan", () => {
    send({ type: "submitMulligan", replaceHandInstanceIds: [...view.mulliganSelection] });
    view.mulliganSelection.clear();
    render();
  });
  on(document.querySelector<HTMLButtonElement>("#play"), "click", "play", () => {
    if (isBattleActionLocked() || view.pendingBattlecry) return;
    if (!view.selectedHandId) return;
    const selectedCard = view.hand.find((card) => card.instanceId === view.selectedHandId);
    send({ type: "playCard", handInstanceId: view.selectedHandId, target: view.selectedTarget ?? inferDefaultTarget(selectedCard?.cardId) });
  });
  on(document.querySelector<HTMLButtonElement>("#attack"), "click", "attack", () => {
    if (isBattleActionLocked() || view.pendingBattlecry) return;
    if (!view.selectedAttackerId || !view.selectedTarget) return;
    send({ type: "attack", attackerInstanceId: view.selectedAttackerId, target: view.selectedTarget });
  });
  on(document.querySelector<HTMLButtonElement>("#training-next"), "click", "training-next", () => {
    if (!trainingSession) return;
    applyTrainingResult(advanceTraining(trainingSession));
  });
  on(document.querySelector<HTMLButtonElement>("#end-turn"), "click", "end-turn", (event) => {
    if (activeTurnAnnouncement() || view.pendingBattlecry) return;
    if (trainingSession && !trainingCanEndTurn(trainingSession)) {
      showBattleToast("這一步只能照教學指定的操作進行。");
      return;
    }
    const btn = event.currentTarget as HTMLButtonElement | null;
    // Drive the flip via WAAPI: a re-render patches the class attribute (see
    // dom-patch.ts) and would otherwise strip a CSS animation class mid-flight.
    btn?.animate?.(
      [
        { transform: "perspective(420px) rotateY(0deg)" },
        { transform: "perspective(420px) rotateY(90deg)", offset: 0.5 },
        { transform: "perspective(420px) rotateY(0deg)" }
      ],
      { duration: 420, easing: "ease-in-out" }
    );
    send({ type: "endTurn" });
  });
  on(document.querySelector<HTMLButtonElement>("#battle-settings-toggle"), "click", "battle-settings-toggle", () => {
    view.battleSettingsOpen = !view.battleSettingsOpen;
    clearHoverTooltip();
    render();
  });
  on(document.querySelector<HTMLButtonElement>("#battle-view-deck"), "click", "battle-view-deck", () => {
    view.battleDeckOpen = true;
    view.battleSettingsOpen = false;
    render();
  });
  on(document.querySelector<HTMLButtonElement>("#battle-audio-settings"), "click", "battle-audio-settings", () => {
    view.settingsOpen = true;
    view.battleSettingsOpen = false;
    render();
  });
  on(document.querySelector<HTMLButtonElement>("#concede"), "click", "concede", () => {
    view.battleSettingsOpen = false;
    view.confirmingConcede = true;
    clearHoverTooltip();
    render();
  });
  on(document.querySelector<HTMLButtonElement>("#concede-cancel"), "click", "concede-cancel", () => {
    view.confirmingConcede = false;
    render();
  });
  on(document.querySelector<HTMLButtonElement>("#concede-confirm"), "click", "concede-confirm", () => {
    view.confirmingConcede = false;
    send({ type: "concede" });
    render();
  });
  on(document.querySelector<HTMLButtonElement>("#battle-deck-close"), "click", "battle-deck-close", () => {
    view.battleDeckOpen = false;
    clearHoverTooltip();
    render();
  });
  on(document.querySelector<HTMLElement>("#battle-deck-backdrop"), "click", "battle-deck-backdrop", (e) => {
    if (e.target === e.currentTarget) {
      view.battleDeckOpen = false;
      clearHoverTooltip();
      render();
    }
  });
  on(document.querySelector<HTMLButtonElement>("#reward-continue"), "click", "reward-continue", () => {
    const stage = view.rewardAnim?.stage;
    if (stage === "done") void backToLobby();
    else skipRewardAnimation(view, render);
  });
  on(document.querySelector<HTMLElement>(".reward-overlay"), "click", "reward-overlay-skip", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("#reward-continue")) return;
    if (view.rewardAnim && view.rewardAnim.stage !== "done") {
      skipRewardAnimation(view, render);
    }
  });

  for (const el of document.querySelectorAll<HTMLElement>("[data-select-deck]")) {
    on(el, "click", "select-deck", () => {
      view.selectedDeckId = el.dataset.selectDeck;
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-edit-deck]")) {
    on(el, "click", "edit-deck", () => {
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
    on(el, "click", "delete-deck", () => void deleteDeck(el.dataset.deleteDeck));
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-add-card]")) {
    on(el, "click", "add-card", () => {
      if (view.editingDeck) {
        addCardToEditor(el.dataset.addCard);
      } else {
        view.pinnedCollectionCardId = el.dataset.addCard;
        render();
      }
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-remove-card]")) {
    on(el, "click", "remove-card", () => removeCardFromEditor(el.dataset.removeCard));
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-menu-screen]")) {
    on(el, "click", "menu-screen", () => {
      const target = el.dataset.menuScreen as MenuScreen | undefined;
      if (!target) return;
      navigateToScreen(target);
    });
  }
  devTestPanel?.bindDevTestActions({
    on,
    jump: navigateToScreen,
    startPve: (setup) => void startDevTestPveMatch(setup),
    showReward: showDevTestRewardScreen,
    getAiTheme: () => view.aiTheme,
    getAiDifficulty: () => view.aiDifficulty
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-battle-mode]")) {
    on(el, "click", "battle-mode", () => {
      const mode = el.dataset.battleMode as BattleMode | undefined;
      if (!mode) return;
      if (mode === "training") {
        navigateToScreen("training");
        return;
      }
      if (mode === "challenge") {
        navigateToScreen("ai");
        return;
      }
      if (mode === "ai") {
        navigateToScreen("computer_placeholder");
        return;
      }
      if (mode === "pvp") {
        navigateToScreen("pvp_placeholder");
        return;
      }
      view.battleMode = mode;
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLButtonElement>("[data-start-training]")) {
    on(el, "click", "start-training", () => {
      const levelId = el.dataset.startTraining as TrainingLevelId | undefined;
      if (!levelId) return;
      void startTrainingMatch(levelId);
    });
  }
  on(document.querySelector<HTMLButtonElement>("#find-match"), "click", "find-match", () => void startMatchmaking());
  on(document.querySelector<HTMLButtonElement>("#matchmaking-cancel"), "click", "matchmaking-cancel", () => void cancelMatchmaking());
  on(document.querySelector<HTMLFormElement>("#profile-form"), "submit", "profile-form", (event) => void saveProfile(event));
  on(document.querySelector<HTMLButtonElement>("#open-avatar-picker"), "click", "open-avatar-picker", () => {
    view.avatarPickerOpen = !view.avatarPickerOpen;
    if (view.avatarPickerOpen) view.titlePickerOpen = false;
    render();
  });
  on(document.querySelector<HTMLButtonElement>("#avatar-picker-close"), "click", "avatar-picker-close", () => {
    view.avatarPickerOpen = false;
    render();
  });
  on(document.querySelector<HTMLElement>("#avatar-picker-backdrop"), "click", "avatar-picker-backdrop", (event) => {
    if (event.target === event.currentTarget) { view.avatarPickerOpen = false; render(); }
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-pick-avatar]")) {
    on(el, "click", "pick-avatar", () => void pickAvatar(el.dataset.pickAvatar));
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-pick-google-avatar]")) {
    on(el, "click", "pick-google-avatar", () => void pickGoogleAvatar());
  }
  on(document.querySelector<HTMLButtonElement>("#open-title-picker"), "click", "open-title-picker", () => {
    view.titlePickerOpen = !view.titlePickerOpen;
    if (view.titlePickerOpen) view.avatarPickerOpen = false;
    render();
  });
  on(document.querySelector<HTMLButtonElement>("#title-picker-close"), "click", "title-picker-close", () => {
    view.titlePickerOpen = false;
    render();
  });
  on(document.querySelector<HTMLElement>("#title-picker-backdrop"), "click", "title-picker-backdrop", (event) => {
    if (event.target === event.currentTarget) { view.titlePickerOpen = false; render(); }
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-pick-title]")) {
    on(el, "click", "pick-title", () => void pickTitle(el.dataset.pickTitle));
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-collection-filter]")) {
    on(el, "click", "collection-filter", () => {
      const filter = el.dataset.collectionFilter as CollectionFilter | undefined;
      if (!filter || view.collectionFilter === filter) return;
      view.collectionFilter = filter;
      render();
    });
  }
  on(document.querySelector<HTMLSelectElement>("#collection-sort-select"), "change", "collection-sort-select", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value as CollectionSort;
    view.collectionSort = value;
    render();
  });
  on(document.querySelector<HTMLSelectElement>("#collection-category-select"), "change", "collection-category-select", (event) => {
    view.collectionCategory = (event.currentTarget as HTMLSelectElement).value;
    render();
  });
  on(document.querySelector<HTMLSelectElement>("#collection-rarity-select"), "change", "collection-rarity-select", (event) => {
    view.collectionRarity = (event.currentTarget as HTMLSelectElement).value;
    render();
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-lb-sort]")) {
    on(el, "click", "lb-sort", () => {
      const value = el.dataset.lbSort as "wins" | "level" | undefined;
      if (!value) return;
      view.leaderboardSortBy = value;
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-view-player-profile]")) {
    on(el, "click", "view-player-profile", () => {
      const userId = el.dataset.viewPlayerProfile;
      if (userId) openPublicPlayerProfile(userId);
    });
  }
  on(document.querySelector<HTMLElement>("#public-profile-backdrop"), "click", "public-profile-backdrop", (event) => {
    if (event.target === event.currentTarget) {
      view.publicPlayerProfile = undefined;
      render();
    }
  });
  on(document.querySelector<HTMLButtonElement>("#close-public-profile"), "click", "close-public-profile", () => {
    view.publicPlayerProfile = undefined;
    render();
  });
  on(document.querySelector<HTMLInputElement>("#collection-search-input"), "input", "collection-search-input", (event) => {
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
    on(el, "click", "collection-card", () => {
      view.pinnedCollectionCardId = el.dataset.collectionCard;
      render();
    });
  }
  on(document.querySelector<HTMLButtonElement>("#pinned-card-close"), "click", "pinned-card-close", () => {
    view.pinnedCollectionCardId = undefined;
    render();
  });
  on(document.querySelector<HTMLElement>("#pinned-card-overlay"), "click", "pinned-card-overlay", (event) => {
    if (event.target === event.currentTarget) {
      view.pinnedCollectionCardId = undefined;
      render();
    }
  });
  on(document.querySelector<HTMLButtonElement>("#card-op-disenchant"), "click", "card-op-disenchant", (event) => {
    const cardId = (event.currentTarget as HTMLButtonElement).dataset.cardId;
    if (cardId) void disenchantCard(cardId, 1);
  });
  on(document.querySelector<HTMLButtonElement>("#card-op-craft"), "click", "card-op-craft", (event) => {
    const cardId = (event.currentTarget as HTMLButtonElement).dataset.cardId;
    if (cardId) void craftCard(cardId);
  });
  on(document.querySelector<HTMLButtonElement>("#bulk-disenchant"), "click", "bulk-disenchant", () => void bulkDisenchantExtras());
  on(document.querySelector<HTMLButtonElement>("#edit-display-name"), "click", "edit-display-name", () => {
    view.editingDisplayNameActive = true;
    view.editingDisplayName = view.profile?.display_name ?? "";
    render();
    requestAnimationFrame(() => {
      const inp = document.querySelector<HTMLInputElement>("#profile-display-name");
      inp?.focus();
      inp?.select();
    });
  });
  on(document.querySelector<HTMLButtonElement>("#cancel-edit-name"), "click", "cancel-edit-name", () => {
    view.editingDisplayNameActive = false;
    view.editingDisplayName = undefined;
    render();
  });
  const displayInput = document.querySelector<HTMLInputElement>("#profile-display-name");
  if (displayInput) {
    on(displayInput, "input", "profile-display-name", () => {
      view.editingDisplayName = displayInput.value;
    });
  }
  on(document.querySelector<HTMLFormElement>("#add-friend-form"), "submit", "add-friend-form", (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#add-friend-input");
    void sendFriendRequest(input?.value ?? "");
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-friends-panel]")) {
    on(el, "click", "friends-panel", () => {
      const panel = el.dataset.friendsPanel as FriendsPanel | undefined;
      if (!panel) return;
      view.friendsPanel = panel;
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-remove-friend]")) {
    on(el, "click", "remove-friend", () => {
      const id = el.dataset.removeFriend;
      if (id) void removeFriend(id);
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-accept-friend-request]")) {
    on(el, "click", "accept-friend-request", () => {
      const id = el.dataset.acceptFriendRequest;
      if (id) void respondFriendRequest("accept", id);
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-decline-friend-request]")) {
    on(el, "click", "decline-friend-request", () => {
      const id = el.dataset.declineFriendRequest;
      if (id) void respondFriendRequest("decline", id);
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-cancel-friend-request]")) {
    on(el, "click", "cancel-friend-request", () => {
      const id = el.dataset.cancelFriendRequest;
      if (id) void respondFriendRequest("cancel", id);
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-challenge-friend]")) {
    on(el, "click", "challenge-friend", () => {
      void createPrivateChallenge();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-copy-code]")) {
    on(el, "click", "copy-code", () => {
      const code = el.dataset.copyCode ?? "";
      if (!code) return;
      void navigator.clipboard?.writeText(code).catch(() => {
        // Clipboard might be blocked in some browsers; the code is visible on-screen.
      });
      showToast(`已複製代碼 ${code}`);
    });
  }
  on(document.querySelector<HTMLButtonElement>("#cancel-private-room"), "click", "cancel-private-room", () => {
    void cancelMatchmaking();
    view.privateJoinCode = undefined;
    render();
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-claim-shop]")) {
    on(el, "click", "claim-shop", () => {
      const id = el.dataset.claimShop;
      if (id) void claimShopItem(id);
    });
  }
  bindPackOpeningActions();
  for (const el of document.querySelectorAll<HTMLInputElement>('input[name="ai-difficulty"]')) {
    on(el, "change", "ai-difficulty", () => {
      const value = el.value as AiDifficulty;
      if (value === "easy" || value === "normal" || value === "hard") {
        view.aiDifficulty = value;
        view.aiDifficultySelected = true;
        render();
      }
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-ai-theme]")) {
    on(el, "click", "ai-theme", () => {
      const theme = AI_THEMES.find((entry) => entry.id === el.dataset.aiTheme);
      if (theme) {
        if (view.aiTheme !== theme.id) view.aiDifficultySelected = false;
        view.aiTheme = theme.id;
        render();
      }
    });
  }
  on(document.querySelector<HTMLButtonElement>("#start-ai-match"), "click", "start-ai-match", () => {
    void startAiMatch();
  });
  on(document.querySelector<HTMLButtonElement>("#start-ai-mode-match"), "click", "start-ai-mode-match", () => {
    void startAiMatch({ withTheme: false });
  });
  on(document.querySelector<HTMLFormElement>("#private-join-form"), "submit", "private-join-form", (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#private-join-input");
    void joinPrivateByCode(input?.value ?? "");
  });
  on(document.querySelector<HTMLButtonElement>("#create-private-room"), "click", "create-private-room", () => {
    void createPrivateChallenge();
  });
  on(document.querySelector<HTMLButtonElement>("#settings-toggle"), "click", "settings-toggle", () => {
    view.settingsOpen = true;
    render();
  });
  on(document.querySelector<HTMLButtonElement>("#settings-close"), "click", "settings-close", () => {
    view.settingsOpen = false;
    render();
  });
  on(document.querySelector<HTMLElement>("#settings-backdrop"), "click", "settings-backdrop", (e) => {
    if (e.target === e.currentTarget) { view.settingsOpen = false; render(); }
  });
  on(document.querySelector<HTMLButtonElement>("#changelog-open"), "click", "changelog-open", () => {
    view.changelogOpen = true;
    render();
  });
  on(document.querySelector<HTMLButtonElement>("#changelog-close"), "click", "changelog-close", () => {
    view.changelogOpen = false;
    render();
  });
  on(document.querySelector<HTMLElement>("#changelog-backdrop"), "click", "changelog-backdrop", (e) => {
    if (e.target === e.currentTarget) { view.changelogOpen = false; render(); }
  });
  for (const el of document.querySelectorAll<HTMLElement>("[data-hover-card-id]")) {
    bindHoverPreview(el, () => {
      const card = el.dataset.hoverCardId ? cardCatalog.get(el.dataset.hoverCardId) : undefined;
      return card ? resolveCatalogCard(card, `tooltip-${card.id}`) : undefined;
    });
  }
  on(document.querySelector<HTMLButtonElement>("#settings-sign-out"), "click", "settings-sign-out", () => void signOut());
  on(document.querySelector<HTMLButtonElement>("#settings-beta-reset-db"), "click", "settings-beta-reset-db", () => void resetBetaDatabaseFromSettings());
  on(document.querySelector<HTMLButtonElement>("#settings-bgm-mute"), "click", "settings-bgm-mute", toggleBgmMute);
  on(document.querySelector<HTMLButtonElement>("#settings-sfx-mute"), "click", "settings-sfx-mute", toggleSfxMute);
  on(document.querySelector<HTMLInputElement>("#settings-bgm-volume"), "input", "settings-bgm-volume", (e) => {
    setBgmVolume(parseFloat((e.currentTarget as HTMLInputElement).value));
  });
  on(document.querySelector<HTMLInputElement>("#settings-sfx-volume"), "input", "settings-sfx-volume", (e) => {
    setSfxVolume(parseFloat((e.currentTarget as HTMLInputElement).value));
  });
}

function bindCollectionDeckControls(root: ParentNode): void {
  on(root.querySelector<HTMLButtonElement>("#new-deck"), "click", "new-deck", beginNewDeck);
  on(root.querySelector<HTMLButtonElement>("#autofill-deck"), "click", "autofill-deck", autofillDeck);
  on(root.querySelector<HTMLButtonElement>("#clear-deck"), "click", "clear-deck", clearDeck);
  on(root.querySelector<HTMLInputElement>("#deck-name"), "input", "deck-name", (event) => {
    if (!view.editingDeck) return;
    view.editingDeck = { ...view.editingDeck, name: (event.currentTarget as HTMLInputElement).value };
  });
  on(root.querySelector<HTMLFormElement>("#deck-form"), "submit", "deck-form", (event) => void saveEditingDeck(event));
  for (const el of root.querySelectorAll<HTMLElement>("[data-edit-deck]")) {
    on(el, "click", "edit-deck", () => {
      const deck = view.decks.find((item) => item.id === el.dataset.editDeck);
      if (deck) {
        view.selectedDeckId = deck.id;
        view.editingDeck = { ...deck, card_ids: [...deck.card_ids] };
      }
      refreshCollectionDeckWorkspace();
    });
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-delete-deck]")) {
    on(el, "click", "delete-deck", () => void deleteDeck(el.dataset.deleteDeck));
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-remove-card]")) {
    on(el, "click", "remove-card", () => removeCardFromEditor(el.dataset.removeCard));
  }
  const openCoverPicker = (): void => {
    if (!view.editingDeck || view.editingDeck.card_ids.length === 0) return;
    view.coverPickerOpen = true;
    refreshCollectionDeckWorkspace();
  };
  on(root.querySelector<HTMLButtonElement>("#edit-cover"), "click", "edit-cover", openCoverPicker);
  on(root.querySelector<HTMLButtonElement>("#edit-cover-thumb"), "click", "edit-cover-thumb", openCoverPicker);
  on(root.querySelector<HTMLButtonElement>("#cover-picker-close"), "click", "cover-picker-close", () => {
    view.coverPickerOpen = false;
    refreshCollectionDeckWorkspace();
  });
  on(root.querySelector<HTMLElement>("#cover-picker-overlay"), "click", "cover-picker-overlay", (event) => {
    if (event.target === event.currentTarget) {
      view.coverPickerOpen = false;
      refreshCollectionDeckWorkspace();
    }
  });
  for (const el of root.querySelectorAll<HTMLElement>("[data-cover-card]")) {
    on(el, "click", "cover-card", () => {
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
  patchHtml(column, renderCollectionDeckColumnContent());
  lastRenderedHtml = "";
  bindCollectionDeckControls(column);
  updateCollectionCardButtons();
}

function updateCollectionCardButtons(): void {
  const selectedCounts = countCards(view.editingDeck?.card_ids ?? []);
  const selectedTotal = view.editingDeck?.card_ids.length ?? 0;
  const collectionMap = buildCollectionMap(view.collection);
  for (const el of document.querySelectorAll<HTMLButtonElement>(".collection-card[data-add-card]")) {
    const cardId = el.dataset.addCard;
    const card = cardId ? cardCatalog.get(cardId) : undefined;
    if (!card || !cardId) continue;
    const quantity = collectionMap.get(cardId) ?? 0;
    const selectedCount = selectedCounts.get(cardId) ?? 0;
    const limit = deckCopyLimit(card);
    const effectiveOwned = usesDbCollectionOwnership() || hasCollectionRows() ? quantity : limit;
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
    on(el, "click", "pack-flip", () => {
      if (!view.packOpeningFlipped || !view.packOpeningRewards) return;
      const idx = parseInt(el.dataset.flipIndex ?? "-1", 10);
      if (idx < 0 || view.packOpeningFlipped[idx]) return;
      view.packOpeningFlipped[idx] = true;
      playSfx("packFlip", 0.6);
      flipPackRewardCard(idx);
    });
  }
  on(document.querySelector<HTMLButtonElement>("#btn-pack-done"), "click", "pack-done", () => {
    view.packOpeningRewards = undefined;
    view.packOpeningFlipped = undefined;
    view.packOpeningKind = undefined;
    document.querySelector("#pack-opening-overlay")?.remove();
    lastRenderedHtml = "";
  });
}

function navigateToScreen(target: MenuScreen): void {
  if (view.matchmaking && target !== "battle") return;
  if (target === "test" && !devTestModeAvailable) target = "main";
  // Entering the challenge (theme select) screen plays the LEGACY book-flip intro.
  if (target === "ai" && view.menuScreen !== "ai") playPveTransition();
  view.menuScreen = target;
  view.avatarPickerOpen = false;
  view.titlePickerOpen = false;
  view.pinnedCollectionCardId = undefined;
  if (target !== "profile") { view.editingDisplayName = undefined; view.editingDisplayNameActive = false; }
  if (target === "friends") void loadFriends();
  if (target === "leaderboard") void loadLeaderboard();
  if (target === "shop") void loadShopItems();
  render();
  if (target === "collection" && supabase && view.session?.user) void loadAccountData();
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
  const avatar = friend.avatar_url || DEFAULT_AVATAR_URL;
  return `
    <li class="friend-row" data-testid="friend-row">
      <img class="friend-avatar" src="${escapeAttr(avatar)}" alt="" onerror="this.src='${DEFAULT_AVATAR_URL}'" />
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
  const avatar = request.avatar_url || DEFAULT_AVATAR_URL;
  return `
    <li class="friend-row" data-testid="friend-request-row">
      <img class="friend-avatar" src="${escapeAttr(avatar)}" alt="" onerror="this.src='${DEFAULT_AVATAR_URL}'" />
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
  const avatarUrl = player.avatarUrl || DEFAULT_AVATAR_URL;
  const level = deriveLbLevel(player.winsCount);
  const rankText = player.rank ? `#${player.rank}` : "—";
  return `
    <section id="public-profile-backdrop" class="public-profile-backdrop" role="dialog" aria-modal="true" aria-label="玩家個人頁面">
      <div class="parchment-card public-profile-card">
        <button id="close-public-profile" class="public-profile-close" title="關閉">×</button>
        <div class="public-profile-hero">
          <img class="public-profile-avatar" src="${escapeAttr(avatarUrl)}" alt="" onerror="this.src='${DEFAULT_AVATAR_URL}'" />
          <div class="public-profile-info">
            <span class="public-profile-source">${escapeHtml(player.source)}</span>
            <h3>${escapeHtml(player.displayName)}</h3>
            <div class="public-profile-title">未設定稱號</div>
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
  const avatarUrl = row.avatar_url || DEFAULT_AVATAR_URL;
  const level = deriveLbLevel(row.wins_count);
  const statLabel = sortBy === "level" ? `Lv. ${level}` : `${row.wins_count} 勝`;
  return `
    <div class="lb-player-card${rankClass}">
      <div class="lb-rank-badge">${rankBadge}</div>
      <img class="lb-avatar" src="${escapeAttr(avatarUrl)}" alt="" onerror="this.src='${DEFAULT_AVATAR_URL}'" />
      <div class="lb-player-info">
        <div class="lb-player-name">${escapeHtml(row.display_name)}</div>
        <div class="lb-player-title">未設定稱號</div>
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
            <img class="gold-icon" src="/images/ui/Coin.webp" alt="金幣"
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
  const icon = shopItemIcon(item.kind);

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
            <img class="price-coin" src="/images/ui/Coin.webp" alt="金幣"
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

function shopItemIcon(kind: string): string {
  if (kind === "CARD_PACK") {
    return `<img src="/images/ui/Carddeck.webp" alt="卡牌包" onerror="this.style.display='none';this.parentElement.textContent='🎴'">`;
  }
  if (kind === "COSMETIC_PACK") {
    return `<img src="/images/ui/accessory.webp" alt="炫彩包" onerror="this.style.display='none';this.parentElement.textContent='✨'">`;
  }
  return `<span aria-hidden="true">✨</span>`;
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
            <img class="gold-icon" src="/images/ui/Coin.webp" alt="金幣" onerror="this.style.display='none'">
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
  const icon = shopItemIcon(item.kind);
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
            <img class="price-coin" src="/images/ui/Coin.webp" alt="金幣" onerror="this.style.display='none'">
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
  return `<div class="pack-card-img-wrap reward-cosmetic-wrap"><span class="reward-voucher-badge"><span class="voucher-icon" aria-hidden="true"></span>${reward.amount}</span></div>`;
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

function titleLabel(id: string): string {
  return TITLE_LABELS[id] ?? id;
}

function googleProfileAvatarUrl(): string | undefined {
  const metadata = view.session?.user.user_metadata ?? {};
  const avatarUrl = metadata.avatar_url;
  return typeof avatarUrl === "string" && avatarUrl.trim() ? avatarUrl : undefined;
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

async function startTrainingMatch(levelId: TrainingLevelId): Promise<void> {
  if (view.joining || view.room) return;
  if (!trainingLevelUnlocked(levelId)) return;
  startLocalTrainingMatch(levelId);
  await Promise.resolve();
}

function startLocalTrainingMatch(levelId: TrainingLevelId): void {
  if (rewardFallbackTimer !== undefined) {
    window.clearTimeout(rewardFallbackTimer);
    rewardFallbackTimer = undefined;
  }
  clearTrainingRewardAnimationTimer();
  resetRewardScreen(view);
  resetCardPlayCues();
  resetMinionVisualTracking();
  resetBattleLog();
  trainingSession = createTrainingSession(levelId, view.profile?.display_name ?? "玩家");
  view.room = undefined;
  view.mySeat = "player1";
  view.hand = [];
  view.state = trainingPublicState(trainingSession);
  view.publicSync = {
    status: trainingSession.status,
    activeSeat: trainingSession.activeSeat,
    turnNumber: trainingSession.turnNumber,
    actionSeq: trainingSession.actionSeq,
    players: trainingSession.players
  };
  view.events = [];
  view.animationCues = [];
  view.eventStatus = "in_progress";
  view.amplificationOptions = undefined;
  resetSpecialPhaseUiState();
  view.selectedHandId = undefined;
  view.selectedAttackerId = undefined;
  view.selectedTarget = undefined;
  view.mulliganSelection.clear();
  view.rejectedHandIds.clear();
  view.menuScreen = "battle";
  render();
}

function applyTrainingResult(result: TrainingCommandResult): void {
  if (!trainingSession) return;
  // Commit any board state still pending from the previous step before applying
  // the next one. Steps are user-paced, so a fast click can otherwise start a
  // step (e.g. killing 京華城) while the prior step's minion is still an
  // uncommitted summon preview — which renders at the wrong slot and makes its
  // death animation fire there instead of in place.
  if (!attackAnimationBusy()) applyPendingPublicSyncNow();
  // Mirror the session's special-phase amplification offer into the view so the
  // real amplification overlay (driven by view.amplificationOptions) can render.
  view.amplificationOptions = trainingSession.amplificationOptions;
  if (result.publicSync) {
    view.state = trainingPublicState(trainingSession);
    applyPublicSync(result.publicSync);
  }
  if (result.events.length > 0) handleEvents(result.events);
  if (result.hand) handleHandSync(result.hand);
  if (result.completed) {
    const rewardDeferUntilMs = deferTrainingCompletionUntil(result.events);
    void completeTrainingReward(rewardDeferUntilMs);
  }
  render();
}

async function completeTrainingReward(deferUntilMs?: number): Promise<void> {
  const session = trainingSession;
  if (!session) return;
  const optimistic = localTrainingReward(session.level.id);
  applyTrainingRewardSummary(optimistic, deferUntilMs);

  if (!supabase || !view.session?.user) return;
  try {
    const { data, error } = await supabase.rpc("complete_training_level", { p_level_id: session.level.id });
    if (error) throw error;
    if (trainingSession !== session) return;
    const payload = normalizeTrainingRewardRpc(data, optimistic);
    markLocalTrainingComplete(session.level.id);
    applyTrainingRewardSummary(payload, deferUntilMs);
  } catch (error) {
    console.warn("training reward persistence failed", error);
  }
}

function applyTrainingRewardSummary(result: { goldBefore: number; goldAfter: number; rewardGold: number }, deferUntilMs?: number): void {
  view.rewardSummary = createTrainingRewardSummary(result);
  if (view.profile) {
    view.profile = {
      ...view.profile,
      gold: result.goldAfter
    };
  }
  if (deferUntilMs && performance.now() < deferUntilMs) {
    const delayMs = Math.max(0, deferUntilMs - performance.now());
    if (trainingRewardAnimationTimer !== undefined) window.clearTimeout(trainingRewardAnimationTimer);
    trainingRewardAnimationTimer = window.setTimeout(() => {
      trainingRewardAnimationTimer = undefined;
      startRewardAnimation(view, render);
    }, delayMs);
    render();
    return;
  }
  clearTrainingRewardAnimationTimer();
  startRewardAnimation(view, render);
  render();
}

function deferTrainingCompletionUntil(events: GameEvent[]): number | undefined {
  if (!trainingSession) return undefined;
  if (!events.some((event) => event.type === "GAME_FINISHED")) return undefined;
  // scheduleHeroDeathSequence (in handleEvents) already computed the hero death
  // shatter hold for every level (第一關 included, not just collision_news), and
  // holds publicSync for it. Start the reward XP/gold animation when the
  // VICTORY/DEFEAT overlay reveals so the two stay in sync.
  return resultOverlayHoldUntilMs || undefined;
}

function clearTrainingRewardAnimationTimer(): void {
  if (trainingRewardAnimationTimer === undefined) return;
  window.clearTimeout(trainingRewardAnimationTimer);
  trainingRewardAnimationTimer = undefined;
}

function localTrainingReward(levelId: string): { goldBefore: number; goldAfter: number; rewardGold: number } {
  const goldBefore = view.profile?.gold ?? 0;
  const alreadyCompleted = isLocalTrainingComplete(levelId);
  const level = TRAINING_LEVELS.find((candidate) => candidate.id === levelId);
  const rewardGold = alreadyCompleted ? 0 : level?.rewardGold ?? 0;
  if (!alreadyCompleted) {
    markLocalTrainingComplete(levelId);
    remoteTrainingCompletions.add(levelId);
  }
  return { goldBefore, goldAfter: goldBefore + rewardGold, rewardGold };
}

function normalizeTrainingRewardRpc(
  data: unknown,
  fallback: { goldBefore: number; goldAfter: number; rewardGold: number }
): { goldBefore: number; goldAfter: number; rewardGold: number } {
  const payload = Array.isArray(data) ? data[0] : data;
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  const goldBefore = numericValue(record.goldBefore, fallback.goldBefore);
  const goldAfter = numericValue(record.goldAfter, fallback.goldAfter);
  const rewardGold = numericValue(record.rewardGold, Math.max(0, goldAfter - goldBefore));
  return { goldBefore, goldAfter, rewardGold };
}

function numericValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function localTrainingCompleteKey(levelId: string): string {
  const userId = view.session?.user?.id ?? "guest";
  return `twcardgame.training.${userId}.${levelId}.completed`;
}

function trainingLevelCompleted(levelId: string): boolean {
  return remoteTrainingCompletions.has(levelId) || isLocalTrainingComplete(levelId);
}

function trainingLevelUnlocked(_levelId: TrainingLevelId): boolean {
  // Training levels are teaching content — every level is freely selectable.
  return true;
}

function isLocalTrainingComplete(levelId: string): boolean {
  return window.localStorage.getItem(localTrainingCompleteKey(levelId)) === "1";
}

function markLocalTrainingComplete(levelId: string): void {
  window.localStorage.setItem(localTrainingCompleteKey(levelId), "1");
}

function selectedDeckJoinOptions(): { deckId?: string; deckIds?: string[] } {
  const selectedDeck = view.selectedDeckId ? view.decks.find((deck) => deck.id === view.selectedDeckId) : undefined;
  return {
    ...(view.selectedDeckId ? { deckId: view.selectedDeckId } : {}),
    ...(selectedDeck?.card_ids.length === 30 ? { deckIds: [...selectedDeck.card_ids] } : {})
  };
}

async function startDevTestPveMatch(devTest: DevTestMatchSetup): Promise<void> {
  if (!devTestModeAvailable || view.joining || view.room) return;
  const unknown = [
    ...(devTest.handCardIds ?? []),
    ...(devTest.opponentHandCardIds ?? []),
    ...(devTest.playerDeckCardIds ?? []),
    ...(devTest.opponentDeckCardIds ?? []),
    ...(devTest.playerBoardCardIds ?? []),
    ...(devTest.opponentBoardCardIds ?? [])
  ].filter((id) => !cardCatalog.has(id));
  if (unknown.length > 0) {
    showAlert(`Unknown card id: ${unknown.join(", ")}`);
    return;
  }

  view.joining = true;
  render();
  try {
    const client = new Client(defaultServerUrl);
    const room = await client.joinOrCreate(
      "pve",
      {
        displayName: view.profile?.display_name ?? "Player",
        difficulty: view.aiDifficulty,
        theme: view.aiTheme,
        devTest
      },
      GameStateSchema
    );
    bindRoomMessages(room, { persist: false });
  } catch (error) {
    showAlert(error instanceof Error ? error.message : "Unable to start dev test match.");
  } finally {
    view.joining = false;
    render();
  }
}

function showDevTestRewardScreen(summary: RewardSummary): void {
  if (!devTestModeAvailable) return;
  if (view.room) {
    showAlert("Leave the current match before opening a dev reward screen.");
    return;
  }
  if (rewardFallbackTimer !== undefined) {
    window.clearTimeout(rewardFallbackTimer);
    rewardFallbackTimer = undefined;
  }
  clearTrainingRewardAnimationTimer();
  resetRewardScreen(view);
  resetCardPlayCues();
  resetMinionVisualTracking();

  const players = {
    player1: devTestPublicPlayer("player1", "Player", 30, 10, 10),
    player2: devTestPublicPlayer("player2", "Opponent", 0, 0, 0)
  };
  view.room = undefined;
  view.mySeat = "player1";
  view.hand = [];
  view.events = [];
  resetBattleLog();
  view.animationCues = [];
  view.publicSync = {
    status: "finished",
    activeSeat: "player1",
    turnNumber: 1,
    actionSeq: 0,
    result: { winnerSeat: summary.result === "win" ? "player1" : "player2", reason: "dev_test" },
    players
  };
  view.state = {
    status: "finished",
    turn: { activeSeat: "player1", number: 1, startedAtMs: Date.now(), deadlineAtMs: Date.now() + 60_000, actionSeq: 0 },
    result: { winnerSeat: summary.result === "win" ? "player1" : "player2", reason: "dev_test" },
    player1: players.player1,
    player2: players.player2
  };
  view.rewardSummary = summary;
  startRewardAnimation(view, render);
  render();
}

function devTestPublicPlayer(seat: Seat, displayName: string, handCount: number, manaCurrent: number, manaMax: number): PublicPlayer {
  return {
    userId: `dev-${seat}`,
    displayName,
    connected: true,
    hero: { hp: 30, maxHp: 30 },
    mana: { current: manaCurrent, max: manaMax },
    handCount,
    deckCount: 0,
    graveyardCount: 0,
    mulliganReady: true,
    board: []
  };
}

async function startAiMatch(options: { withTheme?: boolean } = {}): Promise<void> {
  const { withTheme = true } = options;
  if (view.joining || view.room) return;
  if (!view.aiDifficultySelected) return;
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
          ...selectedDeckJoinOptions(),
          difficulty: view.aiDifficulty,
          ...(withTheme ? { theme: view.aiTheme } : {})
        }
      : {
          displayName: view.profile?.display_name ?? "Player",
          ...selectedDeckJoinOptions(),
          difficulty: view.aiDifficulty,
          ...(withTheme ? { theme: view.aiTheme } : {})
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
          ...selectedDeckJoinOptions(),
          private: true
        }
      : { displayName: view.profile?.display_name ?? "Player", ...selectedDeckJoinOptions(), private: true };
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
          ...selectedDeckJoinOptions(),
          joinCode: code
        }
      : { displayName: view.profile?.display_name ?? "Player", ...selectedDeckJoinOptions(), joinCode: code };
    const room = await client.joinOrCreate("pvp", joinOptions, GameStateSchema);
    bindRoomMessages(room);
  } catch (error) {
    showAlert(error instanceof Error ? error.message : "找不到對應的房間代碼。");
  } finally {
    view.joining = false;
    render();
  }
}

function bindRoomMessages(joined: Room, options: { persist?: boolean; serverUrl?: string } = {}): void {
  trainingSession = undefined;
  view.room = joined;
  resetMinionVisualTracking();
  resetRewardScreen(view);
  if (rewardFallbackTimer !== undefined) {
    window.clearTimeout(rewardFallbackTimer);
    rewardFallbackTimer = undefined;
  }
  view.eventStatus = undefined;
  view.publicSync = undefined;
  view.amplificationOptions = undefined;
  resetSpecialPhaseUiState();
  view.presence.clear();
  stopOpponentDisconnectTick();
  view.rejectedHandIds.clear();
  view.turnAnnouncement = undefined;
  lastTurnAnnouncementKey = undefined;
  (window as any).__room = joined;

  if (options.persist !== false) {
    persistActiveMatch(joined, options.serverUrl ?? defaultServerUrl);
  }

  joined.onStateChange((nextState: any) => {
    if (!activateRoomStateWhenReady(nextState)) return;
  });
  activateRoomStateWhenReady(joined.state);
  joined.onMessage("seat", (message: { seat: Seat }) => {
    view.mySeat = message.seat;
    render();
  });
  joined.onMessage("hand", (message: { seat?: Seat; cards: HandCardView[] }) => {
    handleHandMessage(message);
  });
  joined.onMessage("presence", (message: { seat: Seat; connected: boolean; reconnectUntilMs?: number }) => {
    handlePresenceMessage(message);
  });
  joined.onMessage(
    "publicSync",
    (message: {
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
    }) => {
      applyPublicSync(message);
    }
  );
  joined.onMessage("amplificationOptions", (message: { options: AmplificationOption[] }) => {
    handleAmplificationOptionsMessage(message.options ?? []);
  });
  joined.onMessage("events", (message: GameEvent[]) => {
    handleEvents(message);
  });
  joined.onMessage("error", (message: { message?: string }) => {
    showAlert(message?.message ?? "Room error.");
  });
  joined.onMessage("reward_summary", (message: RewardSummary) => {
    view.rewardSummary = message;
    // Keep local profile in sync with the server-confirmed deltas so reopening
    // the lobby reflects the new gold/xp/level immediately.
    if (view.profile && message.result === "win") {
      view.profile = {
        ...view.profile,
        gold: message.gold.after,
        xp: message.xp.after,
        level: message.level.after
      };
    }
    startRewardAnimation(view, render);
    render();
  });
}

function handleHandMessage(message: { seat?: Seat; cards: HandCardView[] }): void {
  // A reconnected client gets its hand before any "seat" message; re-learn the
  // seat from it so the board renders from the correct perspective.
  if (message.seat && !view.mySeat) view.mySeat = message.seat;
  handleHandSync(message.cards);
}

function handleAmplificationOptionsMessage(options: AmplificationOption[]): void {
  if (view.amplificationRerollStage === "out") {
    view.pendingAmplificationOptions = options;
    const startedAt = view.amplificationRerollStartedAtMs ?? performance.now();
    scheduleApplyAmplificationReroll(Math.max(0, AMP_REROLL_FLIP_OUT_MS - (performance.now() - startedAt)));
    render();
    return;
  }
  view.amplificationOptions = options;
  view.pendingAmplificationOptions = undefined;
  render();
}

function scheduleApplyAmplificationReroll(delayMs: number): void {
  if (amplificationRerollTimer !== undefined) window.clearTimeout(amplificationRerollTimer);
  amplificationRerollTimer = window.setTimeout(() => {
    amplificationRerollTimer = undefined;
    if (!view.pendingAmplificationOptions) return;
    view.amplificationOptions = view.pendingAmplificationOptions;
    view.pendingAmplificationOptions = undefined;
    view.amplificationRerollStage = "in";
    render();
    amplificationRerollTimer = window.setTimeout(() => {
      amplificationRerollTimer = undefined;
      view.amplificationRerollStage = undefined;
      view.amplificationRerollStartedAtMs = undefined;
      render();
    }, AMP_REROLL_FLIP_IN_MS);
  }, delayMs);
}

function resetSpecialPhaseUiState(): void {
  view.specialPhasePeek = false;
  view.amplificationRerollStage = undefined;
  view.amplificationRerollStartedAtMs = undefined;
  view.pendingAmplificationOptions = undefined;
  if (amplificationRerollTimer !== undefined) {
    window.clearTimeout(amplificationRerollTimer);
    amplificationRerollTimer = undefined;
  }
}

function handlePresenceMessage(message: { seat: Seat; connected: boolean; reconnectUntilMs?: number }): void {
  view.presence.set(message.seat, { connected: message.connected, reconnectUntilMs: message.reconnectUntilMs });
  refreshOpponentDisconnectTick();
  render();
}

function isOpponentDisconnected(): boolean {
  const me = view.mySeat;
  if (!me || !view.room) return false;
  const presence = view.presence.get(otherSeat(me));
  return Boolean(presence && presence.connected === false);
}

function refreshOpponentDisconnectTick(): void {
  if (isOpponentDisconnected()) startOpponentDisconnectTick();
  else stopOpponentDisconnectTick();
}

function startOpponentDisconnectTick(): void {
  if (view.opponentDisconnectTimer !== undefined) return;
  view.opponentDisconnectTimer = window.setInterval(() => {
    if (!isOpponentDisconnected()) {
      stopOpponentDisconnectTick();
      return;
    }
    render();
  }, 1000);
}

function stopOpponentDisconnectTick(): void {
  if (view.opponentDisconnectTimer !== undefined) {
    window.clearInterval(view.opponentDisconnectTimer);
    view.opponentDisconnectTimer = undefined;
  }
}

function persistActiveMatch(joined: Room, serverUrl: string): void {
  const token = (joined as any).reconnectionToken as string | undefined;
  if (!token) return;
  const mode = joined.name === "pvp" ? "pvp" : "pve";
  rememberActiveMatch({ token, serverUrl, matchId: joined.roomId, mode });
  startActiveMatchHeartbeat();
}

let activeMatchHeartbeat: number | undefined;

function startActiveMatchHeartbeat(): void {
  if (activeMatchHeartbeat !== undefined) return;
  // Keep the stored record's timestamp fresh while the match is live so a hard
  // refresh leaves a savedAtMs close to the real disconnect time.
  activeMatchHeartbeat = window.setInterval(() => {
    if (!view.room) {
      stopActiveMatchHeartbeat();
      return;
    }
    touchActiveMatch();
  }, 10_000);
}

function stopActiveMatchHeartbeat(): void {
  if (activeMatchHeartbeat !== undefined) {
    window.clearInterval(activeMatchHeartbeat);
    activeMatchHeartbeat = undefined;
  }
}

function forgetActiveMatch(): void {
  clearActiveMatch();
  stopActiveMatchHeartbeat();
  stopOpponentDisconnectTick();
}

/**
 * On returning to the main screen, offer to reconnect to a match that was left
 * mid-game (tab close / F5). Declining is a loss; the win rate counts it.
 */
async function maybePromptResumeMatch(): Promise<void> {
  if (view.room || view.joining) return;
  const rec = readActiveMatch();
  if (!rec) return;
  // PvP reconnection needs an authenticated session; if there's none we can't
  // rejoin — the server's disconnect timeout already records the loss.
  if (rec.mode === "pvp" && supabase && !view.session) {
    forgetActiveMatch();
    return;
  }
  if (!isActiveMatchFresh(rec)) {
    // The room is almost certainly gone and the server has already finalized the
    // match as a loss; just refresh stats silently.
    forgetActiveMatch();
    if (supabase && view.session) await loadAccountData();
    return;
  }
  const resume = await themedConfirm({
    title: "尚未結束的對戰",
    message: "你仍有一場對戰尚未結束。要重新連線回到對戰嗎？選擇「否」將判定為落敗。",
    confirmLabel: "重新連線",
    cancelLabel: "否，放棄對戰"
  });
  if (resume) await resumeMatch(rec);
  else await declineMatch(rec);
}

async function resumeMatch(rec: ActiveMatchRecord): Promise<void> {
  view.joining = true;
  render();
  try {
    const client = new Client(rec.serverUrl);
    const joined: Room = await (client as any).reconnect(rec.token, GameStateSchema);
    bindRoomMessages(joined, { serverUrl: rec.serverUrl });
  } catch {
    // Window expired or room closed — the loss is already recorded server-side.
    forgetActiveMatch();
    showAlert("這場對戰已經結束。");
    if (supabase && view.session) await loadAccountData();
  } finally {
    view.joining = false;
    render();
  }
}

async function declineMatch(rec: ActiveMatchRecord): Promise<void> {
  // Reconnect just long enough to concede so the match resolves at once (and a
  // waiting PvP opponent is freed). If the room is gone, the server's disconnect
  // timeout has already recorded the loss.
  try {
    const client = new Client(rec.serverUrl);
    const joined: Room = await (client as any).reconnect(rec.token, GameStateSchema);
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    const message: ClientCommandMessage = {
      commandId: `decline-${createClientId()}`,
      expectedActionSeq: 0,
      command: { type: "concede" }
    };
    joined.send("command", message);
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    await joined.leave(true);
  } catch {
    // Already finalized server-side; nothing to do.
  }
  forgetActiveMatch();
  if (supabase && view.session) await loadAccountData();
}

function renderOpponentDisconnectOverlay(status: GameStatus | ""): string {
  if (!view.room || status === "finished" || status === "abandoned") return "";
  const me = view.mySeat;
  if (!me) return "";
  const presence = view.presence.get(otherSeat(me));
  if (!presence || presence.connected !== false) return "";
  const remainingMs = presence.reconnectUntilMs ? presence.reconnectUntilMs - Date.now() : 0;
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `
    <section class="opponent-disconnect-overlay" data-testid="opponent-disconnect-overlay" role="status" aria-live="polite">
      <div class="opponent-disconnect-card">
        <div class="opponent-disconnect-title">對手已斷線</div>
        <div class="opponent-disconnect-sub">等待對手重新連線…</div>
        <div class="opponent-disconnect-countdown" data-testid="opponent-disconnect-countdown">${seconds}</div>
        <div class="opponent-disconnect-hint">倒數結束後對手未回來，將判定你獲勝</div>
      </div>
    </section>
  `;
}

function isMatchStateReady(state: any): boolean {
  return typeof state?.matchId === "string" && state.matchId.length > 0;
}

function activateRoomStateWhenReady(nextState: any): boolean {
  if (view.matchmaking && !isMatchStateReady(nextState)) {
    render();
    return false;
  }
  if (view.matchmaking) {
    view.matchmaking = undefined;
    stopMatchmakingTick();
  }
  if (nextState) {
    view.state = nextState;
    publishDebugState();
    pruneSelections();
  }
  render();
  return true;
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
    const { error } = await supabase.from("profiles").update({ display_name: name, display_name_set: true }).eq("user_id", view.session!.user.id);
    if (error) throw error;
    showToast("個人資料已更新。");
    view.editingDisplayName = undefined;
    view.editingDisplayNameActive = false;
    await loadAccountDataRaw();
  });
}

async function savePlayerId(event: Event): Promise<void> {
  event.preventDefault();
  if (!supabase || !view.session?.user) return;
  const name = (document.querySelector<HTMLInputElement>("#player-id-input")?.value ?? "").trim();
  if (!name) {
    showAlert("玩家 ID 不能為空。");
    return;
  }
  await withAccountLoading(async () => {
    const { error } = await supabase.from("profiles").update({ display_name: name, display_name_set: true }).eq("user_id", view.session!.user.id);
    if (error) throw error;
    view.editingDisplayName = undefined;
    showToast("玩家 ID 已設定。");
    await loadAccountDataRaw();
  });
}

async function pickAvatar(slug: string | undefined): Promise<void> {
  if (!supabase || !view.session?.user || !slug) return;
  await withAccountLoading(async () => {
    const { error } = await supabase.rpc("select_user_cosmetic", { p_kind: "avatar", p_cosmetic_id: slug });
    if (error) throw error;
    showToast("頭像已更新。");
    view.avatarPickerOpen = false;
    await loadAccountDataRaw();
  });
}

async function pickGoogleAvatar(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  const avatarUrl = googleProfileAvatarUrl();
  if (!avatarUrl) return;
  await withAccountLoading(async () => {
    const { error } = await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("user_id", view.session!.user.id);
    if (error) throw error;
    showToast("頭像已更新。");
    view.avatarPickerOpen = false;
    await loadAccountDataRaw();
  });
}

async function pickTitle(id: string | undefined): Promise<void> {
  if (!supabase || !view.session?.user || !id) return;
  await withAccountLoading(async () => {
    const { error } = await supabase.rpc("select_user_cosmetic", { p_kind: "title", p_cosmetic_id: id });
    if (error) throw error;
    showToast("稱號已更新。");
    view.titlePickerOpen = false;
    await loadAccountDataRaw();
  });
}

async function resetBetaDatabaseFromSettings(): Promise<void> {
  if (!betaDbResetEnabled || view.accountLoading) return;
  const ok = await themedConfirm({
    title: "清除測試版 DB",
    message: "這會刪除所有測試帳號與玩家資料，且無法復原。",
    confirmLabel: "清除 DB",
    danger: true
  });
  if (!ok) return;
  const token = window.prompt("請輸入重置 token");
  if (!token) return;

  await withAccountLoading(async () => {
    const response = await fetch(`${serverHttpUrl()}/admin/beta-reset-db`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-reset-token": token
      },
      body: JSON.stringify({ token })
    });
    const payload = (await response.json().catch(() => undefined)) as { ok?: boolean; error?: string } | undefined;
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error ?? "DB reset failed.");

    await supabase?.auth.signOut().catch((error) => console.warn("sign out after beta DB reset failed", error));
    view.session = null;
    view.profile = undefined;
    view.decks = [];
    view.collection = [];
    view.matchHistory = [];
    remoteTrainingCompletions = new Set();
    view.selectedDeckId = undefined;
    view.settingsOpen = false;
    showToast("DB 資料已清除，請重新登入。");
  });
}

function bindSelectionActions(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-hand-id]")) {
    on(el, "dragstart", "hand-native-drag", (event) => {
      event.preventDefault();
    });
    on(el, "pointerdown", "hand-drag", (event) => {
      if (isBattleActionLocked() || view.pendingBattlecry) return;
      if (!trainingCanSelectHand(trainingSession, el.dataset.handId)) {
        showBattleToast("這一步只能使用教學指定的牌。");
        return;
      }
      event.preventDefault();
      clearHoverTooltip();
      attachHandPointerDrag(event, el);
    });
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-attacker-id]")) {
    on(el, "click", "attacker-select", (event) => {
      if (isBattleActionLocked() || view.pendingBattlecry) return;
      event.stopImmediatePropagation();
      if (!trainingCanSelectAttacker(trainingSession, el.dataset.attackerId)) {
        showBattleToast("這一步只能選教學指定的隨從。");
        return;
      }
      const reason = attackerError(findMinion(el.dataset.attackerId ?? ""));
      if (reason) {
        showBattleToast(reason);
        return;
      }
      view.selectedAttackerId = el.dataset.attackerId;
      view.selectedHandId = undefined;
      view.selectedTarget = undefined;
      render();
    });
    on(el, "pointerdown", "attacker-drag", (event) => {
      if (isBattleActionLocked() || view.pendingBattlecry) return;
      if (!trainingCanSelectAttacker(trainingSession, el.dataset.attackerId)) {
        showBattleToast("這一步只能選教學指定的隨從。");
        return;
      }
      clearHoverTooltip();
      attachAttackerPointerDrag(event, el);
    });
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-testid='board-minion']")) {
    bindHoverPreview(el, () => minionCardFromElement(el));
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-augment-id]")) {
    bindAugmentHover(el);
    on(el, "pointerdown", "augment-pointer-isolate", (event) => {
      event.stopPropagation();
    });
    on(el, "click", "augment-click-isolate", (event) => {
      event.stopPropagation();
    });
  }

  for (const el of document.querySelectorAll<HTMLElement>("[data-target]")) {
    on(el, "click", "target-select", () => {
      if (isBattleActionLocked() || view.pendingBattlecry) return;
      const target = parseTargetAttr(el);
      if (!target) return;
      if (view.selectedAttackerId) {
        const reason = attackTargetError(target);
        if (reason) {
          showBattleToast(reason);
          return;
        }
        send({ type: "attack", attackerInstanceId: view.selectedAttackerId, target });
        view.selectedAttackerId = undefined;
        view.selectedHandId = undefined;
        view.selectedTarget = undefined;
        render();
        return;
      }
      const card = selectedHandCard();
      if (card && handCardNeedsTarget(card)) {
        const reason = cardTargetError(target);
        if (reason) {
          showBattleToast(reason);
          return;
        }
        send({ type: "playCard", handInstanceId: card.instanceId, target });
        view.selectedAttackerId = undefined;
        view.selectedHandId = undefined;
        view.selectedTarget = undefined;
        render();
        return;
      }
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
    on(el, "click", "mulligan-select", () => {
      const id = el.dataset.mulliganId;
      if (!id) return;
      if (view.mulliganSelection.has(id)) view.mulliganSelection.delete(id);
      else view.mulliganSelection.add(id);
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-special-peek]")) {
    on(el, "click", "special-phase-peek", () => {
      view.specialPhasePeek = true;
      view.selectedAttackerId = undefined;
      view.selectedHandId = undefined;
      view.selectedTarget = undefined;
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-special-return]")) {
    on(el, "click", "special-phase-return", () => {
      view.specialPhasePeek = false;
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-amp-reroll]")) {
    on(el, "click", "reroll-amplification", () => {
      if (view.amplificationRerollStage) return;
      view.amplificationRerollStage = "out";
      view.amplificationRerollStartedAtMs = performance.now();
      view.pendingAmplificationOptions = undefined;
      send({ type: "rerollAmplification" });
      render();
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-amp-id]")) {
    on(el, "click", "select-amplification", () => {
      const optionId = el.dataset.ampId;
      if (!optionId) return;
      send({ type: "selectAmplification", optionId });
    });
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-vote-index]")) {
    on(el, "click", "submit-vote", () => {
      const optionIndex = Number(el.dataset.voteIndex);
      if (!Number.isInteger(optionIndex)) return;
      send({ type: "submitVote", optionIndex: optionIndex as 0 | 1 | 2 });
    });
  }
}

const hoverState: { timer?: number; lastCardId?: string; lastEl?: HTMLElement } = {};
const augmentHoverState: { timer?: number; lastEl?: HTMLElement } = {};

function bindHoverPreview(el: HTMLElement, resolve: () => ResolvedCardView | undefined): void {
  const hoverCapable = typeof window !== "undefined" && (
    (typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches) ||
    (window as any).__el !== undefined
  );
  if (!hoverCapable) return;
  on(el, "mouseenter", "hover-preview-enter", (event) => {
    if (view.confirmingConcede) return;
    // No hover-enlarge preview while aiming a battlecry — the arrow passing over
    // a card must not pop its preview open.
    if (view.pendingBattlecry) return;
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
  on(el, "mouseleave", "hover-preview-leave", () => {
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
  window.clearTimeout(augmentHoverState.timer);
  augmentHoverState.timer = undefined;
  augmentHoverState.lastEl = undefined;
  if (view.hoveredCardId) {
    view.hoveredCardId = undefined;
    view.hoveredCard = undefined;
    view.hoverAnchor = undefined;
  }
  if (view.hoveredAugment) {
    view.hoveredAugment = undefined;
    view.augmentHoverAnchor = undefined;
  }
}

function bindAugmentHover(el: HTMLElement): void {
  const hoverCapable = typeof window !== "undefined" && (
    (typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches) ||
    (window as any).__el !== undefined
  );
  if (!hoverCapable) return;
  on(el, "mouseenter", "augment-hover-enter", () => {
    if (view.confirmingConcede || view.pendingBattlecry) return;
    const augment = augmentFromElement(el);
    if (!augment) return;
    window.clearTimeout(augmentHoverState.timer);
    augmentHoverState.lastEl = el;
    const rect = el.getBoundingClientRect();
    const anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
    augmentHoverState.timer = window.setTimeout(() => {
      if (augmentHoverState.lastEl !== el) return;
      view.hoveredAugment = augment;
      view.augmentHoverAnchor = anchor;
      render();
    }, 120);
  });
  on(el, "mouseleave", "augment-hover-leave", () => {
    if (augmentHoverState.lastEl === el) augmentHoverState.lastEl = undefined;
    window.clearTimeout(augmentHoverState.timer);
    augmentHoverState.timer = undefined;
    if (view.hoveredAugment) {
      view.hoveredAugment = undefined;
      view.augmentHoverAnchor = undefined;
      render();
    }
  });
}

function augmentFromElement(el: HTMLElement): (AmplificationSelection & { description?: string }) | undefined {
  const augmentId = el.dataset.augmentId;
  const seat = el.closest<HTMLElement>(".hero-frame")?.dataset.seat as Seat | undefined;
  if (!augmentId || !seat) return undefined;
  const player = readPlayer(seat);
  const selected = (player?.augments?.length ? player.augments : player?.amplification ? [player.amplification] : []).find((augment) => augment.id === augmentId);
  if (!selected) return undefined;
  return { ...selected, description: amplificationCatalog.get(augmentId)?.description };
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
    baseHealth: catalogCard?.health
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

/**
 * The source can't be dragged (e.g. not enough mana, a minion that can't attack
 * yet). Rather than silently swallowing the gesture, wait for a real drag
 * attempt — a press alone could just be an inspect/select — then surface the
 * reason as a battle toast. A simple tap never crosses the threshold, so it
 * won't spam the hint.
 */
function attachRejectedDrag(event: PointerEvent, reason: string): void {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;
  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
  };
  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) return;
    cleanup();
    showBattleToast(reason);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
}

function attachHandPointerDrag(event: PointerEvent, sourceEl: HTMLElement): void {
  if (isBattleActionLocked() || view.pendingBattlecry) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const handId = sourceEl.dataset.handId;
  if (!handId) return;
  if (!trainingCanSelectHand(trainingSession, handId)) {
    attachRejectedDrag(event, "這一步只能使用教學指定的牌。");
    return;
  }
  const card = view.hand.find((item) => item.instanceId === handId);
  if (!card) return;
  if (!canAfford(card.cost)) {
    attachRejectedDrag(event, cardPlayError(card) ?? "現在無法使用這張牌。");
    return;
  }
  const cardDef = cardCatalog.get(card.cardId);
  const isMinion = (cardDef?.type ?? card.type) === "MINION";
  // Targeted-battlecry cards are played in two stages (LEGACY v1 parity): the
  // drop just places the card; the effect target is aimed afterwards. The drag
  // is therefore always placement-only — no arrow snapping during the drag.
  const isTargeted = handCardNeedsTarget(card);
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
    view.draggingHandId = handId;
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
      needsTarget: false,
      isMinion,
      playerBoardEl,
      isEligibleTarget: () => false,
      onResolve: ({ insertionIndex }) => {
        if (isBattleActionLocked() || view.pendingBattlecry) {
          finalizeHandDrag(undefined);
          return;
        }
        // Minions must land on the board; dropping off-board returns to hand.
        if (isMinion && insertionIndex < 0) {
          finalizeHandDrag(undefined);
          return;
        }
        if (isTargeted) {
          // Stage 2: card is on the field, now aim the battlecry arrow.
          enterBattlecryTargeting(card, isMinion ? insertionIndex : -1, lineKind);
          return;
        }
        send({
          type: "playCard",
          handInstanceId: handId,
          target: inferDefaultTarget(card.cardId),
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
  view.draggingHandId = undefined;
  view.selectedTarget = undefined;
  render();
}

// Timers and overlay node for the client-side card-play animation that
// precedes the battlecry arrow.
let battlecryLandTimers: number[] = [];
let battlecryLandEl: HTMLElement | null = null;
// `performance.now()` of the most recent local battlecry landing animation
// start. Used by `applyPostPlayEffectDelays` to keep the suppressed-play branch
// gated symmetrically with the normal branch (effects wait until the local
// overlay + dust have settled).
let battlecryLocalLandingStartMs: number | undefined;

/**
 * Stage 2 of a targeted-battlecry play (LEGACY v1 parity). A battlecry card is
 * played exactly like any other card: drop → card-play animation → land on the
 * field. Only once it has landed is a separate targeting arrow shown. No
 * `playCard` command is sent until a legal target is clicked — see
 * `commitBattlecry` / `cancelBattlecry`.
 */
function enterBattlecryTargeting(card: HandCardView, boardIndex: number, lineKind: DragLineKind): void {
  // "如果沒有目標 就不能出手" — with no legal target on the field the card
  // cannot be played at all; leave it untouched in hand (no animation).
  if (!hasLegalTargetForCard(card.cardId)) {
    showToast("目前沒有合法的目標！");
    finalizeHandDrag(undefined);
    return;
  }

  const isMinion = (cardCatalog.get(card.cardId)?.type ?? card.type) === "MINION";
  clearHoverTooltip();
  view.selectedHandId = undefined;
  view.draggingHandId = undefined;
  view.selectedAttackerId = undefined;
  view.selectedTarget = undefined;
  view.pendingBattlecry = {
    handInstanceId: card.instanceId,
    cardId: card.cardId,
    isMinion,
    boardIndex,
    boardInstanceIdsBefore: Array.from(readPlayer(view.mySeat ?? "player1")?.board ?? [])
      .map((minion) => minion.instanceId),
    lineKind,
    phase: "landing"
  };
  view.acceptedBattlecry = undefined;
  blog("set pending=landing", {
    handInstanceId: card.instanceId,
    cardId: card.cardId,
    isMinion,
    boardIndex
  });
  render(); // hides the hand card while the card-play animation runs

  // Phase 1: the same card-play animation every card gets, then the arrow.
  playBattlecryLandAnimation(card.cardId, () => {
    const pending = view.pendingBattlecry;
    if (!pending || pending.handInstanceId !== card.instanceId || pending.phase !== "landing") return;
    pending.phase = "aiming";
    blog("phase landing→aiming", { handInstanceId: card.instanceId, cardId: card.cardId });
    render(); // the card is now on the field
    triggerBattlecryLandImpact(card.cardId); // board slam + dust, like any card
    showToast(isMinion ? "請選擇觸發的目標！" : "請選擇目標！");
    beginBattlecryTargeting({
      lineKind,
      getAnchor: battlecryAnchor,
      isEligibleTarget: (el) => {
        const target = parseTargetAttr(el);
        return Boolean(target && isLegalCardTarget(target));
      },
      onCommit: (el) => commitBattlecry(el),
      onInvalid: (el) => showBattleToast(cardTargetError(parseTargetAttr(el)) ?? "這不是有效的目標！"),
      onCancel: () => cancelBattlecry()
    });
  });
}

/**
 * Plays the standard card-play animation (the `#card-play-overlay` entrance +
 * slam, mirroring `playNextCardPlayCue`) for a card being played locally, then
 * invokes `onLanded`. Used so a battlecry card looks identical to any other.
 */
function playBattlecryLandAnimation(cardId: string, onLanded: () => void): void {
  const card = cardCatalog.get(cardId);
  if (!card) {
    onLanded();
    return;
  }
  battlecryLocalLandingStartMs = performance.now();
  const overlay = ensureCardPlayOverlay();
  const el = document.createElement("div");
  el.className = "event-card-preview card from-player";
  const resolved = resolveCatalogCard(card, `battlecry-${cardId}`);
  applyVisibleNewsPowerPreview(card, resolved, view.mySeat);
  el.innerHTML = renderCardFace(resolved, "mulligan");
  overlay.appendChild(el);
  battlecryLandEl = el;
  battlecryLandTimers.push(window.setTimeout(() => el.classList.add("card-play-slam"), 800));
  battlecryLandTimers.push(window.setTimeout(onLanded, 1100));
  battlecryLandTimers.push(
    window.setTimeout(() => {
      el.remove();
      if (battlecryLandEl === el) battlecryLandEl = null;
    }, 1300)
  );
}

/**
 * The board slam + dust puff a minion makes on landing, mirroring
 * `impactCardPlayLanding` so a battlecry minion lands like any other minion.
 */
function triggerBattlecryLandImpact(cardId: string): void {
  const card = cardCatalog.get(cardId);
  window.requestAnimationFrame(() => {
    playSfx(card && card.cost >= 8 ? "cardPlayHeavy" : "cardPlay");
    if (!card || card.type !== "MINION") return;
    slamBoard(view.mySeat);
    const anchor =
      document.querySelector<HTMLElement>('[data-testid="battlecry-preview"]') ??
      document.querySelector<HTMLElement>('[data-testid="player-board"]');
    if (anchor) spawnBoardDust(anchor, card.cost >= 7 ? 2.5 : 1);
  });
}

/** Live screen-space origin of the battlecry arrow (the landed card / hero). */
function battlecryAnchor(): { x: number; y: number } | null {
  const pending = view.pendingBattlecry;
  if (!pending) return null;
  const selector = pending.isMinion
    ? '[data-testid="battlecry-preview"]'
    : '[data-testid="player-hero"]';
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** A legal target was picked — send the single atomic `playCard` command. */
function commitBattlecry(targetEl: HTMLElement): void {
  const pending = view.pendingBattlecry;
  if (!pending) return;
  const target = parseTargetAttr(targetEl);
  if (!target || !isLegalCardTarget(target)) {
    cancelBattlecry();
    return;
  }
  // The card-play animation already ran locally; suppress the server's echo so
  // the card does not appear to play a second time.
  suppressedPlayCues.push({ seat: view.mySeat, cardId: pending.cardId });
  pending.phase = "committed";
  view.acceptedBattlecry = { ...pending };
  blog("battlecry committed preview handoff start", {
    handInstanceId: pending.handInstanceId,
    cardId: pending.cardId,
    boardIndex: pending.boardIndex
  });
  blog("phase aiming→committed; accepted=set", {
    handInstanceId: pending.handInstanceId,
    cardId: pending.cardId,
    boardIndex: pending.boardIndex,
    currentBoardIds: Array.from(readPlayer(view.mySeat ?? "player1")?.board ?? [])
      .map((minion) => minion.instanceId)
  });
  endBattlecryTargeting();
  renderNow();
  send({
    type: "playCard",
    handInstanceId: pending.handInstanceId,
    target,
    boardIndex: pending.isMinion && pending.boardIndex >= 0 ? pending.boardIndex : undefined
  });
}

/** Silently tears down any pending battlecry — used on cancel and on teardown. */
function clearPendingBattlecry(): void {
  if (view.pendingBattlecry || view.acceptedBattlecry || battlecryLandEl) {
    blog("clear pending+accepted", {
      hadPending: Boolean(view.pendingBattlecry),
      hadAccepted: Boolean(view.acceptedBattlecry),
      hadLandEl: Boolean(battlecryLandEl),
      caller: new Error().stack?.split("\n")[2]?.trim()
    });
  }
  endBattlecryTargeting();
  for (const timer of battlecryLandTimers) window.clearTimeout(timer);
  battlecryLandTimers = [];
  battlecryLandEl?.remove();
  battlecryLandEl = null;
  battlecryLocalLandingStartMs = undefined;
  view.pendingBattlecry = undefined;
  view.acceptedBattlecry = undefined;
}

/** "如果點其他地方 如地板 就回手" — abort with no command sent. */
function cancelBattlecry(): void {
  const pending = view.pendingBattlecry;
  if (!pending) return;
  clearPendingBattlecry();
  showToast(pending.isMinion ? "取消出牌 (隨從已退回)" : "操作已取消");
  render();
}

function attachAttackerPointerDrag(event: PointerEvent, sourceEl: HTMLElement): void {
  if (isBattleActionLocked() || view.pendingBattlecry) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (sourceEl.dataset.cardType !== "MINION") return;
  const attackerId = sourceEl.dataset.attackerId;
  if (!attackerId) return;
  const minion = findMinion(attackerId);
  const reason = attackerError(minion);
  if (reason) {
    attachRejectedDrag(event, reason);
    return;
  }
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

    // Keep target validation tied to this gesture. A state sync can clear the
    // UI selection while the pointer is still down.
    beginAttackDrag({
      pointerId,
      sourceEl,
      isEligibleTarget: (targetEl) => {
        const target = parseTargetAttr(targetEl);
        return Boolean(target && isLegalAttackTarget(target, attackerId));
      },
      onResolve: (targetEl) => {
        if (isBattleActionLocked()) {
          view.selectedAttackerId = undefined;
          view.selectedTarget = undefined;
          render();
          return;
        }
        const target = parseTargetAttr(targetEl);
        if (target && isLegalAttackTarget(target, attackerId)) {
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

async function backToLobby(): Promise<void> {
  const room = view.room;
  if (rewardFallbackTimer !== undefined) {
    window.clearTimeout(rewardFallbackTimer);
    rewardFallbackTimer = undefined;
  }
  resetRewardScreen(view);
  trainingSession = undefined;
  view.room = undefined;
  view.mySeat = undefined;
  view.hand = [];
  view.state = undefined;
  view.publicSync = undefined;
  view.presence.clear();
  view.rejectedHandIds.clear();
  view.turnAnnouncement = undefined;
  lastTurnAnnouncementKey = undefined;
  clearPendingBattlecry();
  view.selectedHandId = undefined;
  view.mulliganSelection.clear();
  view.selectedAttackerId = undefined;
  view.selectedTarget = undefined;
  view.events = [];
  resetBattleLog();
  view.animationCues = [];
  resetMinionVisualTracking();
  resetCardPlayCues();
  view.eventStatus = undefined;
  view.toast = undefined;
  if (battleToastTimer !== undefined) {
    clearTimeout(battleToastTimer);
    battleToastTimer = undefined;
  }
  view.matchmaking = undefined;
  view.privateJoinCode = undefined;
  stopMatchmakingTick();
  forgetActiveMatch();
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
          ...selectedDeckJoinOptions()
        }
      : { displayName, ...selectedDeckJoinOptions() };
    const joined: Room = reconnectToken
      ? await (client as any).reconnect(reconnectToken, GameStateSchema)
      : await client.joinOrCreate("pvp", joinOptions, GameStateSchema);

    bindRoomMessages(joined, { serverUrl });
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
      remoteTrainingCompletions = new Set();
      view.selectedDeckId = undefined;
      view.editingDeck = undefined;
      view.menuScreen = "main";
      render();
    }
  });
  render();
}

function setAuthMode(mode: AuthMode): void {
  if (view.accountLoading || view.authMode === mode) return;
  view.authMode = mode;
  render();
}

function needsPlayerIdSetup(): boolean {
  return view.profile?.display_name_set === false;
}

function submitAuthForm(event: Event): void {
  event.preventDefault();
  if (view.authMode === "signup") {
    void signUpWithPassword();
    return;
  }
  void signInWithPassword();
}

async function signInWithPassword(): Promise<void> {
  if (!supabase) return;
  const credentials = readAuthFields();
  if (!credentials) return;
  await withAccountLoading(async () => {
    const { error } = await supabase.auth.signInWithPassword(credentials);
    if (error) throw error;
    pendingWelcomeToast = true;
  });
}

async function signUpWithPassword(): Promise<void> {
  if (!supabase) return;
  const credentials = readSignUpFields();
  if (!credentials) return;
  const { email, password } = credentials;
  await withAccountLoading(async () => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: email.split("@")[0] || "Player" } }
    });
    if (error) throw error;
    const signOutResult = await supabase.auth.signOut();
    if (signOutResult.error) console.warn("sign out after sign-up failed", signOutResult.error);
    view.session = undefined;
    view.authMode = "signin";
    showToast("帳號已建立，請確認信箱後重新登入。");
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
    const [profileResult, decksResult, collectionResult, historyResult, trainingResult] = await Promise.all([
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
        .order("card_id", { ascending: true }),
      supabase
        .from("match_history")
        .select("id,winner_seat,result_reason,created_at,finished_at,player1_user_id,player2_user_id")
        .order("finished_at", { ascending: false })
        .limit(20),
      supabase
        .from("user_training_completions")
        .select("level_id")
        .eq("user_id", userId)
    ]);

    if (profileResult.error) throw profileResult.error;
    if (decksResult.error) throw decksResult.error;
    if (collectionResult.error) throw collectionResult.error;
    if (historyResult.error) throw historyResult.error;
    if (trainingResult.error) throw trainingResult.error;

    view.profile = profileResult.data as ProfileRow;
    view.decks = (decksResult.data ?? []) as DeckRow[];
    view.collection = (collectionResult.data ?? []) as CollectionRow[];
    view.matchHistory = (historyResult.data ?? []) as MatchHistoryRow[];
    syncRemoteTrainingCompletions(trainingResult.data);
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
  const [profileResult, decksResult, collectionResult, historyResult, trainingResult] = await Promise.all([
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
      .order("card_id", { ascending: true }),
    supabase
      .from("match_history")
      .select("id,winner_seat,result_reason,created_at,finished_at")
      .order("finished_at", { ascending: false })
      .limit(20),
    supabase
      .from("user_training_completions")
      .select("level_id")
      .eq("user_id", userId)
  ]);

  if (profileResult.error) throw profileResult.error;
  if (decksResult.error) throw decksResult.error;
  if (collectionResult.error) throw collectionResult.error;
  if (historyResult.error) throw historyResult.error;
  if (trainingResult.error) throw trainingResult.error;

  view.profile = profileResult.data as ProfileRow;
  view.decks = (decksResult.data ?? []) as DeckRow[];
  view.collection = (collectionResult.data ?? []) as CollectionRow[];
  view.matchHistory = (historyResult.data ?? []) as MatchHistoryRow[];
  syncRemoteTrainingCompletions(trainingResult.data);
  if (!view.selectedDeckId || !view.decks.some((deck) => deck.id === view.selectedDeckId)) {
    view.selectedDeckId = view.decks[0]?.id;
  }
  if (view.editingDeck?.id) {
    const editingDeck = view.decks.find((deck) => deck.id === view.editingDeck?.id);
    view.editingDeck = editingDeck ? { ...editingDeck, card_ids: [...editingDeck.card_ids] } : undefined;
  }
}

function syncRemoteTrainingCompletions(rows: unknown): void {
  const next = new Set<string>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const levelId = row && typeof row === "object" ? (row as Record<string, unknown>).level_id : undefined;
      if (typeof levelId === "string") {
        next.add(levelId);
        markLocalTrainingComplete(levelId);
      }
    }
  }
  remoteTrainingCompletions = next;
}

async function ensureCollection(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("ensure_starter_collection");
  if (error) throw error;
}

async function ensureProfile(): Promise<void> {
  if (!supabase || !view.session?.user) return;
  const user = view.session.user;
  const avatarUrl = googleProfileAvatarUrl() ?? FALLBACK_PROFILE_AVATAR_URL;
  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        user_id: user.id,
        display_name: "Player",
        display_name_set: false,
        avatar_url: avatarUrl,
        owned_avatars: ["avatar1"],
        owned_titles: ["beginner"],
        selected_title: "beginner"
      },
      { onConflict: "user_id", ignoreDuplicates: true }
    );
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
  for (const [cardId, quantity] of buildCollectionMap(view.collection)) {
    const card = cardCatalog.get(cardId);
    if (!card || card.collectible === false) continue;
    const extra = quantity - DECK_COPY_LIMIT;
    if (extra > 0) entries.push({ cardId, extra });
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
  const collectionMap = buildCollectionMap(view.collection);
  let legendaryCount = 0;
  for (const card of CARD_CATALOG) {
    if (card.collectible === false) continue;
    const owned = usesDbCollectionOwnership() || hasCollectionRows() ? (collectionMap.get(card.id) ?? 0) : deckCopyLimit(card);
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
  const owned = usesDbCollectionOwnership() || hasCollectionRows()
    ? (buildCollectionMap(view.collection).get(cardId) ?? 0)
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
let battleToastTimer: ReturnType<typeof setTimeout> | undefined;
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

function showBattleToast(message: string): void {
  view.toast = message;
  if (battleToastTimer !== undefined) clearTimeout(battleToastTimer);
  battleToastTimer = setTimeout(() => {
    view.toast = undefined;
    battleToastTimer = undefined;
    render();
  }, 2200);
  render();
}

function readAuthFields(): { email: string; password: string } | undefined {
  const email = document.querySelector<HTMLInputElement>("#auth-email")?.value.trim() ?? "";
  const password = document.querySelector<HTMLInputElement>("#auth-password")?.value ?? "";
  if (!email || !password) {
    showAlert("請輸入帳號與密碼。");
    return undefined;
  }
  return { email, password };
}

function readSignUpFields(): { email: string; password: string } | undefined {
  const credentials = readAuthFields();
  if (!credentials) return undefined;
  const confirmPassword = document.querySelector<HTMLInputElement>("#auth-confirm-password")?.value ?? "";
  if (!confirmPassword) {
    showAlert("請再次輸入密碼。");
    return undefined;
  }
  if (credentials.password !== confirmPassword) {
    showAlert("兩次輸入的密碼不一致。");
    return undefined;
  }
  return credentials;
}

function send(command: GameCommand): void {
  if (trainingSession) {
    if (isBattleActionCommand(command) && activeTurnAnnouncement()) return;
    applyTrainingResult(handleTrainingCommand(trainingSession, command));
    return;
  }
  if (!view.room) return;
  if (isBattleActionCommand(command) && isBattleActionLocked()) return;
  const expectedActionSeq = view.publicSync?.actionSeq ?? view.state?.turn?.actionSeq ?? 0;
  const message: ClientCommandMessage = {
    commandId: `${view.mySeat ?? "client"}-${createClientId()}`,
    expectedActionSeq,
    command
  };
  view.room.send("command", message);
  if (command.type !== "submitMulligan" && command.type !== "reconnect") {
    view.publicSync = { ...view.publicSync, actionSeq: expectedActionSeq + 1 };
  }
}

function isBattleActionCommand(command: GameCommand): boolean {
  return command.type === "playCard" || command.type === "attack" || command.type === "endTurn";
}

function activeTurnAnnouncement(): ClientViewState["turnAnnouncement"] | undefined {
  const announcement = view.turnAnnouncement;
  if (!announcement) return undefined;
  if (announcement.untilMs <= Date.now()) {
    view.turnAnnouncement = undefined;
    return undefined;
  }
  return announcement;
}

function isBattleActionLocked(): boolean {
  // Regular play/attack/endTurn are suspended while a special phase is open, or
  // briefly while a mid-turn augment glow is revealing its value change.
  return (
    readPhase() !== "NORMAL_PLAY" ||
    Boolean(activeTurnAnnouncement()) ||
    performance.now() < augmentGlowLockUntilMs ||
    trainingBlocksBattle(trainingSession)
  );
}

function maybeShowTurnAnnouncement(events: GameEvent[]): void {
  const mySeat = view.mySeat;
  if (!mySeat) return;
  const myTurnStarted = [...events].reverse().find((event) => {
    if (event.type !== "TURN_STARTED") return false;
    const activeSeat = event.seat ?? event.payload?.activeSeat;
    return activeSeat === mySeat;
  });
  if (!myTurnStarted) return;
  const key = `${myTurnStarted.seq ?? myTurnStarted.payload?.turn ?? "turn"}:${mySeat}`;
  if (lastTurnAnnouncementKey === key) return;
  lastTurnAnnouncementKey = key;
  showTurnAnnouncement("你的回合", mySeat);
}

function showTurnAnnouncement(text: string, seat: Seat): void {
  const id = createClientId();
  view.turnAnnouncement = {
    id,
    text,
    seat,
    untilMs: Date.now() + TURN_ANNOUNCEMENT_LOCK_MS
  };
  clearPendingBattlecry();
  view.selectedHandId = undefined;
  view.selectedAttackerId = undefined;
  view.selectedTarget = undefined;
  if (turnAnnouncementTimer !== undefined) window.clearTimeout(turnAnnouncementTimer);
  turnAnnouncementTimer = window.setTimeout(() => {
    if (view.turnAnnouncement?.id !== id) return;
    view.turnAnnouncement = undefined;
    turnAnnouncementTimer = undefined;
    render();
  }, TURN_ANNOUNCEMENT_LOCK_MS);
}

function resetBattleLog(): void {
  view.battleLog = [];
  battleLogMinions.clear();
}

/** Resolved art URL for a card id, or undefined if unknown. */
function cardArt(cardId: string | undefined): string | undefined {
  const image = cardId ? cardCatalog.get(cardId)?.image : undefined;
  return image ? assetUrl(image) : undefined;
}

/** Display name of a seat's hero (its owner), falling back to a relative label. */
function battleLogHeroName(seat: Seat | undefined): string {
  if (!seat) return "Hero";
  return readPlayer(seat)?.displayName || (seat === view.mySeat ? "You" : "Opponent");
}

/** Resolve a minion `instanceId` to a name + card id, using the live board then the summon cache. */
function battleLogUnit(instanceId: string): { name: string; cardId?: string } {
  const minion = findMinion(instanceId);
  if (minion) return { name: cardName(minion.cardId) ?? minion.cardId, cardId: minion.cardId };
  const cached = battleLogMinions.get(instanceId);
  if (cached) return { name: cached.name, cardId: cached.cardId };
  return { name: "a minion" };
}

/** A card ref for the log from a card id (used for the actor of summons / plays / spell damage). */
function logCardRef(cardId: string | undefined, fallback = "A minion"): BattleLogCardRef {
  return { name: cardName(cardId) ?? fallback, thumb: cardArt(cardId) };
}

/** A card ref for a minion instance id. */
function logUnitRef(instanceId: string): BattleLogCardRef {
  const unit = battleLogUnit(instanceId);
  return { name: unit.name, thumb: cardArt(unit.cardId) };
}

/** A card ref for a damage/heal/buff target string (`instanceId` or `"{seat}:hero"`). */
function logTargetRef(target: string): BattleLogCardRef {
  if (target.endsWith(":hero")) return { name: battleLogHeroName(target.split(":")[0] as Seat), hero: true };
  return logUnitRef(target);
}

/** Display name (Traditional Chinese) for a granted keyword code. */
const KEYWORD_LABEL: Record<string, string> = { taunt: "沙包", charge: "衝蹦" };

/**
 * Generic, player-facing explanation for each card keyword — what the mechanic *does*,
 * independent of the card's own `description`. Order here is the display order.
 */
const KEYWORD_GLOSSARY: { has: (k: NonNullable<CardDefinition["keywords"]>) => boolean; label: string; text: string }[] = [
  { has: (k) => Boolean(k.battlecry), label: "觸發", text: "當此隨從從手牌打出、放置在場上時會發動這個效果。" },
  { has: (k) => Boolean(k.taunt || k.baseTaunt), label: "沙包", text: "敵方必須先攻擊有沙包的隨從，才能攻擊其他目標。" },
  { has: (k) => Boolean(k.divineShield), label: "光盾", text: "第一次受到傷害時會免除該次傷害，之後光盾消失。" },
  { has: (k) => Boolean(k.charge), label: "衝蹦", text: "此隨從進場的當回合就能攻擊，不需等待。" },
  { has: (k) => Boolean(k.deathrattle), label: "遺志", text: "當此隨從死亡、離開場上時會發動這個效果。" },
  { has: (k) => Boolean(k.ongoing), label: "持續效果", text: "只要此隨從在場上，這個效果就會持續生效。" },
  { has: (k) => Boolean(k.enrage), label: "激怒", text: "當此隨從受到傷害（生命未滿）時會獲得額外效果。" },
  { has: (k) => Boolean(k.triggered), label: "觸發", text: "符合特定條件時會自動發動的效果。" },
  { has: (k) => Boolean(k.quest), label: "任務", text: "達成指定條件後完成任務並獲得獎勵。" }
];

/**
 * Side panel listing the generic explanation for each keyword the card has. Returns "" when the
 * card is unknown or has none of the glossary keywords, so callers can omit the panel entirely.
 */
function renderKeywordGlossary(cardId: string | undefined, side: "left" | "right"): string {
  const keywords = cardId ? cardCatalog.get(cardId)?.keywords : undefined;
  if (!keywords) return "";
  const rows = KEYWORD_GLOSSARY.filter((entry) => entry.has(keywords));
  if (rows.length === 0) return "";
  const items = rows
    .map(
      (entry) =>
        `<li class="keyword-glossary-item"><span class="keyword-glossary-label">${escapeHtml(entry.label)}</span><span class="keyword-glossary-text">${escapeHtml(entry.text)}</span></li>`
    )
    .join("");
  return `<aside class="keyword-glossary keyword-glossary-${side}"><ul>${items}</ul></aside>`;
}

/** A BUFF payload that locks a minion's attack is shown as a silence, not a stat buff. */
function isSilencePayload(payload: Record<string, unknown>): boolean {
  return typeof payload.lockedTurns === "number";
}

/** Concise stat-change text for a BUFF payload (e.g. "+2/+2", "光盾"). */
function buffDetail(payload: Record<string, unknown>): string {
  if (payload.shield === true) return "光盾";
  if (typeof payload.keyword === "string") return KEYWORD_LABEL[payload.keyword] ?? payload.keyword;
  if (typeof payload.lockedTurns === "number") return `鎖定 ${payload.lockedTurns} 回合`;
  if (typeof payload.setAttack === "number") return `攻擊力 → ${payload.setAttack}`;
  const value = typeof payload.value === "number" ? payload.value : 0;
  if (payload.stat === "ALL") return `+${value}/+${value}`;
  if (payload.stat === "HEALTH") return `+0/+${value}`;
  return `+${value}/+0`;
}

interface BattleLogContext {
  /** DAMAGE seqs already consumed by a preceding attack (folded into its tooltip). */
  claimedDamage: Set<number>;
  /** Attack seq → damage dealt to its target. */
  attackTargetDamage: Map<number, number>;
  /** Most recently played card id seen so far in the batch — the actor for spell/effect damage. */
  lastPlayedCardId?: string;
}

/** Turn a single GameEvent into a battle-log entry, or undefined to skip it (curated subset). */
function battleLogEntryFor(event: GameEvent, ctx: BattleLogContext): BattleLogEntry | undefined {
  const payload = event.payload ?? {};
  const cardId = typeof payload.cardId === "string" ? payload.cardId : undefined;
  const target = typeof payload.target === "string" ? payload.target : undefined;
  const amount = typeof payload.amount === "number" ? payload.amount : undefined;
  const base = { seq: event.seq, seat: event.seat } as const;

  switch (event.type) {
    case "MINION_SUMMONED": {
      if (target && cardId) battleLogMinions.set(target, { cardId, name: cardName(cardId) ?? cardId });
      const tile = logCardRef(cardId);
      return { ...base, kind: "summon", tile, badge: "sparkle", label: `${tile.name} 進場` };
    }
    case "CARD_PLAYED": {
      // Minions are covered by the following MINION_SUMMONED; only log spells/news here.
      if (!cardId || cardCatalog.get(cardId)?.type !== "NEWS") return undefined;
      const tile = logCardRef(cardId);
      return { ...base, kind: "play", tile, label: `打出 ${tile.name}` };
    }
    case "ATTACK": {
      const attackerId = typeof payload.attackerInstanceId === "string" ? payload.attackerInstanceId : undefined;
      const tile = attackerId ? logUnitRef(attackerId) : { name: battleLogHeroName(event.seat), hero: true };
      const ref = payload.target as TargetRef | undefined;
      const flowTo = ref
        ? ref.type === "HERO"
          ? { name: battleLogHeroName(ref.side), hero: true }
          : logUnitRef(ref.instanceId ?? "")
        : undefined;
      const dealt = ctx.attackTargetDamage.get(event.seq);
      return { ...base, kind: "attack", tile, flowTo, badge: "sword", amount: dealt, label: `${tile.name} 攻擊 ${flowTo?.name ?? "目標"}` };
    }
    case "DAMAGE": {
      // Damage from a combat trade is shown inside the attack entry; only direct (spell/effect) damage lands here.
      if (!target || ctx.claimedDamage.has(event.seq)) return undefined;
      const targetRef = logTargetRef(target);
      const actor = ctx.lastPlayedCardId ? logCardRef(ctx.lastPlayedCardId) : undefined;
      if (actor) {
        return { ...base, kind: "damage", tile: actor, flowTo: targetRef, badge: "burst", amount, label: `${actor.name} 對 ${targetRef.name} 造成 ${amount ?? 0} 點傷害` };
      }
      return { ...base, kind: "damage", tile: targetRef, badge: "burst", amount, label: `${targetRef.name} 受到 ${amount ?? 0} 點傷害` };
    }
    case "DESTROY": {
      const tile = cardId ? logCardRef(cardId) : target ? logUnitRef(target) : { name: "隨從" };
      return { ...base, kind: "death", tile, label: `${tile.name} 陣亡` };
    }
    case "HEAL": {
      if (!target) return undefined;
      const tile = logTargetRef(target);
      return { ...base, kind: "heal", tile, badge: "heart", amount, label: `${tile.name} 恢復 ${amount ?? 0} 點生命` };
    }
    case "BOUNCE": {
      const tile = cardId ? logCardRef(cardId) : target ? logUnitRef(target) : { name: "隨從" };
      return { ...base, kind: "bounce", tile, badge: "bounce", label: `${tile.name} 被收回手牌` };
    }
    case "VOTE_RESOLVED": {
      const processText = typeof payload.processText === "string" ? payload.processText : "公投結果出爐";
      return { ...base, kind: "play", tile: { name: "公投" }, badge: "sparkle", label: processText };
    }
    case "EVENT_NOTICE": {
      const text = typeof payload.text === "string" ? payload.text : "";
      if (!text) return undefined;
      return { ...base, kind: "play", tile: { name: "公投" }, badge: "sparkle", label: text };
    }
    // BUFF is handled by the grouping pass in appendBattleLog (multiple events → one actor entry).
    default:
      return undefined;
  }
}

/** Derive battle-log entries from a fresh batch of events (oldest→newest, capped). */
function appendBattleLog(message: GameEvent[]): void {
  // Pre-pass: claim the DAMAGE events that belong to each attack (target hit + retaliation),
  // so they fold into the attack entry rather than appearing as standalone damage.
  const claimedDamage = new Set<number>();
  const attackTargetDamage = new Map<number, number>();
  for (let i = 0; i < message.length; i++) {
    const event = message[i];
    if (event.type !== "ATTACK") continue;
    const payload = event.payload ?? {};
    const attackerId = typeof payload.attackerInstanceId === "string" ? payload.attackerInstanceId : undefined;
    const ref = payload.target as TargetRef | undefined;
    const targetKey = ref ? targetKeyFor(ref) : undefined;
    const claimNextDamageTo = (wanted: string | undefined): GameEvent | undefined => {
      if (!wanted) return undefined;
      for (let j = i + 1; j < message.length; j++) {
        const d = message[j];
        if (d.type !== "DAMAGE" || claimedDamage.has(d.seq)) continue;
        if ((typeof d.payload?.target === "string" ? d.payload.target : undefined) === wanted) {
          claimedDamage.add(d.seq);
          return d;
        }
      }
      return undefined;
    };
    const targetHit = claimNextDamageTo(targetKey);
    if (targetHit && typeof targetHit.payload?.amount === "number") attackTargetDamage.set(event.seq, targetHit.payload.amount);
    claimNextDamageTo(attackerId); // retaliation — claimed so it isn't shown as separate damage
  }

  const entries: BattleLogEntry[] = [];
  let lastPlayedCardId: string | undefined;

  // Consecutive effect events sharing one actor (the just-played card) collapse into
  // a single entry whose strip tile is the actor and whose tooltip fans out to every target.
  type GroupedLogKind = "damage" | "heal" | "buff" | "silence" | "bounce";
  type PendingEffect = {
    kind: GroupedLogKind;
    actorKey: string;
    tile: BattleLogCardRef;
    badge: BattleLogBadge;
    seat?: Seat;
    seq: number;
    flowTargets: { ref: BattleLogCardRef; detail?: string; amount?: number }[];
    singleFallback?: BattleLogEntry;
  };
  let pendingEffect: PendingEffect | undefined;
  const groupedEffectVerb = (kind: GroupedLogKind): string => {
    if (kind === "damage") return "造成傷害";
    if (kind === "heal") return "治療";
    if (kind === "silence") return "鎖定";
    if (kind === "bounce") return "收回";
    return "強化";
  };
  const flushEffect = (): void => {
    if (!pendingEffect) return;
    if (pendingEffect.flowTargets.length === 1 && pendingEffect.singleFallback) {
      entries.push(pendingEffect.singleFallback);
      pendingEffect = undefined;
      return;
    }
    const names = pendingEffect.flowTargets.map((t) => t.ref.name).join("、");
    entries.push({
      seq: pendingEffect.seq,
      seat: pendingEffect.seat,
      kind: pendingEffect.kind,
      tile: pendingEffect.tile,
      badge: pendingEffect.badge,
      flowTargets: pendingEffect.flowTargets,
      label: `${pendingEffect.tile.name} ${groupedEffectVerb(pendingEffect.kind)} ${names}`
    });
    pendingEffect = undefined;
  };
  const pushEffectTarget = (
    kind: GroupedLogKind,
    event: GameEvent,
    target: { ref: BattleLogCardRef; detail?: string; amount?: number },
    badge: BattleLogBadge,
    singleFallback?: BattleLogEntry
  ): void => {
    if (!lastPlayedCardId) {
      flushEffect();
      if (singleFallback) entries.push(singleFallback);
      return;
    }
    const actorKey = `${kind}:${lastPlayedCardId}`;
    if (!pendingEffect || pendingEffect.actorKey !== actorKey) {
      flushEffect();
      pendingEffect = {
        kind,
        actorKey,
        tile: logCardRef(lastPlayedCardId),
        badge,
        seat: event.seat,
        seq: event.seq,
        flowTargets: [],
        singleFallback
      };
    }
    pendingEffect.flowTargets.push(target);
  };

  for (const event of message) {
    if (event.type === "BUFF") {
      const payload = event.payload ?? {};
      const target = typeof payload.target === "string" ? payload.target : undefined;
      if (!target) continue;
      const silence = isSilencePayload(payload);
      const kind = silence ? "silence" : "buff";
      const badge: BattleLogBadge = silence ? "silence" : "arrow";
      const detail = buffDetail(payload);
      const targetRef = logTargetRef(target);
      if (lastPlayedCardId) {
        pushEffectTarget(kind, event, { ref: targetRef, detail }, badge);
      } else {
        // No played-card actor (triggered / self-buff): the buffed minion is its own actor.
        flushEffect();
        entries.push({ seq: event.seq, seat: event.seat, kind, tile: targetRef, badge, detail, label: silence ? `${targetRef.name} ${detail}` : `${targetRef.name} 獲得 ${detail}` });
      }
      continue;
    }

    if (event.type === "CARD_PLAYED" && typeof event.payload?.cardId === "string") {
      flushEffect();
      lastPlayedCardId = event.payload.cardId;
      const entry = battleLogEntryFor(event, { claimedDamage, attackTargetDamage, lastPlayedCardId });
      if (entry) entries.push(entry);
      continue;
    }

    const entry = battleLogEntryFor(event, { claimedDamage, attackTargetDamage, lastPlayedCardId });
    const payload = event.payload ?? {};
    const target = typeof payload.target === "string" ? payload.target : undefined;
    const amount = typeof payload.amount === "number" ? payload.amount : undefined;
    if (entry && target && lastPlayedCardId && (event.type === "DAMAGE" || event.type === "HEAL" || event.type === "BOUNCE")) {
      const kind = event.type === "DAMAGE" ? "damage" : event.type === "HEAL" ? "heal" : "bounce";
      const badge: BattleLogBadge = kind === "damage" ? "burst" : kind === "heal" ? "heart" : "bounce";
      const targetRef = event.type === "BOUNCE" && typeof payload.cardId === "string" ? logCardRef(payload.cardId) : logTargetRef(target);
      pushEffectTarget(kind, event, { ref: targetRef, amount }, badge, entry);
      continue;
    }

    flushEffect();
    if (entry) entries.push(entry);
  }
  flushEffect();
  if (entries.length === 0) return;
  view.battleLog = [...view.battleLog, ...entries].slice(-50);
}

function shouldClearHoverForEvents(events: GameEvent[]): boolean {
  return events.some((event) => {
    switch (event.type) {
      case "CARD_PLAYED":
      case "MINION_SUMMONED":
      case "DAMAGE":
      case "HEAL":
      case "BUFF":
      case "SHIELD_POPPED":
      case "BOUNCE":
      case "DESTROY":
      case "DEATHRATTLE":
      case "VOTE_RESOLVED":
        return true;
      default:
        return false;
    }
  });
}

function handleEvents(message: GameEvent[]): AnimationCue[] {
  if (shouldClearHoverForEvents(message)) clearHoverTooltip();
  view.events = [...message, ...view.events].slice(0, 50);
  appendBattleLog(message);
  maybeShowTurnAnnouncement(message);
  const handGate = scheduleHandEventGates(message);
  const cues = enqueueEventCues(message);
  scheduleCueAudio(cues, message);
  playEventAudio(immediateAudioEvents(message));
  playDiscardAnimations(message, view.mySeat, { delayMs: handGate.discardDelayMs });
  const rejection = message.find((item) => item.type === "COMMAND_REJECTED");
  if (rejection) {
    if (view.selectedHandId) view.rejectedHandIds.add(view.selectedHandId);
    if (view.amplificationRerollStage) resetSpecialPhaseUiState();
    // A rejected battlecry play keeps the card in hand; drop the preview overlay.
    if (view.pendingBattlecry) {
      view.rejectedHandIds.add(view.pendingBattlecry.handInstanceId);
      clearPendingBattlecry();
    }
    showBattleToast(String(rejection.payload?.reason ?? "動作被拒絕。"));
  }
  const finishedEvent = message.find((item) => item.type === "GAME_FINISHED");
  if (finishedEvent) {
    view.eventStatus = "finished";
    // Match is over — no point offering a resume after a later refresh.
    forgetActiveMatch();
    scheduleHeroDeathSequence(finishedEvent, cues);
  } else if (message.some((item) => item.type === "TURN_STARTED")) {
    view.eventStatus = "in_progress";
  }
  // Drop stale amplification options when a special phase closes so the next
  // phase's fresh private offer can't be shadowed by the previous turn's options.
  if (message.some((item) => item.type === "PHASE_ENDED")) {
    view.amplificationOptions = undefined;
    resetSpecialPhaseUiState();
  }
  const voteResolved = message.find((item) => item.type === "VOTE_RESOLVED");
  if (voteResolved) startVoteRouletteFromEvent(voteResolved);
  // Surface event reminders (e.g. 鬼門開 場上已滿 無法復活) as an on-screen toast.
  // When a vote roulette is playing in the same batch, hold the toast until the
  // roulette finishes so it isn't hidden behind the overlay.
  const notice = message.filter((item) => item.type === "EVENT_NOTICE").map((item) => String(item.payload?.text ?? "")).filter(Boolean).at(-1);
  if (notice) {
    if (voteResolved) setTimeout(() => showBattleToast(notice), VOTE_ROULETTE_TOTAL_MS);
    else showBattleToast(notice);
  }
  render();
  return cues;
}

/** Kicks off the turn-20 referendum roulette from a `VOTE_RESOLVED` event. */
function startVoteRouletteFromEvent(event: GameEvent): void {
  const payload = event.payload ?? {};
  const choices = payload.choices as
    | { player1?: VoteRouletteChoice; player2?: VoteRouletteChoice }
    | undefined;
  const winnerSeat = payload.winningSeat;
  const winnerEventId = typeof payload.eventId === "string" ? payload.eventId : undefined;
  const winnerEventName = typeof payload.eventName === "string" ? payload.eventName : "";
  if (!choices?.player1 || !choices?.player2) return;
  if (winnerSeat !== "player1" && winnerSeat !== "player2") return;
  if (!winnerEventId) return;
  void playVoteRoulette({
    choices: { player1: choices.player1, player2: choices.player2 },
    winnerSeat,
    winnerEventId,
    winnerEventName,
    mySeat: view.mySeat
  });
}

function scheduleHandEventGates(events: GameEvent[]): { discardDelayMs: number } {
  let queuedPlaySlot = cardPlayCueQueue.length + (cardPlayCueActive ? 1 : 0);
  let currentPostPlayDelay = 0;
  let discardDelayMs = 0;
  let publicHandHoldMs = 0;
  let localHandHoldMs = 0;
  const localPreserveCardIds: string[] = [];
  const localOmitHandIds: string[] = [];

  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.type === "CARD_PLAYED") {
      currentPostPlayDelay = postPlayDelayForEvent(event, queuedPlaySlot);
      if (!willSuppressPlayCue(event)) queuedPlaySlot += 1;
      const handInstanceId = typeof payload.handInstanceId === "string" ? payload.handInstanceId : undefined;
      if (handInstanceId && event.seat === view.mySeat) localOmitHandIds.push(handInstanceId);
      continue;
    }

    if (event.type === "DISCARD") {
      const delayMs = currentPostPlayDelay > 0 ? currentPostPlayDelay : 0;
      discardDelayMs = Math.max(discardDelayMs, delayMs);
      publicHandHoldMs = Math.max(publicHandHoldMs, delayMs + DISCARD_CARD_BODY_MS);
      if (event.seat === view.mySeat) {
        localHandHoldMs = Math.max(localHandHoldMs, delayMs + DISCARD_CARD_BODY_MS);
        const cardId = typeof payload.cardId === "string" ? payload.cardId : undefined;
        if (cardId) localPreserveCardIds.push(cardId);
      }
      continue;
    }

    if (event.type === "CARD_DRAWN" && typeof payload.cardId === "string") {
      const drawReadyMs = Math.max(currentPostPlayDelay, publicHandHoldMs);
      publicHandHoldMs = Math.max(publicHandHoldMs, drawReadyMs);
      if (event.seat === view.mySeat) localHandHoldMs = Math.max(localHandHoldMs, drawReadyMs);
    }
  }

  if (publicHandHoldMs > 0) holdPendingPublicSyncFor(publicHandHoldMs);
  if (localHandHoldMs > 0) {
    holdPlayerHandSyncFor(localHandHoldMs, {
      preserveMissingCardIds: localPreserveCardIds,
      omitHandIds: localOmitHandIds
    });
  }
  return { discardDelayMs };
}

function postPlayDelayForEvent(event: GameEvent, queuedPlaySlot: number): number {
  if (willSuppressPlayCue(event)) {
    const settleAtMs = (battlecryLocalLandingStartMs ?? performance.now()) + CARD_PLAY_FULL_MS;
    return Math.max(0, settleAtMs - performance.now());
  }
  return queuedPlaySlot * CARD_PLAY_CUE_TOTAL_MS + CARD_PLAY_EFFECT_DELAY_MS;
}

function willSuppressPlayCue(event: GameEvent): boolean {
  if (event.type !== "CARD_PLAYED") return false;
  const cardId = typeof event.payload?.cardId === "string" ? event.payload.cardId : undefined;
  return Boolean(cardId && suppressedPlayCues.some((entry) => entry.seat === event.seat && entry.cardId === cardId));
}

function immediateAudioEvents(events: GameEvent[]): GameEvent[] {
  return events.filter((event) => event.type === "TURN_STARTED" || event.type === "COMMAND_REJECTED");
}

function scheduleCueAudio(cues: AnimationCue[], sourceEvents: GameEvent[]): void {
  const attackDamageSeqs = attackDamageEventSeqs(sourceEvents);
  const scheduled = new Set<string>();
  for (const cue of cues) {
    const sound = soundForCue(cue, sourceEvents, attackDamageSeqs);
    if (!sound) continue;
    const delayMs = audioDelayForCue(cue);
    const dueBucket = Math.round(delayMs / 50) * 50;
    const key = `${sound}:${dueBucket}`;
    if (scheduled.has(key)) continue;
    scheduled.add(key);
    window.setTimeout(() => playSfx(sound), delayMs);
  }
}

function soundForCue(cue: AnimationCue, sourceEvents: GameEvent[], attackDamageSeqs: Set<number>): SoundCue | undefined {
  if (cue.kind === "attackerMoves") return attackImpactSound(cue, sourceEvents);
  if (cue.kind === "damage") {
    const seq = cueEventSeq(cue);
    return seq !== undefined && attackDamageSeqs.has(seq) ? undefined : "damage";
  }
  if (cue.kind === "heal") return "heal";
  if (cue.kind === "buff") return "heal";
  if (cue.kind === "bounce") return "reject";
  if (cue.kind === "destroy") return "death";
  return undefined;
}

function audioDelayForCue(cue: AnimationCue): number {
  if (cue.kind === "attackerMoves") return ATTACK_IMPACT_DELAY_MS;
  return Math.max(0, Math.round(cue.delayMs ?? 0));
}

function attackImpactSound(cue: AnimationCue, sourceEvents: GameEvent[]): SoundCue {
  const seq = cueEventSeq(cue);
  const attackIndex = sourceEvents.findIndex((event) => event.type === "ATTACK" && event.seq === seq);
  const nextDamage = attackIndex >= 0
    ? sourceEvents.slice(attackIndex + 1).find((event) => event.type === "DAMAGE")
    : undefined;
  const amount = typeof nextDamage?.payload?.amount === "number" ? nextDamage.payload.amount : 0;
  return amount >= 7 ? "attackHeavy" : "attack";
}

function attackDamageEventSeqs(events: GameEvent[]): Set<number> {
  const seqs = new Set<number>();
  for (let i = 0; i < events.length; i++) {
    if (events[i].type !== "ATTACK") continue;
    for (let j = i + 1; j < events.length; j++) {
      const type = events[j].type;
      if (type === "DAMAGE") {
        seqs.add(events[j].seq);
        continue;
      }
      if (type === "DESTROY" || type === "GAME_FINISHED") continue;
      break;
    }
  }
  return seqs;
}

function cueEventSeq(cue: AnimationCue): number | undefined {
  const separatorIndex = cue.id.indexOf("-");
  if (separatorIndex < 0) return undefined;
  const rawSeq = cue.id.slice(0, separatorIndex);
  const seq = Number(rawSeq);
  return Number.isFinite(seq) ? seq : undefined;
}

const cardPlayCueQueue: AnimationCue[] = [];
let cardPlayCueActive = false;
let cardPlayTimers: number[] = [];
// Card play visual phases (relative to play-cue start):
//   0–800ms   overlay entrance + hold
//   800ms     `card-play-slam` class added
//   1100ms    impactCardPlayLanding → board slam shake (480ms) + dust cloud (1000ms)
//   1300ms    overlay element removed                  (CARD_PLAY_CUE_TOTAL_MS)
//   1580ms    board slam shake ends                    (1100 + 480)
//   2100ms    dust cloud removed                       (CARD_PLAY_FULL_MS)
const CARD_PLAY_CUE_TOTAL_MS = 1300;
const CARD_PLAY_IMPACT_OFFSET_MS = 1100;
const BOARD_LANDING_SETTLE_MS = 1000;
const CARD_PLAY_FULL_MS = Math.max(
  CARD_PLAY_CUE_TOTAL_MS,
  CARD_PLAY_IMPACT_OFFSET_MS + BOARD_LANDING_SETTLE_MS
);
const CARD_PLAY_EFFECT_DELAY_MS = CARD_PLAY_FULL_MS + 160;
const POST_PLAY_STATE_SYNC_LAG_MS = 180;
const BOUNCE_EFFECT_SYNC_LAG_MS = 650;
const DESTROY_EFFECT_SYNC_LAG_MS = 820;
// Multi-hit strike cards (e.g. 彈劾賴皇 S002) fire N staggered flying blades, one
// per 1-damage hit. Each hit's cue delay is base + index*stagger so the blades
// overlap into a ~1.5s flurry; the board HP snaps once, held until the last
// blade's impact peak (D-i: single final snap, not per-hit decrement).
const MULTI_HIT_STRIKE_STAGGER_MS = 110;
const MULTI_HIT_STRIKE_COUNT_CAP = 10;
const MULTI_HIT_STRIKE_FLUSH_IMPACT_OFFSET_MS = 500;

// A locally-played battlecry card runs its own card-play animation, so the
// server's echoed `CARD_PLAYED` cue for it is suppressed (matched by seat +
// cardId, consumed once) to avoid the card appearing to play twice.
const suppressedPlayCues: Array<{ seat: Seat | undefined; cardId: string }> = [];

// While a card-play preview is animating, board updates are held back so the
// card can visibly hit the board before the new state appears. The latest
// publicSync is stashed here and flushed when the visual cue reaches the point
// where the resulting board state should become visible.
let pendingPublicSync: unknown;
let pendingPublicSyncHoldUntilMs = 0;
let pendingPublicSyncFlushTimer: number | undefined;

let pendingHandSync: { cards: HandCardView[]; suppressDrawIds: string[] } | undefined;
let pendingHandSyncHoldUntilMs = 0;
let pendingHandSyncFlushTimer: number | undefined;
let pendingHandSyncSuppressNewIds = false;
let pendingHandSyncPreserveCardIds: string[] = [];
let pendingHandSyncOmitIds = new Set<string>();

/** Lead before an augment glow fires for an already-visible card/unit, so its
 * PRE-effect value shows first, then the glow lands. */
const AUGMENT_GLOW_LEAD_MS = 220;
/** Longer lead when the affected card is freshly drawn this batch (e.g. 股東紀念品):
 * wait for the ~850ms draw flight to land so the card is on screen at base cost
 * before it glows and drops. */
const AUGMENT_GLOW_DRAW_LEAD_MS = 950;
/** Beat between the triggering animation finishing (minion landing / attack lunge
 * returning) and the augment glow firing — a deliberate pause so the glow reads as
 * a distinct, separate event from the action, not a continuation of it. */
const AUGMENT_GLOW_SETTLE_MS = 480;
/** Time from the glow firing to the value reveal (cost drop / stat change). Set
 * just PAST the ~1.4s glow keyframe so the effect manifests strictly AFTER the
 * glow finishes — trigger → glow → effect → (then input unlocks). */
const AUGMENT_GLOW_REVEAL_DELAY_MS = 1500;
/** Battle input is locked until this time while an augment glow is mid-sequence
 * (mid-turn augments aren't already covered by the special-phase lock). */
let augmentGlowLockUntilMs = 0;
/** Own-hand card instanceIds to render at their base cost (suppressing the
 * discount) until the augment glow reveal lands — 股東紀念品's "show original
 * cost → glow → cost drops" beat. Cleared by `applyAugmentGlow`'s reveal timer. */
const augmentHoldBaseCostIds = new Set<string>();
/** Board minion instanceIds (freshly summoned this batch) to render at their
 * PRINTED base stats until the augment glow reveal lands — the summon equivalent
 * of `augmentHoldBaseCostIds`, so a landing buff shows base → glow → buffed.
 * On-board targets use the public-sync hold instead. Cleared at the glow reveal. */
const augmentHoldBaseStatIds = new Set<string>();
/** Hard cap on how long an augment glow waits for the triggering summon/attack
 * animation to finish before it force-fires, so a missed busy-clear can never
 * strand the value reveal (would otherwise leak `augmentHoldBaseCostIds`). */
const AUGMENT_GLOW_MAX_DEFER_MS = 4000;
/** Drives re-checks of the glow gate while an augment glow waits behind a
 * card-play landing or attack animation, re-asserting the value hold + input
 * lock each tick so the reveal can't slip out before the glow lands. */
let augmentGlowPumpTimer: number | undefined;
const augmentGlowDeadlines = new Map<string, number>();
/** True while a deferred glow batch is holding the public sync for an
 * already-on-board target (so the pump re-asserts that hold). Freshly-summoned
 * targets are NOT held — they ride their card-play landing flush — so the pump
 * must not re-hold and strand them off-board. */
let augmentGlowHoldsSync = false;

function cardPlayPreviewBusy(): boolean {
  return cardPlayCueActive || cardPlayCueQueue.length > 0;
}

function attackAnimationBusy(): boolean {
  if (activeAttackLunges.size > 0) return true;
  for (const cue of view.animationCues) {
    if (cue.kind === "attackerMoves" && !appliedLunges.has(cue.id)) return true;
  }
  return false;
}

function flushPendingPublicSync(opts: { ignoreCardPlayBusy?: boolean } = {}): void {
  const hasPendingSync = pendingPublicSync !== undefined;
  const attackBusy = attackAnimationBusy();
  const cardPlayBusy = cardPlayPreviewBusy();
  const holdRemaining = pendingPublicSyncHoldUntilMs - performance.now();
  if (!hasPendingSync) return;
  if (attackBusy) {
    blog("flush skip", { reason: "attack-busy" });
    return;
  }
  if (voteRouletteActive()) {
    // Hold the post-vote board state (e.g. 高雄氣爆 deaths) until the roulette
    // reveals the winner; the flag clears synchronously inside reveal().
    blog("flush skip", { reason: "vote-roulette-busy" });
    schedulePendingPublicSyncFlush(120, opts);
    return;
  }
  if (!opts.ignoreCardPlayBusy && cardPlayBusy) {
    blog("flush skip", { reason: "card-play-busy", queued: cardPlayCueQueue.length, active: cardPlayCueActive });
    return;
  }
  if (holdRemaining > 0) {
    blog("flush skip", { reason: "held", holdRemaining: Math.round(holdRemaining) });
    schedulePendingPublicSyncFlush(holdRemaining, opts);
    return;
  }
  applyPendingPublicSyncNow();
}

function applyPendingPublicSyncNow(): void {
  if (pendingPublicSync !== undefined) {
    if (pendingPublicSyncFlushTimer !== undefined) {
      window.clearTimeout(pendingPublicSyncFlushTimer);
      pendingPublicSyncFlushTimer = undefined;
    }
    const message = pendingPublicSync;
    pendingPublicSync = undefined;
    pendingPublicSyncHoldUntilMs = 0;
    const mySeat = view.mySeat ?? "player1";
    const beforeBoardIds = Array.from(readPlayer(mySeat)?.board ?? []).map((m) => m.instanceId);
    blog("flush start", {
      hasPending: Boolean(view.pendingBattlecry),
      hasAccepted: Boolean(view.acceptedBattlecry),
      boardIdsBefore: beforeBoardIds
    });
    view.publicSync = message as typeof view.publicSync;
    renderNow();
    const cleared = clearAcceptedBattlecryAfterRender();
    if (cleared) renderNow();
    const afterBoardIds = Array.from(readPlayer(mySeat)?.board ?? []).map((m) => m.instanceId);
    blog("flush done", {
      hasPending: Boolean(view.pendingBattlecry),
      hasAccepted: Boolean(view.acceptedBattlecry),
      boardIdsAfter: afterBoardIds,
      clearedAccepted: cleared
    });
    const opponentSeat = view.mySeat ? otherSeat(view.mySeat) : undefined;
    const opponentHandCount = opponentSeat ? readPlayer(opponentSeat)?.handCount : undefined;
    if (typeof opponentHandCount === "number") noteOpponentHandSync(opponentHandCount);
  }
}

function holdPendingPublicSyncFor(delayMs: number): void {
  pendingPublicSyncHoldUntilMs = Math.max(pendingPublicSyncHoldUntilMs, performance.now() + delayMs);
  blog("hold publicSync", { delayMs: Math.round(delayMs) });
}

function schedulePendingPublicSyncFlush(delayMs: number, opts: { ignoreCardPlayBusy?: boolean } = {}): void {
  if (pendingPublicSyncFlushTimer !== undefined) window.clearTimeout(pendingPublicSyncFlushTimer);
  pendingPublicSyncFlushTimer = window.setTimeout(() => {
    pendingPublicSyncFlushTimer = undefined;
    flushPendingPublicSync(opts);
  }, Math.max(0, delayMs));
}

function handleHandSync(cards: HandCardView[]): void {
  const ids = cards.map((card) => card.instanceId);
  blog("hand received", { ids });

  let holdRemaining = pendingHandSyncHoldUntilMs - performance.now();
  if (pendingHandSync && holdRemaining <= 0) {
    flushPendingHandSync();
    holdRemaining = pendingHandSyncHoldUntilMs - performance.now();
  }
  if (!pendingHandSync && holdRemaining <= 0 && pendingHandSyncHoldUntilMs > 0) {
    clearPendingHandSyncHold();
  }

  const currentIds = new Set(view.hand.map((card) => card.instanceId));
  const addedIds = ids.filter((id) => !currentIds.has(id));
  const changed = ids.length !== view.hand.length || ids.some((id, index) => id !== view.hand[index]?.instanceId);
  if (holdRemaining > 0 && changed) {
    pendingHandSync = {
      cards,
      suppressDrawIds: pendingHandSyncSuppressNewIds ? addedIds : []
    };
    schedulePendingHandSyncFlush(holdRemaining);
    const visibleCards = heldHandView(cards);
    blog("hand sync held", {
      holdRemaining: Math.round(holdRemaining),
      withheldIds: addedIds,
      suppressDrawIds: pendingHandSync.suppressDrawIds,
      preserveCardIds: pendingHandSyncPreserveCardIds
    });
    applyHandSyncNow(visibleCards);
    return;
  }

  if (pendingHandSync) clearPendingHandSyncHold();
  applyHandSyncNow(cards);
}

function applyHandSyncNow(cards: HandCardView[], suppressDrawIds: readonly string[] = []): void {
  view.hand = cards;
  pruneSelections();
  render();
  blog("hand render done", { suppressedDrawIds: suppressDrawIds });
  notePlayerHandSync(cards.map((card) => card.instanceId), { suppressNewIds: suppressDrawIds });
}

function holdPlayerHandSyncFor(
  delayMs: number,
  opts: { suppressNewIds?: boolean; preserveMissingCardIds?: readonly string[]; omitHandIds?: readonly string[] } = {}
): void {
  pendingHandSyncHoldUntilMs = Math.max(pendingHandSyncHoldUntilMs, performance.now() + delayMs);
  pendingHandSyncSuppressNewIds = pendingHandSyncSuppressNewIds || Boolean(opts.suppressNewIds);
  pendingHandSyncPreserveCardIds = [
    ...pendingHandSyncPreserveCardIds,
    ...(opts.preserveMissingCardIds ?? [])
  ];
  for (const id of opts.omitHandIds ?? []) pendingHandSyncOmitIds.add(id);
  blog("hold hand sync", {
    delayMs: Math.round(delayMs),
    suppressNewIds: pendingHandSyncSuppressNewIds,
    preserveCardIds: pendingHandSyncPreserveCardIds
  });
  if (pendingHandSync) {
    schedulePendingHandSyncFlush(pendingHandSyncHoldUntilMs - performance.now());
  }
}

function heldHandView(finalCards: HandCardView[]): HandCardView[] {
  const finalIds = new Set(finalCards.map((card) => card.instanceId));
  const preserveCounts = countCards(pendingHandSyncPreserveCardIds);
  const visible: HandCardView[] = [];
  for (const card of view.hand) {
    if (pendingHandSyncOmitIds.has(card.instanceId)) continue;
    if (finalIds.has(card.instanceId)) {
      visible.push(card);
      continue;
    }
    const remaining = preserveCounts.get(card.cardId) ?? 0;
    if (remaining <= 0) continue;
    preserveCounts.set(card.cardId, remaining - 1);
    visible.push(card);
  }
  return visible;
}

function schedulePendingHandSyncFlush(delayMs: number): void {
  if (pendingHandSyncFlushTimer !== undefined) window.clearTimeout(pendingHandSyncFlushTimer);
  pendingHandSyncFlushTimer = window.setTimeout(() => {
    pendingHandSyncFlushTimer = undefined;
    flushPendingHandSync();
  }, Math.max(0, delayMs));
}

function flushPendingHandSync(): void {
  if (!pendingHandSync) return;
  const holdRemaining = pendingHandSyncHoldUntilMs - performance.now();
  if (holdRemaining > 0) {
    schedulePendingHandSyncFlush(holdRemaining);
    return;
  }
  const sync = pendingHandSync;
  pendingHandSync = undefined;
  pendingHandSyncHoldUntilMs = 0;
  pendingHandSyncSuppressNewIds = false;
  pendingHandSyncPreserveCardIds = [];
  pendingHandSyncOmitIds.clear();
  blog("hand sync release", { ids: sync.cards.map((card) => card.instanceId), suppressedDrawIds: sync.suppressDrawIds });
  applyHandSyncNow(sync.cards, sync.suppressDrawIds);
}

function clearPendingHandSyncHold(): void {
  pendingHandSync = undefined;
  pendingHandSyncHoldUntilMs = 0;
  pendingHandSyncSuppressNewIds = false;
  pendingHandSyncPreserveCardIds = [];
  pendingHandSyncOmitIds.clear();
  if (pendingHandSyncFlushTimer !== undefined) {
    window.clearTimeout(pendingHandSyncFlushTimer);
    pendingHandSyncFlushTimer = undefined;
  }
}

// Plays the landing SFX, shakes the board, and spawns V1-style smoke right
// when the preview-card slam reaches the board.
function impactCardPlayLanding(cue: AnimationCue, card: CardDefinition, previewEl: HTMLElement): void {
  blog("impact", { cardId: cue.cardId, targetKey: cue.targetKey, seat: cue.seat });
  flushPendingPublicSync({ ignoreCardPlayBusy: true });
  window.requestAnimationFrame(() => {
    if (!document.body.contains(previewEl)) return;
    playSfx(card.cost >= 8 ? "cardPlayHeavy" : "cardPlay");
    const board = slamBoard(cue.seat);
    const landedMinion = cue.targetKey
      ? document.querySelector<HTMLElement>(`[data-target-key="${cssEscape(cue.targetKey)}"]`)
      : undefined;
    const smokeAnchor = landedMinion ?? board ?? previewEl;
    spawnBoardDust(smokeAnchor, card.cost >= 7 ? 2.5 : 1);
  });
}

function slamBoard(seat: Seat | undefined): HTMLElement | undefined {
  if (!seat) return undefined;
  const role = seat === view.mySeat ? "player" : "opponent";
  const board = document.querySelector<HTMLElement>(`[data-testid="${role}-board"]`);
  if (!board) return undefined;
  board.classList.remove("board-slam");
  void board.offsetWidth; // restart the animation if it is already applied
  board.classList.add("board-slam");
  window.setTimeout(() => board.classList.remove("board-slam"), 480);
  return board;
}

// Imperative dust puff ported from LEGACY's spawnDustEffect. It is appended to
// body with a very high z-index so it remains visible over the card preview.
function spawnBoardDust(anchor: HTMLElement, intensity = 1): void {
  const rect = anchor.getBoundingClientRect();
  const cloud = document.createElement("div");
  cloud.className = "board-dust-cloud";
  cloud.style.left = `${rect.left + rect.width / 2}px`;
  cloud.style.top = `${rect.top + rect.height * 0.8}px`;
  document.body.appendChild(cloud);

  const count = Math.floor(15 * intensity);
  for (let i = 0; i < count; i++) {
    const particle = document.createElement("div");
    particle.className = "board-dust-particle";
    const angle = Math.random() * Math.PI * 2;
    const distance = (60 + Math.random() * 100) * (intensity > 1 ? 1.8 : 1);
    const size = (15 + Math.random() * 25) * (intensity > 1 ? 1.6 : 1);
    particle.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    particle.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    cloud.appendChild(particle);
  }
  window.setTimeout(() => cloud.remove(), 1000);
}

// Applies a publicSync, but never ahead of an animation that needs the old
// board. The server sends `publicSync` then `events` back-to-back, so we give
// the paired events a short grace window to enqueue card-play / attack cues;
// then the board update is held until that visible motion finishes.
function applyPublicSync(message: typeof view.publicSync): void {
  pendingPublicSync = message;
  blog("publicSync received; scheduled flush", { delayMs: PUBLIC_SYNC_EVENT_GRACE_MS });
  schedulePendingPublicSyncFlush(PUBLIC_SYNC_EVENT_GRACE_MS);
}

function ensureCardPlayOverlay(): HTMLElement {
  let overlay = document.getElementById("card-play-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "card-play-overlay";
    overlay.setAttribute("aria-hidden", "true");
    document.body.appendChild(overlay);
  }
  return overlay;
}

function resetCardPlayCues(): void {
  clearPendingBattlecry();
  suppressedPlayCues.length = 0;
  cardPlayCueQueue.length = 0;
  cardPlayCueActive = false;
  pendingPublicSync = undefined;
  pendingPublicSyncHoldUntilMs = 0;
  augmentGlowLockUntilMs = 0;
  augmentHoldBaseCostIds.clear();
  augmentHoldBaseStatIds.clear();
  if (augmentGlowPumpTimer !== undefined) {
    window.clearTimeout(augmentGlowPumpTimer);
    augmentGlowPumpTimer = undefined;
  }
  augmentGlowDeadlines.clear();
  augmentGlowHoldsSync = false;
  appliedAugmentGlow.clear();
  clearPendingHandSyncHold();
  if (pendingPublicSyncFlushTimer !== undefined) {
    window.clearTimeout(pendingPublicSyncFlushTimer);
    pendingPublicSyncFlushTimer = undefined;
  }
  for (const timer of cardPlayTimers) window.clearTimeout(timer);
  cardPlayTimers = [];
  document.getElementById("card-play-overlay")?.replaceChildren();
  resetMinionVisualTracking();
  resetDrawTracking();
  resetVoteRoulette();
}

function enqueueCardPlayCue(cue: AnimationCue): void {
  if (!cue.cardId || !cardCatalog.get(cue.cardId)) return;
  cardPlayCueQueue.push(cue);
  if (!cardPlayCueActive) playNextCardPlayCue();
}

function playNextCardPlayCue(): void {
  const cue = cardPlayCueQueue.shift();
  if (!cue) {
    cardPlayCueActive = false;
    flushPendingPublicSync();
    return;
  }
  cardPlayCueActive = true;
  const card = cue.cardId ? cardCatalog.get(cue.cardId) : undefined;
  if (!card) {
    playNextCardPlayCue();
    return;
  }
  blog("play cue start", { cardId: cue.cardId, seat: cue.seat });
  const overlay = ensureCardPlayOverlay();
  const el = document.createElement("div");
  el.className = `event-card-preview card ${cue.seat === view.mySeat ? "from-player" : "from-opponent"}`;
  // A buffed play (e.g. a bounced 韓國瑜) carries its boosted stats on the cue so
  // the focus-zoom shows a green 4/4; without them we render the catalog base.
  const resolvedPlay = resolveCatalogCard(card, cue.id);
  applyVisibleNewsPowerPreview(card, resolvedPlay, cue.seat);
  if (typeof cue.playAttack === "number") resolvedPlay.attack = cue.playAttack;
  if (typeof cue.playHealth === "number") resolvedPlay.health = cue.playHealth;
  if (typeof cue.playEffectValue === "number") resolvedPlay.effectValue = cue.playEffectValue;
  if (typeof cue.playBaseEffectValue === "number") resolvedPlay.baseEffectValue = cue.playBaseEffectValue;
  if (typeof cue.playEffectBonusValue === "number") resolvedPlay.effectBonusValue = cue.playEffectBonusValue;
  if (typeof cue.playBaseEffectBonusValue === "number") resolvedPlay.baseEffectBonusValue = cue.playBaseEffectBonusValue;
  el.innerHTML = renderCardFace(resolvedPlay, "mulligan");
  overlay.appendChild(el);
  // Two phases mirror LEGACY showCardPlayPreview: a 0.8s entrance + hold, then
  // a staged shrink-and-fade slam. Minions fire smoke + shake during the slam,
  // matching LEGACY's delayed board impact inside showCardPlayPreview.
  cardPlayTimers.push(window.setTimeout(() => {
    el.classList.add("card-play-slam");
    if (card.type === "MINION") {
      cardPlayTimers.push(window.setTimeout(() => impactCardPlayLanding(cue, card, el), 300));
    }
  }, 800));
  cardPlayTimers.push(window.setTimeout(() => {
    el.remove();
    blog("play cue end", { cardId: cue.cardId, seat: cue.seat });
    playNextCardPlayCue();
  }, CARD_PLAY_CUE_TOTAL_MS));
}

/** Consumes a one-shot suppression entry matching this play cue, if any. */
function consumeSuppressedPlayCue(cue: AnimationCue): boolean {
  const index = suppressedPlayCues.findIndex(
    (entry) => entry.seat === cue.seat && entry.cardId === cue.cardId
  );
  if (index < 0) return false;
  suppressedPlayCues.splice(index, 1);
  return true;
}

/** Cue kinds whose board effect is deferred until a referendum roulette reveals
 * its winner, so the result isn't shown before the decision (Part A). */
const DEFERRED_VOTE_CUE_KINDS = new Set<AnimationCue["kind"]>([
  "destroy",
  "deathrattle",
  "damage",
  "effectStrike",
  "aoeSweep"
]);

function enqueueEventCues(events: GameEvent[]): AnimationCue[] {
  blog("events received", { types: events.map((e) => e.type) });
  // Single vs whole-board (全場) is a presentation concern, so it is decided
  // here from the batch — the rules engine stays pure and carries no aoe flag.
  const { combatDamageSeqs, aoeSeqs, aoeClusters, multiHitSeqs } = classifyBatchScopes(events);
  const rawCues = events
    .map((event, index) => eventToCue(event, events, index, combatDamageSeqs))
    .filter((cue): cue is AnimationCue => Boolean(cue));
  const koSoloHealCluster = appendKoSoloHealCue(rawCues, events);
  for (const cue of rawCues) {
    if (cue.seq !== undefined && aoeSeqs.has(cue.seq)) cue.scope = "aoe";
  }
  if (koSoloHealCluster) {
    const koSoloHealSeqs = new Set(koSoloHealCluster.memberSeqs);
    for (const cue of rawCues) {
      if (cue.seq !== undefined && koSoloHealSeqs.has(cue.seq)) cue.scope = "aoe";
    }
    aoeClusters.push(koSoloHealCluster);
  }
  insertAoeSweepCues(rawCues, aoeClusters);
  // Keep battlecry effects visually behind their card-play cue. The helper also
  // consumes local targeted-battlecry echoes that already animated before send.
  const cues = applyPostAttackEffectDelays(applyPostPlayEffectDelays(applyPostQuestEffectDelays(rawCues), multiHitSeqs));
  if (cues.length === 0) return [];
  // Part A: when a turn-20 referendum is resolving, hold the public sync and push
  // the board-effect cues out until the roulette reveals the winner, so e.g.
  // 高雄氣爆 only kills minions after the decision is shown. Guarded by the same
  // both-ballots check startVoteRouletteFromEvent uses (~7089), so replays without
  // an overlay aren't needlessly delayed.
  const voteChoices = events.find((e) => e.type === "VOTE_RESOLVED")?.payload?.choices as
    | { player1?: unknown; player2?: unknown }
    | undefined;
  if (voteChoices?.player1 && voteChoices?.player2) {
    holdPendingPublicSyncFor(VOTE_REVEAL_HOLD_MS);
    const readyAt = performance.now() + VOTE_REVEAL_HOLD_MS;
    for (const cue of cues) {
      if (DEFERRED_VOTE_CUE_KINDS.has(cue.kind)) {
        cue.delayMs = Math.max(cue.delayMs ?? 0, VOTE_REVEAL_HOLD_MS);
        cue.readyAtMs = readyAt;
      }
    }
  }
  // Part B: for augment glows that change a visible value (cost / stats / a new
  // card), keep the PRE-effect value on screen, fire the glow a beat later, and
  // hold the value reveal until the glow lands. Lock battle input meanwhile.
  scheduleAugmentGlowReveal(cues);
  blog("events cues", {
    cues: cues.map((c) => ({ kind: c.kind, delayMs: c.delayMs, targetKey: c.targetKey, cardId: c.cardId }))
  });
  // An AOE batch can spawn many short-lived per-target cues plus a sweep, so
  // lift the retained-cue cap when a sweep is present (R1) instead of silently
  // dropping the oldest cues.
  const cueCap = cues.some((cue) => cue.kind === "aoeSweep") || multiHitSeqs.size > 0 ? 28 : 12;
  view.animationCues = [...cues, ...view.animationCues].slice(0, cueCap);
  for (const cue of cues) {
    if (cue.kind === "play") enqueueCardPlayCue(cue);
    if ((cue.delayMs ?? 0) > 0) window.setTimeout(render, cue.delayMs);
    const lifetime =
      cue.kind === "play" ? 1350
      : cue.kind === "attackerMoves" ? ATTACK_LUNGE_MS
      : cue.kind === "damage" ? 1150
      : cue.kind === "heal" ? 1500
      : cue.kind === "effectStrike" ? 1150
      : cue.kind === "deathrattle" ? 1150
      : cue.kind === "aoeSweep" ? 1100
      : cue.kind === "lock" ? 900
      : cue.kind === "shieldPop" ? 700
      : cue.kind === "bounce" ? 900
      : cue.kind === "destroy" ? 700
      : cue.kind === "summon" ? CARD_PLAY_EFFECT_DELAY_MS + POST_PLAY_STATE_SYNC_LAG_MS
      : cue.kind === "augmentGlow" ? AUGMENT_GLOW_MAX_DEFER_MS + AUGMENT_GLOW_REVEAL_DELAY_MS
      : cue.kind === "questComplete" ? QUEST_COMPLETE_EFFECT_DELAY_MS + 200
      : 900;
    window.setTimeout(() => {
      view.animationCues = view.animationCues.filter((item) => item.id !== cue.id);
      render();
    }, lifetime + (cue.delayMs ?? 0));
  }
  return cues;
}

/**
 * Sequences the 增幅 value reveal (Part B). For each augmentGlow cue that carries
 * affected cards/units, sets a minimum lead so the pre-effect value shows first,
 * holds the public/hand sync so the new value lands as the glow fades, and locks
 * battle input for the window. Augments with no visible target stay dot-only (no
 * hold, no lock). The glow itself is gated on the triggering animation finishing
 * (card-play landing / attack lunge) — see `pumpAugmentGlowGate`. The pump runs
 * for ALL augment glows so e.g. 廠商回扣 (dot-only, fired by a kill) still waits
 * for the attack to land before flashing.
 */
function scheduleAugmentGlowReveal(cues: AnimationCue[]): void {
  const now = performance.now();
  // Instance ids already on either board this frame — a target NOT in this set is
  // a minion summoned by this very batch, which lands via its card-play flush and
  // must not have its public sync held back (or it would pop in late).
  const onBoardIds = new Set<string>();
  for (const seat of ["player1", "player2"] as const) {
    for (const minion of readPlayer(seat)?.board ?? []) onBoardIds.add(minion.instanceId);
  }
  let hasAugmentGlow = false;
  for (const cue of cues) {
    if (cue.kind !== "augmentGlow") continue;
    hasAugmentGlow = true;
    const targets = cue.augmentTargets ?? [];
    const myCards = cue.seat === view.mySeat ? cue.augmentCards ?? [] : [];
    if (targets.length === 0 && myCards.length === 0) continue;

    // Freshly-drawn cards need a longer lead so the ~850ms draw flight lands first.
    const hasFreshDraw = myCards.some((id) => !view.hand.some((card) => card.instanceId === id));
    const lead = hasFreshDraw ? AUGMENT_GLOW_DRAW_LEAD_MS : AUGMENT_GLOW_LEAD_MS;
    const revealAtMs = lead + AUGMENT_GLOW_REVEAL_DELAY_MS;

    cue.readyAtMs = Math.max(cue.readyAtMs ?? 0, now + lead);
    cue.delayMs = Math.max(cue.delayMs ?? 0, lead);

    // Already-on-board stat changes (e.g. amplification-phase category buff) ride
    // the public sync — hold it so the minion shows its pre-effect stats until the
    // glow reveal flushes it. Freshly-summoned targets are excluded: they land at
    // their final stats via the card-play impact flush and just glow afterwards.
    const visibleTargets = targets.filter((id) => onBoardIds.has(id));
    if (visibleTargets.length > 0) {
      holdPendingPublicSyncFor(revealAtMs);
      augmentGlowHoldsSync = true;
    }
    // Freshly-summoned targets land at their final (buffed) stats via the card-play
    // flush, so we can't hold the sync (would strand them off-board). Instead pin
    // them to base stats via the render override until the glow reveal clears it.
    for (const id of targets) if (!onBoardIds.has(id)) augmentHoldBaseStatIds.add(id);

    // Cost changes (fresh draws like 股東紀念品, or whole-hand discounts) show the
    // base cost via the render override until the reveal clears it — simpler and
    // race-free vs. holding the whole hand sync (which would also hide new cards).
    for (const id of myCards) augmentHoldBaseCostIds.add(id);

    augmentGlowLockUntilMs = Math.max(augmentGlowLockUntilMs, now + revealAtMs);
  }
  if (hasAugmentGlow && augmentGlowPumpTimer === undefined) {
    augmentGlowPumpTimer = window.setTimeout(pumpAugmentGlowGate, 0);
  }
}

/**
 * While an augment glow is queued, holds it back until the animation that
 * triggered it finishes — a minion's card-play landing (`cardPlayPreviewBusy`)
 * or an attacker's lunge (`attackAnimationBusy`) — then lets `applyPostRenderEffects`
 * fire it. The minion/effect should appear first, the glow second. While deferred,
 * a value-changing glow keeps the pre-effect value frozen (publicSync hold) and
 * input locked. A per-cue deadline force-fires the glow as a fail-safe so a stuck
 * busy flag can't strand the reveal. Self-reschedules until no glow is pending.
 */
function pumpAugmentGlowGate(): void {
  augmentGlowPumpTimer = undefined;
  const now = performance.now();
  const pending = view.animationCues.filter(
    (cue) => cue.kind === "augmentGlow" && cue.seat && !appliedAugmentGlow.has(cue.id)
  );
  if (pending.length === 0) {
    augmentGlowDeadlines.clear();
    augmentGlowHoldsSync = false;
    return;
  }

  const busy = cardPlayPreviewBusy() || attackAnimationBusy();
  let anyValueChanging = false;
  let anyWaiting = false;
  for (const cue of pending) {
    if ((cue.augmentTargets?.length ?? 0) > 0 || (cue.seat === view.mySeat && (cue.augmentCards?.length ?? 0) > 0)) {
      anyValueChanging = true;
    }
    if (!augmentGlowDeadlines.has(cue.id)) augmentGlowDeadlines.set(cue.id, now + AUGMENT_GLOW_MAX_DEFER_MS);
    if (now >= (augmentGlowDeadlines.get(cue.id) ?? 0)) {
      // Fail-safe: never leave the reveal stranded if a busy flag never clears.
      applyAugmentGlow(cue);
      continue;
    }
    // While the triggering animation runs, keep pushing the glow's earliest-fire
    // time forward, so it only becomes ready AUGMENT_GLOW_SETTLE_MS after the
    // animation last cleared — the deliberate gap between action and glow.
    if (busy) cue.readyAtMs = Math.max(cue.readyAtMs ?? 0, now + AUGMENT_GLOW_SETTLE_MS);
    if (busy || !cueIsReady(cue)) anyWaiting = true;
  }

  // Keep input locked while any value-changing glow waits on its animation (or
  // lead). Only re-assert the public-sync hold when this batch actually holds it
  // for an on-board target — re-holding for a fresh summon would strand it off-board.
  if (anyValueChanging && anyWaiting) {
    if (augmentGlowHoldsSync) holdPendingPublicSyncFor(AUGMENT_GLOW_REVEAL_DELAY_MS + 160);
    augmentGlowLockUntilMs = Math.max(augmentGlowLockUntilMs, now + AUGMENT_GLOW_REVEAL_DELAY_MS + 160);
  }

  render(); // re-run applyPostRenderEffects so a now-ungated glow can fire
  augmentGlowPumpTimer = window.setTimeout(pumpAugmentGlowGate, 70);
}

function appendKoSoloHealCue(cues: AnimationCue[], events: GameEvent[]): AoeCluster | undefined {
  if (events.some((event) => event.type === "HEAL")) return undefined;
  const summon = events.find((event) => event.type === "MINION_SUMMONED" && event.payload?.cardId === "TW011");
  const targetKey = typeof summon?.payload?.target === "string" ? summon.payload.target : undefined;
  if (!summon || !targetKey) return undefined;
  const playedKo = events.some((event) => event.type === "CARD_PLAYED" && event.payload?.cardId === "TW011");
  if (!playedKo) return undefined;
  const seq = summon.seq + 0.011;
  cues.push({
    id: `${summon.seq}-KO-SOLO-HEAL-${createClientId()}`,
    kind: "heal",
    text: "+0",
    seat: summon.seat,
    targetKey,
    cardId: "TW011",
    amount: 0,
    scope: "aoe",
    seq
  });
  return {
    kind: "aoeSweep",
    variant: "heal",
    seat: summon.seat,
    memberSeqs: [seq]
  };
}

/** Builds the single board-wide overlay cue for one AOE cluster. */
function buildAoeSweepCue(cluster: AoeCluster): AnimationCue {
  const seat = cluster.seat;
  const seatSide: "player" | "opponent" = seat && seat === view.mySeat ? "player" : "opponent";
  return {
    id: `aoe-${cluster.variant}-${createClientId()}`,
    kind: "aoeSweep",
    text: "",
    seat,
    scope: "aoe",
    variant: cluster.variant,
    seatSide,
    // Anchored to the affected seat's board element (player1 / player2),
    // which renders top or bottom depending on the local viewpoint → mirrors.
    targetKey: seat ? `board:${seat}` : undefined
  };
}

/**
 * Splices each cluster's sweep cue just before its first member so the post-play
 * / post-attack delay pass (which walks forward from the play/attack cue) gives
 * the sweep the same delay as its members, and so it renders behind them.
 */
function insertAoeSweepCues(cues: AnimationCue[], clusters: AoeCluster[]): void {
  for (const cluster of clusters) {
    const members = new Set(cluster.memberSeqs);
    const firstIndex = cues.findIndex((cue) => cue.seq !== undefined && members.has(cue.seq));
    const sweep = buildAoeSweepCue(cluster);
    if (firstIndex < 0) cues.push(sweep);
    else cues.splice(firstIndex, 0, sweep);
  }
}

function applyPostPlayEffectDelays(rawCues: AnimationCue[], multiHitSeqs: Set<number> = new Set()): AnimationCue[] {
  const cues: AnimationCue[] = [];
  let queuedPlaySlot = cardPlayCueQueue.length + (cardPlayCueActive ? 1 : 0);
  let currentPostPlayDelay = 0;
  let currentSummonPreviewDelay = 0;
  let currentLandingTargetKey: string | undefined;
  let multiHitIndex = 0;

  for (const cue of rawCues) {
    if (cue.kind === "play") {
      // Targeted battlecries played locally already ran their card-play
      // animation before the command was sent. Effects still need to wait until
      // that local landing has fully settled (overlay removed AND dust cleared)
      // so the battlecry doesn't fire mid-animation when the user clicks fast.
      if (consumeSuppressedPlayCue(cue)) {
        const settleAtMs = (battlecryLocalLandingStartMs ?? performance.now()) + CARD_PLAY_FULL_MS;
        const remaining = Math.max(0, settleAtMs - performance.now());
        currentPostPlayDelay = remaining;
        currentSummonPreviewDelay = 0;
        currentLandingTargetKey = cue.targetKey;
        if (remaining > 0) holdPendingPublicSyncFor(remaining + POST_PLAY_STATE_SYNC_LAG_MS);
        continue;
      }
      currentPostPlayDelay = queuedPlaySlot * CARD_PLAY_CUE_TOTAL_MS + CARD_PLAY_EFFECT_DELAY_MS;
      currentSummonPreviewDelay = queuedPlaySlot * CARD_PLAY_CUE_TOTAL_MS + CARD_PLAY_IMPACT_OFFSET_MS;
      currentLandingTargetKey = cue.targetKey;
      queuedPlaySlot += 1;
      cues.push(cue);
      continue;
    }

    const isLandingSummon = cue.kind === "summon" && cue.targetKey === currentLandingTargetKey;
    if (isLandingSummon) {
      const delayMs = currentSummonPreviewDelay > 0
        ? Math.max(cue.delayMs ?? 0, currentSummonPreviewDelay)
        : cue.delayMs;
      cues.push({
        ...cue,
        delayMs,
        readyAtMs: delayMs !== undefined ? performance.now() + delayMs : cue.readyAtMs,
        suppressBoardAnimation: true
      });
      continue;
    }
    // Multi-hit strike (e.g. S002): stagger each hit's blade by index so the N
    // blades fly one after another, and hold the board HP until the LAST hit's
    // impact peak so the digits snap once at the finale (D-i).
    if (
      currentPostPlayDelay > 0 &&
      !isLandingSummon &&
      isPostPlayEffectCue(cue) &&
      cue.seq !== undefined &&
      multiHitSeqs.has(cue.seq)
    ) {
      const staggered = currentPostPlayDelay + multiHitIndex * MULTI_HIT_STRIKE_STAGGER_MS;
      multiHitIndex += 1;
      // Fixed cap (not the live index) so every cue's hold covers all N hits,
      // even though cues are processed before the final index is known.
      holdPendingPublicSyncFor(
        currentPostPlayDelay +
          (MULTI_HIT_STRIKE_COUNT_CAP - 1) * MULTI_HIT_STRIKE_STAGGER_MS +
          MULTI_HIT_STRIKE_FLUSH_IMPACT_OFFSET_MS
      );
      cues.push({
        ...cue,
        delayMs: Math.max(cue.delayMs ?? 0, staggered),
        readyAtMs: performance.now() + staggered
      });
      continue;
    }
    if (currentPostPlayDelay > 0 && !isLandingSummon && isPostPlayEffectCue(cue)) {
      const syncLag =
        cue.kind === "bounce" ? BOUNCE_EFFECT_SYNC_LAG_MS
        : cue.kind === "destroy" ? DESTROY_EFFECT_SYNC_LAG_MS
        : POST_PLAY_STATE_SYNC_LAG_MS;
      holdPendingPublicSyncFor(currentPostPlayDelay + syncLag);
      if (cue.kind === "bounce") holdPlayerHandSyncFor(currentPostPlayDelay + syncLag, { suppressNewIds: true });
      if (cue.kind === "destroy") {
        blog("hold publicSync for destroy visual", {
          delayMs: Math.round(currentPostPlayDelay + syncLag),
          targetKey: cue.targetKey
        });
      }
      cues.push({
        ...cue,
        delayMs: Math.max(cue.delayMs ?? 0, currentPostPlayDelay),
        readyAtMs: performance.now() + currentPostPlayDelay
      });
      continue;
    }

    cues.push(cue);
  }

  return cues;
}

function isPostPlayEffectCue(cue: AnimationCue): boolean {
  return cue.kind === "damage"
    || cue.kind === "heal"
    || cue.kind === "buff"
    || cue.kind === "bounce"
    || cue.kind === "destroy"
    || cue.kind === "summon"
    || cue.kind === "effectStrike"
    || cue.kind === "deathrattle"
    || cue.kind === "shieldPop"
    || cue.kind === "lock"
    || cue.kind === "aoeSweep";
}

function applyPostAttackEffectDelays(rawCues: AnimationCue[]): AnimationCue[] {
  const cues: AnimationCue[] = [];
  let pendingAttackEffectDelayMs = 0;

  for (const cue of rawCues) {
    if (cue.kind === "attackerMoves") {
      pendingAttackEffectDelayMs = ATTACK_IMPACT_DELAY_MS;
      holdPendingPublicSyncFor(ATTACK_LUNGE_MS + POST_ATTACK_STATE_SYNC_LAG_MS);
      cues.push(cue);
      continue;
    }
    if (pendingAttackEffectDelayMs > 0 && isPostAttackEffectCue(cue)) {
      const delayMs = cue.kind === "destroy" ? ATTACK_LUNGE_MS : pendingAttackEffectDelayMs;
      const effectDelayMs = Math.max(cue.delayMs ?? 0, delayMs);
      if (cue.kind === "bounce") {
        holdPendingPublicSyncFor(effectDelayMs + BOUNCE_EFFECT_SYNC_LAG_MS);
        holdPlayerHandSyncFor(effectDelayMs + BOUNCE_EFFECT_SYNC_LAG_MS, { suppressNewIds: true });
      }
      cues.push({
        ...cue,
        delayMs: effectDelayMs,
        readyAtMs: performance.now() + effectDelayMs
      });
      continue;
    }
    cues.push(cue);
  }
  return cues;
}

function isPostAttackEffectCue(cue: AnimationCue): boolean {
  return cue.kind === "damage"
    || cue.kind === "heal"
    || cue.kind === "buff"
    || cue.kind === "bounce"
    || cue.kind === "destroy"
    || cue.kind === "effectStrike"
    || cue.kind === "deathrattle"
    || cue.kind === "shieldPop"
    || cue.kind === "lock"
    || cue.kind === "aoeSweep";
}

/**
 * After a `questComplete` cue, delays all downstream effect cues so the golden
 * flash has time to register before damage / destroy / summon animate.
 * Holds `pendingPublicSync` so the board stays frozen at the pre-effect state
 * while the effects play through.
 */
function applyPostQuestEffectDelays(rawCues: AnimationCue[]): AnimationCue[] {
  const cues: AnimationCue[] = [];
  let pendingQuestDelay = 0;

  for (const cue of rawCues) {
    if (cue.kind === "questComplete") {
      pendingQuestDelay = QUEST_COMPLETE_EFFECT_DELAY_MS;
      holdPendingPublicSyncFor(QUEST_COMPLETE_EFFECT_DELAY_MS + DESTROY_EFFECT_SYNC_LAG_MS);
      cues.push(cue);
      continue;
    }
    if (pendingQuestDelay > 0 && isPostQuestEffectCue(cue)) {
      const syncLag =
        cue.kind === "destroy" ? DESTROY_EFFECT_SYNC_LAG_MS
        : cue.kind === "bounce" ? BOUNCE_EFFECT_SYNC_LAG_MS
        : POST_PLAY_STATE_SYNC_LAG_MS;
      holdPendingPublicSyncFor(pendingQuestDelay + syncLag);
      if (cue.kind === "bounce") holdPlayerHandSyncFor(pendingQuestDelay + syncLag, { suppressNewIds: true });
      cues.push({
        ...cue,
        delayMs: Math.max(cue.delayMs ?? 0, pendingQuestDelay),
        readyAtMs: performance.now() + pendingQuestDelay
      });
      continue;
    }
    cues.push(cue);
  }
  return cues;
}

function isPostQuestEffectCue(cue: AnimationCue): boolean {
  return cue.kind === "damage"
    || cue.kind === "heal"
    || cue.kind === "buff"
    || cue.kind === "bounce"
    || cue.kind === "destroy"
    || cue.kind === "effectStrike"
    || cue.kind === "deathrattle"
    || cue.kind === "shieldPop"
    || cue.kind === "lock"
    || cue.kind === "aoeSweep"
    || cue.kind === "summon";
}

function eventToCue(event: GameEvent, events: GameEvent[] = [], index = -1, combatDamageSeqs?: Set<number>): AnimationCue | undefined {
  const payload = event.payload ?? {};
  const target = typeof payload.target === "string" ? payload.target : undefined;
  const amount = typeof payload.amount === "number" ? payload.amount : undefined;
  const cardId = typeof payload.cardId === "string" ? payload.cardId : undefined;
  const id = `${event.seq}-${event.type}-${createClientId()}`;
  if (event.type === "CARD_PLAYED") {
    const playedCardId = typeof payload.cardId === "string" ? payload.cardId : undefined;
    return {
      id,
      kind: "play",
      text: cardName(playedCardId) ?? "Card played",
      seat: event.seat,
      cardId: playedCardId,
      playAttack: typeof payload.attack === "number" ? payload.attack : undefined,
      playHealth: typeof payload.health === "number" ? payload.health : undefined,
      playEffectValue: typeof payload.effectValue === "number" ? payload.effectValue : undefined,
      playBaseEffectValue: typeof payload.baseEffectValue === "number" ? payload.baseEffectValue : undefined,
      playEffectBonusValue: typeof payload.effectBonusValue === "number" ? payload.effectBonusValue : undefined,
      playBaseEffectBonusValue: typeof payload.baseEffectBonusValue === "number" ? payload.baseEffectBonusValue : undefined,
      targetKey: findLandingTargetKey(events, index, event.seat, playedCardId)
    };
  }
  if (event.type === "MINION_SUMMONED") {
    return { id, kind: "summon", text: "Summoned", seat: event.seat, targetKey: target, cardId };
  }
  if (event.type === "AUGMENT_TRIGGERED") {
    // The augment indicator pulse is applied imperatively (applyAugmentGlow) off
    // the owner's seat; cardId carries the augment id so the right dot lights up.
    // targets/cards (optional, additive) carry the board minion / hand card
    // instanceIds the 增幅 changed, so the glow also lands on them (Part B).
    const augmentId = typeof payload.augmentId === "string" ? payload.augmentId : undefined;
    const stringList = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    return {
      id,
      kind: "augmentGlow",
      text: "",
      seat: event.seat,
      cardId: augmentId,
      augmentTargets: stringList(payload.targets),
      augmentCards: stringList(payload.cards)
    };
  }
  if (event.type === "ATTACK") {
    const attackerInstanceId = typeof payload.attackerInstanceId === "string" ? payload.attackerInstanceId : undefined;
    const targetRef = (payload.target ?? undefined) as TargetRef | undefined;
    const targetKey = targetRef ? targetKeyFor(targetRef) : undefined;
    return { id, kind: "attackerMoves", text: "", seat: event.seat, attackerInstanceId, targetKey };
  }
  // DAMAGE / HEAL / BUFF / SHIELD_POPPED / BOUNCE / DESTROY / DEATHRATTLE all
  // map through the shared cue-kind table. The batch-level `combatDamageSeqs`
  // decides whether a DAMAGE is a basic combat hit ("damage") or a spell strike
  // ("effectStrike"); the AOE scope is tagged later in enqueueEventCues.
  const effectKind = mapEventToCueKind(event, combatDamageSeqs ? combatDamageSeqs.has(event.seq) : true);
  if (effectKind) {
    const effectTargetKey = event.type === "DEATHRATTLE"
      ? (typeof payload.source === "string" ? payload.source : undefined)
      : target;
    const text =
      effectKind === "damage" || effectKind === "effectStrike" ? (amount ? `-${amount}` : "Damage")
      : effectKind === "heal" ? (amount ? `+${amount}` : "Heal")
      : effectKind === "shieldPop" ? "Shield"
      : effectKind === "lock" ? "Locked"
      : effectKind === "bounce" ? "Bounce"
      : effectKind === "destroy" ? "Destroyed"
      : effectKind === "deathrattle" ? "Deathrattle"
      : "Buff";
    // Battlecry damage and selected NEWS damage can carry a sourceKey so the
    // imperative blade sprite knows where to fly from.
    const sourceKey = effectKind === "effectStrike" ? findEffectSourceKey(events, index) : undefined;
    return { id, kind: effectKind, text, seat: event.seat, targetKey: effectTargetKey, sourceKey, cardId, amount, seq: event.seq };
  }
  if (event.type === "QUEST_COMPLETED") {
    const source = typeof payload.source === "string" ? payload.source : undefined;
    return { id, kind: "questComplete", text: "任務完成", seat: event.seat, targetKey: source, cardId };
  }
  if (event.type === "TURN_STARTED") return undefined;
  if (event.type === "COMMAND_REJECTED") return { id, kind: "reject", text: String(payload.reason ?? "動作被拒絕。"), seat: event.seat };
  return undefined;
}

function findLandingTargetKey(events: GameEvent[], startIndex: number, seat: Seat | undefined, cardId: string | undefined): string | undefined {
  if (startIndex < 0 || !seat || !cardId) return undefined;
  for (let i = startIndex + 1; i < events.length; i++) {
    const event = events[i];
    if (event.type === "CARD_PLAYED") break;
    if (event.type !== "MINION_SUMMONED" || event.seat !== seat) continue;
    if (event.payload?.cardId !== cardId) continue;
    return typeof event.payload.target === "string" ? event.payload.target : undefined;
  }
  return undefined;
}

function pruneSelections(): void {
  const handIds = new Set(view.hand.map((card) => card.instanceId));
  if (view.selectedHandId && !handIds.has(view.selectedHandId)) view.selectedHandId = undefined;
  // Keep a committed battlecry preview until the synced board has a real
  // replacement minion that can adopt its DOM key.
  if (canClearPendingBattlecry(handIds)) {
    blog("pruneSelections clearing battlecry");
    clearPendingBattlecry();
  }
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
    if (view.selectedHandId && handCardNeedsTarget(selectedHandCard()) && !isLegalCardTarget(target)) {
      view.selectedTarget = undefined;
    }
  }
}

function canClearPendingBattlecry(handIds = new Set(view.hand.map((card) => card.instanceId))): boolean {
  const pending = activeBattlecryPreview();
  if (!pending || handIds.has(pending.handInstanceId)) return false;
  if (!pending.isMinion || pending.phase !== "committed") return true;
  return hasBattlecryReplacement(Array.from(readPlayer(view.mySeat ?? "player1")?.board ?? []), pending);
}

function activeBattlecryPreview(): BattlecryPreviewState | undefined {
  return view.pendingBattlecry ?? view.acceptedBattlecry;
}

function clearAcceptedBattlecryAfterRender(): boolean {
  const pending = activeBattlecryPreview();
  if (pending) {
    const seat = view.mySeat ?? "player1";
    const board = Array.from(readPlayer(seat)?.board ?? []);
    const handIds = new Set(view.hand.map((card) => card.instanceId));
    blog("clearAcceptedBattlecryAfterRender check", {
      canClear: canClearPendingBattlecry(handIds),
      phase: pending.phase,
      handHasCard: handIds.has(pending.handInstanceId),
      hasReplacement: hasBattlecryReplacement(board as PublicMinion[], pending),
      boardIds: board.map((m) => (m as PublicMinion).instanceId)
    });
  }
  if (!canClearPendingBattlecry()) return false;
  blog("battlecry committed preview handoff end", {
    handInstanceId: activeBattlecryPreview()?.handInstanceId,
    cardId: activeBattlecryPreview()?.cardId
  });
  clearPendingBattlecry();
  return true;
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

function readPhase(): Phase {
  return (view.publicSync?.phase as Phase | undefined) ?? (view.state?.phase as Phase | undefined) ?? "NORMAL_PLAY";
}

/** Current per-side board cap (7 normally; lowered to 3 by the 社交距離 referendum). */
function readBoardLimit(): number {
  return view.publicSync?.boardLimit ?? (view.state?.boardLimit as number | undefined) ?? 7;
}

function readPhaseDeadlineAtMs(): number {
  return view.publicSync?.phaseDeadlineAtMs ?? view.state?.specialPhase?.phaseDeadlineAtMs ?? 0;
}

/** Live seconds left in the current special phase (PvP only); undefined when none. */
function phaseCountdownSeconds(): number | undefined {
  if (!isTimedPlayerMatch()) return undefined;
  const deadlineAtMs = readPhaseDeadlineAtMs();
  if (!deadlineAtMs) return undefined;
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs < -500) return undefined;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function readTurnStartedAtMs(): number {
  return view.publicSync?.turnStartedAtMs ?? view.state?.turn?.startedAtMs ?? 0;
}

function readTurnDeadlineAtMs(): number {
  if (!isTimedPlayerMatch()) return 0;
  return view.publicSync?.turnDeadlineAtMs ?? view.state?.turn?.deadlineAtMs ?? 0;
}

function isTimedPlayerMatch(): boolean {
  return view.room?.name === "pvp";
}

function visibleCountdownSeconds(): number | undefined {
  if (!isTimedPlayerMatch()) return undefined;
  const deadlineAtMs = readTurnDeadlineAtMs();
  if (!deadlineAtMs || readTurnStartedAtMs() <= 0) return undefined;
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs > 10_000 || remainingMs < -500) return undefined;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function renderTurnCountdown(kind: "turn" | "mulligan"): string {
  const seconds = visibleCountdownSeconds();
  if (seconds === undefined) return "";
  const activeSeat = readActiveSeat();
  const label = kind === "mulligan" ? "換牌倒數" : activeSeat === view.mySeat ? "你的回合" : "對手回合";
  return `
    <div class="turn-countdown-badge ${kind} ${seconds <= 3 ? "urgent" : ""}" data-testid="${kind}-countdown" role="status" aria-live="polite">
      <span class="turn-countdown-label">${escapeHtml(label)}</span>
      <span class="turn-countdown-value">${seconds}</span>
    </div>
  `;
}

function syncTurnCountdownTick(status: GameStatus | ""): void {
  // During a special phase the turn clock is frozen; tick on the phase deadline
  // instead and reveal the whole ~30s window (vs. the last 10s for turns).
  const inSpecialPhase = isTimedPlayerMatch() && readPhase() !== "NORMAL_PLAY";
  const deadlineAtMs = inSpecialPhase ? readPhaseDeadlineAtMs() : readTurnDeadlineAtMs();
  const showWindowMs = inSpecialPhase ? 31_000 : 10_000;
  const inTimedMatch = Boolean(
    isTimedPlayerMatch() &&
      view.state &&
      deadlineAtMs > 0 &&
      (inSpecialPhase || status === "mulligan" || status === "in_progress")
  );
  if (!inTimedMatch) {
    stopTurnCountdownTick();
    return;
  }

  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= showWindowMs && remainingMs >= -500) {
    if (turnCountdownWakeTimer !== undefined) {
      window.clearTimeout(turnCountdownWakeTimer);
      turnCountdownWakeTimer = undefined;
      turnCountdownWakeDeadlineAtMs = undefined;
    }
    if (turnCountdownTimer === undefined) {
      turnCountdownTimer = window.setInterval(render, 250);
    }
    return;
  }

  if (turnCountdownTimer !== undefined) {
    window.clearInterval(turnCountdownTimer);
    turnCountdownTimer = undefined;
  }
  if (remainingMs > showWindowMs && turnCountdownWakeDeadlineAtMs !== deadlineAtMs) {
    if (turnCountdownWakeTimer !== undefined) window.clearTimeout(turnCountdownWakeTimer);
    turnCountdownWakeDeadlineAtMs = deadlineAtMs;
    turnCountdownWakeTimer = window.setTimeout(() => {
      turnCountdownWakeTimer = undefined;
      turnCountdownWakeDeadlineAtMs = undefined;
      render();
    }, Math.max(0, remainingMs - showWindowMs));
  }
}

function stopTurnCountdownTick(): void {
  if (turnCountdownTimer !== undefined) {
    window.clearInterval(turnCountdownTimer);
    turnCountdownTimer = undefined;
  }
  if (turnCountdownWakeTimer !== undefined) {
    window.clearTimeout(turnCountdownWakeTimer);
    turnCountdownWakeTimer = undefined;
  }
  turnCountdownWakeDeadlineAtMs = undefined;
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
  if (view.pendingBattlecry) return view.pendingBattlecry.phase === "aiming" && isLegalCardTarget(target);
  if (sameTarget(view.selectedTarget, target)) return true;
  if (view.selectedAttackerId) return isLegalAttackTarget(target);
  if (handCardNeedsTarget(selectedHandCard())) return isLegalCardTarget(target);
  return false;
}

function activeTargeting(): boolean {
  if (view.pendingBattlecry) return view.pendingBattlecry.phase === "aiming";
  return Boolean(view.selectedAttackerId || handCardNeedsTarget(selectedHandCard()));
}

function selectedHandCard(): HandCardView | undefined {
  return view.hand.find((card) => card.instanceId === view.selectedHandId);
}

function isLegalAttackTarget(target: TargetRef, attackerId = view.selectedAttackerId): boolean {
  return !attackTargetError(target, attackerId);
}

function attackTargetError(target: TargetRef | undefined, attackerId = view.selectedAttackerId): string | undefined {
  if (!target) return "請選擇攻擊目標。";
  if (!view.mySeat || !attackerId) return "請先選擇要攻擊的隨從。";
  const attacker = Array.from(readPlayer(view.mySeat)?.board ?? []).find((minion) => minion.instanceId === attackerId);
  const attackerReason = attackerError(attacker);
  if (attackerReason) return attackerReason;
  const enemy = otherSeat(view.mySeat);
  if (target.side !== enemy) return "只能攻擊敵方目標。";
  if (target.type === "MINION" && !targetMinionExists(target)) return "找不到目標隨從。";
  const enemyTaunts = Array.from(readPlayer(enemy)?.board ?? []).filter((minion) => minion.taunt);
  if (enemyTaunts.length > 0 && !(target.type === "MINION" && enemyTaunts.some((minion) => minion.instanceId === target.instanceId))) {
    return "請先攻擊具有沙包的敵方隨從。";
  }
  return undefined;
}

/** Why a minion of mine cannot attack right now, or undefined if it can. */
function attackerError(attacker: PublicMinion | undefined): string | undefined {
  if (!attacker) return "找不到攻擊者。";
  if (readActiveSeat() !== view.mySeat) return "還沒輪到你的回合。";
  if (attacker.lockedTurns > 0) return "這名隨從被鎖定，不能攻擊。";
  if (attacker.attack <= 0) return "這名隨從沒有攻擊力，無法攻擊。";
  if (attacker.sleeping) return "這名隨從剛上場，本回合還不能攻擊。";
  if (!attacker.canAttack) return "這名隨從本回合已經攻擊過了。";
  return undefined;
}

function canUseMinionAsAttacker(attacker: PublicMinion | undefined): boolean {
  return !attackerError(attacker);
}

/** Why a card in my hand cannot be played right now, or undefined if it can. */
function cardPlayError(card: HandCardView): string | undefined {
  if (readActiveSeat() !== view.mySeat) return "還沒輪到你的回合。";
  const player = view.mySeat ? readPlayer(view.mySeat) : undefined;
  if (player && player.mana.current < card.cost) return "魔力不足，無法使用這張牌。";
  return undefined;
}

/** The card currently choosing a battlecry target — selected in hand, or mid two-stage play. */
function targetingCardId(): string | undefined {
  if (view.pendingBattlecry) return view.pendingBattlecry.cardId;
  return view.selectedHandId ? selectedHandCard()?.cardId : undefined;
}

function isLegalCardTarget(target: TargetRef): boolean {
  return !cardTargetError(target);
}

function cardTargetError(target: TargetRef | undefined): string | undefined {
  const cardId = targetingCardId();
  if (!cardId || !view.mySeat) return "請先選擇要指定目標的卡牌。";
  const rule = cardCatalog.get(cardId)?.keywords?.battlecry?.target;
  if (!rule) return "這張牌不需要指定目標。";
  if (!target) return "這張牌需要選擇目標。";
  const expectedSides = targetRuleSides(rule.side);
  const expectedTypes = targetRuleTypes(rule.type);
  if (!expectedTypes.includes(target.type)) {
    if (rule.type === "MINION") return "這個目標不是隨從。";
    if (rule.type === "HERO") return "這個目標不是英雄。";
    return "這個目標類型不正確。";
  }
  if (!target.side || !expectedSides.includes(target.side)) {
    if (rule.side === "FRIENDLY") return "這個目標不是友軍。";
    if (rule.side === "ENEMY") return "這個目標不是敵軍。";
    return "這個目標陣營不正確。";
  }
  if (target.type === "MINION" && !targetMinionExists(target)) return "找不到目標隨從。";
  return undefined;
}

function targetMinionExists(target: TargetRef): boolean {
  return Boolean(target.side && target.instanceId && Array.from(readPlayer(target.side)?.board ?? []).some((minion) => minion.instanceId === target.instanceId));
}

/** True if at least one unit on the field satisfies the card's battlecry target rule. */
function hasLegalTargetForCard(cardId: string): boolean {
  const rule = cardCatalog.get(cardId)?.keywords?.battlecry?.target;
  if (!rule || !view.mySeat) return false;
  const expectedSides = targetRuleSides(rule.side);
  const expectedTypes = targetRuleTypes(rule.type);
  for (const seat of expectedSides) {
    const player = readPlayer(seat);
    if (!player) continue;
    if (expectedTypes.includes("HERO") && player.hero) return true;
    if (expectedTypes.includes("MINION") && (player.board?.length ?? 0) > 0) return true;
  }
  return false;
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
  return view.animationCues.some((cue) => cue.targetKey === targetKey && (!kind || cue.kind === kind) && cueIsReady(cue));
}

function cueIsReady(cue: AnimationCue): boolean {
  return !cue.readyAtMs || performance.now() >= cue.readyAtMs;
}

const appliedLunges = new Set<string>();
const activeAttackLunges = new Map<string, { dx: number; dy: number }>();

function attackLungeDelta(attackerRect: DOMRect, targetRect: DOMRect, targetIsHero = false): { dx: number; dy: number } {
  const rawDx = targetRect.left + targetRect.width / 2 - (attackerRect.left + attackerRect.width / 2);
  const rawDy = targetRect.top + targetRect.height / 2 - (attackerRect.top + attackerRect.height / 2);
  if (targetIsHero) {
    return {
      dx: Math.round(rawDx),
      dy: Math.round(rawDy)
    };
  }

  const distance = Math.hypot(rawDx, rawDy);
  if (distance <= 0) return { dx: 0, dy: 0 };

  const ux = rawDx / distance;
  const uy = rawDy / distance;
  const attackerEdge = Math.abs(ux) * attackerRect.width / 2 + Math.abs(uy) * attackerRect.height / 2;
  const targetEdge = Math.abs(ux) * targetRect.width / 2 + Math.abs(uy) * targetRect.height / 2;
  const contactOverlap = Math.min(targetEdge * 0.72, Math.max(24, attackerEdge * 0.45));
  const travel = Math.max(0, distance - attackerEdge - targetEdge + contactOverlap);

  return {
    dx: Math.round(ux * travel),
    dy: Math.round(uy * travel)
  };
}

function attackTargetRect(target: HTMLElement, targetKey: string): DOMRect {
  if (targetKey.endsWith(":hero")) {
    return target.querySelector<HTMLElement>(".avatar")?.getBoundingClientRect() ?? target.getBoundingClientRect();
  }
  return target.getBoundingClientRect();
}

function startAttackLunge(cue: AnimationCue): boolean {
  if (cue.kind !== "attackerMoves" || !cue.attackerInstanceId || !cue.targetKey || appliedLunges.has(cue.id)) return false;
  const attackerSelector = `[data-target-key="${cssEscape(cue.attackerInstanceId)}"]`;
  const targetSelector = `[data-target-key="${cssEscape(cue.targetKey)}"]`;
  const attacker = document.querySelector<HTMLElement>(attackerSelector);
  const target = document.querySelector<HTMLElement>(targetSelector);
  if (!attacker || !target) return false;

  const attackerRect = attacker.getBoundingClientRect();
  const targetRect = attackTargetRect(target, cue.targetKey);
  const { dx, dy } = attackLungeDelta(attackerRect, targetRect, cue.targetKey.endsWith(":hero"));

  appliedLunges.add(cue.id);
  activeAttackLunges.set(cue.attackerInstanceId, { dx, dy });
  render();

  window.setTimeout(() => {
    activeAttackLunges.delete(cue.attackerInstanceId!);
    appliedLunges.delete(cue.id);
    flushPendingPublicSync();
    render();
  }, ATTACK_LUNGE_MS);
  return true;
}

// Battlecry flying knife — fired imperatively (once) when the effect cue is
// ready, into a body-level sprite that the main render loop never touches, so
// its CSS fly animation can't be reset by a re-render mid-flight.
function applyKnifeStrike(cue: AnimationCue): void {
  if (cue.kind !== "effectStrike" || !cue.sourceKey || !cue.targetKey || appliedKnives.has(cue.id)) return;
  // Target rect: live on the board, or — when this same battlecry just killed it
  // — the rect captured at death (recentUnitRects) so the knife still lands.
  const targetEl = document.querySelector<HTMLElement>(`[data-target-key="${cssEscape(cue.targetKey)}"]`);
  let tr = targetEl?.getBoundingClientRect();
  if (!tr || tr.width === 0) {
    const recent = recentUnitRects.get(cue.targetKey);
    if (recent && performance.now() - recent.atMs < 2000) tr = recent.rect;
  }
  if (!tr || tr.width === 0) return; // not placeable yet — retry next render
  // Source rect: the caster's real minion, or its in-flight battlecry preview
  // (which carries no target-key) while the board update is still held.
  const sourceEl = document.querySelector<HTMLElement>(`[data-target-key="${cssEscape(cue.sourceKey)}"]`)
    ?? document.querySelector<HTMLElement>(".battlecry-preview");
  if (!sourceEl) return; // caster not on screen yet — retry next render
  const sr = sourceEl.getBoundingClientRect();
  appliedKnives.add(cue.id);

  const tx = tr.left + tr.width / 2;
  const ty = tr.top + tr.height / 2;
  const dx = sr.left + sr.width / 2 - tx;
  const dy = sr.top + sr.height / 2 - ty;
  const angle = Math.round(Math.atan2(-dy, -dx) * (180 / Math.PI));

  const knife = document.createElement("i");
  knife.className = "attack-sprite";
  knife.setAttribute("aria-hidden", "true");
  knife.style.position = "fixed";
  knife.style.left = `${Math.round(tx)}px`;
  knife.style.top = `${Math.round(ty)}px`;
  knife.style.zIndex = "2001";
  knife.style.setProperty("--fly-dx", `${Math.round(dx)}px`);
  knife.style.setProperty("--fly-dy", `${Math.round(dy)}px`);
  knife.style.setProperty("--fly-angle", `${angle}deg`);
  document.body.appendChild(knife);
  // Removed after the fly animation (0.34s) finishes; the id stays in
  // appliedKnives so the still-alive cue can't spawn a second knife.
  window.setTimeout(() => knife.remove(), 420);
}

// Shared core for the death-shatter visual: slices `bgImg` (sampled over `rect`)
// into a cols×rows grid of fragments that fly apart and fade. Used by both the
// minion shatter (fast, 0.78s) and the hero shatter (slow, HERO_SHATTER_MS).
// `spreadScale` widens the fly distance for the larger hero portrait. Returns
// the body-level container so callers can schedule its own removal.
function spawnShatter(
  rect: DOMRect,
  bgImg: string | null,
  opts: { durationMs: number; cols: number; rows: number; spreadScale?: number }
): HTMLElement {
  const { durationMs, cols, rows, spreadScale = 1 } = opts;
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;z-index:2000;overflow:visible;`;
  document.body.appendChild(container);

  const fragW = rect.width / cols;
  const fragH = rect.height / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const frag = document.createElement("div");
      frag.className = "shatter-fragment";
      frag.style.width = `${fragW}px`;
      frag.style.height = `${fragH}px`;
      frag.style.left = `${c * fragW}px`;
      frag.style.top = `${r * fragH}px`;
      frag.style.setProperty("--shatter-dur", `${durationMs}ms`);
      if (bgImg) {
        frag.style.backgroundImage = bgImg;
        frag.style.backgroundSize = `${rect.width}px ${rect.height}px`;
        frag.style.backgroundPosition = `-${c * fragW}px -${r * fragH}px`;
      } else {
        frag.style.background = "linear-gradient(135deg,#444,#111)";
      }
      const angle = Math.random() * Math.PI * 2;
      const dist = (50 + Math.random() * 150) * spreadScale;
      frag.style.setProperty("--dx", `${Math.round(Math.cos(angle) * dist)}px`);
      frag.style.setProperty("--dy", `${Math.round(Math.sin(angle) * dist)}px`);
      frag.style.setProperty("--dr", `${Math.round((Math.random() - 0.5) * 600)}deg`);
      container.appendChild(frag);
    }
  }
  return container;
}

function applyDeathShatter(cue: AnimationCue): void {
  if (cue.kind !== "destroy" || !cue.targetKey || appliedDeathShatters.has(cue.id)) return;
  const minionEl = document.querySelector<HTMLElement>(`[data-target-key="${cssEscape(cue.targetKey)}"]`);
  if (!minionEl) return;
  appliedDeathShatters.add(cue.id);

  const rect = minionEl.getBoundingClientRect();
  blog("DEATHSHATTER-DBG fired", { targetKey: cue.targetKey, left: Math.round(rect.left) });
  recentUnitRects.set(cue.targetKey, { rect, atMs: performance.now() });
  const artEl = minionEl.querySelector<HTMLElement>(".minion-art");
  const bgImg = artEl ? artEl.style.backgroundImage : null;

  const container = spawnShatter(rect, bgImg, { durationMs: 780, cols: 4, rows: 5 });
  window.setTimeout(() => {
    container.remove();
    appliedDeathShatters.delete(cue.id);
  }, 800);
}

// Hero counterpart of applyDeathShatter: when a hero dies (GAME_FINISHED), the
// losing hero's circular portrait shatters — slower (HERO_SHATTER_MS) and more
// dramatically than a minion. The portrait image is a CSS background on the
// `.avatar` child, so it must be read via getComputedStyle (not inline .style).
// Fires once per match, gated by heroShatterFired.
function applyHeroShatter(loserSeat: Seat): void {
  if (heroShatterFired) return;
  const heroEl = document.querySelector<HTMLElement>(`[data-target-key="${cssEscape(`${loserSeat}:hero`)}"]`);
  const avatarEl = heroEl?.querySelector<HTMLElement>(".avatar");
  if (!heroEl || !avatarEl) return;
  heroShatterFired = true;

  const rect = avatarEl.getBoundingClientRect();
  const computedBg = getComputedStyle(avatarEl).backgroundImage;
  const bgImg = computedBg && computedBg !== "none" ? computedBg : null;
  recentUnitRects.set(`${loserSeat}:hero`, { rect, atMs: performance.now() });
  // Hide the intact portrait from here on (driven by the render template, since
  // the very next render() reconciles this hero button).
  shatteringHeroSeat = loserSeat;

  const container = spawnShatter(rect, bgImg, {
    durationMs: HERO_SHATTER_MS,
    cols: 5,
    rows: 6,
    spreadScale: 1.4
  });
  window.setTimeout(() => container.remove(), HERO_SHATTER_MS + 60);
}

// On GAME_FINISHED, play the losing hero's slow death shatter, then reveal the
// VICTORY/DEFEAT overlay only after it finishes. Shared by PvP / PvE / training
// (all flow through handleEvents). `hero_destroyed`/`concede` both shatter the
// loser; `abandoned` (disconnect) emits no GAME_FINISHED so the overlay still
// shows immediately. Sets resultOverlayHoldUntilMs, which gates
// renderResultOverlay and the training reward animation.
function scheduleHeroDeathSequence(finishedEvent: GameEvent, cues: AnimationCue[]): void {
  if (resultOverlayHoldUntilMs !== 0) return; // already scheduled this match
  const winnerSeat =
    (finishedEvent.payload?.winnerSeat as Seat | undefined)
    ?? view.publicSync?.result?.winnerSeat
    ?? view.state?.result?.winnerSeat;
  if (!winnerSeat) return;
  const loserSeat = otherSeat(winnerSeat);
  // Let the killing blow's damage number land before the portrait shatters.
  const finalCueDelayMs = cues.reduce((max, cue) => Math.max(max, cue.delayMs ?? 0), 0);
  const holdMs = finalCueDelayMs + HERO_SHATTER_MS + RESULT_OVERLAY_PAUSE_MS;
  resultOverlayHoldUntilMs = performance.now() + holdMs;
  // Keep the board (counts) from snapping to the post-match state early.
  holdPendingPublicSyncFor(holdMs);
  window.setTimeout(() => {
    applyHeroShatter(loserSeat);
    render();
  }, finalCueDelayMs);
  // Reveal the overlay once the shatter (and settle pause) has elapsed.
  window.setTimeout(() => render(), holdMs);
}

// Spawns the 遺志 soul plume imperatively at the dead minion's slot. The unit
// may already be gone from the DOM (DESTROY ran first), so fall back to the
// rect captured by applyDeathShatter (R4).
function applyDeathrattlePlume(cue: AnimationCue): void {
  if (cue.kind !== "deathrattle" || !cue.targetKey || appliedDeathrattles.has(cue.id)) return;
  const liveEl = document.querySelector<HTMLElement>(`[data-target-key="${cssEscape(cue.targetKey)}"]`);
  const recent = recentUnitRects.get(cue.targetKey);
  const rect = liveEl?.getBoundingClientRect()
    ?? (recent && performance.now() - recent.atMs < 2000 ? recent.rect : undefined);
  if (!rect || rect.width === 0) return;
  appliedDeathrattles.add(cue.id);

  const container = document.createElement("div");
  container.className = "deathrattle-plume-layer";
  container.style.cssText = `position:fixed;left:${rect.left + rect.width / 2}px;top:${rect.top + rect.height / 2}px;width:0;height:0;pointer-events:none;z-index:2100;overflow:visible;`;
  document.body.appendChild(container);

  for (let i = 0; i < 9; i++) {
    const wisp = document.createElement("span");
    wisp.className = "deathrattle-wisp";
    const spread = (i / 8 - 0.5) * rect.width * 0.8;
    const rise = 50 + Math.random() * 60;
    wisp.style.setProperty("--dx", `${Math.round(spread + (Math.random() - 0.5) * 18)}px`);
    wisp.style.setProperty("--dy", `${-Math.round(rise)}px`);
    wisp.style.setProperty("--size", `${10 + Math.round(Math.random() * 12)}px`);
    wisp.style.animationDelay = `${i * 40}ms`;
    container.appendChild(wisp);
  }
  window.setTimeout(() => {
    container.remove();
    appliedDeathrattles.delete(cue.id);
  }, 1200);
}

function applyPostRenderEffects(): void {
  const eventLayer = document.querySelector<HTMLElement>(".event-layer");
  for (const cue of view.animationCues) {
    if (cue.kind === "attackerMoves" && cue.attackerInstanceId && cue.targetKey && !appliedLunges.has(cue.id)) {
      startAttackLunge(cue);
    }
    if (cue.kind === "effectStrike" && cue.sourceKey && cue.targetKey && cueIsReady(cue)) {
      applyKnifeStrike(cue);
    }
    if (cue.kind === "destroy" && cue.targetKey && cueIsReady(cue)) {
      applyDeathShatter(cue);
    }
    if (cue.kind === "deathrattle" && cue.targetKey && cueIsReady(cue)) {
      applyDeathrattlePlume(cue);
    }
    if (
      cue.kind === "augmentGlow" &&
      cue.seat &&
      cueIsReady(cue) &&
      !cardPlayPreviewBusy() &&
      !attackAnimationBusy()
    ) {
      // The triggering summon/attack must finish first: the minion lands or the
      // attacker returns, THEN the augment glows. The pump (re)drives this check.
      applyAugmentGlow(cue);
    }
  }
  if (eventLayer) {
    for (const node of eventLayer.querySelectorAll<HTMLElement>("[data-anchor-key]")) {
      if (node.dataset.anchored === "true") continue;
      const anchorKey = node.dataset.anchorKey ?? "";
      const selector = `[data-target-key="${cssEscape(anchorKey)}"]`;
      const target = document.querySelector<HTMLElement>(selector);
      let r = target?.getBoundingClientRect();
      if ((!r || r.width === 0) && !anchorKey.startsWith("board:")) {
        // Target just left the board (e.g. killed by this same battlecry): the
        // kill flush removes the minion while the effect cue is still alive, so
        // a live DOM lookup misses. Fall back to the rect captured when it died
        // (recentUnitRects, populated by applyDeathShatter) so the impact flash
        // still lands on the spot instead of being orphaned.
        const recent = recentUnitRects.get(anchorKey);
        if (recent && performance.now() - recent.atMs < 2000) r = recent.rect;
      }
      if (!r) continue;
      // A board-wide AOE sweep covers the whole board rect (top-left + size),
      // not a single point. The board element that this seat rendered into is
      // top or bottom depending on the local viewpoint, so the sweep mirrors.
      if (anchorKey.startsWith("board:")) {
        const topLeft = localPointFromViewport(eventLayer, r.left, r.top);
        const bottomRight = localPointFromViewport(eventLayer, r.right, r.bottom);
        node.style.left = `${topLeft.x}px`;
        node.style.top = `${topLeft.y}px`;
        node.style.width = `${Math.max(0, bottomRight.x - topLeft.x)}px`;
        node.style.height = `${Math.max(0, bottomRight.y - topLeft.y)}px`;
        node.dataset.anchored = "true";
        continue;
      }
      const { x, y } = localPointFromViewport(eventLayer, r.left + r.width / 2, r.top + r.height / 2);
      const cueId = node.dataset.cueId;
      const cue = cueId ? view.animationCues.find((item) => item.id === cueId) : undefined;
      if (cue) {
        cue.anchorX = x;
        cue.anchorY = y;
      }
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.dataset.anchored = "true";
    }
  }
}


const appliedAugmentGlow = new Set<string>();

/**
 * Pulses the firing player's 增幅 indicator(s). A specific augment id (from the
 * AUGMENT_TRIGGERED payload, carried on `cue.cardId`) lights up its matching dot;
 * a general/persist trigger pulses all of that seat's dots. A body-level ring is
 * also spawned so the flash survives the publicSync re-render of the hero DOM.
 */
function applyAugmentGlow(cue: AnimationCue): void {
  if (appliedAugmentGlow.has(cue.id)) return;
  const dots = Array.from(document.querySelectorAll<HTMLElement>(`[data-seat="${cue.seat}"] .hero-augment-dot`));
  const targetIds = cue.augmentTargets ?? [];
  const cardIds = cue.seat === view.mySeat ? cue.augmentCards ?? [] : [];
  if (dots.length === 0 && targetIds.length === 0 && cardIds.length === 0) return;
  appliedAugmentGlow.add(cue.id);

  // Hero indicator dot(s): a specific augment id lights its matching dot; a
  // general/persist trigger pulses all of the seat's dots.
  const matched = cue.cardId ? dots.filter((dot) => dot.dataset.augmentId === cue.cardId) : [];
  const dotTargets = matched.length > 0 ? matched : dots;
  for (const dot of dotTargets) spawnAugmentGlow(dot);

  // Affected board units and own-hand cards also glow so the player sees what
  // the 增幅 changed (Part B).
  for (const id of targetIds) {
    const el = document.querySelector<HTMLElement>(`[data-target-key="${cssEscape(id)}"]`);
    if (el) spawnUnitAugmentGlow(el);
  }
  for (const id of cardIds) {
    const el = document.querySelector<HTMLElement>(`[data-hand-id="${cssEscape(id)}"]`);
    if (el) spawnUnitAugmentGlow(el);
  }

  // The effect manifests only AFTER the glow finishes: keep input locked until the
  // reveal (anchored to this actual fire time, not the pre-defer estimate), then
  // drop the base-cost/base-stat holds, flush the held board sync, and pop the
  // now-revealed values so the change reads as caused by the glow.
  if (targetIds.length > 0 || cardIds.length > 0) {
    augmentGlowLockUntilMs = Math.max(
      augmentGlowLockUntilMs,
      performance.now() + AUGMENT_GLOW_REVEAL_DELAY_MS + 200
    );
    window.setTimeout(() => {
      for (const id of cardIds) augmentHoldBaseCostIds.delete(id);
      for (const id of targetIds) augmentHoldBaseStatIds.delete(id);
      // Force the held board sync through first so stats are current, then drop
      // the cost/stat overrides and pop the revealed numbers.
      if (targetIds.length > 0) applyPendingPublicSyncNow();
      renderNow();
      popAugmentValues(targetIds, cardIds);
    }, AUGMENT_GLOW_REVEAL_DELAY_MS);
  }

  // Hold the applied-guard past the cue's (now defer-extended) lifetime so the cue
  // can't re-fire if its DOM node briefly reappears via a re-render.
  window.setTimeout(
    () => appliedAugmentGlow.delete(cue.id),
    AUGMENT_GLOW_MAX_DEFER_MS + AUGMENT_GLOW_REVEAL_DELAY_MS + (cue.delayMs ?? 0) + 400
  );
}

function spawnAugmentGlow(dot: HTMLElement): void {
  const rect = dot.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  dot.classList.remove("augment-trigger");
  void dot.offsetWidth; // restart the dot's own pulse
  dot.classList.add("augment-trigger");
  window.setTimeout(() => dot.classList.remove("augment-trigger"), 1400);
  const glow = document.createElement("div");
  glow.className = "augment-glow-fx";
  glow.style.left = `${rect.left + rect.width / 2}px`;
  glow.style.top = `${rect.top + rect.height / 2}px`;
  document.body.appendChild(glow);
  window.setTimeout(() => glow.remove(), 1400);
}

/**
 * Spawns a body-level ring sized to a card/minion node (so it survives the morph
 * re-render) plus a direct inline glow on the node itself. Used for the
 * affected-unit/card augment flash (NOT a CSS-`animation-delay` class, which the
 * morph render would reset — see web-animation skill).
 */
function spawnUnitAugmentGlow(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const glow = document.createElement("div");
  glow.className = "augment-glow-fx is-unit";
  glow.style.left = `${rect.left + rect.width / 2}px`;
  glow.style.top = `${rect.top + rect.height / 2}px`;
  glow.style.width = `${Math.round(rect.width)}px`;
  glow.style.height = `${Math.round(rect.height)}px`;
  document.body.appendChild(glow);
  window.setTimeout(() => glow.remove(), 1450);
  el.classList.add("augment-affected-glow");
  window.setTimeout(() => el.classList.remove("augment-affected-glow"), 1450);
}

/** Adds a one-shot "pop" to the just-revealed cost/stat numbers of affected nodes. */
function popAugmentValues(targetIds: readonly string[], cardIds: readonly string[]): void {
  const pop = (el: Element | null): void => {
    if (!(el instanceof HTMLElement)) return;
    el.classList.remove("value-just-changed");
    void el.offsetWidth;
    el.classList.add("value-just-changed");
    window.setTimeout(() => el.classList.remove("value-just-changed"), 600);
  };
  for (const id of targetIds) {
    const node = document.querySelector<HTMLElement>(`[data-target-key="${cssEscape(id)}"]`);
    pop(node?.querySelector(".stat-atk") ?? null);
    pop(node?.querySelector(".stat-hp") ?? null);
  }
  for (const id of cardIds) {
    const node = document.querySelector<HTMLElement>(`[data-hand-id="${cssEscape(id)}"]`);
    pop(node?.querySelector(".card-cost") ?? null);
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

// Vector (SVG) badge icons — replace the former 🔒 / ⏳ / 💀 emoji so the
// battlefield carries no emoji. `currentColor` lets each badge tint the icon.
const BADGE_ICON_LOCK =
  `<svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3z"/></svg>`;
const BADGE_ICON_QUEST =
  `<svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2h12a1 1 0 0 1 0 2h-1v3l-4 5 4 5v3h1a1 1 0 0 1 0 2H6a1 1 0 0 1 0-2h1v-3l4-5-4-5V4H6a1 1 0 0 1 0-2z"/></svg>`;
const BADGE_ICON_DEATH =
  `<svg class="badge-icon" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M12 2C7 2 3 5.6 3 10c0 2.6 1.4 4.9 3.5 6.3V19a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2.7C20.6 14.9 22 12.6 22 10c0-4.4-4-8-9-8zM8.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm7 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>`;

function renderCountdownBadges(minion: PublicMinion): string {
  let html = "";
  if (minion.lockedTurns > 0) {
    html += `<div class="countdown-badge lock-countdown">${BADGE_ICON_LOCK}<span>${minion.lockedTurns}</span></div>`;
  }
  if (minion.questTurns !== undefined && minion.questTurns >= 0) {
    const questTotal = cardCatalog.get(minion.cardId)?.keywords?.quest?.turns ?? 1;
    const questRemaining = questTotal - minion.questTurns;
    const urgentStyle = questRemaining <= 1 ? ' style="color:#ff4d4d;"' : '';
    html += `<div class="countdown-badge quest-countdown">${BADGE_ICON_QUEST}<span${urgentStyle}>${questRemaining}</span></div>`;
  }
  if (minion.deathTimer !== undefined && minion.deathTimer >= 0) {
    html += `<div class="countdown-badge death-countdown" style="background: rgba(139, 0, 0, 0.9); border-color: #ff4d4d; color: #fff;">${BADGE_ICON_DEATH}<span>${minion.deathTimer}</span></div>`;
  }
  return html;
}

function canAfford(cost: number): boolean {
  if (isBattleActionLocked()) return false;
  const player = view.mySeat ? readPlayer(view.mySeat) : undefined;
  return Boolean(player && player.mana.current >= cost && readActiveSeat() === view.mySeat);
}

function handCardNeedsTarget(card: HandCardView | undefined): boolean {
  if (!card) return false;
  return card.needsTarget ?? cardNeedsTarget(card.cardId);
}

function cardNeedsTarget(cardId: string): boolean {
  const effect = cardCatalog.get(cardId)?.keywords?.battlecry;
  return Boolean(effect?.target);
}

/**
 * True if the player still has a move other than ending the turn — i.e. an
 * affordable card to play (with board room for minions) or a minion that can
 * still attack. Mirrors `legalMoves` loosely; used only as a UX hint so it
 * errs optimistic (a card whose battlecry has no valid target still counts).
 */
function hasAnyLegalAction(): boolean {
  if (!view.mySeat || readActiveSeat() !== view.mySeat || isBattleActionLocked()) return false;
  const player = readPlayer(view.mySeat);
  if (!player) return false;
  const boardSize = Array.from(player.board ?? []).length;
  for (const card of view.hand) {
    if (player.mana.current < card.cost) continue;
    if (card.type === "MINION" && boardSize >= 7) continue;
    return true;
  }
  for (const minion of Array.from(player.board ?? [])) {
    if (!attackerError(minion)) return true;
  }
  return false;
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

function usesDbCollectionOwnership(): boolean {
  return Boolean(supabase);
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
