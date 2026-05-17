---
name: twcardgame-v2
description: Use when working on the TWCARDGAME v2 rewrite, including its Colyseus authoritative server, deterministic TypeScript rules engine, card catalog validation, Vite web client, Supabase scaffolding, or migration from the LEGACY v1 app.
---

# TWCARDGAME v2

## Use This Skill When

- Implementing or reviewing gameplay in `packages/rules`.
- Adding or changing cards/effect types in `packages/cards`.
- Touching Colyseus room logic in `apps/server`.
- Touching the Vite client in `apps/web`.
- Migrating behavior or assets from `LEGACY/`.

## First Move

Read `docs/製作.md` for the current project rules if the task is more than a tiny edit.

Also inspect the relevant package before editing:

- Cards: `packages/cards/src/types.ts`, `packages/cards/src/validation.ts`, `packages/cards/src/catalog.generated.ts`
- Rules: `packages/rules/src/engine.ts`, `packages/rules/src/effects.ts`, `packages/rules/src/state.ts`
- Server: `apps/server/src/GameRoom.ts`, `apps/server/src/schema.ts`
- Web: `apps/web/src/main.ts`

## Hard Rules

- Keep v2 code in `apps/`, `packages/`, and `docs/`; keep v1 material in `LEGACY/`.
- All gameplay mutations go through `GameRoom.handleCommand -> reduce(...) -> rules state/events -> Colyseus sync`.
- Do not put gameplay rules in `apps/web` or `apps/server`.
- Do not use DOM, Colyseus, Supabase, `Date.now()`, or `Math.random()` inside `packages/rules`.
- Preserve private information: public state shows counts only; hand/deck order stay private.
- For Colyseus Schema, use `defineTypes(...)` and keep `useDefineForClassFields: false`.

## Validation

After meaningful changes, run the smallest relevant set:

```bash
npm run validate:cards
npm test
npm run check
```

For server/web changes, also run:

```bash
npm run build
```

For card or rules changes, add or update tests before calling the work done.
