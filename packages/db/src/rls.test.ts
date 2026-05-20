import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const coreMigration = readFileSync(new URL("../migrations/0001_v2_core.sql", import.meta.url), "utf8");
const phase4Migration = readFileSync(new URL("../migrations/0002_phase4_account_deck_collection.sql", import.meta.url), "utf8");
const grantsMigration = readFileSync(new URL("../migrations/0003_phase4_browser_table_grants.sql", import.meta.url), "utf8");
const serviceRoleGrantsMigration = readFileSync(new URL("../migrations/0004_phase4_service_role_grants.sql", import.meta.url), "utf8");
const legacyShopMigration = readFileSync(new URL("../migrations/0006_legacy_shop_items.sql", import.meta.url), "utf8");

describe("Supabase RLS migration coverage", () => {
  const browserTables = ["profiles", "card_catalog_snapshots", "decks", "card_collections", "match_history"];

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
    expect(phase4Migration + grantsMigration).toContain("grant execute on function public.ensure_full_seed_collection(text) to authenticated;");
    expect(phase4Migration + grantsMigration).toContain("grant execute on function public.save_user_deck(uuid, text, text, text[]) to authenticated;");
    expect(phase4Migration + grantsMigration).toContain("grant execute on function public.delete_user_deck(uuid) to authenticated;");
    expect(phase4Migration).not.toContain("to anon");
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
});
