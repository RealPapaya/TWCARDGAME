# Phase 4 Account, Deck & Collection

Phase 4 adds the account and saved-deck layer around the existing authoritative PvP room.

## Implemented

- Supabase password auth and Google OAuth are wired in the web client when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present.
- The browser lobby loads the signed-in profile, starter collection, saved decks, selected deck, and recent match history through Supabase RLS.
- New accounts can claim the full current collectible catalog through `ensure_full_seed_collection`.
- Deck saves and deletes use authenticated Supabase RPCs. Saves validate 30 cards, catalog version, collectible cards, copy limits, and owned quantities.
- PvP production joins send `{ accessToken, deckId, displayName }`; the Colyseus server revalidates auth, deck ownership, current catalog version, legality, and collection quantities.
- Match history continues to be persisted on game end and is readable only by match participants.

## Environment

- Web: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional `VITE_COLYSEUS_URL`.
- Server and catalog publishing: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Verify List

- `npm run validate:cards`
- `npm test`
- `npm run check`
- `npm run build`
- `npm run test:rls`
- `npm run publish:catalog` with Supabase service env configured
- Manual browser checks:
  - Create an account with email/password.
  - Sign out and sign back in.
  - Sign in with Google OAuth.
  - Confirm profile exists after first login.
  - Confirm collection is populated with current collectible catalog cards.
  - Create, edit, and delete a legal saved deck.
  - Attempt to save an illegal deck and confirm it is rejected.
  - Join PvP with a saved deck from two accounts.
  - Attempt to join with another user's deck id and confirm the server rejects it.
  - Finish a match and confirm both players can see the match history row.
  - Confirm unrelated users cannot read another user's decks, collection, profile, or match history.
