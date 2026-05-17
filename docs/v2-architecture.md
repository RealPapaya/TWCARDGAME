# TWCARDGAME v2 Architecture

This folder is a parallel rewrite scaffold. The existing v1 static app remains intact.

## Commands

- `npm install`
- `npm run validate:cards`
- `npm test`
- `npm run check`
- `npm run build`
- `npm run start -w @twcardgame/server`
- `npm run dev -w @twcardgame/web`

## Boundaries

- `packages/cards`: source-controlled card catalog, schemas, validation.
- `packages/rules`: deterministic gameplay engine. No DOM, Colyseus, Supabase, timers, or `Math.random()`.
- `apps/server`: Colyseus room adapter. Clients send commands; server applies `reduce(...)`.
- `apps/web`: small Vite client that renders synced public state and receives private hand state via direct messages.
- `packages/db`: Supabase client helpers and initial RLS migration.

## Current Milestone

The implemented milestone is PvP core scaffolding:

- strict 30-card public PvP deck validation
- seeded shuffling and random effect resolution
- mulligan and turn start
- authoritative play, attack, end turn, concede commands
- card catalog validation for all current cards
- handlers registered for all current battlecry effect types
- private hand messages separate from public state
- Fly.io server scaffold
