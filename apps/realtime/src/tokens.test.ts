import { describe, expect, it } from "vitest";
import {
  decodeReconnectToken,
  encodeReconnectToken,
  importReconnectKey,
  RECONNECT_TOKEN_TTL_MS,
  signReconnectToken,
  verifyReconnectToken,
  type ReconnectTokenPayload
} from "./tokens.js";

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

describe("signed reconnect tokens", () => {
  const NOW = 1_000_000;
  const payload: ReconnectTokenPayload = {
    v: 1,
    mode: "pvp",
    room: "private:room-1",
    sessionId: "sid-1",
    issuedAtMs: NOW
  };

  it("verifies a freshly signed token", async () => {
    const key = await importReconnectKey("secret-a");
    const token = await signReconnectToken(payload, key);
    expect(token).toContain("."); // <body>.<sig>
    expect(await verifyReconnectToken(token, key, NOW)).toEqual(payload);
  });

  it("rejects a tampered payload", async () => {
    const key = await importReconnectKey("secret-a");
    const token = await signReconnectToken(payload, key);
    const tampered = await signReconnectToken({ ...payload, sessionId: "attacker" }, key);
    const forged = `${tampered.split(".")[0]}.${token.split(".")[1]}`; // attacker body + valid-looking sig
    expect(await verifyReconnectToken(forged, key, NOW)).toBeNull();
  });

  it("rejects a token signed with a different key", async () => {
    const token = await signReconnectToken(payload, await importReconnectKey("secret-a"));
    expect(await verifyReconnectToken(token, await importReconnectKey("secret-b"), NOW)).toBeNull();
  });

  it("rejects an unsigned token when a key is configured", async () => {
    const key = await importReconnectKey("secret-a");
    const unsigned = await signReconnectToken(payload, null);
    expect(await verifyReconnectToken(unsigned, key, NOW)).toBeNull();
  });

  it("rejects expired and future-dated tokens", async () => {
    const key = await importReconnectKey("secret-a");
    const token = await signReconnectToken(payload, key);
    expect(await verifyReconnectToken(token, key, NOW + RECONNECT_TOKEN_TTL_MS + 1)).toBeNull(); // expired
    expect(await verifyReconnectToken(token, key, NOW - 5 * 60_000)).toBeNull(); // far future-dated
    expect(await verifyReconnectToken(token, key, NOW + RECONNECT_TOKEN_TTL_MS - 1)).toEqual(payload); // still fresh
  });

  it("stays usable without a key (dev/PoC) but still enforces expiry", async () => {
    const unsigned = await signReconnectToken(payload, null);
    expect(await verifyReconnectToken(unsigned, null, NOW)).toEqual(payload);
    expect(await verifyReconnectToken(unsigned, null, NOW + RECONNECT_TOKEN_TTL_MS + 1)).toBeNull();
  });
});
