export type RealtimeMode = "pvp" | "pve";

export interface ReconnectTokenPayload {
  v: 1;
  mode: RealtimeMode;
  room: string;
  sessionId: string;
  issuedAtMs: number;
}

export function encodeReconnectToken(payload: ReconnectTokenPayload): string {
  return base64UrlEncode(JSON.stringify(payload));
}

export function decodeReconnectToken(token: string): ReconnectTokenPayload | null {
  try {
    const parsed = JSON.parse(base64UrlDecode(token)) as Partial<ReconnectTokenPayload>;
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

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
