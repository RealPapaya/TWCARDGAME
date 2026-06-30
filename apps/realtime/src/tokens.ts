export type RealtimeMode = "pvp" | "pve";

export interface ReconnectTokenPayload {
  v: 1;
  mode: RealtimeMode;
  room: string;
  sessionId: string;
  issuedAtMs: number;
}

/**
 * Reconnect tokens are bearer capabilities (they grant a player their seat back),
 * so they are HMAC-signed and time-bounded. A signed token is `<payload>.<sig>`
 * where both halves are base64url. The signing key comes from the Worker env
 * (`RECONNECT_TOKEN_SECRET`, falling back to `SUPABASE_SERVICE_ROLE_KEY` so a
 * production deployment signs automatically). With no secret configured (pure
 * dev/PoC, never publicly reachable) tokens stay unsigned but are still validated
 * for shape + expiry. {@link verifyReconnectToken} rejects tampered, unsigned
 * (when a key is configured), future-dated, or expired tokens.
 */

/** Tokens older than this are rejected — comfortably longer than any single match. */
export const RECONNECT_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
/** Clock-skew tolerance for the future-dated guard. */
const CLOCK_SKEW_MS = 60_000;

/** Encode just the payload body (base64url JSON). Exposed for the unsigned path/tests. */
export function encodeReconnectToken(payload: ReconnectTokenPayload): string {
  return base64UrlEncode(JSON.stringify(payload));
}

/** Decode + shape-validate a payload body, ignoring any `.<sig>` suffix. No expiry/signature check. */
export function decodeReconnectToken(token: string): ReconnectTokenPayload | null {
  const dot = token.indexOf(".");
  const body = dot === -1 ? token : token.slice(0, dot);
  try {
    const parsed = JSON.parse(base64UrlDecode(body)) as Partial<ReconnectTokenPayload>;
    if (
      parsed.v !== 1 ||
      (parsed.mode !== "pvp" && parsed.mode !== "pve") ||
      typeof parsed.room !== "string" ||
      parsed.room.length === 0 ||
      typeof parsed.sessionId !== "string" ||
      parsed.sessionId.length === 0 ||
      typeof parsed.issuedAtMs !== "number"
    ) {
      return null;
    }
    return parsed as ReconnectTokenPayload;
  } catch {
    return null;
  }
}

/** Import a raw secret as an HMAC-SHA256 key. */
export async function importReconnectKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify"
  ]);
}

// Import is expensive; cache one promise per distinct secret for the isolate's lifetime.
const keyCache = new Map<string, Promise<CryptoKey>>();

/** Resolve the HMAC key for a secret (cached), or null when no secret is configured. */
export async function reconnectKeyFor(secret: string | undefined | null): Promise<CryptoKey | null> {
  if (!secret) return null;
  let pending = keyCache.get(secret);
  if (!pending) {
    pending = importReconnectKey(secret);
    keyCache.set(secret, pending);
  }
  return pending;
}

/** Sign a payload. With no key returns the unsigned body (dev/PoC); otherwise `<body>.<sig>`. */
export async function signReconnectToken(payload: ReconnectTokenPayload, key: CryptoKey | null): Promise<string> {
  const body = encodeReconnectToken(payload);
  if (!key) return body;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

/**
 * Verify a token: shape, signature (required when `key` is set), and freshness
 * (`issuedAtMs` within `[now - ttl, now + skew]`). Returns the payload or null.
 */
export async function verifyReconnectToken(
  token: string,
  key: CryptoKey | null,
  nowMs: number,
  ttlMs: number = RECONNECT_TOKEN_TTL_MS
): Promise<ReconnectTokenPayload | null> {
  const dot = token.indexOf(".");
  const body = dot === -1 ? token : token.slice(0, dot);
  const payload = decodeReconnectToken(body);
  if (!payload) return null;

  if (key) {
    if (dot === -1) return null; // a signature is mandatory once a key is configured
    let signature: Uint8Array;
    try {
      signature = base64UrlDecodeBytes(token.slice(dot + 1));
    } catch {
      return null;
    }
    const valid = await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(body));
    if (!valid) return null;
  }

  if (payload.issuedAtMs > nowMs + CLOCK_SKEW_MS) return null; // future-dated
  if (nowMs - payload.issuedAtMs > ttlMs) return null; // expired
  return payload;
}

function base64UrlEncode(text: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(text));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(encoded: string): string {
  return new TextDecoder().decode(base64UrlDecodeBytes(encoded));
}

function base64UrlDecodeBytes(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
