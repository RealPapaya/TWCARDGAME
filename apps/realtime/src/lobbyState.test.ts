import { describe, expect, it } from "vitest";
import {
  claimPublicMatch,
  createPrivateChallenge,
  emptyLobbyState,
  joinPrivateByCode,
  releasePrivateRoom
} from "./lobbyState.js";

describe("lobby state", () => {
  it("creates and resolves private room join codes case-insensitively", () => {
    const state = emptyLobbyState();
    const record = createPrivateChallenge(state, 1000, () => "private:one", () => "ab2345");

    expect(record).toEqual({ room: "private:one", joinCode: "AB2345", createdAtMs: 1000 });
    expect(joinPrivateByCode(state, " ab2345 ")).toEqual(record);
  });

  it("releases private room codes", () => {
    const state = emptyLobbyState();
    createPrivateChallenge(state, 1000, () => "private:one", () => "ABC234");

    expect(releasePrivateRoom(state, "abc234")).toBe(true);
    expect(joinPrivateByCode(state, "ABC234")).toBeNull();
  });

  it("pairs two public matchmaking claims into one room", () => {
    const state = emptyLobbyState();
    const first = claimPublicMatch(state, 1000, () => "public:one");
    const second = claimPublicMatch(state, 1100, () => "public:two");
    const third = claimPublicMatch(state, 1200, () => "public:three");

    expect(first).toEqual({ room: "public:one", status: "waiting" });
    expect(second).toEqual({ room: "public:one", status: "matched" });
    expect(third).toEqual({ room: "public:three", status: "waiting" });
  });
});
