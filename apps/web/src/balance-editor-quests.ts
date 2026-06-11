// Pure data + SQL-export helpers for the balance-editor "任務/成就" (tasks &
// achievements) tab. Kept free of DOM so the SQL generation is unit-testable.
//
// Quests have no TypeScript catalog the way cards/amps/votes do — their only
// source of truth is the SQL seed in
// packages/db/migrations/0023_tasks_achievements.sql. This module embeds an
// editable copy of that seed and re-emits an upsert in the same shape, so the
// output can be pasted into a fresh migration. Writes to quest_definitions are
// service_role-only by design (anti-cheat), which is why the editor produces a
// migration rather than writing to Supabase from the browser.

import { QUEST_EVENT_TYPES } from "@twcardgame/shared";

export type QuestRecurrence = "once" | "daily" | "weekly";

/**
 * The editor's working shape for a quest_definitions row. `reward` is a jsonb
 * column in the DB but every seeded quest is gold-only and `claim_quest_reward`
 * reads only `reward->>'gold'`, so the editor models it as a single number and
 * serializes back to `{"gold":N}`.
 */
export interface QuestDefinitionDraft {
  id: string;
  display_name: string;
  description: string;
  event_type: string;
  target_count: number;
  recurrence: QuestRecurrence;
  rewardGold: number;
  active: boolean;
}

/**
 * Event types known to be emitted server-side, offered as datalist hints.
 * Derived from the shared QUEST_EVENT_TYPES registry (the single source of
 * truth) so the editor stays in sync with what the server actually emits.
 */
export const KNOWN_EVENT_TYPES: ReadonlyArray<{ value: string; label: string }> = QUEST_EVENT_TYPES.map(
  ({ value, label }) => ({ value, label })
);

export const QUEST_RECURRENCE_OPTIONS: ReadonlyArray<{ value: QuestRecurrence; label: string }> = [
  { value: "once", label: "成就 (once)" },
  { value: "daily", label: "每日 (daily)" },
  { value: "weekly", label: "每週 (weekly)" }
];

/**
 * Initial seed, matching the intended display names from the 0023 task list.
 * Achievements are `once`; daily tasks are `daily`.
 */
export const QUEST_DEFINITIONS_SEED: readonly QuestDefinitionDraft[] = [
  { id: "ach_first_pve_win", display_name: "已知用火", description: "首次擊敗電腦對手", event_type: "pve_win", target_count: 1, recurrence: "once", rewardGold: 100, active: true },
  { id: "ach_first_pvp_win", display_name: "第一滴血", description: "首次在玩家對戰中獲勝", event_type: "pvp_win", target_count: 1, recurrence: "once", rewardGold: 100, active: true },
  { id: "ach_reach_level_5", display_name: "初生之犢", description: "達到等級 5", event_type: "level_up", target_count: 4, recurrence: "once", rewardGold: 100, active: true },
  { id: "ach_reach_level_10", display_name: "進入狀況", description: "達到等級 10", event_type: "level_up", target_count: 9, recurrence: "once", rewardGold: 200, active: true },
  { id: "ach_win_10_total", display_name: "十全大補湯", description: "累積獲勝 10 場", event_type: "match_won", target_count: 10, recurrence: "once", rewardGold: 250, active: true },
  { id: "ach_collect_5_cards", display_name: "收藏家", description: "獲得 50 張卡牌", event_type: "card_acquired", target_count: 50, recurrence: "once", rewardGold: 100, active: true },
  { id: "daily_login", display_name: "每日簽到", description: "今日登入遊戲", event_type: "daily_login", target_count: 1, recurrence: "daily", rewardGold: 15, active: true },
  { id: "daily_play_1", display_name: "沒贏也沒關係", description: "今日進行 1 場對戰", event_type: "match_played", target_count: 1, recurrence: "daily", rewardGold: 30, active: true },
  { id: "daily_play_3", display_name: "我們必須更深入一點", description: "今日進行 3 場對戰", event_type: "match_played", target_count: 3, recurrence: "daily", rewardGold: 50, active: true },
  { id: "daily_win_1", display_name: "每日首勝", description: "今日獲勝 1 場", event_type: "match_won", target_count: 1, recurrence: "daily", rewardGold: 50, active: true },
  { id: "daily_play_10_cards", display_name: "劉謙", description: "今日出 30 張牌", event_type: "cards_played", target_count: 10, recurrence: "daily", rewardGold: 40, active: true },
  { id: "daily_summon_5", display_name: "放置Play", description: "今日召喚 15 個單位", event_type: "minions_summoned", target_count: 5, recurrence: "daily", rewardGold: 40, active: true },
  { id: "daily_deal_30_dmg", display_name: "說好的別打臉", description: "今日對敵方英雄造成 30 傷害", event_type: "damage_dealt", target_count: 30, recurrence: "daily", rewardGold: 40, active: true }
];

