# Phase 5 Social, Shop & AI

Phase 5 layers four cross-cutting lobby features on top of the Phase 4 account / deck / collection stack:

1. **Friend system** — list, add by display name, remove, and challenge to a private match via shareable join code.
2. **Leaderboard** — top players ranked by lifetime PvP wins (denormalized `profiles.wins_count`).
3. **Shop** — free-everything stub. Items are listed in `shop_items`; "buying" calls a SECURITY DEFINER RPC that grants the listed cards to the user's `card_collections`. There is no currency, price check, or payment integration.
4. **Computer (AI) fight** — server-side `BotRoom` (Colyseus room type `pve`) that occupies one seat with a heuristic bot. Three difficulties (`easy` / `normal` / `hard`).

## Implemented

- Migration `packages/db/migrations/0005_phase5_social_shop_ai.sql`:
  - `profiles.wins_count` and `match_history.is_vs_ai` / `ai_difficulty` columns.
  - `friends` table (mutual rows + RLS).
  - `shop_items` table (read-only RLS for `authenticated`, seeded with two starter packs).
  - RPCs: `send_friend_request`, `remove_friend`, `list_friends`, `purchase_shop_item`, `get_leaderboard`, `record_pvp_win`.
- `packages/rules`:
  - `legalMoves(state, seat)` enumerates legal `GameCommand`s for a seat.
  - `decide(state, seat, difficulty, rng, catalog, nowMs)` heuristic bot. Pure; reuses `rules.reduce` for one-ply simulation on `hard`.
- `apps/server`:
  - `GameRoom` accepts `{ joinCode }` / `{ private: true }` on create, registers an in-memory code, sends `joinCode` to clients, and releases the code on dispose. Public matchmaking still works because the `pvp` room type is registered with `filterBy(["joinCode"])`.
  - `privateRooms.ts` is the in-memory code → roomId registry (also exposes a code-generator that excludes ambiguous characters).
  - `BotRoom` subclasses `GameRoom`; `maxClients = 1`, fabricates a bot `PlayerSetup` (re-uses the human's deck), drives turns via `legalMoves` + `decide`, and persists matches with `is_vs_ai = true` so leaderboard counts are unaffected.
  - `persistence.ts` threads `MatchPersistenceMetadata` through `MatchResultFinalizer`, writing `is_vs_ai` / `ai_difficulty` to `match_history` and calling `record_pvp_win` for human PvP winners.
  - `index.ts` registers `pve` and adds a `GET /private-rooms/:code` lookup endpoint for clients that prefer HTTP resolution.
- `apps/web`:
  - New menu screens: friends, leaderboard, shop, AI (`MenuScreen` extended).
  - Battle screen gains "create private room" and "join by code" affordances.
  - All Supabase calls use the existing browser client (anon key + session).

## Environment

No new environment variables. Existing Phase 4 variables suffice:

- Web: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional `VITE_COLYSEUS_URL`.
- Server & catalog publishing: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Optional `BOT_THINK_DELAY_MS` (default `600`) tunes the bot's per-action pacing.

## Free-shop stub explicit caveat

`shop_items.purchase_shop_item` has **no price check, no currency table, no transaction log**. Every listed item is claimable an unlimited number of times. This is intentional for Phase 5 so the inventory grant path is exercised end-to-end; a future phase can introduce currency, daily caps, or one-time SKUs without changing the `shop_items` schema.

## Verify list

- `npm run validate:cards`
- `npm test`
- `npm run check`
- `npm run build`
- `npm run test:rls` (covers the new RLS policies once migrated)
- Apply `packages/db/migrations/0005_phase5_social_shop_ai.sql` against the dev Supabase project.

Manual browser checks (two accounts unless noted):

- **Friend list**: account A sends a request to B's display name; both see each other in the friend list; either side removes the friend and the row disappears for both.
- **Friend challenge**: A clicks "建立房間並取得代碼" (in the Battle screen or after pressing "挑戰" on a friend); a 6-character code is shown; B pastes it into "加入房間" and both lands in the same `GameRoom`.
- **Leaderboard**: finish a PvP match; the winner's row in the leaderboard increments by 1 within one refresh; vs-AI wins do **not** affect the count.
- **Shop**: claim a starter pack; the listed cards appear in the collection; the pack remains claimable (free stub).
- **AI fight (single account)**: pick a deck, choose difficulty, start a match; the bot submits its mulligan, plays cards on its turns, and eventually ends the game; the match appears in match history with `is_vs_ai = true`; the player's `wins_count` is unaffected.
