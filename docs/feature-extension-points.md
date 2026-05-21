# Feature Extension Points

Use these extension points when adding larger features after the modular refactor. The goal is to make new modes, cosmetics, shop items, collection flows, and battle UX predictable without leaking gameplay rules into adapters.

## Game Modes

- Define user-facing mode selection in `apps/web/src/app/types.ts` and render it from `apps/web/src/runtime.ts`.
- Add server room/admission behavior in `apps/server`, then route commands through `GameRoom.handleCommand -> reduce(...)`.
- Add rules support only in `packages/rules` when the mode changes gameplay setup, turn flow, legal moves, or win conditions.
- Cover mode setup with server tests and at least one e2e smoke path.

## Cosmetics

- Store cosmetic ownership and selection in `packages/db` migrations and account helpers.
- Render selected cosmetics from web profile/public player data.
- Keep cosmetics cosmetic: no card stats, combat behavior, matchmaking rules, or hidden gameplay state.

## Shop Items

- Define persisted item shape in `packages/db` migrations and shared rows.
- Keep purchase authorization and inventory grants server/database-side.
- Web shop screens may display price, contents, and purchase results, but they should not grant rewards locally.
- Add RLS or migration tests for new purchase behavior.

## Collection And Deck Flows

- Card definitions remain source-controlled in `packages/cards`.
- Deck legality stays in `packages/rules/deck.ts` and database save functions.
- Web collection screens may filter, sort, edit, and submit decks; they should not invent card copy limits or ownership rules outside existing helpers.
- Add smoke coverage for collection navigation, deck editing, and persistence-sensitive flows.

## Battle UX

- Battle UI reads synced public state, private hand messages, and rules events.
- New presentation features should prefer new `GameEvent` payloads over re-computing rules decisions in the browser.
- Input affordances may prepare a `TargetRef` or command envelope, then send it to the server.
- Add regression tests for effect combinations that can drift presentation or state, especially auras, temporary buffs, enrage, deathrattles, random effects, and turn lifecycle effects.

## Required Checks

Run the smallest relevant set for the changed feature:

```bash
npm run validate:cards
npm test
npm run check
```

For web/server feature work, also run:

```bash
npm run build
```
