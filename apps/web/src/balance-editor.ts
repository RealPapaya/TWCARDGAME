import "./styles.css";
import { CARD_CATALOG, AMPLIFICATION_DB, VOTE_EVENT_DB, cardImagePath } from "@twcardgame/cards";
import type { CardDefinition, EffectDefinition, CardKeywords } from "@twcardgame/cards";
import type { AmplificationDbEntry, VoteEventDbEntry } from "@twcardgame/cards";
import {
  AMPLIFICATION_TIERS,
  MAX_LEVEL,
  LEVEL_UP_GOLD,
  MAX_LEVEL_XP_REQUIREMENT,
  AI_THEMES,
  AI_THEME_DECKS,
  AI_DIFFICULTIES
} from "@twcardgame/shared";
import type { AmplificationTier, AiDifficulty } from "@twcardgame/shared";
import {
  getXPRequiredForLevel,
  getPveXpReward,
  getPveFirstVictoryGold,
  calculatePvPExp,
  calculatePvPGold
} from "@twcardgame/shared";
import {
  QUEST_DEFINITIONS_SEED,
  QUEST_RECURRENCE_OPTIONS,
  KNOWN_EVENT_TYPES,
  generateQuestSeedSql,
  validateQuestDrafts,
  type QuestDefinitionDraft,
  type QuestRecurrence
} from "./balance-editor-quests.js";
import { renderCardPreview, renderAugmentPreview, renderVoteEventPreview } from "./balance-editor-preview.js";
import {
  SHOP_PACK_SEED,
  PACK_RARITIES,
  computePackOdds,
  validatePackDrafts,
  generatePackSeedSql,
  type ShopPackDraft,
  type PackRarity
} from "./balance-editor-packs.js";

// ── deep clone helpers ──────────────────────────────────────────────
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ── mutable working copies ──────────────────────────────────────────
const cards: CardDefinition[] = deepClone(CARD_CATALOG as CardDefinition[]);
const amps: AmplificationDbEntry[] = deepClone(AMPLIFICATION_DB);
const votes: VoteEventDbEntry[] = deepClone(VOTE_EVENT_DB);
const aiDecks: Record<string, string[]> = deepClone(AI_THEME_DECKS as Record<string, string[]>);
const aiThemes = deepClone(AI_THEMES as any[]);
const quests: QuestDefinitionDraft[] = deepClone(QUEST_DEFINITIONS_SEED as QuestDefinitionDraft[]);
const packs: ShopPackDraft[] = deepClone(SHOP_PACK_SEED as ShopPackDraft[]);

const KNOWN_AUGMENT_IMAGE_IDS = new Set([
  "AMP_INVOICE_200",
  "AMP_SHAREHOLDER_GIFT",
  "AMP_FRIES_BOGO",
  "AMP_MIN_WAGE",
  "AMP_LIFE_INSURANCE",
  "AMP_BANQUET",
  "AMP_THREE_WAY_RACE",
  "AMP_ENERGY_TRANSITION"
]);

const KNOWN_VOTE_EVENT_IMAGE_IDS = new Set([
  "VE_BLACKOUT",
  "VE_UTILITY_HIKE",
  "VE_MORAKOT",
  "VE_KAOHSIUNG_BLAST",
  "VE_MARTIAL_LAW",
  "VE_PARLIAMENT_STAR_BRAWL",
  "VE_MAZU",
  "VE_PARTY_INFIGHTING",
  "VE_GHOST_GATE",
  "VE_FINANCIAL_CRISIS",
  "VE_BASEBALL_CHAMPION",
  "VE_CASH_HANDOUT",
  "VE_CURFEW_TIME",
  "VE_SOCIAL_DISTANCING",
  "VE_EQUALITY_FOR_ALL",
  "VE_TECH_ENFORCEMENT"
]);

function applyKnownImageFlags() {
  for (const amp of amps) {
    if (amp.hasImage == null && KNOWN_AUGMENT_IMAGE_IDS.has(amp.id)) amp.hasImage = true;
  }
  for (const vote of votes) {
    if (vote.hasImage == null && KNOWN_VOTE_EVENT_IMAGE_IDS.has(vote.id)) vote.hasImage = true;
  }
}

applyKnownImageFlags();

// progression constants (mutable copies)
const prog = {
  MAX_LEVEL: MAX_LEVEL as number,
  LEVEL_UP_GOLD: LEVEL_UP_GOLD as number,
  MAX_LEVEL_XP_REQUIREMENT: MAX_LEVEL_XP_REQUIREMENT as number
};

// ── change tracking ─────────────────────────────────────────────────
let changeCount = 0;
function setChangeBadge(n: number) {
  changeCount = n;
  const badge = document.getElementById("change-badge");
  if (badge) {
    badge.textContent = String(n);
    badge.style.display = n > 0 ? "inline-flex" : "none";
  }
}
// Recompute the REAL number of pending changes (vs the imported baseline) so the
// badge counts actual diffs — touching a field then setting it back is 0, not +2.
function bumpChanges() {
  setChangeBadge(buildChangeset().count);
}

// ── inject styles ───────────────────────────────────────────────────
const style = document.createElement("style");
style.textContent = `
:root {
  --bg: #0a0a0f;
  --bg-gradient: linear-gradient(135deg, #0a0a0f 0%, #12121a 50%, #0a0a0f 100%);
  --glass: rgba(255,255,255,0.04);
  --glass-border: rgba(255,255,255,0.08);
  --glass-hover: rgba(255,255,255,0.07);
  --primary: #6366f1;
  --primary-dim: rgba(99,102,241,0.15);
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
  --text: #e2e8f0;
  --text-dim: #94a3b8;
  --text-muted: #64748b;
  --rarity-common: #9ca3af;
  --rarity-rare: #3b82f6;
  --rarity-epic: #a855f7;
  --rarity-legendary: #f59e0b;
  --tier-low: #22c55e;
  --tier-mid: #f59e0b;
  --tier-high: #ef4444;
  --radius: 12px;
  --radius-sm: 8px;
  --font: 'Inter', 'Noto Sans TC', system-ui, sans-serif;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 14px; }
body {
  font-family: var(--font);
  background: var(--bg);
  background-image: var(--bg-gradient);
  color: var(--text);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
/* base.css locks html,body to overflow:hidden/height:100% for the game's
   fixed letterbox — restore normal page scrolling for the editor. */
html, body { height: auto; min-height: 100%; overflow: visible; }
/* Neutralise the game's letterbox #app rule (layout.css makes #app a fixed
   full-screen flex frame) so the editor lays out as a normal scrolling page.
   styles.css is imported only for the in-battle card/augment/event previews. */
main#app {
  position: static; inset: auto;
  display: block;
  width: auto; height: auto;
  min-height: 100vh;
  overflow: visible;
  background: transparent;
  touch-action: auto;
  max-width: 1440px; margin: 0 auto; padding: 0 24px 48px;
}

/* header */
.be-header {
  position: sticky; top: 0; z-index: 100;
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  background: rgba(10,10,15,0.75);
  border-bottom: 1px solid var(--glass-border);
  padding: 16px 0;
  margin: 0 -24px;
  padding-left: 24px;
  padding-right: 24px;
}
.be-header-inner {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
}
.be-title {
  font-size: 1.5rem; font-weight: 700;
  background: linear-gradient(135deg, var(--primary), #a78bfa);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}
.be-actions { display: flex; gap: 8px; margin-left: auto; }
.be-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: var(--radius-sm);
  border: 1px solid var(--glass-border);
  background: var(--glass); color: var(--text);
  cursor: pointer; font-family: var(--font); font-size: 0.85rem; font-weight: 500;
  transition: all 0.2s;
}
.be-btn:hover { background: var(--glass-hover); border-color: rgba(255,255,255,0.15); }
.be-btn--primary { background: var(--primary); border-color: var(--primary); color: #fff; }
.be-btn--primary:hover { background: #5558e6; }
.be-btn--danger { background: var(--danger); border-color: var(--danger); color: #fff; }
.be-btn--danger:hover { background: #dc2626; }
.change-badge {
  display: none; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px;
  border-radius: 10px; background: var(--danger);
  color: #fff; font-size: 0.7rem; font-weight: 700;
}

/* tabs */
.be-tabs {
  display: flex; gap: 4px; padding: 12px 0 0;
}
.be-tab {
  padding: 10px 20px; border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent; border: 1px solid transparent;
  border-bottom: none; color: var(--text-dim);
  cursor: pointer; font-family: var(--font); font-size: 0.9rem; font-weight: 500;
  transition: all 0.2s;
}
.be-tab:hover { color: var(--text); background: var(--glass); }
.be-tab--active {
  color: var(--primary); background: var(--glass);
  border-color: var(--glass-border);
}

/* panels */
.be-panel {
  display: none;
  background: var(--glass);
  border: 1px solid var(--glass-border);
  border-radius: 0 var(--radius) var(--radius) var(--radius);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 24px;
  animation: fadeIn 0.25s ease;
}
.be-panel--active { display: block; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

/* stats bar */
.be-stats {
  display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px;
}
.be-stat {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; border-radius: var(--radius-sm);
  background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border);
  font-size: 0.8rem; color: var(--text-dim);
}
.be-stat b { color: var(--text); font-weight: 600; font-size: 1rem; }

/* search / filter bar */
.be-toolbar {
  display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; align-items: center;
}
.be-search {
  flex: 1; min-width: 200px; padding: 8px 14px;
  border-radius: var(--radius-sm); border: 1px solid var(--glass-border);
  background: rgba(0,0,0,0.3); color: var(--text);
  font-family: var(--font); font-size: 0.85rem;
  transition: border-color 0.2s;
}
.be-search:focus { outline: none; border-color: var(--primary); }
.be-select {
  padding: 8px 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--glass-border);
  background: rgba(0,0,0,0.3); color: var(--text);
  font-family: var(--font); font-size: 0.85rem;
  cursor: pointer;
}
.be-select:focus { outline: none; border-color: var(--primary); }

/* table */
.be-table {
  width: 100%; border-collapse: separate; border-spacing: 0;
}
.be-table th {
  text-align: left; padding: 10px 12px;
  font-size: 0.75rem; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.5px;
  border-bottom: 1px solid var(--glass-border);
  position: sticky; top: 0; background: rgba(10,10,15,0.9);
  backdrop-filter: blur(8px);
}
.be-table td {
  padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.03);
  font-size: 0.85rem; vertical-align: middle;
}
.be-table tr.be-row { cursor: pointer; transition: background 0.15s; }
.be-table tr.be-row:hover { background: var(--glass-hover); }
.be-table tr.be-row--expanded { background: var(--primary-dim); }

/* rarity badges */
.be-rarity {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
}
.be-rarity--COMMON { background: rgba(156,163,175,0.15); color: var(--rarity-common); }
.be-rarity--RARE { background: rgba(59,130,246,0.15); color: var(--rarity-rare); }
.be-rarity--EPIC { background: rgba(168,85,247,0.15); color: var(--rarity-epic); }
.be-rarity--LEGENDARY { background: rgba(245,158,11,0.15); color: var(--rarity-legendary); }

/* type badges */
.be-type {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 0.7rem; font-weight: 600;
}
.be-type--MINION { background: rgba(34,197,94,0.15); color: var(--success); }
.be-type--NEWS { background: rgba(99,102,241,0.15); color: var(--primary); }

/* tier colors */
.be-tier--low { color: var(--tier-low); }
.be-tier--mid { color: var(--tier-mid); }
.be-tier--high { color: var(--tier-high); }

/* expandable editor */
.be-editor {
  display: none; padding: 20px;
  background: rgba(0,0,0,0.2); border-bottom: 1px solid var(--glass-border);
}
.be-editor--open { display: table-row; }
.be-editor-inner {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}
.be-field { display: flex; flex-direction: column; gap: 4px; }
.be-field label {
  font-size: 0.7rem; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.5px;
}
.be-field input, .be-field select, .be-field textarea {
  padding: 8px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--glass-border);
  background: rgba(0,0,0,0.3); color: var(--text);
  font-family: var(--font); font-size: 0.85rem;
  transition: border-color 0.2s;
}
.be-field input:focus, .be-field select:focus, .be-field textarea:focus {
  outline: none; border-color: var(--primary);
}
.be-field textarea { resize: vertical; min-height: 60px; }
.be-input {
  padding: 8px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--glass-border);
  background: rgba(0,0,0,0.3); color: var(--text);
  font-family: var(--font); font-size: 0.85rem;
  transition: border-color 0.2s;
}
.be-input:focus { outline: none; border-color: var(--primary); }

/* in-game card / augment / event preview — uses the live game's .card markup + CSS */
.be-preview {
  display: flex; justify-content: center; align-items: flex-start;
  padding: 16px; min-height: 200px;
  background: rgba(0,0,0,0.25); border-radius: var(--radius-sm);
  border: 1px dashed var(--glass-border);
}
.be-augment-preview-pair {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  width: 100%;
  flex-wrap: wrap;
}
.be-augment-preview-pair .hero-augment-dot {
  flex: 0 0 auto;
  transform: scale(1.25);
}
/* neutralise the hand fan transform so the preview sits upright and centered */
.be-preview .card { transform: none !important; margin: 0 !important; }

/* card editor: left = big preview + image/category, right = detail tuning */
.be-card-editor {
  display: grid;
  grid-template-columns: minmax(240px, 320px) 1fr;
  gap: 24px;
  align-items: start;
}
@media (max-width: 820px) {
  .be-card-editor { grid-template-columns: 1fr; }
}
.be-card-editor-left { display: flex; flex-direction: column; gap: 14px; }
.be-card-editor-right { margin: 0; }
/* enlarge the preview so the artwork is legible, and vertically centre it
   (the base .be-preview pins to flex-start, which left the card glued to the top). */
.be-card-preview-lg {
  align-items: center;
  justify-content: center;
  min-height: 300px;
  padding: 28px 16px;
  /* visible so the augment art (taller than a card) isn't clipped top/bottom */
  overflow: visible;
}
/* cards and vote options share the .card box → one rule scales both */
.be-card-preview-lg .card {
  transform: scale(1.45) !important;
  transform-origin: center center;
  margin: 40px 0 !important;
}
/* augment previews are the small hero dot pair — scale them up a touch */
.be-card-preview-lg .be-augment-preview-pair .hero-augment-dot {
  transform: scale(1.6);
}
/* the preview is display-only; keep it inert without the game's disabled
   greyscale (base.css button:disabled { filter: grayscale; opacity }). */
.be-preview { pointer-events: none; }

/* number input with +/- */
.be-num-group {
  display: flex; align-items: center; gap: 0;
}
.be-num-group input {
  width: 60px; text-align: center;
  border-radius: 0; border-left: none; border-right: none;
}
.be-num-btn {
  width: 32px; height: 34px; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.3); border: 1px solid var(--glass-border);
  color: var(--text); cursor: pointer; font-size: 1rem; font-weight: 600;
  transition: all 0.15s;
}
.be-num-btn:first-child { border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.be-num-btn:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.be-num-btn:hover { background: var(--primary-dim); }

/* keyword toggles */
.be-toggles { display: flex; gap: 8px; flex-wrap: wrap; }
.be-toggle {
  padding: 4px 10px; border-radius: 4px;
  font-size: 0.75rem; font-weight: 600; cursor: pointer;
  border: 1px solid var(--glass-border); background: transparent; color: var(--text-dim);
  transition: all 0.15s;
}
.be-toggle--on { background: var(--primary-dim); border-color: var(--primary); color: var(--primary); }

/* weight bar */
.be-weight-bar {
  width: 100%; height: 6px; border-radius: 3px;
  background: rgba(255,255,255,0.06); overflow: hidden;
}
.be-weight-bar-fill {
  height: 100%; border-radius: 3px; background: var(--primary);
  transition: width 0.3s ease;
}

/* progression table */
.be-xp-table {
  max-height: 400px; overflow-y: auto;
  border: 1px solid var(--glass-border); border-radius: var(--radius-sm);
}
.be-xp-table table { width: 100%; border-collapse: collapse; }
.be-xp-table th, .be-xp-table td {
  padding: 6px 12px; font-size: 0.8rem; text-align: center;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.be-xp-table th { background: rgba(0,0,0,0.3); color: var(--text-muted); font-weight: 600; position: sticky; top: 0; }

/* ai deck panel */
.be-deck-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px; }
.be-deck-card {
  background: var(--glass); border: 1px solid var(--glass-border);
  border-radius: var(--radius); padding: 20px;
  backdrop-filter: blur(8px);
}
.be-deck-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.be-deck-hero {
  width: 48px; height: 48px; border-radius: 50%;
  background: var(--primary-dim); display: flex; align-items: center; justify-content: center;
  font-size: 1.2rem; font-weight: 700; color: var(--primary);
}
.be-deck-title { font-size: 1.1rem; font-weight: 600; }
.be-deck-subtitle { font-size: 0.8rem; color: var(--text-dim); }
.be-deck-list {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px;
  max-height: 350px; overflow-y: auto;
}
.be-deck-item {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;
  transition: background 0.1s;
}
.be-deck-item:hover { background: var(--glass-hover); }
.be-deck-item-cost {
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(99,102,241,0.2); color: var(--primary);
  display: flex; align-items: center; justify-content: center;
  font-size: 0.7rem; font-weight: 700; flex-shrink: 0;
}
.be-deck-item-count { color: var(--text-muted); font-size: 0.75rem; margin-left: auto; }

/* progression constants */
.be-prog-consts {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 20px; margin-bottom: 24px;
}
.be-prog-card {
  background: rgba(0,0,0,0.2); border: 1px solid var(--glass-border);
  border-radius: var(--radius); padding: 20px;
}
.be-prog-card h4 { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }

.be-rewards-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
.be-rewards-table th, .be-rewards-table td {
  padding: 8px 12px; text-align: center; font-size: 0.85rem;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.be-rewards-table th { color: var(--text-muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; }

/* scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

/* balance score */
.be-balance {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 4px;
  font-size: 0.7rem; font-weight: 700; white-space: nowrap;
}

/* ai deck editor */
.be-deck-toolbar {
  display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; align-items: center;
  position: relative;
}
.be-deck-search {
  flex: 1; min-width: 150px; padding: 6px 10px;
  border-radius: var(--radius-sm); border: 1px solid var(--glass-border);
  background: rgba(0,0,0,0.3); color: var(--text);
  font-family: var(--font); font-size: 0.8rem;
}
.be-deck-search:focus { outline: none; border-color: var(--primary); }
.be-deck-suggestions {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
  max-height: 200px; overflow-y: auto;
  border: 1px solid var(--glass-border); border-radius: var(--radius-sm);
  background: rgba(10,10,15,0.97); margin-top: 4px;
}
.be-deck-suggest-item {
  padding: 6px 10px; cursor: pointer; font-size: 0.8rem;
  display: flex; align-items: center; gap: 8px;
  transition: background 0.1s;
}
.be-deck-suggest-item:hover { background: var(--glass-hover); }
.be-deck-remove-btn {
  width: 18px; height: 18px; border-radius: 50%;
  background: rgba(239,68,68,0.15); border: none;
  color: var(--danger); cursor: pointer; font-size: 0.7rem;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.15s; flex-shrink: 0;
}
.be-deck-item:hover .be-deck-remove-btn { opacity: 1; }
.be-deck-validation {
  font-size: 0.75rem; padding: 4px 10px; border-radius: 4px; margin-top: 8px;
}
.be-deck-valid { background: rgba(34,197,94,0.1); color: var(--success); }
.be-deck-invalid { background: rgba(239,68,68,0.1); color: var(--danger); }

/* section headers */
.be-section-title {
  font-size: 1rem; font-weight: 600; color: var(--text);
  margin: 24px 0 12px; padding-bottom: 8px;
  border-bottom: 1px solid var(--glass-border);
}

/* dropdown menu for exports */
.be-dropdown {
  position: relative;
  display: inline-block;
}
.be-dropdown-menu {
  display: none;
  position: absolute;
  top: 100%;
  right: 0;
  background: rgba(15, 15, 25, 0.98);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  z-index: 1000;
  min-width: 280px;
  margin-top: 4px;
  backdrop-filter: blur(10px);
}
.be-dropdown-menu.show {
  display: block;
}
.be-dropdown-item {
  display: block;
  width: 100%;
  padding: 10px 16px;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--text);
  font-family: var(--font);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s;
}
.be-dropdown-item:hover {
  background: var(--primary-dim);
  color: var(--primary);
}
`;
document.head.appendChild(style);