export type QuestValidationIssue =
  | { type: "empty_id"; index: number }
  | { type: "duplicate_id"; id: string };

/**
 * Surfaces problems that would make the exported SQL fail: empty ids, or
 * duplicate ids (Postgres errors when ON CONFLICT touches the same row twice in
 * one statement).
 */
export function validateQuestDrafts(quests: readonly QuestDefinitionDraft[]): QuestValidationIssue[] {
  const issues: QuestValidationIssue[] = [];
  const seen = new Set<string>();
  const reportedDup = new Set<string>();
  quests.forEach((quest, index) => {
    const id = quest.id.trim();
    if (!id) {
      issues.push({ type: "empty_id", index });
      return;
    }
    if (seen.has(id)) {
      if (!reportedDup.has(id)) {
        issues.push({ type: "duplicate_id", id });
        reportedDup.add(id);
      }
    } else {
      seen.add(id);
    }
  });
  return issues;
}

/** Doubles single quotes for safe inlining into a single-quoted SQL literal. */
export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlString(value: string): string {
  return `'${escapeSqlString(value)}'`;
}

function rewardLiteral(rewardGold: number): string {
  const json = JSON.stringify({ gold: Math.trunc(rewardGold) });
  return `'${escapeSqlString(json)}'::jsonb`;
}

const QUEST_COLUMNS = "(id, display_name, description, event_type, target_count, recurrence, reward, active)";

const ON_CONFLICT_CLAUSE = `on conflict (id) do update
  set display_name = excluded.display_name,
      description  = excluded.description,
      event_type   = excluded.event_type,
      target_count = excluded.target_count,
      recurrence   = excluded.recurrence,
      reward       = excluded.reward,
      active       = excluded.active,
      updated_at   = now();`;

/**
 * Emits an idempotent `insert ... on conflict do update` for the given quests,
 * mirroring the upsert shape of 0023_tasks_achievements.sql so the result can be
 * dropped into a new migration verbatim.
 */
export function generateQuestSeedSql(quests: readonly QuestDefinitionDraft[]): string {
  const header = [
    "-- Auto-generated by balance-editor — 任務 / 成就 (quest_definitions) seed.",
    "-- Save as a new migration, e.g. packages/db/migrations/00NN_tasks_achievements_seed.sql",
    "-- Mirrors the upsert shape from 0023_tasks_achievements.sql (idempotent)."
  ].join("\n");

  if (quests.length === 0) {
    return `${header}\n-- (no quests to export)\n`;
  }

  const rows = quests.map((quest) => {
    const values = [
      sqlString(quest.id.trim()),
      sqlString(quest.display_name),
      sqlString(quest.description),
      sqlString(quest.event_type.trim()),
      String(Math.trunc(quest.target_count)),
      sqlString(quest.recurrence),
      rewardLiteral(quest.rewardGold),
      quest.active ? "true" : "false"
    ];
    return `  (${values.join(", ")})`;
  });

  return [
    header,
    "",
    "insert into public.quest_definitions",
    `  ${QUEST_COLUMNS}`,
    "values",
    `${rows.join(",\n")}`,
    ON_CONFLICT_CLAUSE,
    ""
  ].join("\n");
}
