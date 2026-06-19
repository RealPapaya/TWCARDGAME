export interface PrivateRoomRecord {
  room: string;
  joinCode: string;
  createdAtMs: number;
}

export interface PublicQueueRecord {
  room: string;
  createdAtMs: number;
}

export interface LobbyStorageState {
  privateCodes: Record<string, PrivateRoomRecord>;
  roomToCode: Record<string, string>;
  publicQueue?: PublicQueueRecord;
}

export interface PublicMatchResult {
  room: string;
  status: "waiting" | "matched";
}

export const PUBLIC_QUEUE_TTL_MS = 120_000;

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export function emptyLobbyState(): LobbyStorageState {
  return { privateCodes: {}, roomToCode: {} };
}

export function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase();
}

export function randomJoinCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export function createPrivateChallenge(
  state: LobbyStorageState,
  nowMs: number,
  roomFactory: () => string,
  codeFactory: () => string = randomJoinCode
): PrivateRoomRecord {
  let joinCode = normalizeJoinCode(codeFactory());
  for (let attempt = 0; state.privateCodes[joinCode] && attempt < 10; attempt++) {
    joinCode = normalizeJoinCode(codeFactory());
  }
  if (state.privateCodes[joinCode]) {
    joinCode = `${joinCode}${nowMs.toString(36).slice(-2).toUpperCase()}`;
  }

  const record: PrivateRoomRecord = { room: roomFactory(), joinCode, createdAtMs: nowMs };
  state.privateCodes[joinCode] = record;
  state.roomToCode[record.room] = joinCode;
  return record;
}

export function joinPrivateByCode(state: LobbyStorageState, rawCode: string): PrivateRoomRecord | null {
  return state.privateCodes[normalizeJoinCode(rawCode)] ?? null;
}

export function releasePrivateRoom(state: LobbyStorageState, rawCode: string): boolean {
  const joinCode = normalizeJoinCode(rawCode);
  const record = state.privateCodes[joinCode];
  if (!record) return false;
  delete state.privateCodes[joinCode];
  if (state.roomToCode[record.room] === joinCode) delete state.roomToCode[record.room];
  return true;
}

export function claimPublicMatch(
  state: LobbyStorageState,
  nowMs: number,
  roomFactory: () => string
): PublicMatchResult {
  if (state.publicQueue && nowMs - state.publicQueue.createdAtMs <= PUBLIC_QUEUE_TTL_MS) {
    const room = state.publicQueue.room;
    delete state.publicQueue;
    return { room, status: "matched" };
  }

  const room = roomFactory();
  state.publicQueue = { room, createdAtMs: nowMs };
  return { room, status: "waiting" };
}