// ── tab IDs ─────────────────────────────────────────────────────────
type TabId = "cards" | "amps" | "votes" | "progression" | "aidecks" | "tasks" | "packs";
const TABS: { id: TabId; label: string }[] = [
  { id: "cards", label: "卡牌" },
  { id: "amps", label: "增幅" },
  { id: "votes", label: "事件" },
  { id: "progression", label: "進度" },
  { id: "aidecks", label: "AI牌組" },
  { id: "tasks", label: "任務/成就" },
  { id: "packs", label: "卡包" }
];
let activeTab: TabId = "cards";
let expandedThemeId: string | null = null;
let expandedQuestId: string | null = null;
let expandedPackId: string | null = null;

// ── utility helpers ─────────────────────────────────────────────────
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

function tierClass(tier: AmplificationTier): string {
  if (tier === "加減賺") return "be-tier--low";
  if (tier === "蕭貪") return "be-tier--mid";
  return "be-tier--high";
}

function rarityClass(r: string): string {
  return `be-rarity be-rarity--${r}`;
}

function kwSummary(kw?: CardKeywords): string {
  if (!kw) return "—";
  const parts: string[] = [];
  if (kw.taunt) parts.push("沙包");
  if (kw.charge) parts.push("衝蹦");
  if (kw.divineShield) parts.push("光盾");
  if (kw.battlecry) parts.push(`觸發:${kw.battlecry.type ?? ""}`);
  if (kw.deathrattle) parts.push(`遺志:${kw.deathrattle.type ?? ""}`);
  if (kw.ongoing) parts.push(`持續:${kw.ongoing.type ?? ""}`);
  if (kw.enrage) parts.push(`激怒:${kw.enrage.type ?? ""}`);
  if (kw.triggered) parts.push(`觸發機制:${kw.triggered.type ?? ""}`);
  if (kw.quest) parts.push(`任務:${kw.quest.type ?? ""}`);
  if (kw.newsPower != null) parts.push(`新聞+${kw.newsPower}`);
  if (kw.onDiscard) parts.push(`棄牌:${kw.onDiscard}`);
  return parts.join(", ") || "—";
}

function effectSummary(ef?: EffectDefinition): string {
  if (!ef) return "—";
  const parts: string[] = [];
  if (ef.type) parts.push(ef.type);
  if (ef.value != null) parts.push(`val=${ef.value}`);
  if (ef.crystals != null) parts.push(`💎${ef.crystals}`);
  if (ef.durationTurns != null) parts.push(`${ef.durationTurns}T`);
  if (ef.stat) parts.push(ef.stat);
  if (ef.target_category) parts.push(ef.target_category);
  return parts.join(" ") || "—";
}

// ── balance scoring ─────────────────────────────────────────────────
function estimateEffectValue(ef?: EffectDefinition): number {
  if (!ef || !ef.type) return 0;
  const v = ef.value ?? 0;
  switch (ef.type) {
    case "DAMAGE": case "DAMAGE_NON_CATEGORY": return v * 0.8;
    case "MULTI_DAMAGE": return v * 0.7 * (ef.count ?? 1);
    case "DAMAGE_ALL_ENEMY_MINIONS": case "DAMAGE_ALL_NON_CATEGORIES": return v * 2;
    case "DAMAGE_AND_DRAW_IF_KILL": return v * 0.8 + 0.5;
    case "HEAL": case "HEAL_CATEGORY_BONUS": return v * 0.5;
    case "HEAL_ALL_FRIENDLY": return 2;
    case "FULL_HEAL": return 1.5;
    case "FULL_HEAL_AND_DRAW": return 3;
    case "BUFF_ALL": return v * 2;
    case "BUFF_ADJACENT": return v * 1.5;
    case "BUFF_CATEGORY": return v * 1.5;
    case "BUFF_STAT_TARGET": case "BUFF_STAT_TARGET_CATEGORY_BONUS": return v * 0.8;
    case "BUFF_STAT_TARGET_TEMP": return v * 0.5;
    case "BUFF_HEALTH_AND_TAUNT_TARGET": return v * 1;
    case "DRAW": return (ef.drawCount ?? 1) * 1.5;
    case "DRAW_NEWS": return 1.5;
    case "DRAW_MINION_REDUCE_COST": return 2;
    case "DISCARD_DRAW": return 0.5;
    case "DESTROY": return 3;
    case "DESTROY_ALL_MINIONS": return 4;
    case "DESTROY_DAMAGED": case "DESTROY_HIGH_ATTACK": case "DESTROY_LOW_ATTACK": return 2;
    case "DESTROY_LOCKED": return 1.5;
    case "BOUNCE_TARGET": return 1.5;
    case "BOUNCE": return 1;
    case "BOUNCE_ALL_ENEMY": return 4;
    case "BOUNCE_ALL_CATEGORY": return 2.5;
    case "BOUNCE_CATEGORY": return 1.5;
    case "BOUNCE_RANDOM_ENEMY": return 1;
    case "BOUNCE_SELF": return 1;
    case "GIVE_DIVINE_SHIELD": return 1.5;
    case "GIVE_DIVINE_SHIELD_ALL": case "GIVE_DIVINE_SHIELD_CATEGORY": return 3;
    case "GIVE_KEYWORD_ADJACENT": return 1;
    case "LOCK_ALL_ENEMY": return 3;
    case "LOCK_ATTACK": return 1;
    case "LOCK_SELF": return -1;
    case "LOCK_ALL_AND_BUFF_CATEGORY": return 2;
    case "SUMMON": return 1.5;
    case "SUMMON_MULTIPLE": return (ef.summon?.length ?? 1) * 1.5;
    case "EAT_FRIENDLY": return 1;
    case "DAMAGE_RANDOM_FRIENDLY": return -(v * 0.5);
    case "DAMAGE_SELF": return -(v * 0.3);
    case "DISCARD_RANDOM": return -1;
    case "ADD_CARD_TO_HAND": return 1;
    case "REDUCE_NEWS_COST": return v * 0.8;
    case "ADJACENT_BUFF_STATS": return v * 1.5;
    case "ADJACENT_BUFF_CATEGORY_ATTRS": return v * 1.2;
    case "SWAP_ATTACK_HEALTH": return 0.5;
    case "SET_ATTACK_ALL": return 1;
    case "SET_DEATH_TIMER": return 1;
    case "REDUCE_COST_ALL_HAND": return v * 1;
    case "UNLOCK_AND_BUFF_HEALTH": return v * 0.8;
    default: return 0;
  }
}

function calculateBalanceScore(card: CardDefinition): { power: number; expected: number; ratio: number } {
  const cost = Math.max(card.cost, 0.5);
  if (card.type === "NEWS") {
    const np = card.keywords?.newsPower ?? 0;
    const effectVal = estimateEffectValue(card.keywords?.battlecry);
    const power = effectVal + np * 1.5;
    const expected = cost * 1.5;
    return { power: +power.toFixed(1), expected: +expected.toFixed(1), ratio: +(power / expected).toFixed(2) };
  }
  const statValue = (card.attack ?? 0) + (card.health ?? 0);
  let bonus = 0;
  const kw = card.keywords;
  if (kw) {
    if (kw.taunt) bonus += 0.5;
    if (kw.charge) bonus += 1;
    if (kw.divineShield) bonus += 1.5;
    if (kw.newsPower) bonus += kw.newsPower * 0.5;
    bonus += estimateEffectValue(kw.battlecry);
    bonus += estimateEffectValue(kw.deathrattle) * 0.8;
    bonus += estimateEffectValue(kw.ongoing) * 1.2;
    bonus += estimateEffectValue(kw.enrage) * 0.5;
    bonus += estimateEffectValue(kw.triggered) * 0.8;
    bonus += estimateEffectValue(kw.quest) * 0.6;
  }
  if (card.bounce_bonus) bonus += card.bounce_bonus;
  const power = statValue + bonus;
  const expected = cost * 2 + 1;
  return { power: +power.toFixed(1), expected: +expected.toFixed(1), ratio: +(power / expected).toFixed(2) };
}

function balanceColor(ratio: number): string {
  if (ratio >= 1.4) return "var(--danger)";
  if (ratio >= 1.15) return "var(--warning)";
  if (ratio >= 0.85) return "var(--success)";
  if (ratio >= 0.6) return "#60a5fa";
  return "#94a3b8";
}

