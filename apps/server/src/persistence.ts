import { createSupabaseServerClient, persistMatchHistory, type MatchHistoryRow } from "@twcardgame/db";
import { toPublicState, type MatchState } from "@twcardgame/rules";

export interface MatchResultPersistence {
  enabled: boolean;
  persist(state: MatchState): Promise<void>;
}

export interface MatchResultLogger {
  warn(message?: unknown, ...optionalParams: unknown[]): void;
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
    persist: (state) => persistMatchHistory(client, buildMatchHistoryRow(state))
  };
}

export const noopMatchResultPersistence: MatchResultPersistence = {
  enabled: false,
  persist: async () => undefined
};

export async function safePersistMatchResult(
  persistence: MatchResultPersistence,
  state: MatchState,
  logger: MatchResultLogger = console
): Promise<void> {
  if (!persistence.enabled) return;
  try {
    await persistence.persist(state);
  } catch (error) {
    logger.warn("[match-history] Failed to persist match result.", error);
  }
}

export function buildMatchHistoryRow(state: MatchState, finishedAt = new Date()): MatchHistoryRow {
  return {
    id: state.matchId,
    card_catalog_version: state.cardCatalogVersion,
    player1_user_id: uuidOrNull(state.players.player1.userId),
    player2_user_id: uuidOrNull(state.players.player2.userId),
    winner_seat: state.result?.winnerSeat,
    result_reason: state.result?.reason ?? "abandoned",
    final_state: toPublicState(state),
    finished_at: finishedAt.toISOString()
  };
}

function uuidOrNull(value: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
