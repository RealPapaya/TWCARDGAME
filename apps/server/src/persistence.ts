import { createSupabaseServerClient, persistMatchHistory, recordPvpWin, type MatchHistoryRow } from "@twcardgame/db";
import { toPublicState, type MatchState } from "@twcardgame/rules";
import type { AiDifficulty } from "@twcardgame/shared";
import { logger } from "./logger.js";

export interface MatchPersistenceMetadata {
  isVsAi?: boolean;
  aiDifficulty?: AiDifficulty;
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
    finished_at: finishedAt.toISOString()
  };
}

function uuidOrNull(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
