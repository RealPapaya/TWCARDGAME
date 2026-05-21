# Web Module Ownership

The web client is an adapter around server/rules state. It may render, send commands, animate events, and call account services, but gameplay outcomes stay in `packages/rules`.

## Bootstrap

- `apps/web/src/main.ts`: installs global browser concerns and starts the app.
- `apps/web/src/runtime.ts`: owns app startup, Colyseus room binding, render scheduling, event binding, and screen composition while the web extraction continues.
- `apps/web/src/app/config.ts`: owns browser-facing environment configuration.
- `apps/web/src/app/context.ts`: exposes the narrow shared app context for helpers that need current view state, render scheduling, Supabase, card catalog, or seat order.

## State And Types

- `apps/web/src/app/types.ts`: owns shared web view types such as `ClientViewState`, account rows, collection/deck rows, shop purchase results, and card view models.
- `ClientViewState` remains client UI state only. It should not become a copy of the rules state machine.
- Public match state comes from Colyseus schema sync. Private hand data comes from direct room messages.

## Services

- Supabase calls live in web runtime/service helpers and mutate only account UI state: profile, decks, collection, match history, friends, leaderboard, and shop data.
- Colyseus calls send `GameCommand` messages or bind room messages. They do not compute gameplay results.
- New services should expose narrow functions that accept typed inputs and update `ClientViewState` through the app context or an explicit caller-owned render callback.

## Screens

- Main menu, battle selection, AI setup, profile, collection/deck editor, friends, leaderboard, and shop are screen renderers over `ClientViewState`.
- Screen handlers may validate UI preconditions, such as selected deck or signed-in state.
- Screen handlers must not apply damage, draw cards, summon minions, decide deaths, or enforce combat rules.

## Battle Helpers

- Battle rendering reads public player state, private hand view, selected UI targets, and queued events.
- Battle commands must go through `sendCommand(...)` into the active room.
- Animations and hover previews may infer presentation details from `GameEvent` and catalog data, but they must not mutate gameplay state.

## Shared UI Helpers

- `apps/web/src/ui.ts`: owns pure presentation helpers for escaping, class composition, card asset URLs, and card fan layout.
- `apps/web/src/drag.ts`: owns pointer and drag affordances. It may choose command targets but does not resolve command effects.
- `apps/web/src/app/render-snapshot.ts`, `dom.ts`, `storage.ts`, `audio.ts`, and `viewport.ts` own browser utility concerns and should stay free of gameplay logic.

## Guardrails

- Add new gameplay mechanics under `packages/cards` validation and `packages/rules` handlers first.
- Add new UI flows as adapters over existing commands, messages, and account service calls.
- If a web helper starts needing rules-like decisions, move that decision into `packages/rules` and expose the result through public state or events.
