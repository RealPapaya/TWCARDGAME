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

export interface AuthenticatedUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}

export interface PlayerProfileRow {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CardCatalogSnapshotRow {
  version: string;
  cards: unknown;
  created_at?: string;
}

export interface DeckRow {
  id: string;
  user_id: string;
  name: string;
  card_catalog_version: string;
  card_ids: string[];
  created_at?: string;
  updated_at?: string;
}

export interface SaveDeckInput {
  id?: string;
  userId: string;
  name: string;
  cardCatalogVersion: string;
  cardIds: readonly string[];
}

export interface CardCollectionRow {
  user_id: string;
  card_catalog_version: string;
  card_id: string;
  quantity: number;
  acquired_at?: string;
}

export interface CollectionGrant {
  cardId: string;
  quantity: number;
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

export async function getAuthenticatedUser(client: SupabaseClient, accessToken: string): Promise<AuthenticatedUser> {
  if (!accessToken) throw new Error("Supabase access token is required.");
  const { data, error } = await client.auth.getUser(accessToken);
  if (error) throw error;
  if (!data.user) throw new Error("Supabase access token did not resolve to a user.");
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    user_metadata: data.user.user_metadata ?? {}
  };
}

export async function upsertPlayerProfile(client: SupabaseClient, row: PlayerProfileRow): Promise<PlayerProfileRow> {
  const { data, error } = await client
    .from("profiles")
    .upsert({
      user_id: row.user_id,
      display_name: row.display_name,
      avatar_url: row.avatar_url ?? null
    })
    .select("user_id,display_name,avatar_url,created_at,updated_at")
    .single();
  if (error) throw error;
  return data as PlayerProfileRow;
}

export async function publishCardCatalogSnapshot(
  client: SupabaseClient,
  snapshot: { version: string; cards: unknown }
): Promise<void> {
  const { error } = await client.from("card_catalog_snapshots").upsert({
    version: snapshot.version,
    cards: snapshot.cards
  });
  if (error) throw error;
}

export async function listUserDecks(client: SupabaseClient, userId: string): Promise<DeckRow[]> {
  const { data, error } = await client
    .from("decks")
    .select("id,user_id,name,card_catalog_version,card_ids,created_at,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DeckRow[];
}

export async function getOwnedDeck(
  client: SupabaseClient,
  input: { userId: string; deckId: string }
): Promise<DeckRow> {
  const { data, error } = await client
    .from("decks")
    .select("id,user_id,name,card_catalog_version,card_ids,created_at,updated_at")
    .eq("id", input.deckId)
    .eq("user_id", input.userId)
    .single();
  if (error) throw error;
  const deck = data as DeckRow;
  assertDeckOwnership(deck, input.userId);
  return deck;
}

export async function saveUserDeck(client: SupabaseClient, input: SaveDeckInput): Promise<DeckRow> {
  const payload = {
    user_id: input.userId,
    name: input.name,
    card_catalog_version: input.cardCatalogVersion,
    card_ids: [...input.cardIds]
  };

  const query = input.id
    ? client
        .from("decks")
        .update(payload)
        .eq("id", input.id)
        .eq("user_id", input.userId)
        .select("id,user_id,name,card_catalog_version,card_ids,created_at,updated_at")
        .single()
    : client
        .from("decks")
        .insert(payload)
        .select("id,user_id,name,card_catalog_version,card_ids,created_at,updated_at")
        .single();

  const { data, error } = await query;
  if (error) throw error;
  return data as DeckRow;
}

export async function deleteUserDeck(client: SupabaseClient, input: { userId: string; deckId: string }): Promise<void> {
  const { error } = await client.from("decks").delete().eq("id", input.deckId).eq("user_id", input.userId);
  if (error) throw error;
}

export async function listUserCollection(
  client: SupabaseClient,
  input: { userId: string; cardCatalogVersion: string }
): Promise<CardCollectionRow[]> {
  const { data, error } = await client
    .from("card_collections")
    .select("user_id,card_catalog_version,card_id,quantity,acquired_at")
    .eq("user_id", input.userId)
    .eq("card_catalog_version", input.cardCatalogVersion)
    .order("card_id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CardCollectionRow[];
}

export async function replaceUserCollection(
  client: SupabaseClient,
  input: { userId: string; cardCatalogVersion: string; grants: readonly CollectionGrant[] }
): Promise<void> {
  const rows = input.grants.map((grant) => ({
    user_id: input.userId,
    card_catalog_version: input.cardCatalogVersion,
    card_id: grant.cardId,
    quantity: grant.quantity
  }));

  const { error: deleteError } = await client
    .from("card_collections")
    .delete()
    .eq("user_id", input.userId)
    .eq("card_catalog_version", input.cardCatalogVersion);
  if (deleteError) throw deleteError;
  if (rows.length === 0) return;

  const { error } = await client.from("card_collections").upsert(rows);
  if (error) throw error;
}

export function assertDeckOwnership(deck: Pick<DeckRow, "id" | "user_id"> | null | undefined, userId: string): void {
  if (!deck) throw new Error("Deck not found.");
  if (deck.user_id !== userId) throw new Error(`Deck ${deck.id} does not belong to user ${userId}.`);
}
