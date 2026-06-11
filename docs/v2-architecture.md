# TWCARDGAME v2 Architecture

This folder documents the v2 architecture.

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

For card additions and new mechanics, follow [Card Authoring Workflow](./card-authoring-workflow.md).
For web ownership boundaries, follow [Web Module Ownership](./web-module-ownership.md).
For larger feature additions, follow [Feature Extension Points](./feature-extension-points.md).

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
