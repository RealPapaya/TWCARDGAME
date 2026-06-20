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
- `apps/realtime` (**live backend**): Cloudflare Workers + Durable Objects adapter — `GameSession` (PvP) / `BotGameSession` (PvE) orchestration on a `GameDurableObject`, plus `LobbyDurableObject` (matchmaking/private rooms/reconnect), `accounts.ts` (deck resolution), `matchServices.ts` (finalize/rewards). Seat assignment, command routing, public sync, private hand messages, deadlines via DO Alarms, bot pacing — **no gameplay logic**.
- `apps/server` (**legacy, pending decommission**): the old Colyseus adapter — `GameRoom` (PvP) and `BotRoom` (PvE). Same adapter responsibilities, now superseded by `apps/realtime`. Don't add features here.
- `apps/web`: rendering and input only, organized as a thin entry (`main.ts` → `runtime.ts`) plus focused `app/` modules (native-WebSocket transport adapter, DOM rendering/patching, animations, audio, viewport, storage). It sends commands and renders server state; it does not apply authoritative game state changes.
- `packages/db`: persistence adapters and migrations only.

All gameplay mutation must flow through:

```txt
client command -> GameSession.applyClientCommand -> reduce(...) -> MatchState + GameEvents -> public snapshot (toPublicState) + private hand (toHandView)
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
- Keep PvE AI logic in `bot.ts`/`legalMoves.ts` deterministic — drive it from a seeded `BotRngState`, never `Math.random()`. `BotGameSession` (live) / `BotRoom` (legacy) only paces and submits the resulting commands.

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

Backend code (live `apps/realtime`, legacy `apps/server`) is an adapter — keep gameplay out of it:

- Receive command messages.
- Build `CommandEnvelope`.
- Call `reduce(...)`.
- Broadcast the public snapshot from `toPublicState(...)` (in `apps/realtime`, as JSON `state`/`publicSync`; legacy Colyseus synced a Schema delta).
- Send private hand via `toHandView(...)`.
- Schedule deadlines with DO Alarms in `apps/realtime` (never wall-clock timers in rules); keep the `GameSession` orchestration transport-agnostic and unit-testable.

For the **legacy Colyseus Schema** in `apps/server` only:

- Use `defineTypes(...)`.
- Keep `useDefineForClassFields: false` in `tsconfig.base.json` (still set repo-wide while `apps/server` exists).
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
