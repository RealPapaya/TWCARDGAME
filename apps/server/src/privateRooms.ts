/**
 * In-memory registry of private-room join codes. Codes are 6 characters drawn
 * from an unambiguous alphabet (no 0/O/1/I/L). Rooms register their generated
 * (or supplied) code on create and release it on dispose.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

const codeToRoomId = new Map<string, string>();
const roomIdToCode = new Map<string, string>();

export function generateUniqueJoinCode(maxAttempts = 10): string {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = randomCode();
    if (!codeToRoomId.has(code)) return code;
  }
  // Fallback: append a timestamp suffix so the code stays unique even on collision.
  return randomCode() + Date.now().toString(36).slice(-2).toUpperCase();
}

export function registerJoinCode(code: string, roomId: string): void {
  codeToRoomId.set(code, roomId);
  roomIdToCode.set(roomId, code);
}

export function releaseJoinCodeForRoom(roomId: string): void {
  const code = roomIdToCode.get(roomId);
  if (!code) return;
  roomIdToCode.delete(roomId);
  if (codeToRoomId.get(code) === roomId) codeToRoomId.delete(code);
}

export function lookupRoomIdByJoinCode(code: string): string | undefined {
  return codeToRoomId.get(code.toUpperCase());
}

export function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase();
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}
