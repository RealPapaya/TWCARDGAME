import { describe, expect, it } from "vitest";
import { decodeReconnectToken, encodeReconnectToken } from "./tokens.js";

describe("reconnect tokens", () => {
  it("round-trips the room and session identity", () => {
    const token = encodeReconnectToken({
      v: 1,
      mode: "pvp",
      room: "private:room-1",
      sessionId: "sid-1",
      issuedAtMs: 1234
    });

    expect(decodeReconnectToken(token)).toEqual({
      v: 1,
      mode: "pvp",
      room: "private:room-1",
      sessionId: "sid-1",
      issuedAtMs: 1234
    });
  });

  it("rejects malformed tokens", () => {
    expect(decodeReconnectToken("not-json")).toBeNull();
    expect(decodeReconnectToken(encodeReconnectToken({ v: 1, mode: "pve", room: "r", sessionId: "s", issuedAtMs: 1 }).slice(2))).toBeNull();
  });
});
