import type { FriendRequestRow } from "@twcardgame/shared";
import type { TaskView } from "./types.js";

export function hasFriendNotification(friendRequests: readonly FriendRequestRow[]): boolean {
  return friendRequests.some((request) => request.direction === "incoming");
}

export function hasTaskNotification(tasks: readonly TaskView[]): boolean {
  return tasks.some((task) => task.quest.recurrence !== "once" && task.state === "claimable");
}

export function hasAchievementNotification(tasks: readonly TaskView[]): boolean {
  return tasks.some((task) => task.quest.recurrence === "once" && task.state === "claimable");
}
