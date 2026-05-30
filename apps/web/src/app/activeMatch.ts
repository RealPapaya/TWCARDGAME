/**
 * Persists a pointer to the in-progress match so the player can be offered a
 * reconnect after an accidental tab close or F5 refresh. Stored in localStorage
 * (not sessionStorage) so it survives a full tab/window close, not just reload.
 *
 * `savedAtMs` is refreshed by a heartbeat while the match is live so that, after
 * a hard refresh, it approximates the moment of disconnect — letting startup
 * decide whether the server room is still likely alive.
 */
const STORAGE_KEY = "twcg.activeMatch";

/** Resume window: the server reconnect budget (30s) plus a generous buffer. */
export const ACTIVE_MATCH_RESUME_GRACE_MS = 45_000;

export interface ActiveMatchRecord {
  token: string;
  serverUrl: string;
  matchId: string;
  mode: "pvp" | "pve";
  savedAtMs: number;
}

export function rememberActiveMatch(record: Omit<ActiveMatchRecord, "savedAtMs">): void {
  try {
    const full: ActiveMatchRecord = { ...record, savedAtMs: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
  } catch {
    // localStorage may be unavailable (private mode / quota) — degrade silently.
  }
}

export function readActiveMatch(): ActiveMatchRecord | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<ActiveMatchRecord>;
    if (
      typeof parsed?.token !== "string" ||
      typeof parsed.serverUrl !== "string" ||
      typeof parsed.matchId !== "string" ||
      (parsed.mode !== "pvp" && parsed.mode !== "pve") ||
      typeof parsed.savedAtMs !== "number"
    ) {
      return undefined;
    }
    return parsed as ActiveMatchRecord;
  } catch {
    return undefined;
  }
}

/** Bumps savedAtMs on the stored record without changing anything else. */
export function touchActiveMatch(): void {
  const existing = readActiveMatch();
  if (!existing) return;
  rememberActiveMatch(existing);
}

export function clearActiveMatch(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** True when the stored record is recent enough that the server room may still exist. */
export function isActiveMatchFresh(record: ActiveMatchRecord, nowMs: number = Date.now()): boolean {
  return nowMs - record.savedAtMs <= ACTIVE_MATCH_RESUME_GRACE_MS;
}
