# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This is the TWCARDGAME **v2** rewrite — a TypeScript npm-workspaces monorepo (ESM, `NodeNext`, strict). The original static v1 app is preserved verbatim under `LEGACY/` and is **not** part of the build. Keep v2 work in `apps/`, `packages/`, and `docs/`.

Workspaces (TS project references are wired in [tsconfig.json](tsconfig.json)):

- [apps/server](apps/server/) — `@twcardgame/server`, Colyseus authoritative PvP room (Railway deployable, see [railway.json](railway.json) / [Dockerfile](apps/server/Dockerfile)).
- [apps/web](apps/web/) — `@twcardgame/web`, Vite vanilla-TS client using `@colyseus/sdk`.
- [packages/cards](packages/cards/) — source-controlled card catalog, Zod schemas, validation, CLI.
- [packages/rules](packages/rules/) — deterministic gameplay engine (pure, no I/O).
- [packages/shared](packages/shared/) — command / state-view / event contracts shared by client + server + rules.
- [packages/db](packages/db/) — Supabase client + RLS migrations.
- [packages/test-utils](packages/test-utils/) — shared test fixtures.

## Commands

Run from repo root unless noted:

```bash
npm install
npm run validate:cards     # tsx packages/cards/src/cli.ts — runs validateCatalog over CARD_CATALOG
npm test                   # vitest run, picks up packages/**/*.test.ts and apps/**/*.test.ts
npm run test:watch
npm run check              # tsc -b across all project references (no emit-style check, no pretty)
npm run build              # tsc -b, then `npm run build -w @twcardgame/web` (vite bundle)
npm run dev:server         # tsx watch apps/server/src/index.ts
npm run dev:web            # vite --host 0.0.0.0
```

Run a single test file: `npx vitest run packages/rules/src/rules.test.ts` (or `-t "<name pattern>"` for a single test).

Vitest is configured with `resolve.conditions: ["source"]` — workspace packages' `exports."."."source"` (their `src/index.ts`) is consumed directly, so tests do not require a prior `tsc -b`. Production consumers go through `dist/` instead.

## Architecture invariants

These rules are load-bearing for the v2 design — violating them breaks determinism, replay, or the trust boundary between client and server.

**Command flow.** All gameplay mutations go through one path:

```
client → Colyseus message "command" → GameRoom.handleCommand → rules.reduce(state, command) → MatchState + GameEvents → syncPublicState() / private hand messages
```

The client never mutates state; it sends `CommandEnvelope`s and renders synced state. Gameplay logic must not live in `apps/server` or `apps/web`.

**Determinism in `packages/rules`.** The rules package must be pure and reproducible:

- No DOM, no Colyseus, no Supabase, no network, no timers.
- No `Math.random()` — use the seeded RNG in [packages/rules/src/rng.ts](packages/rules/src/rng.ts) (`nextInt`, `shuffleInPlace`, seed from the match seed).
- No `Date.now()` — time-dependent fields (e.g. `startedAtMs`, reconnect deadlines) come from `input.nowMs` / command envelopes provided by the server.

**Private vs public state.** Public synced state (Colyseus schema in [apps/server/src/schema.ts](apps/server/src/schema.ts), built from `toPublicState`) exposes counts only — never hand contents or deck order. Each player's own hand is delivered via the `hand` direct message built from `toHandView`. Do not leak private fields into the schema.

**Colyseus Schema gotcha.** Use `defineTypes(...)` instead of decorator field syntax, and keep `useDefineForClassFields: false` in [tsconfig.base.json](tsconfig.base.json) — `@colyseus/schema` v4 relies on this to track field metadata.

**Deck rules.** PvP decks are strict 30-card public decks validated by `validateDeck` in [packages/rules/src/deck.ts](packages/rules/src/deck.ts) against the card catalog. The catalog is the single source of truth: cards live in [packages/cards/src/catalog.generated.ts](packages/cards/src/catalog.generated.ts), shapes in [types.ts](packages/cards/src/types.ts)/[schema.ts](packages/cards/src/schema.ts), version exported as `CARD_CATALOG_VERSION` and embedded in `MatchState.cardCatalogVersion`.

**Adding card effects.** New battlecry / effect types need both (a) a schema entry in `packages/cards` so `validate:cards` accepts them, and (b) a handler in [packages/rules/src/effects.ts](packages/rules/src/effects.ts) reachable from `resolveEffect`. If either side is missing, validation or runtime fails closed.

## Workflow expectations

The repo's own skills document the project workflow and coding style:

- General project workflow: [.claude/skills/twcardgame-v2/SKILL.md](.claude/skills/twcardgame-v2/SKILL.md)
- Coding style and module boundaries: [.claude/skills/twcardgame-v2-coding-style/SKILL.md](.claude/skills/twcardgame-v2-coding-style/SKILL.md)

Validation cadence:

- After meaningful changes: `npm run validate:cards && npm test && npm run check`.
- After server/web changes: also `npm run build`.
- Card or rules changes: update or add tests before declaring done — rules behavior is exercised in [packages/rules/src/rules.test.ts](packages/rules/src/rules.test.ts) and the catalog in [packages/cards/src/catalog.test.ts](packages/cards/src/catalog.test.ts).

The Chinese build guide is [docs/製作.md](docs/製作.md), and the architecture overview is [docs/v2-architecture.md](docs/v2-architecture.md).
