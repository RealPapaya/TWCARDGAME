import { describe, expect, it } from "vitest";
import type { FriendRequestRow } from "@twcardgame/shared";
import { hasMainMenuNotification } from "./main-menu-notification.js";
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

describe("hasMainMenuNotification", () => {
  it.each(["once", "daily", "weekly"] as const)(
    "shows for a claimable %s quest",
    (recurrence) => {
      expect(hasMainMenuNotification([task(recurrence, "claimable")], [])).toBe(true);
    }
  );

  it("shows for an incoming friend request", () => {
    expect(hasMainMenuNotification([], [friendRequest("incoming")])).toBe(true);
  });

  it("ignores claimed or unfinished quests and outgoing requests", () => {
    expect(hasMainMenuNotification([
      task("once", "claimed"),
      task("daily", "in-progress")
    ], [friendRequest("outgoing")])).toBe(false);
  });
});
