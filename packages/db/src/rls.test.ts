import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const coreMigration = readFileSync(new URL("../migrations/0001_v2_core.sql", import.meta.url), "utf8");
const phase4Migration = readFileSync(new URL("../migrations/0002_phase4_account_deck_collection.sql", import.meta.url), "utf8");
const grantsMigration = readFileSync(new URL("../migrations/0003_phase4_browser_table_grants.sql", import.meta.url), "utf8");
const serviceRoleGrantsMigration = readFileSync(new URL("../migrations/0004_phase4_service_role_grants.sql", import.meta.url), "utf8");
const legacyShopMigration = readFileSync(new URL("../migrations/0006_legacy_shop_items.sql", import.meta.url), "utf8");
const userDataMigration = readFileSync(new URL("../migrations/0007_user_inventory_login_quests.sql", import.meta.url), "utf8");
const friendRequestsMigration = readFileSync(new URL("../migrations/0008_friend_requests.sql", import.meta.url), "utf8");
const starterCollectionSecurityMigration = readFileSync(
  new URL("../migrations/0013_starter_collection_security.sql", import.meta.url),
  "utf8"
);
const starterPackOwnedCollectionMigration = readFileSync(
  new URL("../migrations/0014_starter_pack_owned_collection.sql", import.meta.url),
  "utf8"
);
const playerIdStarterCollectionOnlyMigration = readFileSync(
  new URL("../migrations/0015_player_id_and_starter_collection_only.sql", import.meta.url),
  "utf8"
);
const cardIdOwnershipMigration = readFileSync(
  new URL("../migrations/0016_collection_card_id_ownership.sql", import.meta.url),
  "utf8"
);
const betaResetMigration = readFileSync(new URL("../migrations/0017_beta_reset_and_starter_cosmetics.sql", import.meta.url), "utf8");
const trainingCompletionsMigration = readFileSync(new URL("../migrations/0019_training_completions.sql", import.meta.url), "utf8");
const collisionTrainingMigration = readFileSync(new URL("../migrations/0020_training_collision_news.sql", import.meta.url), "utf8");

