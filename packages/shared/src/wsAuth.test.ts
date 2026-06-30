import { describe, expect, it } from "vitest";
import { buildWsProtocols, negotiatedWsProtocol, parseWsProtocols, WS_BASE_PROTOCOL } from "./wsAuth.js";

describe("ws subprotocol auth", () => {
  it("round-trips access + reconnect tokens through the protocol header", () => {
    const protocols = buildWsProtocols({ accessToken: "jwt-value.abc", reconnectToken: "rt-body.sig" });
    expect(protocols[0]).toBe(WS_BASE_PROTOCOL);
    const header = protocols.join(", "); // how browsers serialise Sec-WebSocket-Protocol
    expect(parseWsProtocols(header)).toEqual({ accessToken: "jwt-value.abc", reconnectToken: "rt-body.sig" });
  });

  it("omits absent secrets but always offers the base protocol", () => {
    expect(buildWsProtocols({})).toEqual([WS_BASE_PROTOCOL]);
    expect(buildWsProtocols({ reconnectToken: "rt" })).toEqual([WS_BASE_PROTOCOL, "rt.rt"]);
  });

  it("returns nothing for an empty/missing header", () => {
    expect(parseWsProtocols(null)).toEqual({});
    expect(parseWsProtocols("")).toEqual({});
    expect(negotiatedWsProtocol(null)).toBeUndefined();
  });

  it("echoes the base protocol only when the client offered it", () => {
    expect(negotiatedWsProtocol(`${WS_BASE_PROTOCOL}, jwt.x`)).toBe(WS_BASE_PROTOCOL);
    expect(negotiatedWsProtocol("something-else")).toBeUndefined();
  });
});