function balanceLabel(ratio: number): string {
  if (ratio >= 1.4) return "OP";
  if (ratio >= 1.15) return "偏強";
  if (ratio >= 0.85) return "平衡";
  if (ratio >= 0.6) return "偏弱";
  return "極弱";
}

function imageStatusHtml(hasImage: boolean): string {
  return hasImage
    ? '<span style="color:var(--success)">有</span>'
    : '<span style="color:var(--text-muted)">無</span>';
}

function cardHasImage(card: CardDefinition): boolean {
  return card.image.trim().length > 0;
}

function numInput(value: number, onChange: (v: number) => void, min = 0, max = 99): HTMLElement {
  const wrap = h("div", { class: "be-num-group" });
  const dec = h("button", { class: "be-num-btn", type: "button" }, "−");
  const inp = h("input", { type: "number", value: String(value), min: String(min), max: String(max) });
  const inc = h("button", { class: "be-num-btn", type: "button" }, "+");
  dec.addEventListener("click", () => {
    const v = Math.max(min, Number(inp.value) - 1);
    inp.value = String(v);
    onChange(v);
    bumpChanges();
  });
  inc.addEventListener("click", () => {
    const v = Math.min(max, Number(inp.value) + 1);
    inp.value = String(v);
    onChange(v);
    bumpChanges();
  });
  inp.addEventListener("change", () => {
    const v = Math.max(min, Math.min(max, Number(inp.value) || 0));
    inp.value = String(v);
    onChange(v);
    bumpChanges();
  });
  wrap.append(dec, inp, inc);
  return wrap;
}

// ── MAIN RENDER ─────────────────────────────────────────────────────
const app = document.getElementById("app")!;

function render() {
  app.innerHTML = "";

  // header
  const header = h("div", { class: "be-header" });
  const headerInner = h("div", { class: "be-header-inner" });
  headerInner.append(h("div", { class: "be-title" }, "寶島遊戲王 — 遊戲平衡編輯器"));

  const badge = h("span", { class: "change-badge", id: "change-badge" }, String(changeCount));
  if (changeCount > 0) badge.style.display = "inline-flex";

  const actions = h("div", { class: "be-actions" });
  const applyBtn = h("button", { class: "be-btn be-btn--primary", title: "直接寫入原始碼，不需手動貼上（需在 npm run dev:web 下開啟）" }, "✅ 套用到原始碼");
  const exportJsonBtn = h("button", { class: "be-btn" }, "📦 匯出 JSON");

  const dropdown = h("div", { class: "be-dropdown" });
  const exportTsBtn = h("button", { class: "be-btn" }, "📄 匯出 TS 檔案 ▾");
  const dropdownMenu = h("div", { class: "be-dropdown-menu" });

  const expCards = h("button", { class: "be-dropdown-item" }, "卡牌 TS (catalog.generated.ts)");
  const expAmps = h("button", { class: "be-dropdown-item" }, "增幅 TS (amplificationDb.ts)");
  const expVotes = h("button", { class: "be-dropdown-item" }, "事件 TS (voteEventDb.ts)");
  const expAi = h("button", { class: "be-dropdown-item" }, "AI 牌組 TS (aiDecks.generated.ts)");
  const expProg = h("button", { class: "be-dropdown-item" }, "進度 TS (progression.generated.ts)");
  const expTasks = h("button", { class: "be-dropdown-item" }, "任務/成就 SQL (tasks_achievements_seed.sql)");
  const expPacks = h("button", { class: "be-dropdown-item" }, "商店卡包 SQL (card_packs_seed.sql)");

  dropdownMenu.append(expCards, expAmps, expVotes, expAi, expProg, expTasks, expPacks);
  dropdown.append(exportTsBtn, dropdownMenu);

  const resetBtn = h("button", { class: "be-btn be-btn--danger" }, "🔄 重置");
  actions.append(badge, applyBtn, exportJsonBtn, dropdown, resetBtn);
  headerInner.append(actions);
  header.append(headerInner);

  // tabs
  const tabBar = h("div", { class: "be-tabs" });
  for (const t of TABS) {
    const tabBtn = h("button", { class: `be-tab ${t.id === activeTab ? "be-tab--active" : ""}` }, t.label);
    tabBtn.addEventListener("click", () => {
      activeTab = t.id;
      render();
    });
    tabBar.append(tabBtn);
  }
  header.append(tabBar);
  app.append(header);

  // panels
  const panels: Record<TabId, HTMLElement> = {
    cards: renderCardsPanel(),
    amps: renderAmpsPanel(),
    votes: renderVotesPanel(),
    progression: renderProgressionPanel(),
    aidecks: renderAiDecksPanel(),
    tasks: renderTasksPanel(),
    packs: renderPacksPanel()
  };
  for (const [id, panel] of Object.entries(panels)) {
    panel.classList.add("be-panel");
    if (id === activeTab) panel.classList.add("be-panel--active");
    app.append(panel);
  }

  // button handlers
  applyBtn.addEventListener("click", () => applyToSource(applyBtn));
  exportJsonBtn.addEventListener("click", exportJson);

  exportTsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle("show");
  });
  document.addEventListener("click", () => {
    dropdownMenu.classList.remove("show");
  });

  expCards.addEventListener("click", exportCardsTs);
  expAmps.addEventListener("click", exportAmpsTs);
  expVotes.addEventListener("click", exportVotesTs);
  expAi.addEventListener("click", exportAiDecksTs);
  expProg.addEventListener("click", exportProgressionTs);
  expTasks.addEventListener("click", exportTasksSql);
  expPacks.addEventListener("click", exportPacksSql);

  resetBtn.addEventListener("click", () => {
    if (!confirm("確定要重置所有修改？")) return;
    cards.splice(0, cards.length, ...deepClone(CARD_CATALOG as CardDefinition[]));
    amps.splice(0, amps.length, ...deepClone(AMPLIFICATION_DB));
    votes.splice(0, votes.length, ...deepClone(VOTE_EVENT_DB));
    applyKnownImageFlags();
    aiThemes.splice(0, aiThemes.length, ...deepClone(AI_THEMES as any[]));
    for (const key of Object.keys(aiDecks)) {
      delete aiDecks[key];
    }
    Object.assign(aiDecks, deepClone(AI_THEME_DECKS as Record<string, string[]>));
    quests.splice(0, quests.length, ...deepClone(QUEST_DEFINITIONS_SEED as QuestDefinitionDraft[]));
    packs.splice(0, packs.length, ...deepClone(SHOP_PACK_SEED as ShopPackDraft[]));
    expandedQuestId = null;
    expandedPackId = null;
    prog.MAX_LEVEL = MAX_LEVEL;
    prog.LEVEL_UP_GOLD = LEVEL_UP_GOLD;
    prog.MAX_LEVEL_XP_REQUIREMENT = MAX_LEVEL_XP_REQUIREMENT;
    changeCount = 0;
    render();
  });
}

// ── CARDS PANEL ─────────────────────────────────────────────────────
function renderCardsPanel(): HTMLElement {
  const panel = h("div");
  let searchTerm = "";
  let filterType = "";
  let filterRarity = "";
  let filterCategory = "";
  let expandedId: string | null = null;

  const categories = [...new Set(cards.map((c) => c.category))].sort();
  const hiddenCategories = [
    ...new Set(cards.map((c) => c.hiddenCategory).filter((c): c is string => !!c))
  ].sort();
  const totalCards = cards.length;
  const avgCost = (cards.reduce((s, c) => s + c.cost, 0) / totalCards).toFixed(1);
  const minions = cards.filter((c) => c.type === "MINION");
  const avgAtk = minions.length ? (minions.reduce((s, c) => s + (c.attack ?? 0), 0) / minions.length).toFixed(1) : "—";
  const avgHp = minions.length ? (minions.reduce((s, c) => s + (c.health ?? 0), 0) / minions.length).toFixed(1) : "—";
  const balScores = cards.map(calculateBalanceScore);
  const avgBal = (balScores.reduce((s, b) => s + b.ratio, 0) / totalCards * 100).toFixed(0);
  const opCount = balScores.filter((b) => b.ratio >= 1.4).length;
  const strongCount = balScores.filter((b) => b.ratio >= 1.15 && b.ratio < 1.4).length;
  const weakCount = balScores.filter((b) => b.ratio < 0.6).length;

  // stats
  const stats = h("div", { class: "be-stats" });
  stats.innerHTML = `
    <div class="be-stat">總數 <b>${totalCards}</b></div>
    <div class="be-stat">平均費用 <b>${avgCost}</b></div>
    <div class="be-stat">平均攻擊 <b>${avgAtk}</b></div>
    <div class="be-stat">平均血量 <b>${avgHp}</b></div>
    <div class="be-stat">平衡指數 <b style="color:${balanceColor(+avgBal / 100)}">${avgBal}%</b></div>
    <div class="be-stat" style="color:var(--danger)">OP <b>${opCount}</b></div>
    <div class="be-stat" style="color:var(--warning)">偏強 <b>${strongCount}</b></div>
    <div class="be-stat" style="color:#60a5fa">極弱 <b>${weakCount}</b></div>
  `;
  panel.append(stats);

  // toolbar
  const toolbar = h("div", { class: "be-toolbar" });
  const searchInput = h("input", { class: "be-search", placeholder: "搜尋卡牌 ID / 名稱 / 描述...", type: "text" });
  const typeSelect = h("select", { class: "be-select" });
  typeSelect.innerHTML = `<option value="">全部類型</option><option value="MINION">MINION</option><option value="NEWS">NEWS</option>`;
  const raritySelect = h("select", { class: "be-select" });
  raritySelect.innerHTML = `<option value="">全部稀有度</option><option value="COMMON">COMMON</option><option value="RARE">RARE</option><option value="EPIC">EPIC</option><option value="LEGENDARY">LEGENDARY</option>`;
  const catSelect = h("select", { class: "be-select" });
  catSelect.innerHTML =
    `<option value="">全部分類</option>` +
    categories.map((c) => `<option value="${c}">${c}</option>`).join("") +
    (hiddenCategories.length
      ? `<optgroup label="隱藏分類">` +
        hiddenCategories.map((c) => `<option value="hidden:${c}">🕶 ${c}</option>`).join("") +
        `</optgroup>`
      : "");
  toolbar.append(searchInput, typeSelect, raritySelect, catSelect);
  panel.append(toolbar);

  // table container
  const tableWrap = h("div", { style: "overflow-x: auto;" });
  const table = h("table", { class: "be-table" });
  const thead = h("thead");
  thead.innerHTML = `<tr><th>ID</th><th>名稱</th><th>是否有圖片</th><th>費用</th><th>攻/血</th><th>平衡</th><th>類型</th><th>稀有度</th><th>分類</th><th>隱藏分類</th><th>關鍵字</th></tr>`;
  table.append(thead);
  const tbody = h("tbody");
  table.append(tbody);
  tableWrap.append(table);
  panel.append(tableWrap);

  function rebuildRows() {
    tbody.innerHTML = "";
    const filtered = cards.filter((c) => {
      if (filterType && c.type !== filterType) return false;
      if (filterRarity && c.rarity !== filterRarity) return false;
      if (filterCategory) {
        if (filterCategory.startsWith("hidden:")) {
          if (c.hiddenCategory !== filterCategory.slice("hidden:".length)) return false;
        } else if (c.category !== filterCategory) {
          return false;
        }
      }
      if (searchTerm) {
        const s = searchTerm.toLowerCase();
        if (!c.id.toLowerCase().includes(s) && !c.name.toLowerCase().includes(s) && !c.description.toLowerCase().includes(s)) return false;
      }
      return true;
    });

    for (const card of filtered) {
      const tr = h("tr", { class: `be-row ${expandedId === card.id ? "be-row--expanded" : ""}` });
      const bal = calculateBalanceScore(card);
      const balPct = (bal.ratio * 100).toFixed(0);
      const bClr = balanceColor(bal.ratio);
      tr.innerHTML = `
        <td style="font-family:monospace;color:var(--text-muted)">${card.id}</td>
        <td style="font-weight:600">${card.name}</td>
        <td>${imageStatusHtml(cardHasImage(card))}</td>
        <td><span style="color:var(--primary);font-weight:700">${card.cost}</span></td>
        <td>${card.type === "MINION" ? `${card.attack ?? 0}/${card.health ?? 0}` : "—"}</td>
        <td><span class="be-balance" style="color:${bClr};background:${bClr}15" title="力量${bal.power} / 期望${bal.expected}">${balPct}% ${balanceLabel(bal.ratio)}</span></td>
        <td><span class="be-type be-type--${card.type}">${card.type}</span></td>
        <td><span class="${rarityClass(card.rarity)}">${card.rarity}</span></td>
        <td style="color:var(--text-dim)">${card.category}</td>
        <td style="color:var(--text-muted)">${card.hiddenCategory ? `🕶 ${card.hiddenCategory}` : "—"}</td>
        <td style="font-size:0.75rem;color:var(--text-dim);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${kwSummary(card.keywords)}</td>
      `;
      tr.addEventListener("click", () => {
        expandedId = expandedId === card.id ? null : card.id;
        rebuildRows();
      });
      tbody.append(tr);

      if (expandedId === card.id) {
        const edRow = h("tr", { class: "be-editor be-editor--open" });
        const edTd = h("td", { colspan: "11" });
        edTd.append(buildCardEditor(card, () => rebuildRows()));
        edRow.append(edTd);
        tbody.append(edRow);
      }
    }
  }

  searchInput.addEventListener("input", (e) => {
    searchTerm = (e.target as HTMLInputElement).value;
    rebuildRows();
  });
  typeSelect.addEventListener("change", (e) => {
    filterType = (e.target as HTMLSelectElement).value;
    rebuildRows();
  });
  raritySelect.addEventListener("change", (e) => {
    filterRarity = (e.target as HTMLSelectElement).value;
    rebuildRows();
  });
  catSelect.addEventListener("change", (e) => {
    filterCategory = (e.target as HTMLSelectElement).value;
    rebuildRows();
  });

  rebuildRows();
  return panel;
}