describe("Supabase RLS migration coverage", () => {
  const browserTables = ["profiles", "card_catalog_snapshots", "decks", "card_collections", "match_history"];
  const userDataTables = [
    "cosmetic_catalog",
    "user_cosmetics",
    "user_currency_ledger",
    "user_login_days",
    "user_events",
    "quest_definitions",
    "user_quest_progress"
  ];

  it("enables RLS on every browser-exposed table", () => {
    for (const table of browserTables) {
      expect(coreMigration).toContain(`alter table public.${table} enable row level security;`);
    }
  });

  it("keeps policies scoped to authenticated owners and match participants", () => {
    expect(coreMigration).toContain("auth.uid() = user_id");
    expect(coreMigration).toContain("auth.uid() = player1_user_id or auth.uid() = player2_user_id");
    expect(coreMigration).toContain("on public.card_catalog_snapshots for select");
  });

  it("exposes authenticated Phase 4 RPCs without anonymous write grants", () => {
    expect(phase4Migration + grantsMigration).toContain("grant execute on function public.save_user_deck(uuid, text, text, text[]) to authenticated;");
    expect(phase4Migration + grantsMigration).toContain("grant execute on function public.delete_user_deck(uuid) to authenticated;");
    expect(phase4Migration).not.toContain("to anon");
  });

  it("keeps full catalog seed restricted and exposes only starter bootstrap to authenticated users", () => {
    const starterMigrations = starterCollectionSecurityMigration + starterPackOwnedCollectionMigration + playerIdStarterCollectionOnlyMigration;
    expect(starterMigrations).toContain(
      "revoke execute on function public.ensure_full_seed_collection(text) from anon, authenticated;"
    );
    expect(starterMigrations).toContain(
      "grant execute on function public.ensure_full_seed_collection(text) to service_role;"
    );
    expect(starterMigrations).toContain(
      "grant execute on function public.ensure_starter_collection() to authenticated;"
    );
  });

  it("grants new players the starter pack collection instead of the full card catalog", () => {
    expect(playerIdStarterCollectionOnlyMigration).toContain("starter_pack_card_ids text[] := array[");
    expect(playerIdStarterCollectionOnlyMigration).toContain("'TW068'");
    expect(playerIdStarterCollectionOnlyMigration).toContain("'S026'");
    expect(playerIdStarterCollectionOnlyMigration).toContain("foreach cid in array starter_pack_card_ids loop");
    expect(playerIdStarterCollectionOnlyMigration).not.toContain("case when card->>'rarity' = 'LEGENDARY' then 1 else 2 end");
  });

  it("requires new players to set a display name and does not auto-create starter decks", () => {
    const latestNewUserMigration = playerIdStarterCollectionOnlyMigration + betaResetMigration;
    expect(playerIdStarterCollectionOnlyMigration).toContain("add column if not exists display_name_set boolean not null default true");
    expect(betaResetMigration).toContain("insert into public.profiles (user_id, display_name, display_name_set, avatar_url, owned_avatars, owned_titles, selected_title)");
    expect(betaResetMigration).toContain("'Player'");
    expect(betaResetMigration).toContain("false");
    expect(betaResetMigration).toContain("coalesce(new.raw_user_meta_data->>'avatar_url', '/images/avatars/avatar1.webp')");
    expect(betaResetMigration).toContain("array['avatar1']::text[]");
    expect(betaResetMigration).toContain("array['beginner']::text[]");
    expect(betaResetMigration).toContain("alter column selected_title set default 'beginner'");
    expect(betaResetMigration).toContain("(new.id, 'avatar', 'avatar1', 'starter_default')");
    expect(betaResetMigration).toContain("(new.id, 'title', 'beginner', 'starter_default')");
    expect(latestNewUserMigration).not.toContain("starter_deck_ids");
    expect(latestNewUserMigration).not.toContain("insert into public.decks");
    expect(latestNewUserMigration).not.toContain("Starter Deck");
  });

  it("keeps beta DB reset service-role only", () => {
    expect(betaResetMigration).toContain("create or replace function public.beta_reset_database()");
    expect(betaResetMigration).toContain("delete from auth.users");
    expect(betaResetMigration).toContain("truncate table");
    expect(betaResetMigration).toContain("revoke all on function public.beta_reset_database() from public;");
    expect(betaResetMigration).toContain("grant execute on function public.beta_reset_database() to service_role;");
    expect(betaResetMigration).not.toContain("grant execute on function public.beta_reset_database() to authenticated;");
    expect(betaResetMigration).not.toContain("grant execute on function public.beta_reset_database() to anon;");
  });

  it("grants browser table privileges required before RLS policies are evaluated", () => {
    expect(grantsMigration).toContain("grant select, insert, update on public.profiles to authenticated;");
    expect(grantsMigration).toContain("grant select on public.card_catalog_snapshots to anon, authenticated;");
    expect(grantsMigration).toContain("grant select on public.decks to authenticated;");
    expect(grantsMigration).toContain("grant select on public.card_collections to authenticated;");
    expect(grantsMigration).toContain("grant select on public.match_history to authenticated;");
  });

  it("grants service-role table privileges for server-side match authorization and persistence", () => {
    expect(serviceRoleGrantsMigration).toContain("grant usage on schema public to service_role;");
    expect(serviceRoleGrantsMigration).toContain("grant select, insert, update, delete on public.decks to service_role;");
    expect(serviceRoleGrantsMigration).toContain("grant select, insert, update, delete on public.card_collections to service_role;");
    expect(serviceRoleGrantsMigration).toContain("grant select, insert, update, delete on public.match_history to service_role;");
  });

  it("validates saved decks against catalog, copy limits, and owned collection quantity", () => {
    expect(phase4Migration).toContain("coalesce(array_length(p_card_ids, 1), 0) <> 30");
    expect(phase4Migration).toContain("catalog.card_id is null");
    expect(phase4Migration).toContain("catalog.collectible is false");
    expect(phase4Migration).toContain("case when catalog.rarity = 'LEGENDARY' then 1 else 2 end");
    expect(phase4Migration).toContain("deck.qty > coalesce(collection.quantity, 0)");
  });

  it("treats collection ownership as card-id based across catalog snapshots", () => {
    expect(cardIdOwnershipMigration).toContain("collection_totals as (");
    expect(cardIdOwnershipMigration).toContain("where user_id = current_user_id");
    expect(cardIdOwnershipMigration).toContain("group by card_id");
    expect(cardIdOwnershipMigration).toContain("left join collection_totals collection on collection.card_id = deck.card_id");
    expect(cardIdOwnershipMigration).not.toContain("collection.card_catalog_version = p_card_catalog_version");
  });

  it("keeps legacy shop purchases paid and seeded with v1 product ids", () => {
    expect(legacyShopMigration).toContain("add column if not exists gold integer not null default 100");
    expect(legacyShopMigration).toContain("add column if not exists price_gold integer not null default 0");
    expect(legacyShopMigration).toContain("if profile.gold < item.price_gold then");
    expect(legacyShopMigration).toContain("set gold = profile.gold - item.price_gold");
    expect(legacyShopMigration).toContain("'card-pack'");
    expect(legacyShopMigration).toContain("'cosmetic-pack'");
    expect(legacyShopMigration).toContain("'CARD_PACK'");
    expect(legacyShopMigration).toContain("'COSMETIC_PACK'");
  });

  it("adds user-data tables behind RLS for inventory, login, events, and quests", () => {
    for (const table of userDataTables) {
      expect(userDataMigration).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(userDataMigration).toContain("create table if not exists public.user_events");
    expect(userDataMigration).toContain("create table if not exists public.quest_definitions");
    expect(userDataMigration).toContain("create table if not exists public.user_quest_progress");
  });

  it("allows browser reads but keeps event and ledger writes behind RPCs", () => {
    expect(userDataMigration).toContain("grant select on public.user_currency_ledger to authenticated;");
    expect(userDataMigration).toContain("grant select on public.user_events to authenticated;");
    expect(userDataMigration).toContain("grant select on public.user_quest_progress to authenticated;");
    expect(userDataMigration).not.toContain("grant select, insert on public.user_events to authenticated");
    expect(userDataMigration).not.toContain("grant select, insert on public.user_currency_ledger to authenticated");
    expect(userDataMigration).not.toContain("grant insert on public.user_events to authenticated");
    expect(userDataMigration).not.toContain("grant insert on public.user_currency_ledger to authenticated");
  });

  it("exposes only safe authenticated user-data RPCs to the browser", () => {
    expect(userDataMigration).toContain("grant execute on function public.record_daily_login() to authenticated;");
    expect(userDataMigration).toContain("grant execute on function public.select_user_cosmetic(text, text) to authenticated;");
    expect(userDataMigration).toContain("revoke all on function public.emit_user_event(uuid, text, text, text, jsonb) from public;");
    expect(userDataMigration).toContain("revoke all on function public.adjust_user_currency(uuid, text, integer, text, text, text, jsonb) from public;");
    expect(userDataMigration).toContain("revoke all on function public.grant_user_cosmetic(uuid, text, text, text, text, jsonb) from public;");
  });

  it("records Taipei daily login events idempotently and prepares quest progress", () => {
    expect(userDataMigration).toContain("now() at time zone 'Asia/Taipei'");
    expect(userDataMigration).toContain("create or replace function public.record_daily_login()");
    expect(userDataMigration).toContain("on conflict do nothing");
    expect(userDataMigration).toContain("'daily_login'");
    expect(userDataMigration).toContain("insert into public.user_quest_progress");
  });

  it("routes shop, deck, and PvP mutations into the user event window", () => {
    expect(userDataMigration).toContain("create or replace function public.purchase_shop_item(p_item_id text)");
    expect(userDataMigration).toContain("'card_acquired'");
    expect(userDataMigration).toContain("'cosmetic_acquired'");
    expect(userDataMigration).toContain("'shop_purchase'");
    expect(userDataMigration).toContain("create or replace function public.save_user_deck(");
    expect(userDataMigration).toContain("'deck_saved'");
    expect(userDataMigration).toContain("create or replace function public.record_pvp_win(p_match_id text)");
    expect(userDataMigration).toContain("'match_finished'");
    expect(userDataMigration).toContain("'pvp_win'");
  });

  it("keeps friend requests pending until the receiver accepts", () => {
    expect(friendRequestsMigration).toContain("create table if not exists public.friend_requests");
    expect(friendRequestsMigration).toContain("status = 'pending'");
    expect(friendRequestsMigration).toContain("create or replace function public.accept_friend_request(p_request_id uuid)");
    expect(friendRequestsMigration).toContain("insert into public.friends (user_id, friend_user_id)");
    expect(friendRequestsMigration).toContain("grant select on public.friend_requests to authenticated;");
    expect(friendRequestsMigration).not.toContain("grant select, insert on public.friend_requests to authenticated;");
    expect(friendRequestsMigration).toContain("grant execute on function public.list_friend_requests() to authenticated;");
  });

  it("claims scripted training rewards through an idempotent authenticated RPC", () => {
    expect(trainingCompletionsMigration).toContain("create table if not exists public.user_training_completions");
    expect(trainingCompletionsMigration).toContain("alter table public.user_training_completions enable row level security;");
    expect(trainingCompletionsMigration).toContain("auth.uid() = user_id");
    expect(trainingCompletionsMigration).toContain("on conflict (user_id, level_id) do nothing");
    expect(trainingCompletionsMigration).toContain("set gold = gold + v_reward_gold");
    expect(trainingCompletionsMigration).toContain("grant execute on function public.complete_training_level(text) to authenticated;");
    expect(trainingCompletionsMigration).not.toContain("grant execute on function public.complete_training_level(text) to anon;");
    expect(trainingCompletionsMigration).not.toContain("grant insert on public.user_training_completions to authenticated;");
    expect(collisionTrainingMigration).toContain("when 'social_rookie' then v_reward_gold := 100;");
    expect(collisionTrainingMigration).toContain("when 'collision_news' then v_reward_gold := 100;");
    expect(collisionTrainingMigration).toContain("Unknown training level");
    expect(collisionTrainingMigration).toContain("grant execute on function public.complete_training_level(text) to authenticated;");
  });
});
