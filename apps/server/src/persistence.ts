import { createSupabaseServerClient, persistMatchHistory, recordPvpWin, type MatchHistoryRow } from "@twcardgame/db";
import { toPublicState, type MatchState } from "@twcardgame/rules";
import type { AiDifficulty, AiTheme } from "@twcardgame/shared";
import { logger } from "./logger.js";

export interface MatchPersistenceMetadata {
  isVsAi?: boolean;
  aiDifficulty?: AiDifficulty;
  aiTheme?: AiTheme;
  /**
   * Wall-clock time (ms) the match started, recorded server-side by the room.
   * Stored as match_history.created_at so the client can show real match
   * duration (finished_at − created_at). Absent for legacy rows.
   */
  startedAtMs?: number;
}

export interface MatchResultPersistence {
  enabled: boolean;
  persist(state: MatchState, metadata?: MatchPersistenceMetadata): Promise<void>;
}

export interface MatchResultLogger {
  warn(event: string, fields?: Record<string, unknown>): void;
}

export function createMatchResultPersistenceFromEnv(
  env: NodeJS.ProcessEnv = process.env
): MatchResultPersistence {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return noopMatchResultPersistence;

  const client = createSupabaseServerClient({ url, serviceRoleKey });
  return {
    enabled: true,
    persist: async (state, metadata) => {
      await persistMatchHistory(client, buildMatchHistoryRow(state, new Date(), metadata));
      if (!metadata?.isVsAi && state.result?.winnerSeat) {
        await recordPvpWin(client, state.matchId);
      }
    }
  };
}

export const noopMatchResultPersistence: MatchResultPersistence = {
  enabled: false,
  persist: async () => undefined
};

export async function safePersistMatchResult(
  persistence: MatchResultPersistence,
  state: MatchState,
  matchLogger: MatchResultLogger = logger,
  metadata?: MatchPersistenceMetadata
): Promise<void> {
  if (!persistence.enabled) return;
  try {
    await persistence.persist(state, metadata);
  } catch (error) {
    matchLogger.warn("match.persist.failed", { matchId: state.matchId, error });
  }
}

export function buildMatchHistoryRow(
  state: MatchState,
  finishedAt = new Date(),
  metadata?: MatchPersistenceMetadata
): MatchHistoryRow {
  return {
    id: state.matchId,
    card_catalog_version: state.cardCatalogVersion,
    player1_user_id: uuidOrNull(state.players.player1.userId),
    player2_user_id: uuidOrNull(state.players.player2.userId),
    winner_seat: state.result?.winnerSeat,
    result_reason: state.result?.reason ?? "abandoned",
    final_state: toPublicState(state),
    is_vs_ai: metadata?.isVsAi ?? false,
    ai_difficulty: metadata?.aiDifficulty ?? null,
    ai_theme: metadata?.aiTheme ?? null,
    // Match start time so the client can derive duration. When absent the column
    // falls back to its DB default (now()), matching legacy insert-time behaviour.
    created_at: metadata?.startedAtMs ? new Date(metadata.startedAtMs).toISOString() : undefined,
    finished_at: finishedAt.toISOString()
  };
}

function uuidOrNull(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