function buildCardEditor(card: CardDefinition, refresh: () => void): HTMLElement {
  // Two-pane layout: left = large card preview + image / category metadata,
  // right = the numeric / keyword detail tuning.
  const wrap = h("div", { class: "be-card-editor" });
  const left = h("div", { class: "be-card-editor-left" });
  const grid = h("div", { class: "be-editor-inner be-card-editor-right" });
  wrap.append(left, grid);

  // ── LEFT: large in-game preview (mirrors the live card face) ──
  const preview = h("div", { class: "be-preview be-card-preview-lg" });
  preview.innerHTML = renderCardPreview(card);
  left.append(preview);

  // Art path is derived from the card id (files are named `<id>.webp`); it is
  // not hand-edited so the naming can never drift again. Shown read-only.
  const imageField = h("div", { class: "be-field" });
  imageField.append(h("label", {}, "圖片路徑（依 id 自動）"));
  const imageInp = h("input", { type: "text", value: cardImagePath(card.id), readonly: "readonly" });
  imageField.append(imageInp);
  left.append(imageField);

  // category
  const catField = h("div", { class: "be-field" });
  catField.append(h("label", {}, "分類"));
  const catInp = h("input", { type: "text", value: card.category });
  catInp.addEventListener("change", () => { card.category = catInp.value; bumpChanges(); refresh(); });
  catField.append(catInp);
  left.append(catField);

  // hidden category (optional — not shown on the card face)
  const hiddenCatField = h("div", { class: "be-field" });
  hiddenCatField.append(h("label", {}, "隱藏分類"));
  const hiddenCatInp = h("input", { type: "text", value: card.hiddenCategory ?? "", placeholder: "（選填）" });
  hiddenCatInp.addEventListener("change", () => {
    const v = hiddenCatInp.value.trim();
    card.hiddenCategory = v || undefined;
    bumpChanges();
    refresh();
  });
  hiddenCatField.append(hiddenCatInp);
  left.append(hiddenCatField);

  // ── RIGHT: detail tuning ──
  // name
  const nameField = h("div", { class: "be-field" });
  nameField.append(h("label", {}, "名稱"));
  const nameInp = h("input", { type: "text", value: card.name });
  nameInp.addEventListener("change", () => { card.name = nameInp.value; bumpChanges(); refresh(); });
  nameField.append(nameInp);
  grid.append(nameField);

  // cost
  const costField = h("div", { class: "be-field" });
  costField.append(h("label", {}, "費用"));
  costField.append(numInput(card.cost, (v) => { card.cost = v; refresh(); }, 0, 15));
  grid.append(costField);

  // attack (MINION only)
  if (card.type === "MINION") {
    const atkField = h("div", { class: "be-field" });
    atkField.append(h("label", {}, "攻擊"));
    atkField.append(numInput(card.attack ?? 0, (v) => { card.attack = v; refresh(); }));
    grid.append(atkField);

    const hpField = h("div", { class: "be-field" });
    hpField.append(h("label", {}, "血量"));
    hpField.append(numInput(card.health ?? 0, (v) => { card.health = v; refresh(); }, 1));
    grid.append(hpField);
  }

  // rarity
  const rarField = h("div", { class: "be-field" });
  rarField.append(h("label", {}, "稀有度"));
  const rarSel = h("select", { class: "" });
  for (const r of ["COMMON", "RARE", "EPIC", "LEGENDARY"]) {
    const opt = h("option", { value: r }, r);
    if (r === card.rarity) opt.selected = true;
    rarSel.append(opt);
  }
  rarSel.addEventListener("change", () => { card.rarity = rarSel.value as CardDefinition["rarity"]; bumpChanges(); refresh(); });
  rarField.append(rarSel);
  grid.append(rarField);

  // description
  const descField = h("div", { class: "be-field", style: "grid-column: 1 / -1;" });
  descField.append(h("label", {}, "描述"));
  const descInp = h("textarea", {}, card.description);
  descInp.addEventListener("change", () => { card.description = descInp.value; bumpChanges(); });
  descField.append(descInp);
  grid.append(descField);

  // bounce_bonus
  if (card.bounce_bonus != null) {
    const bbField = h("div", { class: "be-field" });
    bbField.append(h("label", {}, "彈回加成"));
    bbField.append(numInput(card.bounce_bonus, (v) => { card.bounce_bonus = v; refresh(); }));
    grid.append(bbField);
  }

  // keywords section
  const kwSection = h("div", { class: "be-field", style: "grid-column: 1 / -1;" });
  kwSection.append(h("label", {}, "關鍵字"));
  const toggles = h("div", { class: "be-toggles" });
  const kw = card.keywords ?? {};
  card.keywords = kw;

  const boolKeys = [
    { key: "taunt" as const, label: "沙包" },
    { key: "charge" as const, label: "衝蹦" },
    { key: "divineShield" as const, label: "光盾" }
  ];
  for (const { key, label } of boolKeys) {
    const btn = h("button", { class: `be-toggle ${kw[key] ? "be-toggle--on" : ""}`, type: "button" }, label);
    btn.addEventListener("click", () => {
      (kw as Record<string, unknown>)[key] = !kw[key];
      btn.classList.toggle("be-toggle--on");
      bumpChanges();
      refresh();
    });
    toggles.append(btn);
  }
  kwSection.append(toggles);

  // newsPower
  if (kw.newsPower != null || card.type === "MINION") {
    const npField = h("div", { style: "margin-top:8px;" });
    npField.append(h("label", { style: "font-size:0.7rem;color:var(--text-muted);" }, "新聞數值 "));
    npField.append(numInput(kw.newsPower ?? 0, (v) => { kw.newsPower = v || undefined; refresh(); }));
    kwSection.append(npField);
  }

  // effect editors for keyword effects
  const effectKeys = ["battlecry", "deathrattle", "ongoing", "enrage", "triggered", "quest"] as const;
  for (const ek of effectKeys) {
    const ef = kw[ek];
    if (ef) {
      const efDiv = h("div", { style: "margin-top:12px;padding:8px;background:rgba(0,0,0,0.2);border-radius:8px;" });
      efDiv.append(h("label", { style: "font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;" }, ek));
      efDiv.append(buildEffectEditor(ef, refresh));
      kwSection.append(efDiv);
    }
  }

  grid.append(kwSection);
  return wrap;
}

