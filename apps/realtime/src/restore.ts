import type { AiDifficulty, AiTheme } from "@twcardgame/shared";
import { GameSession, type GameSessionSnapshot, type SessionHost } from "./GameSession.js";
import { BotGameSession } from "./BotGameSession.js";

/**
 * Rebuild the correct session subclass from a persisted snapshot. Lives in its
 * own module so neither GameSession nor BotGameSession has to import the other
 * (no import cycle). The Durable Object calls this when it wakes from
 * hibernation.
 */
export function restoreSession(host: SessionHost, snapshot: GameSessionSnapshot): GameSession {
  if (snapshot.kind === "pve") {
    const extra = snapshot.extra ?? {};
    const session = new BotGameSession(host, {
      matchId: snapshot.matchId,
      joinCode: snapshot.joinCode,
      reconnectWindowMs: snapshot.reconnectWindowMs,
      mulliganTimeLimitMs: snapshot.mulliganTimeLimitMs,
      turnTimeLimitMs: snapshot.turnTimeLimitMs,
      difficulty: extra.difficulty as AiDifficulty | undefined,
      challenge: extra.challenge === true,
      theme: (extra.theme as AiTheme | null | undefined) ?? undefined
    });
    session.applySnapshot(snapshot);
    return session;
  }
  return GameSession.fromSnapshot(host, snapshot);
}
