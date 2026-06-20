import type { FriendRequestRow } from "@twcardgame/shared";
import type { TaskView } from "./types.js";

export function hasMainMenuNotification(
  tasks: readonly TaskView[],
  friendRequests: readonly FriendRequestRow[]
): boolean {
  return tasks.some((task) => task.state === "claimable")
    || friendRequests.some((request) => request.direction === "incoming");
}
