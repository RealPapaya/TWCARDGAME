# Phase 4 Playwright Verification Guide

Use this guide when asking Claude or another browser agent to verify Phase 4 with Playwright.

## Preconditions

- Supabase migrations have been applied:
  - `packages/db/migrations/0001_v2_core.sql`
  - `packages/db/migrations/0002_phase4_account_deck_collection.sql`
- Card catalog has been published:
  - `npm run publish:catalog`
- Web env is configured in `apps/web/.env.local`:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Server is running with service-role env:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Local dev endpoints are available:
  - Web: `http://localhost:5173`
  - Server: `http://localhost:2567/health`

Do not paste service-role keys into browser code, Playwright logs, screenshots, or test output.

## Recommended Test Users

Use two disposable accounts that can be safely deleted in Supabase Auth after verification.

- `twcardgame-p1+<timestamp>@example.com`
- `twcardgame-p2+<timestamp>@example.com`

Use a temporary password such as `Test1234!phase4`.

If Supabase email confirmation is enabled, either confirm the users in Supabase Dashboard or temporarily disable email confirmation for local verification.

## Browser Verification Flow

### 1. Login And Collection Sync

For each test user:

1. Open `http://localhost:5173`.
2. Create account or sign in.
3. Verify account lobby appears.
4. Verify the top lobby text shows the current catalog version.
5. Verify owned card count becomes `104 owned cards`.
6. If owned card count is `0`, click `Sync Collection`, then verify it becomes `104 owned cards`.

Expected result:

- User reaches the lobby without console errors.
- Collection is populated for the current catalog.
- Deck editor is enabled.

### 2. Deck CRUD

For each test user:

1. Click `New Deck`.
2. Click `Autofill`.
3. Verify deck counter becomes `30/30`.
4. Click `Save Deck`.
5. Verify saved deck appears in the saved deck list.
6. Click `Edit` on the saved deck.
7. Remove one card with `-`.
8. Verify counter becomes `29/30` and `Save Deck` is disabled.
9. Add one card back with `+`.
10. Verify counter becomes `30/30`.
11. Save again.
12. Optionally create a second deck, delete it, and verify it disappears.

Expected result:

- Legal 30-card decks can be saved.
- Illegal 29-card deck cannot be saved.
- Saved decks stay visible after refresh.

### 3. PvP Join With Saved Decks

Use two browser contexts, one per account.

1. In browser context A, sign in as player 1.
2. In browser context B, sign in as player 2.
3. In both contexts, ensure a saved deck is selected.
4. Click `Join` in both contexts.
5. Verify both players enter the PvP room.
6. Complete mulligan on both sides.
7. Verify game reaches `in_progress`.
8. Play at least one card.
9. End turn.
10. Have one player concede.

Expected result:

- Both players can join with saved decks.
- Mulligan and gameplay still work.
- Match reaches `finished` after concede.

### 4. Match History

After the concede:

1. Return to lobby or refresh the page.
2. Verify match history contains a recent row.
3. Verify both participants can see the match row.

Expected result:

- Match history appears for player 1 and player 2.
- Result reason is visible, such as `concede`.

### 5. Server-Side Ownership Rejection

This is the security check.

1. Create a saved deck as player 1.
2. Capture player 1 deck id from Supabase Dashboard or browser state.
3. Sign in as player 2.
4. Attempt to join the PvP room while passing player 1's deck id.

Expected result:

- Server rejects the join.
- Player 2 cannot start a match with player 1's deck.

Claude may need to use `page.evaluate` to call Colyseus directly for this negative case if the normal UI does not expose arbitrary deck ids.

## Suggested Playwright Agent Prompt

Use this prompt for Claude:

```text
Verify TWCARDGAME Phase 4 using Playwright.

Use http://localhost:5173 as the web app and http://localhost:2567/health as the server health check.

Do not inspect or print secret env values. Create two disposable Supabase accounts, or use the provided test credentials if I give them separately.

Run these checks:
1. Sign in/create account for two users.
2. Confirm each reaches the account lobby.
3. Confirm each user has 104 owned cards after Sync Collection if needed.
4. For each user, create a legal deck using Autofill and Save Deck.
5. Confirm saved deck appears and survives refresh.
6. Confirm removing one card makes the deck 29/30 and Save Deck is disabled.
7. Join PvP from two browser contexts with saved decks.
8. Complete mulligan, play one card or pass turns as needed, then concede.
9. Return to lobby and verify match history appears for both users.
10. Try a negative ownership check by attempting to join as user 2 with user 1's deck id; confirm the server rejects it.

Report pass/fail for each step, include screenshots only of UI state, and redact emails/passwords/tokens.
```

## Debug Notes

- If the lobby never appears, check Supabase Auth email confirmation.
- If owned cards stays `0`, check that `card_catalog_snapshots` contains `v2-seed-from-v0.9.0`.
- If deck save fails, check `save_user_deck` RPC exists and grants execute to `authenticated`.
- If PvP join fails, restart the server with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- If normal dev e2e should be checked too, run:
  - `npm run test:e2e`
  - `npm run test:reconnect` with `RECONNECT_WINDOW_MS=5000`
