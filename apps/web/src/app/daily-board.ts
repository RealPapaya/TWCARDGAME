import type { TaskView } from "./types.js";

/** The 簽到 (daily check-in) quest, always pinned first on the daily board. */
export const DAILY_CHECKIN_QUEST_ID = "daily_login";
/** How many non-check-in daily tasks to surface (the rest stay hidden). */
export const DAILY_PICK_COUNT = 2;

const TASK_STATE_RANK = { claimable: 0, "in-progress": 1, claimed: 2 } as const;

/** Deterministic 32-bit FNV-1a hash — keeps the daily pick stable for a seed. */
export function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Builds the daily board: the 簽到 check-in plus a stable random pick of
 * `DAILY_PICK_COUNT` other daily tasks. Seeded by user + Taipei date so the
 * same subset shows all day across reloads/devices, then reshuffles tomorrow.
 *
 * Server progress still advances for every daily quest — this only controls
 * which ones are displayed. The check-in is always shown (when active); the
 * picks are sorted claimable → in-progress → claimed for a useful order.
 *
 * Invariant: every **claimable** daily is always surfaced, even when it falls
 * outside the hash-picked subset. Otherwise the main-menu red dot (which counts
 * all claimable dailies) would stay lit forever for a reward the player can't
 * see to claim. The hash pick only fills the remaining slots from the rest.
 */
export function selectDailyBoard(tasks: readonly TaskView[], seed: string): TaskView[] {
  const dailies = tasks.filter((task) => task.quest.recurrence === "daily");
  const checkIn = dailies.filter((task) => task.quest.id === DAILY_CHECKIN_QUEST_ID);
  const others = dailies.filter((task) => task.quest.id !== DAILY_CHECKIN_QUEST_ID);

  // Always-visible: any claimable daily (so the red dot never outlives the board).
  const claimable = others.filter((task) => task.state === "claimable");
  // Fill the remaining slots from the non-claimable rest, stable-shuffled by seed.
  const fillCount = Math.max(0, DAILY_PICK_COUNT - claimable.length);
  const filler = others
    .filter((task) => task.state !== "claimable")
    .map((task) => ({ task, rank: stableHash(`${seed}:${task.quest.id}`) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, fillCount)
    .map((entry) => entry.task);

  const picks = [...claimable, ...filler].sort((a, b) => TASK_STATE_RANK[a.state] - TASK_STATE_RANK[b.state]);
  return [...checkIn, ...picks];
}
