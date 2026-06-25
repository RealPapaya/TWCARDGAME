// Central registry of quest/achievement `event_type` strings.
//
// This is the single source of truth for the detection "vocabulary": every
// server-authoritative user_event that can advance quest progress is listed
// here, with its zh-TW label and progress mode. Consumers:
//   * apps/server emission (taskEvents.ts + DB RPCs) — emit these exact values.
//   * apps/web balance editor — datalist hints for authoring quest_definitions.
//   * quest_definitions.event_type — matched verbatim by the progress RPCs.
//
// Defining a new achievement/quest is then "pick a value here + a target number
// + a display name" — no new code required, because the emission already fires.

/**
 * How matching quests advance when an event arrives:
 *   - "cumulative": progress += amount (emit_user_progress_event). Use for
 *     counting occurrences over time (damage dealt, packs opened, losses…).
 *   - "snapshot": progress = max(progress, value) (emit_user_progress_snapshot).
 *     Use for "own X" state thresholds where the current amount can also drop
 *     (friends owned, distinct card types, copies of a card).
 */
export type QuestEventMode = "cumulative" | "snapshot";

export interface QuestEventTypeDef {
  /** The exact `event_type` string (or, for `dynamic`, its prefix template). */
  value: string;
  /** zh-TW label for editor hints. */
  label: string;
  mode: QuestEventMode;
  /**
   * When true, `value` is a prefix and the real event_type appends a runtime
   * suffix (e.g. `pve_win:hard`, `card_copies_owned:CARD_X`). A quest_definitions
   * row must use the fully-suffixed string.
   */
  dynamic?: boolean;
}

/**
 * All quest event types. Existing types (pre-0024) are kept so the editor's
 * dropdown stays complete; new detection types are grouped after them.
 */
export const QUEST_EVENT_TYPES: ReadonlyArray<QuestEventTypeDef> = [
  // --- Existing (emitted before this work) -------------------------------
  { value: "pve_win", label: "擊敗電腦 (pve_win)", mode: "cumulative" },
  { value: "pvp_win", label: "玩家對戰獲勝 (pvp_win)", mode: "cumulative" },
  { value: "match_won", label: "對戰獲勝 (match_won)", mode: "cumulative" },
  { value: "match_played", label: "進行對戰 (match_played)", mode: "cumulative" },
  { value: "level_up", label: "升級 (level_up)", mode: "cumulative" },
  { value: "card_acquired", label: "獲得卡牌 (card_acquired)", mode: "cumulative" },
  { value: "daily_login", label: "每日登入 (daily_login)", mode: "cumulative" },
  { value: "cards_played", label: "出牌 (cards_played)", mode: "cumulative" },
  { value: "minions_summoned", label: "召喚單位 (minions_summoned)", mode: "cumulative" },
  { value: "damage_dealt", label: "對英雄造成傷害 (damage_dealt)", mode: "cumulative" },
  { value: "quest_claimed", label: "領取獎勵 (quest_claimed)", mode: "cumulative" },

  // --- New: in-match combat (aggregated at match end) --------------------
  { value: "damage_dealt_minion", label: "對隨從造成傷害 (damage_dealt_minion)", mode: "cumulative" },
  { value: "minions_killed", label: "擊殺隨從 (minions_killed)", mode: "cumulative" },
  { value: "health_restored", label: "回復生命 (health_restored)", mode: "cumulative" },
  { value: "minions_resurrected", label: "復活隨從 (minions_resurrected)", mode: "cumulative" },
  { value: "minions_bounced", label: "回手隨從 (minions_bounced)", mode: "cumulative" },

  // --- New: match outcome ------------------------------------------------
  { value: "match_lost", label: "戰敗 (match_lost)", mode: "cumulative" },
  { value: "pve_win:", label: "擊敗電腦特定難度 (pve_win:<easy|normal|hard>)", mode: "cumulative", dynamic: true },
  { value: "pve_lost:", label: "敗給電腦特定難度，投降不計 (pve_lost:<easy|normal|hard>)", mode: "cumulative", dynamic: true },
  { value: "pvp_played", label: "進行玩家對戰 (pvp_played)", mode: "cumulative" },
  { value: "challenge_win", label: "通關挑戰模式 (challenge_win)", mode: "cumulative" },
  { value: "challenge_win:", label: "通關挑戰特定關卡 (challenge_win:<stage>:<level>)", mode: "cumulative", dynamic: true },

  // --- New: in-match combat thresholds (emitted at match end) ------------
  { value: "damage_taken", label: "我方英雄受到傷害 (damage_taken)", mode: "cumulative" },
  { value: "own_minions_died", label: "我方隨從死亡 (own_minions_died)", mode: "cumulative" },
  { value: "political_minions_killed", label: "擊殺藍綠政治隨從 (political_minions_killed)", mode: "cumulative" },
  { value: "hero_damage_vs_taunt", label: "對方有沙包時對英雄造成傷害 (hero_damage_vs_taunt)", mode: "cumulative" },
  { value: "vote_won", label: "公投中選 (vote_won)", mode: "cumulative" },
  { value: "minion_heal_match_50", label: "單場回復隨從滿 50 (minion_heal_match_50)", mode: "cumulative" },
  { value: "perfect_game", label: "完全比賽 (perfect_game)", mode: "cumulative" },
  { value: "labor_deck_win", label: "勞工牌組獲勝 (labor_deck_win)", mode: "cumulative" },
  { value: "pack_epic_multi", label: "單卡包多張史詩 (pack_epic_multi)", mode: "cumulative" },

  // --- New: economy ------------------------------------------------------
  { value: "gold_spent", label: "累積消費金幣 (gold_spent)", mode: "cumulative" },
  { value: "voucher_gained", label: "獲得消費券 (voucher_gained)", mode: "cumulative" },
  { value: "card_disenchanted", label: "分解卡片 (card_disenchanted)", mode: "cumulative" },
  { value: "pack_opened", label: "打開卡包 (pack_opened)", mode: "cumulative" },

  // --- New: social + cosmetics -------------------------------------------
  { value: "title_acquired", label: "獲得稱號 (title_acquired)", mode: "cumulative" },
  { value: "avatar_acquired", label: "獲得頭像 (avatar_acquired)", mode: "cumulative" },

  // --- New: state snapshots ("own X") ------------------------------------
  { value: "friends_owned", label: "擁有好友 (friends_owned)", mode: "snapshot" },
  { value: "collection_types_owned", label: "擁有卡牌種類 (collection_types_owned)", mode: "snapshot" },
  { value: "card_copies_owned:", label: "擁有特定卡牌張數 (card_copies_owned:<cardId>)", mode: "snapshot", dynamic: true }
];

const MODE_BY_EVENT = new Map(QUEST_EVENT_TYPES.map((def) => [def.value, def.mode] as const));

/**
 * Resolves the progress mode for a concrete event_type, handling dynamic
 * suffixed types (e.g. `pve_win:hard` → the `pve_win:` prefix's mode). Returns
 * "cumulative" for unknown types so a hand-authored quest still tracks.
 */
export function questEventMode(eventType: string): QuestEventMode {
  const exact = MODE_BY_EVENT.get(eventType);
  if (exact) return exact;
  for (const def of QUEST_EVENT_TYPES) {
    if (def.dynamic && def.value.endsWith(":") && eventType.startsWith(def.value)) {
      return def.mode;
    }
  }
  return "cumulative";
}
