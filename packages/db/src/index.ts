import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PublicGameState, Seat } from "@twcardgame/shared";

export interface DatabaseConfig {
  url: string;
  serviceRoleKey?: string;
  anonKey?: string;
}

export interface MatchHistoryRow {
  id: string;
  card_catalog_version: string;
  player1_user_id?: string | null;
  player2_user_id?: string | null;
  winner_seat?: Seat;
  result_reason: string;
  final_state: PublicGameState;
  created_at?: string;
  finished_at?: string;
}

export function createSupabaseServerClient(config: DatabaseConfig): SupabaseClient {
  const key = config.serviceRoleKey ?? config.anonKey;
  if (!key) throw new Error("Supabase key is required.");
  return createClient(config.url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function persistMatchHistory(client: SupabaseClient, row: MatchHistoryRow): Promise<void> {
  const { error } = await client.from("match_history").upsert(row);
  if (error) throw error;
}