function buildEffectEditor(ef: EffectDefinition, refresh: () => void): HTMLElement {
  const grid = h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-top:6px;" });

  if (ef.type != null) {
    const f = h("div", { class: "be-field" });
    f.append(h("label", {}, "type"));
    const inp = h("input", { type: "text", value: ef.type });
    inp.addEventListener("change", () => { ef.type = inp.value; bumpChanges(); });
    f.append(inp);
    grid.append(f);
  }
  const numFields: { key: keyof EffectDefinition; label: string }[] = [
    { key: "value", label: "value" },
    { key: "crystals", label: "crystals" },
    { key: "durationTurns", label: "durationTurns" },
    { key: "count", label: "count" },
    { key: "turns", label: "turns" },
    { key: "attack", label: "attack" },
    { key: "bonus_value", label: "bonus_value" },
    { key: "buff_value", label: "buff_value" },
    { key: "discardCount", label: "discardCount" },
    { key: "drawCount", label: "drawCount" }
  ];
  for (const { key, label } of numFields) {
    if ((ef as Record<string, unknown>)[key] != null) {
      const f = h("div", { class: "be-field" });
      f.append(h("label", {}, label));
      f.append(numInput(Number((ef as Record<string, unknown>)[key]), (v) => { (ef as Record<string, unknown>)[key] = v; refresh(); }, 0, 999));
      grid.append(f);
    }
  }
  if (ef.stat) {
    const f = h("div", { class: "be-field" });
    f.append(h("label", {}, "stat"));
    const sel = h("select");
    for (const s of ["ATTACK", "HEALTH", "ALL"]) {
      const o = h("option", { value: s }, s);
      if (s === ef.stat) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener("change", () => { ef.stat = sel.value as "ATTACK" | "HEALTH" | "ALL"; bumpChanges(); });
    f.append(sel);
    grid.append(f);
  }
  if (ef.target_category) {
    const f = h("div", { class: "be-field" });
    f.append(h("label", {}, "target_category"));
    const inp = h("input", { type: "text", value: ef.target_category });
    inp.addEventListener("change", () => { ef.target_category = inp.value; bumpChanges(); });
    f.append(inp);
    grid.append(f);
  }

  return grid;
}

// ── AMPS PANEL ──────────────────────────────────────────────────────
function renderAmpsPanel(): HTMLElement {
  const panel = h("div");
  const tierGroups: Record<AmplificationTier, AmplificationDbEntry[]> = {
    "加減賺": [],
    "蕭貪": [],
    "卯死": []
  };
  for (const a of amps) tierGroups[a.tier].push(a);

  for (const tier of AMPLIFICATION_TIERS) {
    const group = tierGroups[tier];
    const title = h("div", { class: `be-section-title ${tierClass(tier)}` }, `${tier}（${group.length}）`);
    panel.append(title);

    const table = h("table", { class: "be-table" });
    const thead = h("thead");
    thead.innerHTML = `<tr><th>ID</th><th>名稱</th><th>描述</th><th>是否有圖片</th><th>派系</th><th>效果</th><th>Phase1?</th></tr>`;
    table.append(thead);
    const tbody = h("tbody");

    for (const amp of group) {
      const tr = h("tr", { class: "be-row" });
      let expanded = false;
      tr.innerHTML = `
        <td style="font-family:monospace;color:var(--text-muted)">${amp.id}</td>
        <td style="font-weight:600" class="${tierClass(tier)}">${amp.name}</td>
        <td style="color:var(--text-dim);max-width:300px">${amp.description}</td>
        <td>${imageStatusHtml(Boolean(amp.hasImage))}</td>
        <td>${amp.factionTags.length ? amp.factionTags.join(", ") : "通用"}</td>
        <td style="font-size:0.75rem">${effectSummary(amp.effect)}</td>
        <td>${amp.firstPhaseOnly ? "✓" : ""}</td>
      `;
      tr.addEventListener("click", () => {
        expanded = !expanded;
        const next = tr.nextElementSibling;
        if (expanded) {
          tr.classList.add("be-row--expanded");
          const edRow = h("tr", { class: "be-editor be-editor--open" });
          const edTd = h("td", { colspan: "7" });
          edTd.append(buildAmpEditor(amp));
          edRow.append(edTd);
          tr.after(edRow);
        } else {
          tr.classList.remove("be-row--expanded");
          if (next?.classList.contains("be-editor")) next.remove();
        }
      });
      tbody.append(tr);
    }
    table.append(tbody);
    panel.append(table);
  }
  return panel;
}

function buildAmpEditor(amp: AmplificationDbEntry): HTMLElement {
  // Two-pane layout: left = large preview, right = detail tuning.
  const wrap = h("div", { class: "be-card-editor" });
  const left = h("div", { class: "be-card-editor-left" });
  const grid = h("div", { class: "be-editor-inner be-card-editor-right" });
  wrap.append(left, grid);

  // in-game preview (mirrors the live augment option)
  const preview = h("div", { class: "be-preview be-card-preview-lg" });
  preview.innerHTML = renderAugmentPreview(amp);
  left.append(preview);

  const nameF = h("div", { class: "be-field" });
  nameF.append(h("label", {}, "名稱"));
  const nameI = h("input", { type: "text", value: amp.name });
  nameI.addEventListener("change", () => { amp.name = nameI.value; bumpChanges(); });
  nameF.append(nameI);
  grid.append(nameF);

  const descF = h("div", { class: "be-field", style: "grid-column: span 2;" });
  descF.append(h("label", {}, "描述"));
  const descI = h("textarea", {}, amp.description);
  descI.addEventListener("change", () => { amp.description = descI.value; bumpChanges(); });
  descF.append(descI);
  grid.append(descF);

  const tagsF = h("div", { class: "be-field" });
  tagsF.append(h("label", {}, "派系標籤 (逗號分隔)"));
  const tagsI = h("input", { type: "text", value: amp.factionTags.join(", ") });
  tagsI.addEventListener("change", () => {
    amp.factionTags = tagsI.value.split(",").map((s) => s.trim()).filter(Boolean);
    bumpChanges();
  });
  tagsF.append(tagsI);
  grid.append(tagsF);

  const imgF = h("div", { class: "be-field" });
  imgF.append(h("label", {}, "是否有圖片"));
  const imgToggles = h("div", { class: "be-toggles" });
  const imgBtn = h("button", { class: `be-toggle ${amp.hasImage ? "be-toggle--on" : ""}`, type: "button" }, amp.hasImage ? "有圖片" : "無圖片");
  imgBtn.addEventListener("click", () => {
    amp.hasImage = !Boolean(amp.hasImage);
    bumpChanges();
    render();
  });
  imgToggles.append(imgBtn);
  imgF.append(imgToggles);
  grid.append(imgF);

  // effect
  const efDiv = h("div", { class: "be-field", style: "grid-column: 1 / -1;" });
  efDiv.append(h("label", {}, "效果"));
  efDiv.append(buildEffectEditor(amp.effect, () => {}));
  grid.append(efDiv);

  return wrap;
}

// ── VOTES PANEL ─────────────────────────────────────────────────────
function renderVotesPanel(): HTMLElement {
  const panel = h("div");
  const maxWeight = Math.max(...votes.map((v) => v.tierWeight));

  const table = h("table", { class: "be-table" });
  const thead = h("thead");
  thead.innerHTML = `<tr><th>ID</th><th>名稱</th><th>是否有圖片</th><th>權重</th><th style="min-width:120px">權重視覺</th><th>模式</th><th>選項</th><th>效果</th></tr>`;
  table.append(thead);
  const tbody = h("tbody");

  for (const ve of votes) {
    const tr = h("tr", { class: "be-row" });
    const pct = ((ve.tierWeight / maxWeight) * 100).toFixed(0);
    tr.innerHTML = `
      <td style="font-family:monospace;color:var(--text-muted)">${ve.id}</td>
      <td style="font-weight:600">${ve.name}</td>
      <td>${imageStatusHtml(Boolean(ve.hasImage))}</td>
      <td style="font-weight:700;color:var(--primary)">${ve.tierWeight}</td>
      <td><div class="be-weight-bar"><div class="be-weight-bar-fill" style="width:${pct}%"></div></div></td>
      <td><span class="be-type be-type--${ve.apply.mode === "ENVIRONMENT" ? "MINION" : "NEWS"}">${ve.apply.mode}</span></td>
      <td style="font-size:0.75rem;color:var(--text-dim)">${ve.options[0]}</td>
      <td style="font-size:0.75rem">${effectSummary(ve.apply.effect)}</td>
    `;
    let expanded = false;
    tr.addEventListener("click", () => {
      expanded = !expanded;
      const next = tr.nextElementSibling;
      if (expanded) {
        tr.classList.add("be-row--expanded");
        const edRow = h("tr", { class: "be-editor be-editor--open" });
        const edTd = h("td", { colspan: "8" });
        edTd.append(buildVoteEditor(ve));
        edRow.append(edTd);
        tr.after(edRow);
      } else {
        tr.classList.remove("be-row--expanded");
        if (next?.classList.contains("be-editor")) next.remove();
      }
    });
    tbody.append(tr);
  }
  table.append(tbody);
  panel.append(table);
  return panel;
}

function buildVoteEditor(ve: VoteEventDbEntry): HTMLElement {
  // Two-pane layout: left = large preview, right = detail tuning.
  const wrap = h("div", { class: "be-card-editor" });
  const left = h("div", { class: "be-card-editor-left" });
  const grid = h("div", { class: "be-editor-inner be-card-editor-right" });
  wrap.append(left, grid);

  // in-game preview (mirrors the live vote option)
  const preview = h("div", { class: "be-preview be-card-preview-lg" });
  preview.innerHTML = renderVoteEventPreview(ve);
  left.append(preview);

  const nameF = h("div", { class: "be-field" });
  nameF.append(h("label", {}, "名稱"));
  const nameI = h("input", { type: "text", value: ve.name });
  nameI.addEventListener("change", () => { ve.name = nameI.value; bumpChanges(); });
  nameF.append(nameI);
  grid.append(nameF);

  const weightF = h("div", { class: "be-field" });
  weightF.append(h("label", {}, "權重"));
  weightF.append(numInput(ve.tierWeight, (v) => { ve.tierWeight = v; }, 1, 100));
  grid.append(weightF);

  const imgF = h("div", { class: "be-field" });
  imgF.append(h("label", {}, "是否有圖片"));
  const imgToggles = h("div", { class: "be-toggles" });
  const imgBtn = h("button", { class: `be-toggle ${ve.hasImage ? "be-toggle--on" : ""}`, type: "button" }, ve.hasImage ? "有圖片" : "無圖片");
  imgBtn.addEventListener("click", () => {
    ve.hasImage = !Boolean(ve.hasImage);
    bumpChanges();
    render();
  });
  imgToggles.append(imgBtn);
  imgF.append(imgToggles);
  grid.append(imgF);

  // options
  for (let i = 0; i < 3; i++) {
    const optF = h("div", { class: "be-field" });
    optF.append(h("label", {}, `選項 ${i + 1}`));
    const inp = h("input", { type: "text", value: ve.options[i] });
    const idx = i as 0 | 1 | 2;
    inp.addEventListener("change", () => { ve.options[idx] = inp.value; bumpChanges(); });
    optF.append(inp);
    grid.append(optF);
  }

  // mode
  const modeF = h("div", { class: "be-field" });
  modeF.append(h("label", {}, "模式"));
  const modeSel = h("select");
  for (const m of ["ENVIRONMENT", "IMMEDIATE"]) {
    const o = h("option", { value: m }, m);
    if (m === ve.apply.mode) o.selected = true;
    modeSel.append(o);
  }
  modeSel.addEventListener("change", () => { ve.apply.mode = modeSel.value as "ENVIRONMENT" | "IMMEDIATE"; bumpChanges(); });
  modeF.append(modeSel);
  grid.append(modeF);

  if (ve.apply.durationTurns != null) {
    const durF = h("div", { class: "be-field" });
    durF.append(h("label", {}, "持續回合"));
    durF.append(numInput(ve.apply.durationTurns, (v) => { ve.apply.durationTurns = v; }, 1, 20));
    grid.append(durF);
  }

  // effect
  const efDiv = h("div", { class: "be-field", style: "grid-column: 1 / -1;" });
  efDiv.append(h("label", {}, "效果"));
  efDiv.append(buildEffectEditor(ve.apply.effect, () => {}));
  grid.append(efDiv);

  return wrap;
}

// ── PROGRESSION PANEL ───────────────────────────────────────────────
function renderProgressionPanel(): HTMLElement {
  const panel = h("div");

  // editable constants
  const consts = h("div", { class: "be-prog-consts" });

  const maxLvCard = h("div", { class: "be-prog-card" });
  maxLvCard.append(h("h4", {}, "MAX_LEVEL"));
  maxLvCard.append(numInput(prog.MAX_LEVEL, (v) => { prog.MAX_LEVEL = v; }, 1, 100));
  consts.append(maxLvCard);

  const lvGoldCard = h("div", { class: "be-prog-card" });
  lvGoldCard.append(h("h4", {}, "LEVEL_UP_GOLD"));
  lvGoldCard.append(numInput(prog.LEVEL_UP_GOLD, (v) => { prog.LEVEL_UP_GOLD = v; }, 0, 1000));
  consts.append(lvGoldCard);

  const maxXpCard = h("div", { class: "be-prog-card" });
  maxXpCard.append(h("h4", {}, "MAX_LEVEL_XP_REQUIREMENT"));
  maxXpCard.append(numInput(prog.MAX_LEVEL_XP_REQUIREMENT, (v) => { prog.MAX_LEVEL_XP_REQUIREMENT = v; }, 0, 9999));
  consts.append(maxXpCard);

  panel.append(consts);

  // XP curve table
  panel.append(h("div", { class: "be-section-title" }, "XP 曲線表"));
  const xpWrap = h("div", { class: "be-xp-table" });
  const xpTable = h("table");
  let xpHtml = "<thead><tr><th>等級</th><th>所需 XP</th><th>累計 XP</th><th>視覺化</th></tr></thead><tbody>";
  let cumXp = 0;
  const maxXp = getXPRequiredForLevel(MAX_LEVEL - 1);
  for (let i = 1; i < MAX_LEVEL; i++) {
    const req = getXPRequiredForLevel(i);
    cumXp += req;
    const pct = ((req / maxXp) * 100).toFixed(0);
    xpHtml += `<tr>
      <td>${i} → ${i + 1}</td>
      <td style="font-weight:600;color:var(--primary)">${req}</td>
      <td style="color:var(--text-dim)">${cumXp}</td>
      <td><div class="be-weight-bar"><div class="be-weight-bar-fill" style="width:${pct}%"></div></div></td>
    </tr>`;
  }
  xpHtml += "</tbody>";
  xpTable.innerHTML = xpHtml;
  xpWrap.append(xpTable);
  panel.append(xpWrap);

  // In-game difficulty labels — the internal keys (easy/normal/hard) are a v1→v2
  // remap, so the editor shows the player-facing 普通/專家/大師 names too to avoid
  // the "easy 其實是普通級" confusion.
  const diffLabel: Record<AiDifficulty, string> = { easy: "普通級", normal: "專家級", hard: "大師級" };
  const lvlGold = prog.LEVEL_UP_GOLD;

  // ── PvE rewards table ──────────────────────────────────────────────
  panel.append(h("div", { class: "be-section-title", style: "margin-top:32px;" }, "PvE 獎勵表（對戰 AI）"));
  const rewardsTable = h("table", { class: "be-rewards-table" });
  let rHtml = `<thead><tr><th>難度（內部鍵）</th><th>遊戲內名稱</th><th>首勝 XP</th><th>重複 XP</th><th>首勝金幣</th><th>重複金幣</th></tr></thead><tbody>`;
  for (const diff of AI_DIFFICULTIES) {
    rHtml += `<tr>
      <td style="font-weight:600;text-transform:uppercase">${diff}</td>
      <td style="font-weight:600">${diffLabel[diff]}</td>
      <td style="color:var(--success)">${getPveXpReward(diff, true)}</td>
      <td style="color:var(--text-dim)">${getPveXpReward(diff, false)}</td>
      <td style="color:var(--warning)">${getPveFirstVictoryGold(diff)}</td>
      <td style="color:var(--text-muted)">0</td>
    </tr>`;
  }
  rHtml += "</tbody>";
  rewardsTable.innerHTML = rHtml;
  panel.append(rewardsTable);
  panel.append(
    h(
      "div",
      { style: "margin-top:8px;font-size:0.78rem;color:var(--text-dim);line-height:1.6;" },
      `※ PvE 金幣只有「每個 AI 主題 × 難度」的『首勝』才會發放（每組合一次）；重複勝利只給 XP，金幣為 0。`,
      h("br"),
      `※ 不論首勝或重複，勝利取得的 XP 若觸發升級，每升一級額外 +${lvlGold} 金幣（PvP 同樣適用）。`,
      h("br"),
      `※ PvE 只有「勝方」會拿到獎勵，敗方無任何 XP / 金幣。`
    )
  );

  // ── PvP rewards table ──────────────────────────────────────────────
  panel.append(h("div", { class: "be-section-title", style: "margin-top:32px;" }, "PvP 獎勵表（線上對戰）"));
  panel.append(
    h(
      "div",
      { style: "margin-bottom:12px;font-size:0.8rem;color:var(--text-dim);line-height:1.7;" },
      h("b", { style: "color:var(--text)" }, "勝方 XP"),
      `：8 基礎 + 剩餘血量加成 floor(剩血/30×4)(0–4) + 速度加成(≤5回合+3、≤10+2、≤15+1)。範圍 8–15。`,
      h("br"),
      h("b", { style: "color:var(--text)" }, "勝方金幣"),
      `：( 20 + 回合加成 min(回合數,20) + 受傷加成 floor((30−剩血)/3) ) × 2。`,
      h("br"),
      h("b", { style: "color:var(--text)" }, "敗方金幣"),
      `：floor(勝方金幣 / 3) + 敗方受傷加成 floor((30−敗方剩血)/3)。`,
      h("br"),
      `升級金幣（每級 +${lvlGold}）同樣適用於 PvP 勝方。`
    )
  );

  // Worked examples computed from the live progression functions so the table
  // can never drift from the server's actual reward math.
  const pvpScenarios: { label: string; turns: number; winnerHp: number; loserHp: number }[] = [
    { label: "速勝・血量全滿", turns: 4, winnerHp: 30, loserHp: 0 },
    { label: "普通勝", turns: 8, winnerHp: 20, loserHp: 0 },
    { label: "慘勝（剩 4 血）", turns: 12, winnerHp: 4, loserHp: 0 },
    { label: "長盤勝", turns: 20, winnerHp: 15, loserHp: 0 },
    { label: "對手投降（敗方剩 18 血）", turns: 9, winnerHp: 26, loserHp: 18 }
  ];
  const pvpTable = h("table", { class: "be-rewards-table" });
  let pHtml = `<thead><tr><th>情境</th><th>回合數</th><th>勝方剩血</th><th>敗方剩血</th><th>勝方 XP</th><th>勝方金幣</th><th>敗方金幣</th></tr></thead><tbody>`;
  for (const s of pvpScenarios) {
    const xp = calculatePvPExp(s.winnerHp, s.turns);
    const { winnerGold, loserGold } = calculatePvPGold(s.winnerHp, s.loserHp, s.turns);
    pHtml += `<tr>
      <td style="font-weight:600;text-align:left">${s.label}</td>
      <td style="color:var(--text-dim)">${s.turns}</td>
      <td style="color:var(--text-dim)">${s.winnerHp}</td>
      <td style="color:var(--text-dim)">${s.loserHp}</td>
      <td style="color:var(--success)">${xp}</td>
      <td style="color:var(--warning)">${winnerGold}</td>
      <td style="color:#60a5fa">${loserGold}</td>
    </tr>`;
  }
  pHtml += "</tbody>";
  pvpTable.innerHTML = pHtml;
  panel.append(pvpTable);
  panel.append(
    h(
      "div",
      { style: "margin-top:8px;font-size:0.78rem;color:var(--text-dim);line-height:1.6;" },
      `※ PvP 勝方與敗方都會拿到金幣（敗方為安慰獎）；只有勝方拿 XP。`,
      h("br"),
      `※ 以上為範例情境，實際數值依該場「回合數 / 雙方剩餘血量」即時計算。`,
      h("br"),
      `※ 所有 XP / 金幣只發給已登入帳號，且需伺服器（realtime Worker）設好 Supabase 金鑰；否則雙方都會看到「獎勵未發放」。`
    )
  );

  return panel;
}

// ── AI DECKS PANEL ──────────────────────────────────────────────────
function validateAiDeck(deckIds: string[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (deckIds.length !== 30) {
    errors.push(`卡牌總數必須剛好為 30 張（目前有 ${deckIds.length} 張）`);
  }
  const counts = new Map<string, number>();
  for (const id of deckIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let legendaryTotal = 0;
  for (const [id, count] of counts) {
    const card = cards.find((c) => c.id === id);
    if (!card) {
      errors.push(`未知的卡牌 ID: ${id}`);
      continue;
    }
    if (count > 2) {
      errors.push(`卡牌「${card.name}」(${id}) 超過單卡複製上限 2 張（目前有 ${count} 張）`);
    }
    if (card.rarity === "LEGENDARY") {
      legendaryTotal += count;
    }
  }
  if (legendaryTotal > 2) {
    errors.push(`傳說卡牌總數超過上限 2 張（目前有 ${legendaryTotal} 張）`);
  }
  return { valid: errors.length === 0, errors };
}

function addCardToDeck(themeId: string, cardId: string) {
  if (!aiDecks[themeId]) aiDecks[themeId] = [];
  aiDecks[themeId].push(cardId);
  bumpChanges();
  render();
}

function removeCardFromDeck(themeId: string, cardId: string) {
  if (!aiDecks[themeId]) return;
  const index = aiDecks[themeId].lastIndexOf(cardId);
  if (index !== -1) {
    aiDecks[themeId].splice(index, 1);
    bumpChanges();
    render();
  }
}

function deleteCardFromDeck(themeId: string, cardId: string) {
  if (!aiDecks[themeId]) return;
  aiDecks[themeId] = aiDecks[themeId].filter((id) => id !== cardId);
  bumpChanges();
  render();
}

function renderAiDecksPanel(): HTMLElement {
  const panel = h("div");
  const deckGrid = h("div", { class: "be-deck-grid" });

  const cardMap = new Map(cards.map((c) => [c.id, c]));

  for (const theme of aiThemes) {
    const isExpanded = expandedThemeId === theme.id;
    const deckCard = h("div", {
      class: `be-deck-card ${isExpanded ? "be-deck-card--expanded" : ""}`,
      style: isExpanded ? "grid-column: 1 / -1; border-color: var(--primary);" : "cursor: pointer;"
    });

    const header = h("div", { class: "be-deck-header" });
    const heroInitial = theme.name.charAt(0);
    const hero = h("div", { class: "be-deck-hero" }, heroInitial);

    // validation badge
    const deckIds = aiDecks[theme.id] || [];
    const valResult = validateAiDeck(deckIds);
    const valBadge = h("span", {
      class: `be-deck-validation ${valResult.valid ? "be-deck-valid" : "be-deck-invalid"}`,
      style: "margin-left: auto; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px;"
    }, valResult.valid ? "✓ 合規" : `✗ 異常 (${valResult.errors.length})`);

    const info = h("div", { style: "flex: 1;" });
    info.append(h("div", { class: "be-deck-title" }, theme.label));
    info.append(h("div", { class: "be-deck-subtitle" }, `${theme.partyTag} • 英雄: ${theme.name} (${theme.heroCardId})`));
    header.append(hero, info, valBadge);
    deckCard.append(header);

    // If not expanded, clicking header/card toggles expand
    if (!isExpanded) {
      deckCard.addEventListener("click", () => {
        expandedThemeId = theme.id;
        render();
      });

      // show basic non-editable card list
      const countMap = new Map<string, number>();
      for (const id of deckIds) countMap.set(id, (countMap.get(id) ?? 0) + 1);

      const sorted = [...countMap.entries()].sort((a, b) => {
        const ca = cardMap.get(a[0]);
        const cb = cardMap.get(b[0]);
        return (ca?.cost ?? 0) - (cb?.cost ?? 0);
      });

      const list = h("div", { class: "be-deck-list" });
      for (const [cardId, count] of sorted) {
        const c = cardMap.get(cardId);
        const item = h("div", { class: "be-deck-item" });
        const costBadge = h("div", { class: "be-deck-item-cost" }, String(c?.cost ?? "?"));
        const name = h("span", {}, c?.name ?? cardId);
        const countBadge = h("span", { class: "be-deck-item-count" }, `×${count}`);
        item.append(costBadge, name, countBadge);
        list.append(item);
      }
      deckCard.append(list);

      const deckTotal = h("div", { style: "margin-top:12px;font-size:0.75rem;color:var(--text-muted);" }, `共 ${deckIds.length} 張卡 • ${countMap.size} 種`);
      deckCard.append(deckTotal);
    } else {
      // Expanded Editor View
      const collapseBtn = h("button", {
        class: "be-btn be-btn--danger",
        style: "padding: 4px 8px; font-size: 0.75rem; margin-left: 8px;",
        type: "button"
      }, "收合 ▴");
      collapseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        expandedThemeId = null;
        render();
      });
      header.append(collapseBtn);

      // Meta fields row
      const metaRow = h("div", {
        style: "display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 16px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: var(--radius-sm);"
      });

      // Name field
      const nameF = h("div", { class: "be-field" });
      nameF.append(h("label", {}, "英雄名稱"));
      const nameI = h("input", { type: "text", value: theme.name });
      nameI.addEventListener("change", () => {
        theme.name = nameI.value;
        bumpChanges();
        render();
      });
      nameF.append(nameI);

      // Label field
      const labelF = h("div", { class: "be-field" });
      labelF.append(h("label", {}, "挑戰關卡標題"));
      const labelI = h("input", { type: "text", value: theme.label });
      labelI.addEventListener("change", () => {
        theme.label = labelI.value;
        bumpChanges();
        render();
      });
      labelF.append(labelI);

      // Party Tag
      const partyF = h("div", { class: "be-field" });
      partyF.append(h("label", {}, "所屬政黨"));
      const partySel = h("select");
      for (const pt of ["民進黨", "國民黨", "民眾黨"]) {
        const opt = h("option", { value: pt }, pt);
        if (pt === theme.partyTag) opt.selected = true;
        partySel.append(opt);
      }
      partySel.addEventListener("change", () => {
        theme.partyTag = partySel.value as any;
        bumpChanges();
        render();
      });
      partyF.append(partySel);

      // Hero Card ID select
      const heroF = h("div", { class: "be-field" });
      heroF.append(h("label", {}, "代表英雄卡 (Hero Card)"));
      const heroSel = h("select");
      const sortedCards = [...cards].sort((a, b) => a.id.localeCompare(b.id));
      for (const card of sortedCards) {
        const opt = h("option", { value: card.id }, `${card.name} (${card.id}) [${card.rarity}]`);
        if (card.id === theme.heroCardId) opt.selected = true;
        heroSel.append(opt);
      }
      heroSel.addEventListener("change", () => {
        theme.heroCardId = heroSel.value;
        bumpChanges();
        render();
      });
      heroF.append(heroSel);

      metaRow.append(nameF, labelF, partyF, heroF);
      deckCard.append(metaRow);

      // Validation warnings
      if (!valResult.valid) {
        const errDiv = h("div", {
          style: "margin-top: 12px; padding: 12px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: var(--radius-sm); color: var(--danger); font-size: 0.85rem;"
        });
        errDiv.append(h("h5", { style: "font-weight: 700; margin-bottom: 4px;" }, "牌組規則異常："));
        const errList = h("ul", { style: "padding-left: 16px; margin: 0;" });
        for (const err of valResult.errors) {
          errList.append(h("li", {}, err));
        }
        errDiv.append(errList);
        deckCard.append(errDiv);
      } else {
        const okDiv = h("div", {
          style: "margin-top: 12px; padding: 8px 12px; background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); border-radius: var(--radius-sm); color: var(--success); font-size: 0.85rem;"
        }, "✓ 牌組規則完全合規 (剛好 30 張，且未超出複製與傳說卡限制)");
        deckCard.append(okDiv);
      }

      // Deck cards list + Search / Add section
      const editorCols = h("div", {
        style: "display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 20px; margin-top: 16px;"
      });

      // Left: Card list with +/- controls
      const leftCol = h("div");
      leftCol.append(h("h5", { style: "font-size: 0.85rem; color: var(--text-muted); margin-bottom: 8px;" }, "當前卡牌清單"));

      const countMap = new Map<string, number>();
      for (const id of deckIds) countMap.set(id, (countMap.get(id) ?? 0) + 1);
      const sortedEntries = [...countMap.entries()].sort((a, b) => {
        const ca = cardMap.get(a[0]);
        const cb = cardMap.get(b[0]);
        return (ca?.cost ?? 0) - (cb?.cost ?? 0);
      });

      const listDiv = h("div", { style: "display: flex; flex-direction: column; gap: 4px; max-height: 400px; overflow-y: auto; padding-right: 4px;" });
      for (const [cardId, count] of sortedEntries) {
        const c = cardMap.get(cardId);
        const item = h("div", {
          class: "be-deck-item",
          style: "background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 6px 12px;"
        });

        const costBadge = h("div", { class: "be-deck-item-cost" }, String(c?.cost ?? "?"));
        const nameSpan = h("span", { style: "font-weight: 500; font-size: 0.85rem;" }, `${c?.name ?? cardId} [${c?.id}]`);

        // Controls container
        const ctrlContainer = h("div", { style: "display: flex; align-items: center; gap: 6px; margin-left: auto;" });

        const decBtn = h("button", {
          class: "be-num-btn",
          style: "width: 24px; height: 24px; font-size: 0.8rem; border-radius: 4px;",
          type: "button"
        }, "−");
        decBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          removeCardFromDeck(theme.id, cardId);
        });

        const qtySpan = h("span", { style: "font-weight: 700; min-width: 24px; text-align: center; font-size: 0.85rem;" }, `x${count}`);

        const incBtn = h("button", {
          class: "be-num-btn",
          style: "width: 24px; height: 24px; font-size: 0.8rem; border-radius: 4px;",
          type: "button"
        }, "+");
        incBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          addCardToDeck(theme.id, cardId);
        });

        const delBtn = h("button", {
          class: "be-deck-remove-btn",
          style: "opacity: 1; border: none; font-size: 0.8rem;",
          type: "button"
        }, "🗑️");
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (confirm(`確定要將卡牌 ${c?.name || cardId} 從牌組中完全移除？`)) {
            deleteCardFromDeck(theme.id, cardId);
          }
        });

        ctrlContainer.append(decBtn, qtySpan, incBtn, delBtn);
        item.append(costBadge, nameSpan, ctrlContainer);
        listDiv.append(item);
      }
      leftCol.append(listDiv);

      // Right: Search & Add cards
      const rightCol = h("div", { style: "position: relative;" });
      rightCol.append(h("h5", { style: "font-size: 0.85rem; color: var(--text-muted); margin-bottom: 8px;" }, "搜尋並加入卡牌"));

      const searchDiv = h("div", { style: "position: relative;" });
      const searchI = h("input", {
        class: "be-deck-search",
        placeholder: "搜尋卡牌名稱或 ID...",
        style: "width: 100%; padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--glass-border); background: rgba(0,0,0,0.3); color: var(--text); font-size: 0.85rem;",
        type: "text"
      });
      const suggsDiv = h("div", {
        class: "be-deck-suggestions",
        style: "display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 100; max-height: 250px; overflow-y: auto; background: rgba(10,10,15,0.98); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); box-shadow: 0 4px 12px rgba(0,0,0,0.5);"
      });

      searchI.addEventListener("input", () => {
        const query = searchI.value.trim().toLowerCase();
        if (!query) {
          suggsDiv.style.display = "none";
          return;
        }

        // Filter catalog cards matching name or ID
        const matched = cards.filter((c) => c.name.toLowerCase().includes(query) || c.id.toLowerCase().includes(query)).slice(0, 8);

        suggsDiv.innerHTML = "";
        if (matched.length === 0) {
          suggsDiv.append(h("div", { style: "padding: 8px 12px; font-size: 0.8rem; color: var(--text-muted);" }, "找不到匹配的卡牌"));
        } else {
          for (const card of matched) {
            const item = h("div", {
              class: "be-deck-suggest-item",
              style: "display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; transition: background 0.1s;"
            });
            item.innerHTML = `
              <div class="be-deck-item-cost" style="width:20px;height:20px;font-size:0.7rem;border-radius:50%;background:rgba(99,102,241,0.2);color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:700;">${card.cost}</div>
              <div style="font-size:0.85rem;font-weight:500;">${card.name}</div>
              <div style="font-size:0.7rem;color:var(--text-muted);font-family:monospace;margin-left:auto;">${card.id}</div>
              <span class="${rarityClass(card.rarity)}" style="font-size:0.65rem;padding:1px 4px;border-radius:3px;">${card.rarity}</span>
            `;
            item.addEventListener("click", () => {
              addCardToDeck(theme.id, card.id);
              searchI.value = "";
              suggsDiv.style.display = "none";
            });
            suggsDiv.append(item);
          }
        }
        suggsDiv.style.display = "block";
      });

      // Hide suggestions when clicking outside
      document.addEventListener("click", (event) => {
        if (!searchDiv.contains(event.target as Node)) {
          suggsDiv.style.display = "none";
        }
      });

      searchDiv.append(searchI, suggsDiv);
      rightCol.append(searchDiv);

      editorCols.append(leftCol, rightCol);
      deckCard.append(editorCols);
    }

    deckGrid.append(deckCard);
  }
  panel.append(deckGrid);
  return panel;
}

