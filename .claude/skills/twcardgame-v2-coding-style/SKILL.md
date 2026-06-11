---
name: twcardgame-v2-coding-style
description: Use when writing, reviewing, or refactoring TWCARDGAME v2 code and you need the project coding style, modular architecture rules, deterministic rules-engine conventions, card-effect extension pattern, or validation expectations.
---

# TWCARDGAME v2 Coding Style

## Core Philosophy

Write small, boring, deterministic modules. The game is a multiplayer card game, so correctness and replayability matter more than cleverness.

Prefer:

- explicit data flow over hidden mutation
- package boundaries over convenience imports
- pure rules over UI/server shortcuts
- typed card/effect contracts over stringly ad hoc checks
- focused tests over broad manual clicking

## Module Boundaries

Keep these responsibilities separate:

- `packages/rules`: authoritative gameplay only, including the PvE bot's decision logic (`bot.ts`, `legalMoves.ts`). Pure TypeScript. No DOM, Colyseus, Supabase, timers, network, `Math.random()`, or `Date.now()`.
- `packages/cards`: card catalog, card schemas, supported effect-type lists, catalog validation.
- `packages/shared`: DTOs and cross-package contracts only. Avoid business logic here.
- `apps/server`: Colyseus adapter — `GameRoom` (PvP) and `BotRoom` (PvE). Seat assignment, room lifecycle, command routing, public sync, private hand messages, account/persistence wiring, bot pacing.
- `apps/web`: rendering and input only, organized as a thin entry (`main.ts` → `runtime.ts`) plus focused `app/` modules (DOM rendering/patching, animations, audio, viewport, storage). It sends commands and renders server state; it does not apply authoritative game state changes.
- `packages/db`: persistence adapters and migrations only.

All gameplay mutation must flow through:

```txt
client command -> GameRoom.handleCommand -> reduce(...) -> MatchState + GameEvents -> sync schema/private messages
```

## Coding Style

- Use TypeScript strict types; prefer named interfaces/types for cross-module contracts.
- Keep functions short enough to test directly. Split only around real responsibility boundaries.
- Use early returns for invalid command paths.
- Avoid speculative abstraction. Add helpers when two or more call sites share real behavior.
- Keep server/web code thin. If a change decides game outcome, mana, damage, draw, target legality, or card movement, it belongs in `packages/rules`.
- Keep comments sparse and useful. Comment invariants or non-obvious sequencing, not obvious assignments.
- Preserve ESM imports with `.js` suffix for local TypeScript imports that compile to NodeNext output.
- Do not add package dependencies unless they solve a concrete repo problem.

## Rules Engine Patterns

Rules engine code should be deterministic and replayable:

- Take time from input/envelope `nowMs`; never call `Date.now()` in `packages/rules`.
- Use `nextInt`, `nextRandom`, or `shuffleInPlace` from `packages/rules/src/rng.ts`; never call `Math.random()`.
- Return events for animation/replay, but treat `MatchState` as truth.
- Resolve deaths, auras, triggers, and win conditions in rules code, not the client.
- Keep private state in `MatchState.private`; never expose hand contents or deck order through public state.
- Keep PvE AI logic in `bot.ts`/`legalMoves.ts` deterministic — drive it from a seeded `BotRngState`, never `Math.random()`. `BotRoom` only paces and submits the resulting commands.

When adding a command:

1. Add or update shared command types in `packages/shared`.
2. Route it in `packages/rules/src/engine.ts`.
3. Keep validation near command handling.
4. Emit `GameEvent`s for UI animation.
5. Add tests for valid path, invalid path, and deterministic replay if random/time is involved.

## Card And Effect Style

Cards are data, effects are code.

When adding a new effect type:

1. Add the effect type to `packages/cards/src/types.ts`.
2. Validate it in `packages/cards/src/validation.ts` if needed.
3. Implement the handler in the matching domain file under `packages/rules/src/effects/` (`core.ts`, `damage-heal.ts`, `hand.ts`, `summon-destroy-bounce.ts`, `buff-keyword-lock.ts`, `channel.ts`, `environment.ts`, `voteEvents.ts`) and register it in `effects/registry.ts` so `resolveEffect` can dispatch it. An unregistered type throws `Unhandled effect type`.
4. Add catalog/rules tests.
5. Run `npm run validate:cards`, `npm test`, and `npm run check`.

Do not special-case cards by name unless the card's intended behavior truly requires it. Prefer effect data that can be reused by future cards.

## Server Style

Colyseus room code should be an adapter:

- Receive command messages.
- Build `CommandEnvelope`.
- Call `reduce(...)`.
- Sync public schema from `toPublicState(...)`.
- Send private hand via `toHandView(...)`.

For Colyseus Schema:

- Use `defineTypes(...)`.
- Keep `useDefineForClassFields: false` in `tsconfig.base.json`.
- Use explicit fields for stable shapes when maps cause schema metadata friction.

## Web Style

The web client is not authoritative:

- Do not reduce state locally.
- Do not infer hidden opponent data.
- Do not mutate synced state objects as gameplay.
- Keep selected UI state local and disposable.
- Send command payloads that match `packages/shared` types.

## Validation Cadence

After meaningful changes:

```bash
npm run validate:cards
npm test
npm run check
```

After server/web/build tooling changes:

```bash
npm run build
```

For rules/card changes, add tests before calling the task complete.
