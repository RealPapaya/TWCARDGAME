import { describe, expect, it } from "vitest";
import type { FriendRequestRow } from "@twcardgame/shared";
import {
  hasAchievementNotification,
  hasFriendNotification,
  hasTaskNotification
} from "./main-menu-notification.js";
import type { TaskRecurrence, TaskView } from "./types.js";

function task(recurrence: TaskRecurrence, state: TaskView["state"]): TaskView {
  return {
    quest: {
      id: `${recurrence}-${state}`,
      display_name: "Test",
      event_type: "test",
      target_count: 1,
      recurrence,
      active: true
    },
    state,
    current: state === "in-progress" ? 0 : 1,
    target: 1
  };
}

function friendRequest(direction: FriendRequestRow["direction"]): FriendRequestRow {
  return {
    request_id: direction,
    other_user_id: `user-${direction}`,
    display_name: "Test",
    wins_count: 0,
    direction
  };
}

describe("main menu notification helpers", () => {
  it.each(["daily", "weekly"] as const)(
    "shows task notification for a claimable %s quest",
    (recurrence) => {
      expect(hasTaskNotification([task(recurrence, "claimable")])).toBe(true);
    }
  );

  it("shows achievement notification for a claimable once quest", () => {
    expect(hasAchievementNotification([task("once", "claimable")])).toBe(true);
  });

  it("shows for an incoming friend request", () => {
    expect(hasFriendNotification([friendRequest("incoming")])).toBe(true);
  });

  it("ignores claimed or unfinished tasks and achievements", () => {
    const tasks = [
      task("once", "claimed"),
      task("daily", "in-progress")
    ];

    expect(hasTaskNotification(tasks)).toBe(false);
    expect(hasAchievementNotification(tasks)).toBe(false);
  });

  it("ignores outgoing friend requests", () => {
    expect(hasFriendNotification([friendRequest("outgoing")])).toBe(false);
  });
});