// ── TASKS / ACHIEVEMENTS PANEL ──────────────────────────────────────
function nextQuestId(prefix: string): string {
  const existing = new Set(quests.map((q) => q.id));
  let i = 1;
  while (existing.has(`${prefix}_${i}`)) i++;
  return `${prefix}_${i}`;
}

function addQuest(recurrence: QuestRecurrence) {
  const prefix = recurrence === "once" ? "ach_new" : recurrence === "weekly" ? "weekly_new" : "daily_new";
  const id = nextQuestId(prefix);
  quests.push({
    id,
    display_name: "新任務",
    description: "",
    event_type: recurrence === "once" ? "pve_win" : "match_played",
    target_count: 1,
    recurrence,
    rewardGold: recurrence === "once" ? 100 : 40,
    active: true
  });
  expandedQuestId = id;
  bumpChanges();
  render();
}

function deleteQuest(id: string) {
  const index = quests.findIndex((q) => q.id === id);
  if (index === -1) return;
  quests.splice(index, 1);
  if (expandedQuestId === id) expandedQuestId = null;
  bumpChanges();
  render();
}

function renderTasksPanel(): HTMLElement {
  const panel = h("div");

  // shared datalist of known server-emitted event types
  const datalist = h("datalist", { id: "quest-event-types" });
  for (const et of KNOWN_EVENT_TYPES) datalist.append(h("option", { value: et.value }, et.label));
  panel.append(datalist);

  // stats
  const onceCount = quests.filter((q) => q.recurrence === "once").length;
  const dailyCount = quests.filter((q) => q.recurrence === "daily").length;
  const weeklyCount = quests.filter((q) => q.recurrence === "weekly").length;
  const activeCount = quests.filter((q) => q.active).length;
  const stats = h("div", { class: "be-stats" });
  stats.innerHTML = `
    <div class="be-stat">總數 <b>${quests.length}</b></div>
    <div class="be-stat">成就 <b>${onceCount}</b></div>
    <div class="be-stat">每日 <b>${dailyCount}</b></div>
    <div class="be-stat">每週 <b>${weeklyCount}</b></div>
    <div class="be-stat" style="color:var(--success)">啟用 <b>${activeCount}</b></div>
  `;
  panel.append(stats);

  // validation banner (empty / duplicate ids would break the exported SQL)
  const issues = validateQuestDrafts(quests);
  if (issues.length) {
    const warn = h("div", {
      style: "margin-bottom:16px;padding:10px 14px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius-sm);color:var(--danger);font-size:0.8rem;"
    });
    const lines = issues.map((issue) =>
      issue.type === "empty_id" ? `第 ${issue.index + 1} 列的 ID 為空` : `重複的 ID：${issue.id}`
    );
    warn.innerHTML = `⚠ 匯出前請修正：${lines.join("；")}`;
    panel.append(warn);
  }

  for (const { value: recurrence, label } of QUEST_RECURRENCE_OPTIONS) {
    const group = quests.filter((q) => q.recurrence === recurrence);

    const titleRow = h("div", { style: "display:flex;align-items:center;gap:12px;margin:24px 0 12px;" });
    titleRow.append(h("div", { class: "be-section-title", style: "margin:0;border:none;flex:1;" }, `${label}（${group.length}）`));
    const addBtn = h("button", { class: "be-btn be-btn--primary", type: "button" }, `＋ 新增`);
    addBtn.addEventListener("click", () => addQuest(recurrence));
    titleRow.append(addBtn);
    panel.append(titleRow);

    const table = h("table", { class: "be-table" });
    const thead = h("thead");
    thead.innerHTML = `<tr><th>ID</th><th>名稱</th><th>事件類型</th><th>目標</th><th>獎勵</th><th>啟用</th></tr>`;
    table.append(thead);
    const tbody = h("tbody");

    if (group.length === 0) {
      const emptyRow = h("tr");
      emptyRow.innerHTML = `<td colspan="6" style="color:var(--text-muted);padding:16px 12px;">尚無項目，點「＋ 新增」建立。</td>`;
      tbody.append(emptyRow);
    }

    for (const quest of group) {
      const expanded = expandedQuestId === quest.id;
      const tr = h("tr", { class: `be-row ${expanded ? "be-row--expanded" : ""}` });
      tr.innerHTML = `
        <td style="font-family:monospace;color:var(--text-muted)">${escapeHtmlText(quest.id)}</td>
        <td style="font-weight:600">${escapeHtmlText(quest.display_name)}</td>
        <td style="font-size:0.8rem;color:var(--text-dim)">${escapeHtmlText(quest.event_type)}</td>
        <td><span style="color:var(--primary);font-weight:700">${quest.target_count}</span></td>
        <td style="color:var(--warning);font-weight:600">💰${quest.rewardGold}</td>
        <td>${quest.active ? '<span style="color:var(--success)">啟用</span>' : '<span style="color:var(--text-muted)">停用</span>'}</td>
      `;
      tr.addEventListener("click", () => {
        expandedQuestId = expanded ? null : quest.id;
        render();
      });
      tbody.append(tr);

      if (expanded) {
        const edRow = h("tr", { class: "be-editor be-editor--open" });
        const edTd = h("td", { colspan: "6" });
        edTd.append(buildQuestEditor(quest));
        edRow.append(edTd);
        tbody.append(edRow);
      }
    }
    table.append(tbody);
    panel.append(table);
  }

  return panel;
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildQuestEditor(q: QuestDefinitionDraft): HTMLElement {
  const grid = h("div", { class: "be-editor-inner" });

  // id (primary key — editable so new rows can be named)
  const idF = h("div", { class: "be-field" });
  idF.append(h("label", {}, "ID（主鍵）"));
  const idI = h("input", { type: "text", value: q.id });
  idI.addEventListener("change", () => {
    q.id = idI.value.trim();
    if (expandedQuestId !== q.id) expandedQuestId = q.id;
    bumpChanges();
    render();
  });
  idF.append(idI);
  grid.append(idF);

  // display_name
  const nameF = h("div", { class: "be-field" });
  nameF.append(h("label", {}, "名稱"));
  const nameI = h("input", { type: "text", value: q.display_name });
  nameI.addEventListener("change", () => { q.display_name = nameI.value; bumpChanges(); render(); });
  nameF.append(nameI);
  grid.append(nameF);

  // event_type with datalist suggestions
  const evF = h("div", { class: "be-field" });
  evF.append(h("label", {}, "事件類型"));
  const evI = h("input", { type: "text", value: q.event_type, list: "quest-event-types" });
  evI.addEventListener("change", () => { q.event_type = evI.value.trim(); bumpChanges(); render(); });
  evF.append(evI);
  grid.append(evF);

  // recurrence
  const recF = h("div", { class: "be-field" });
  recF.append(h("label", {}, "重複類型"));
  const recSel = h("select");
  for (const opt of QUEST_RECURRENCE_OPTIONS) {
    const o = h("option", { value: opt.value }, opt.label);
    if (opt.value === q.recurrence) o.selected = true;
    recSel.append(o);
  }
  recSel.addEventListener("change", () => { q.recurrence = recSel.value as QuestRecurrence; bumpChanges(); render(); });
  recF.append(recSel);
  grid.append(recF);

  // target_count
  const tgtF = h("div", { class: "be-field" });
  tgtF.append(h("label", {}, "目標次數"));
  tgtF.append(numInput(q.target_count, (v) => { q.target_count = v; render(); }, 1, 9999));
  grid.append(tgtF);

  // reward gold
  const goldF = h("div", { class: "be-field" });
  goldF.append(h("label", {}, "獎勵金幣"));
  goldF.append(numInput(q.rewardGold, (v) => { q.rewardGold = v; render(); }, 0, 9999));
  grid.append(goldF);

  // active toggle
  const actF = h("div", { class: "be-field" });
  actF.append(h("label", {}, "啟用"));
  const actToggles = h("div", { class: "be-toggles" });
  const actBtn = h("button", { class: `be-toggle ${q.active ? "be-toggle--on" : ""}`, type: "button" }, q.active ? "啟用中" : "已停用");
  actBtn.addEventListener("click", () => { q.active = !q.active; bumpChanges(); render(); });
  actToggles.append(actBtn);
  actF.append(actToggles);
  grid.append(actF);

  // description
  const descF = h("div", { class: "be-field", style: "grid-column: 1 / -1;" });
  descF.append(h("label", {}, "描述"));
  const descI = h("textarea", {}, q.description);
  descI.addEventListener("change", () => { q.description = descI.value; bumpChanges(); });
  descF.append(descI);
  grid.append(descF);

  // delete
  const delF = h("div", { class: "be-field", style: "grid-column: 1 / -1;align-items:flex-start;" });
  const delBtn = h("button", { class: "be-btn be-btn--danger", type: "button" }, "🗑️ 刪除此項目");
  delBtn.addEventListener("click", () => {
    if (confirm(`確定要刪除「${q.display_name || q.id}」？`)) deleteQuest(q.id);
  });
  delF.append(delBtn);
  grid.append(delF);

  return grid;
}

// ── EXPORT ──────────────────────────────────────────────────────────
// ── apply directly to source files (dev server) ─────────────────────
function toast(message: string, ok: boolean) {
  const el = h("div", {
    style:
      "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;" +
      "padding:12px 20px;border-radius:10px;font-size:0.9rem;font-weight:600;" +
      "box-shadow:0 8px 24px rgba(0,0,0,0.5);max-width:80vw;text-align:center;" +
      (ok
        ? "background:rgba(34,197,94,0.95);color:#04210f;"
        : "background:rgba(239,68,68,0.95);color:#fff;")
  }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), ok ? 3200 : 6000);
}

