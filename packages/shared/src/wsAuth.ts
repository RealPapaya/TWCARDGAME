/**
 * WebSocket subprotocol encoding for connection auth. Bearer secrets — the
 * Supabase access token (JWT) and the reconnect token — travel in the
 * `Sec-WebSocket-Protocol` header rather than the URL query string, so they never
 * land in browser history, `Referer` headers, or edge access logs. The client
 * offers them via {@link buildWsProtocols}; the server reads them back with
 * {@link parseWsProtocols} and echoes {@link WS_BASE_PROTOCOL} to complete the
 * handshake. Subprotocol tokens permit only HTTP token characters — JWTs and
 * base64url reconnect tokens qualify (no spaces or commas).
 */
export const WS_BASE_PROTOCOL = "twcardgame.v1";
const JWT_PREFIX = "jwt.";
const RECONNECT_PREFIX = "rt.";

export interface WsConnectionAuth {
  accessToken?: string;
  reconnectToken?: string;
}

/** Build the client's offered subprotocol list (always includes the base protocol). */
export function buildWsProtocols(auth: WsConnectionAuth): string[] {
  const protocols = [WS_BASE_PROTOCOL];
  if (auth.accessToken) protocols.push(`${JWT_PREFIX}${auth.accessToken}`);
  if (auth.reconnectToken) protocols.push(`${RECONNECT_PREFIX}${auth.reconnectToken}`);
  return protocols;
}

/** Extract the auth secrets from a `Sec-WebSocket-Protocol` request header. */
export function parseWsProtocols(header: string | null | undefined): WsConnectionAuth {
  if (!header) return {};
  const auth: WsConnectionAuth = {};
  for (const entry of header.split(",")) {
    const proto = entry.trim();
    if (proto.startsWith(JWT_PREFIX)) auth.accessToken = proto.slice(JWT_PREFIX.length);
    else if (proto.startsWith(RECONNECT_PREFIX)) auth.reconnectToken = proto.slice(RECONNECT_PREFIX.length);
  }
  return auth;
}

/** The subprotocol the server echoes on the 101 response, when the client offered ours. */
export function negotiatedWsProtocol(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  return header.split(",").some((entry) => entry.trim() === WS_BASE_PROTOCOL) ? WS_BASE_PROTOCOL : undefined;
}
