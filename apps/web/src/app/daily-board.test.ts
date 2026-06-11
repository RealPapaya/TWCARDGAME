import { describe, expect, it } from "vitest";
import { DAILY_CHECKIN_QUEST_ID, DAILY_PICK_COUNT, selectDailyBoard } from "./daily-board.js";
import type { TaskView } from "./types.js";

function task(id: string, recurrence: "daily" | "once", state: TaskView["state"] = "in-progress"): TaskView {
  return {
    quest: {
      id,
      display_name: id,
      description: "",
      event_type: "match_played",
      target_count: 1,
      recurrence,
      reward: { gold: 10 },
      active: true
    },
    state,
    current: 0,
    target: 1
  };
}

const DAILIES = [
  task(DAILY_CHECKIN_QUEST_ID, "daily"),
  task("daily_play_1", "daily"),
  task("daily_play_3", "daily"),
  task("daily_win_1", "daily"),
  task("daily_cards", "daily"),
  task("daily_summon", "daily"),
  task("daily_damage", "daily")
];

describe("selectDailyBoard", () => {
  it("returns the check-in plus exactly DAILY_PICK_COUNT other dailies", () => {
    const board = selectDailyBoard(DAILIES, "user-1:2026-06-11");
    expect(board).toHaveLength(1 + DAILY_PICK_COUNT);
    expect(board[0].quest.id).toBe(DAILY_CHECKIN_QUEST_ID);
    expect(board.slice(1).every((t) => t.quest.id !== DAILY_CHECKIN_QUEST_ID)).toBe(true);
  });

  it("excludes achievements (once quests) entirely", () => {
    const mixed = [...DAILIES, task("ach_x", "once"), task("ach_y", "once")];
    const board = selectDailyBoard(mixed, "user-1:2026-06-11");
    expect(board.every((t) => t.quest.recurrence === "daily")).toBe(true);
  });

  it("is stable for the same seed and reshuffles for a new one", () => {
    const a = selectDailyBoard(DAILIES, "user-1:2026-06-11").map((t) => t.quest.id);
    const b = selectDailyBoard(DAILIES, "user-1:2026-06-11").map((t) => t.quest.id);
    expect(a).toEqual(b);

    // A different day yields a different pick for at least one user/day pair.
    const days = ["2026-06-12", "2026-06-13", "2026-06-14", "2026-06-15"].map(
      (d) => selectDailyBoard(DAILIES, `user-1:${d}`).map((t) => t.quest.id).join(",")
    );
    expect(new Set([a.join(","), ...days]).size).toBeGreaterThan(1);
  });

  it("orders the picks claimable → in-progress → claimed", () => {
    const dailies = [
      task(DAILY_CHECKIN_QUEST_ID, "daily"),
      task("d_claimed", "daily", "claimed"),
      task("d_claimable", "daily", "claimable")
    ];
    const board = selectDailyBoard(dailies, "seed");
    expect(board[0].quest.id).toBe(DAILY_CHECKIN_QUEST_ID);
    expect(board[1].state).toBe("claimable");
    expect(board[2].state).toBe("claimed");
  });

  it("omits the check-in row when no check-in quest is active", () => {
    const board = selectDailyBoard(DAILIES.slice(1), "seed");
    expect(board.every((t) => t.quest.id !== DAILY_CHECKIN_QUEST_ID)).toBe(true);
    expect(board).toHaveLength(DAILY_PICK_COUNT);
  });
});
