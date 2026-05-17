import type { GameEvent, MatchResult, Seat } from "@twcardgame/shared";
import type { MatchState } from "@twcardgame/rules";
import { safePersistMatchResult, type MatchResultLogger, type MatchResultPersistence } from "./persistence.js";

export class MatchResultFinalizer {
  private persistedMatchIds = new Set<string>();

  constructor(
    private readonly persistence: MatchResultPersistence,
    private readonly logger: MatchResultLogger = console
  ) {}

  finish(match: MatchState, result: MatchResult, seat?: Seat): GameEvent[] {
    if (isMatchComplete(match)) return [];

    match.status = result.reason === "abandoned" ? "abandoned" : "finished";
    match.result = result;

    const event: GameEvent = {
      seq: match.private.nextEventSeq++,
      type: "GAME_FINISHED",
      seat,
      payload: { ...result }
    };
    match.private.eventLog.push(event);
    return [event];
  }

  async persistOnce(match: MatchState): Promise<void> {
    if (!isMatchComplete(match) || this.persistedMatchIds.has(match.matchId)) return;
    this.persistedMatchIds.add(match.matchId);
    await safePersistMatchResult(this.persistence, match, this.logger);
  }
}

export function isMatchComplete(match: MatchState): boolean {
  return match.status === "finished" || match.status === "abandoned";
}
