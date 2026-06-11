---
name: twcardgame-v2
description: Use when working on the TWCARDGAME v2 rewrite, including its Colyseus authoritative server, deterministic TypeScript rules engine, card catalog validation, Vite web client, or Supabase scaffolding.
---

# TWCARDGAME v2

## Use This Skill When

- Implementing or reviewing gameplay in `packages/rules` (engine, effects, deck, bot AI).
- Adding or changing cards/effect types in `packages/cards`.
- Touching Colyseus room logic in `apps/server` (PvP `GameRoom`, PvE `BotRoom`).
- Touching the Vite client in `apps/web`.

## First Move

Read `docs/製作.md` for the current project rules if the task is more than a tiny edit.

Also inspect the relevant package before editing:

- Cards: `packages/cards/src/types.ts`, `packages/cards/src/validation.ts`, `packages/cards/src/catalog.generated.ts`
- Rules: `packages/rules/src/engine.ts`, `packages/rules/src/state.ts`, `packages/rules/src/effects/registry.ts` (effect handlers grouped by domain under `effects/`), `packages/rules/src/legalMoves.ts`, `packages/rules/src/bot.ts` (AI decisions)
- Server: `apps/server/src/GameRoom.ts`, `apps/server/src/BotRoom.ts`, `apps/server/src/schema.ts`
- Web: `apps/web/src/runtime.ts` (`startApp`; `main.ts` is just the entry point) and the `apps/web/src/app/` modules

## Hard Rules

- Keep all code in `apps/`, `packages/`, and `docs/`.
- All gameplay mutations go through `GameRoom.handleCommand -> reduce(...) -> rules state/events -> Colyseus sync`.
- Do not put gameplay rules in `apps/web` or `apps/server`.
- Do not use DOM, Colyseus, Supabase, `Date.now()`, or `Math.random()` inside `packages/rules`.
- Preserve private information: public state shows counts only; hand/deck order stay private.
- For Colyseus Schema, use `defineTypes(...)` and keep `useDefineForClassFields: false`.
- New effect types need a domain handler under `packages/rules/src/effects/` registered in `effects/registry.ts`; an unregistered type throws at runtime.
- PvE AI decisions live in `packages/rules/src/bot.ts` and must stay deterministic (seeded `BotRngState`). `BotRoom` only paces and submits the bot's commands — keep decision logic out of it.

## Web Animation Lessons

- Attack/death animations need the old DOM. `publicSync` can arrive before paired `events`, so give events a short grace window to enqueue cues and then hold sync while `attackAnimationBusy()` is true.
- Keep attack timing constants and CSS keyframes in lockstep. If contact is 70% of `ATTACK_LUNGE_MS`, schedule damage numbers and attack SFX from that derived delay; delay `destroy` cues until the full lunge returns to origin.
- For lethal or mutual-destruction animation bugs, add scoped logs for cue enqueue, DOM lookup, lunge start/abort/success, and publicSync flush/apply before changing behavior.

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