// Minimal-diff change detection: the server only edits the spans we send, so we
// send ONLY what differs from the imported baseline. Untouched entries are never
// transmitted and therefore stay byte-for-byte identical on disk.
type Leaf = { path: (string | number)[]; value: unknown };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
// JSON round-trip so undefined-valued keys (e.g. `newsPower = v || undefined`)
// don't register as differences — they vanish in the serialised source too.
function normalize<T>(v: T): T {
  return JSON.parse(JSON.stringify(v ?? null));
}
function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

// Collect scalar/array/object leaf edits between baseline and current. Returns
// false if a key was added or removed (or an object↔non-object swap) — the caller
// then falls back to re-serialising that whole entry.
function collectLeaves(base: unknown, cur: unknown, path: (string | number)[], out: Leaf[]): boolean {
  if (jsonEq(base, cur)) return true;
  if (isPlainObject(base) && isPlainObject(cur)) {
    const bk = Object.keys(base);
    const ck = Object.keys(cur);
    if (bk.length !== ck.length || !bk.every((k) => k in cur)) return false;
    for (const k of ck) if (!collectLeaves(base[k], cur[k], [...path, k], out)) return false;
    return true;
  }
  if (isPlainObject(base) !== isPlainObject(cur)) return false;
  // primitive or array value at an existing key → patch this single span
  out.push({ path, value: cur });
  return true;
}

type EntryChange = { id: string; leaves?: Leaf[]; entry?: unknown };
function sectionChanges<T extends { id: string }>(base: readonly T[], cur: readonly T[]): EntryChange[] {
  const baseById = new Map(base.map((e) => [e.id, e]));
  const changed: EntryChange[] = [];
  for (const entry of cur) {
    const b = baseById.get(entry.id);
    if (b && jsonEq(b, entry)) continue;
    if (!b) { changed.push({ id: entry.id, entry }); continue; }
    const leaves: Leaf[] = [];
    if (collectLeaves(normalize(b), normalize(entry), [], leaves) && leaves.length) {
      changed.push({ id: entry.id, leaves });
    } else {
      changed.push({ id: entry.id, entry });
    }
  }
  return changed;
}

function buildChangeset() {
  const sections: Record<string, EntryChange[]> = {};
  const add = (name: string, ch: EntryChange[]) => { if (ch.length) sections[name] = ch; };
  add("cards", sectionChanges(CARD_CATALOG as readonly { id: string }[], cards as { id: string }[]));
  add("amps", sectionChanges(AMPLIFICATION_DB as readonly { id: string }[], amps as { id: string }[]));
  add("votes", sectionChanges(VOTE_EVENT_DB as readonly { id: string }[], votes as { id: string }[]));
  add("aiThemes", sectionChanges(AI_THEMES as readonly { id: string }[], aiThemes as { id: string }[]));

  const aiDecksChanged: { key: string; value: string[] }[] = [];
  for (const key of Object.keys(aiDecks)) {
    const baseDeck = (AI_THEME_DECKS as Record<string, readonly string[]>)[key];
    if (!baseDeck || !jsonEq(baseDeck, aiDecks[key])) aiDecksChanged.push({ key, value: aiDecks[key] });
  }

  const progression: Record<string, number> = {};
  if (prog.MAX_LEVEL !== MAX_LEVEL) progression.MAX_LEVEL = prog.MAX_LEVEL;
  if (prog.LEVEL_UP_GOLD !== LEVEL_UP_GOLD) progression.LEVEL_UP_GOLD = prog.LEVEL_UP_GOLD;
  if (prog.MAX_LEVEL_XP_REQUIREMENT !== MAX_LEVEL_XP_REQUIREMENT) progression.MAX_LEVEL_XP_REQUIREMENT = prog.MAX_LEVEL_XP_REQUIREMENT;

  // Shop packs: add/remove/rename rewrites the whole SHOP_PACK_SEED array;
  // pure field edits go through the precise per-entry section path.
  let packsFull: ShopPackDraft[] | undefined;
  if (!jsonEq(SHOP_PACK_SEED, packs)) {
    const baseIds = new Set(SHOP_PACK_SEED.map((p) => p.id));
    const curIds = new Set(packs.map((p) => p.id));
    const structural = packs.some((p) => !baseIds.has(p.id)) || SHOP_PACK_SEED.some((p) => !curIds.has(p.id));
    if (structural) packsFull = packs;
    else add("packs", sectionChanges(SHOP_PACK_SEED as readonly { id: string }[], packs as { id: string }[]));
  }

  const changeset: {
    sections: typeof sections;
    aiDecks: typeof aiDecksChanged;
    progression: typeof progression;
    packsFull?: ShopPackDraft[];
  } = { sections, aiDecks: aiDecksChanged, progression, packsFull };
  const count =
    Object.values(sections).reduce((n, c) => n + c.length, 0) +
    aiDecksChanged.length +
    Object.keys(progression).length +
    (packsFull ? packsFull.length : 0);
  return { changeset, count };
}

async function applyToSource(btn: HTMLButtonElement) {
  const { changeset, count } = buildChangeset();
  if (count === 0) {
    toast("沒有偵測到任何變更。", true);
    return;
  }
  const label = btn.textContent;
  btn.textContent = "⏳ 寫入中…";
  btn.disabled = true;
  try {
    // 任務 (quests) and 卡包 (packs) are Supabase seeds, not code — they stay on
    // the SQL export path; everything else is patched straight into source.
    const res = await fetch("/__apply-balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changeset)
    });
    const result = (await res.json()) as { ok: boolean; written?: string[]; error?: string };
    if (result.ok) {
      setChangeBadge(0);
      toast(`✅ 已精準套用 ${count} 項變更到 ${result.written?.length ?? 0} 個檔案，Vite 會自動重新載入。`, true);
    } else {
      toast(`❌ 套用失敗：${result.error ?? "未知錯誤"}`, false);
    }
  } catch {
    toast("❌ 無法連線到開發伺服器。請用「npm run dev:web」開啟編輯器後再套用。", false);
  } finally {
    btn.textContent = label;
    btn.disabled = false;
  }
}

function exportJson() {
  const data = {
    cards,
    amplifications: amps,
    voteEvents: votes,
    progression: prog,
    aiThemes,
    aiDecks,
    quests
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, "balance-data.json");
}

function exportCardsTs() {
  // Normalize every art path to the id-derived canonical name on the way out,
  // so the exported catalog is always internally consistent.
  const normalized = cards.map((card) => ({ ...card, image: cardImagePath(card.id) }));
  const lines = [
    '// Auto-generated by balance-editor',
    'import type { CardDefinition } from "./types.js";',
    "",
    `export const CARD_CATALOG_GENERATED = ${JSON.stringify(normalized, null, 2)} as const satisfies readonly CardDefinition[];`,
    ""
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  downloadBlob(blob, "catalog.generated.ts");
}

function exportAmpsTs() {
  const lines = [
    '// Auto-generated by balance-editor',
    'import type { AmplificationTier } from "@twcardgame/shared";',
    'import type { EffectDefinition } from "./types.js";',
    "",
    'export interface AmplificationDbEntry {',
    '  id: string;',
    '  name: string;',
    '  description: string;',
    '  hasImage?: boolean;',
    '  tier: AmplificationTier;',
    '  factionTags: string[];',
    '  firstPhaseOnly?: boolean;',
    '  effect: EffectDefinition;',
    '}',
    "",
    `export const AMPLIFICATION_DB: AmplificationDbEntry[] = ${JSON.stringify(amps, null, 2)};`,
    ""
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  downloadBlob(blob, "amplificationDb.ts");
}

function exportVotesTs() {
  const lines = [
    '// Auto-generated by balance-editor',
    'import type { EffectDefinition } from "./types.js";',
    "",
    'export interface EnvironmentDescriptor {',
    '  mode: "ENVIRONMENT" | "IMMEDIATE";',
    '  durationTurns?: number;',
    '  effect: EffectDefinition;',
    '}',
    "",
    'export interface VoteEventDbEntry {',
    '  id: string;',
    '  name: string;',
    '  hasImage?: boolean;',
    '  tierWeight: number;',
    '  options: [string, string, string];',
    '  apply: EnvironmentDescriptor;',
    '}',
    "",
    `export const VOTE_EVENT_DB: VoteEventDbEntry[] = ${JSON.stringify(votes, null, 2)};`,
    ""
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  downloadBlob(blob, "voteEventDb.ts");
}

function exportAiDecksTs() {
  const lines = [
    '// Auto-generated by balance-editor',
    '// Copy and paste these to replace definitions in packages/shared/src/index.ts',
    "",
    'export type AiTheme = "dpp" | "dpp2" | "kmt" | "kmt2" | "tpp";',
    'export type AiPartyTag = "民進黨" | "國民黨" | "民眾黨";',
    'export interface AiThemeDefinition {',
    '  id: AiTheme;',
    '  name: string;',
    '  label: string;',
    '  heroCardId: string;',
    '  partyTag: AiPartyTag;',
    '}',
    "",
    `export const AI_THEMES: readonly AiThemeDefinition[] = ${JSON.stringify(aiThemes, null, 2)} as const;`,
    "",
    `export const AI_THEME_DECKS: Record<AiTheme, readonly string[]> = ${JSON.stringify(aiDecks, null, 2)} as const;`,
    ""
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  downloadBlob(blob, "aiDecks.generated.ts");
}

// ── PACKS PANEL ─────────────────────────────────────────────────────
function renderPacksPanel(): HTMLElement {
  const panel = h("div");

  // datalist of catalog categories (faction picker hints), from the working copy
  const categories = [...new Set(cards.map((c) => c.category).filter(Boolean))].sort();
  const datalist = h("datalist", { id: "pack-faction-categories" });
  for (const cat of categories) datalist.append(h("option", { value: cat }));
  panel.append(datalist);

  // intro / explanation of how the odds work
  const intro = h("div", {
    style: "margin-bottom:16px;padding:12px 14px;background:var(--glass);border:1px solid var(--glass-border);border-radius:var(--radius-sm);color:var(--text-dim);font-size:0.8rem;line-height:1.6;"
  });
  intro.innerHTML =
    "每抽一張卡分兩步：先依 <b>掉落率</b> 抽稀有度，再於該稀有度的卡池中挑卡。" +
    "陣營卡會獲得 <b>陣營權重</b> 倍的選中權重（其餘等權重）。下方「命中率」依目前卡牌分頁的卡池即時計算 —— " +
    "<b>權重越低、卡池越大，目標陣營的命中率就越低</b>。";
  panel.append(intro);

  // validation banner
  const issues = validatePackDrafts(packs);
  if (issues.length) {
    const warn = h("div", {
      style: "margin-bottom:16px;padding:10px 14px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius-sm);color:var(--danger);font-size:0.8rem;"
    });
    const lines = issues.map((issue) =>
      issue.type === "empty_id"
        ? `第 ${issue.index + 1} 列的 ID 為空`
        : issue.type === "duplicate_id"
          ? `重複的 ID：${issue.id}`
          : `${issue.id} 的掉落率加總為 ${issue.total}%（應為 100%）`
    );
    warn.innerHTML = `⚠ ${lines.join("；")}`;
    panel.append(warn);
  }

  const titleRow = h("div", { style: "display:flex;align-items:center;gap:12px;margin:8px 0 12px;" });
  titleRow.append(h("div", { class: "be-section-title", style: "margin:0;border:none;flex:1;" }, `商店卡包（${packs.length}）`));
  const addBtn = h("button", { class: "be-btn be-btn--primary", type: "button" }, "＋ 新增卡包");
  addBtn.addEventListener("click", addPack);
  titleRow.append(addBtn);
  panel.append(titleRow);

  const table = h("table", { class: "be-table" });
  const thead = h("thead");
  thead.innerHTML = `<tr><th>ID</th><th>名稱</th><th>價格</th><th>張數</th><th>目標陣營</th><th>權重</th><th>每張命中率</th></tr>`;
  table.append(thead);
  const tbody = h("tbody");

  if (packs.length === 0) {
    const emptyRow = h("tr");
    emptyRow.innerHTML = `<td colspan="7" style="color:var(--text-muted);padding:16px 12px;">尚無卡包，點「＋ 新增卡包」建立。</td>`;
    tbody.append(emptyRow);
  }

  for (const pack of packs) {
    const expanded = expandedPackId === pack.id;
    const odds = computePackOdds(pack, cards);
    const hitCell = odds.hasFaction
      ? `<span style="color:var(--primary);font-weight:700">${(odds.perCardFactionChance * 100).toFixed(1)}%</span> <span style="color:var(--text-muted);font-size:0.75rem">(${odds.expectedFactionCards.toFixed(2)} 張/包)</span>`
      : `<span style="color:var(--text-muted)">均等</span>`;
    const tr = h("tr", { class: `be-row ${expanded ? "be-row--expanded" : ""}` });
    tr.innerHTML = `
      <td style="font-family:monospace;color:var(--text-muted)">${escapeHtmlText(pack.id)}</td>
      <td style="font-weight:600">${escapeHtmlText(pack.display_name)}</td>
      <td style="color:var(--warning);font-weight:600">💰${pack.price_gold}</td>
      <td>${pack.cardCount}</td>
      <td style="font-size:0.8rem;color:var(--text-dim)">${escapeHtmlText(pack.faction ?? "—")}</td>
      <td>${odds.hasFaction ? `${pack.factionWeight}×` : "—"}</td>
      <td>${hitCell}</td>
    `;
    tr.addEventListener("click", () => {
      expandedPackId = expanded ? null : pack.id;
      render();
    });
    tbody.append(tr);

    if (expanded) {
      const edRow = h("tr", { class: "be-editor be-editor--open" });
      const edTd = h("td", { colspan: "7" });
      edTd.append(buildPackEditor(pack));
      edRow.append(edTd);
      tbody.append(edRow);
    }
  }
  table.append(tbody);
  panel.append(table);

  return panel;
}

function buildPackEditor(pack: ShopPackDraft): HTMLElement {
  const wrap = h("div", { style: "padding:16px;display:flex;flex-direction:column;gap:16px;" });

  const field = (label: string, input: HTMLElement): HTMLElement => {
    const f = h("label", { style: "display:flex;flex-direction:column;gap:4px;font-size:0.75rem;color:var(--text-muted);" });
    f.append(document.createTextNode(label), input);
    return f;
  };

  const grid = h("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;" });

  const idInput = h("input", { class: "be-input", type: "text", value: pack.id });
  idInput.addEventListener("input", () => { pack.id = idInput.value; bumpChanges(); });

  const nameInput = h("input", { class: "be-input", type: "text", value: pack.display_name });
  nameInput.addEventListener("input", () => { pack.display_name = nameInput.value; bumpChanges(); });

  const priceInput = h("input", { class: "be-input", type: "number", value: String(pack.price_gold), min: "0" });
  priceInput.addEventListener("input", () => { pack.price_gold = Number(priceInput.value) || 0; bumpChanges(); });

  const countInput = h("input", { class: "be-input", type: "number", value: String(pack.cardCount), min: "1" });
  countInput.addEventListener("input", () => { pack.cardCount = Number(countInput.value) || 0; render(); bumpChanges(); });

  const factionInput = h("input", { class: "be-input", type: "text", value: pack.faction ?? "", list: "pack-faction-categories", placeholder: "（無，均等）" });
  factionInput.addEventListener("input", () => { pack.faction = factionInput.value.trim() || undefined; render(); bumpChanges(); });

  const weightInput = h("input", { class: "be-input", type: "number", value: String(pack.factionWeight), min: "1", step: "0.5" });
  weightInput.addEventListener("input", () => { pack.factionWeight = Number(weightInput.value) || 1; render(); bumpChanges(); });

  grid.append(
    field("ID", idInput),
    field("名稱", nameInput),
    field("價格 (gold)", priceInput),
    field("每包張數", countInput),
    field("目標陣營 (category)", factionInput),
    field("陣營權重 (×)", weightInput)
  );
  wrap.append(grid);

  const descInput = h("textarea", { class: "be-input", rows: "2", style: "resize:vertical;width:100%;" });
  descInput.value = pack.description;
  descInput.addEventListener("input", () => { pack.description = descInput.value; bumpChanges(); });
  wrap.append(field("描述", descInput));

  // drop-rates editor
  wrap.append(h("div", { class: "be-section-title", style: "margin:8px 0 0;border:none;" }, "稀有度掉落率 (%)"));
  const drTable = h("table", { class: "be-table", style: "max-width:420px;" });
  drTable.innerHTML = `<thead><tr><th>稀有度</th><th>掉落率 (%)</th></tr></thead>`;
  const drBody = h("tbody");
  for (const rarity of PACK_RARITIES) {
    let dr = pack.dropRates.find((r) => r.rarity === rarity.value);
    const row = h("tr");
    const labelTd = h("td", {}, `${rarity.label} (${rarity.value})`);
    const valTd = h("td");
    const rateInput = h("input", { class: "be-input", type: "number", min: "0", step: "0.1", value: dr ? String(dr.rate) : "0", style: "width:100px;" });
    rateInput.addEventListener("input", () => {
      const v = Number(rateInput.value) || 0;
      if (!dr) {
        dr = { label: rarity.label, rarity: rarity.value as PackRarity, rate: v };
        pack.dropRates.push(dr);
      } else {
        dr.rate = v;
      }
      render();
      bumpChanges();
    });
    valTd.append(rateInput);
    row.append(labelTd, valTd);
    drBody.append(row);
  }
  drTable.append(drBody);
  const total = pack.dropRates.reduce((s, r) => s + (Number.isFinite(r.rate) ? r.rate : 0), 0);
  const totalNote = h("div", {
    style: `font-size:0.75rem;margin-top:6px;color:${Math.abs(total - 100) < 0.01 ? "var(--success)" : "var(--danger)"};`
  }, `加總：${total}%`);
  wrap.append(drTable, totalNote);

  // computed odds breakdown
  const odds = computePackOdds(pack, cards);
  wrap.append(h("div", { class: "be-section-title", style: "margin:8px 0 0;border:none;" }, "命中率分析（依目前卡池即時計算）"));
  if (!odds.hasFaction) {
    wrap.append(h("div", { style: "font-size:0.8rem;color:var(--text-dim);" }, "此卡包無目標陣營，所有卡牌於各稀有度內等機率。"));
  } else {
    const oddsTable = h("table", { class: "be-table" });
    oddsTable.innerHTML = `<thead><tr><th>稀有度</th><th>掉落率</th><th>陣營卡</th><th>其他卡</th><th>該稀有度命中率</th></tr></thead>`;
    const oBody = h("tbody");
    for (const r of odds.perRarity) {
      const tr = h("tr");
      tr.innerHTML = `
        <td>${r.rarity}</td>
        <td>${r.rate}%</td>
        <td>${r.factionCount}</td>
        <td>${r.otherCount}</td>
        <td style="color:var(--primary);font-weight:600">${(r.pFactionGivenRarity * 100).toFixed(1)}%</td>
      `;
      oBody.append(tr);
    }
    oddsTable.append(oBody);
    wrap.append(oddsTable);
    const summary = h("div", {
      style: "margin-top:8px;font-size:0.85rem;color:var(--text);"
    });
    summary.innerHTML =
      `每抽一張卡，是「${escapeHtmlText(pack.faction ?? "")}」的機率為 ` +
      `<b style="color:var(--primary)">${(odds.perCardFactionChance * 100).toFixed(1)}%</b>` +
      `，整包平均拿到 <b style="color:var(--primary)">${odds.expectedFactionCards.toFixed(2)}</b> 張。`;
    wrap.append(summary);
  }

  // delete
  const actions = h("div", { style: "display:flex;justify-content:flex-end;margin-top:8px;" });
  const delBtn = h("button", { class: "be-btn be-btn--danger", type: "button" }, "🗑 刪除此卡包");
  delBtn.addEventListener("click", () => {
    if (!confirm(`確定要刪除「${pack.display_name}」？`)) return;
    const idx = packs.indexOf(pack);
    if (idx >= 0) packs.splice(idx, 1);
    expandedPackId = null;
    render();
    bumpChanges();
  });
  actions.append(delBtn);
  wrap.append(actions);

  return wrap;
}

function addPack() {
  let n = packs.length + 1;
  let id = `pack-new-${n}`;
  while (packs.some((p) => p.id === id)) id = `pack-new-${++n}`;
  packs.push({
    id,
    display_name: "新卡包",
    description: "包含 5 張隨機卡牌。",
    price_gold: 100,
    cardCount: 5,
    factionWeight: 3,
    dropRates: [
      { label: "普通", rarity: "COMMON", rate: 60 },
      { label: "精良", rarity: "RARE", rate: 30 },
      { label: "史詩", rarity: "EPIC", rate: 7 },
      { label: "傳說", rarity: "LEGENDARY", rate: 3 }
    ]
  });
  expandedPackId = id;
  render();
  bumpChanges();
}

function exportPacksSql() {
  const blob = new Blob([generatePackSeedSql(packs)], { type: "text/plain" });
  downloadBlob(blob, "card_packs_seed.sql");
}

function exportProgressionTs() {
  const lines = [
    '// Auto-generated by balance-editor',
    '// Replace the top constants in packages/shared/src/progression.ts',
    "",
    `export const MAX_LEVEL = ${prog.MAX_LEVEL};`,
    `export const LEVEL_UP_GOLD = ${prog.LEVEL_UP_GOLD};`,
    `export const MAX_LEVEL_XP_REQUIREMENT = ${prog.MAX_LEVEL_XP_REQUIREMENT};`,
    ""
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  downloadBlob(blob, "progression.generated.ts");
}

function exportTasksSql() {
  const blob = new Blob([generateQuestSeedSql(quests)], { type: "text/plain" });
  downloadBlob(blob, "tasks_achievements_seed.sql");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── BOOT ────────────────────────────────────────────────────────────
render();
