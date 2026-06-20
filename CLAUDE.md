# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This is the TWCARDGAME **v2** rewrite — a TypeScript npm-workspaces monorepo (ESM, `NodeNext`, strict). All work lives in `apps/`, `packages/`, and `docs/`.

Workspaces (TS project references are wired in [tsconfig.json](tsconfig.json)):

- [apps/realtime](apps/realtime/) — `@twcardgame/realtime`, **the live backend**: Cloudflare Workers + Durable Objects, which replaced Colyseus (Plan B). One match == one [GameDurableObject](apps/realtime/src/GameDurableObject.ts) (Hibernation WebSockets + a single DO Alarm + storage); the transport-agnostic, unit-testable gameplay orchestration is [GameSession](apps/realtime/src/GameSession.ts) (PvP) / [BotGameSession](apps/realtime/src/BotGameSession.ts) (PvE). Matchmaking + private-room join codes + reconnect tokens live in [LobbyDurableObject](apps/realtime/src/LobbyDurableObject.ts); deck resolution / `validateDeck` in [accounts.ts](apps/realtime/src/accounts.ts); match finalize + rewards (env-gated Supabase) in [matchServices.ts](apps/realtime/src/matchServices.ts). Deployed at `twcardgame-realtime.ptr0905.workers.dev`.
- [apps/server](apps/server/) — `@twcardgame/server`, **legacy** Colyseus authoritative server (Railway, see [railway.json](railway.json) / [Dockerfile](apps/server/Dockerfile)), **superseded by `apps/realtime` and pending decommission** — the web client no longer connects to it. Still defines `pvp` ([GameRoom](apps/server/src/GameRoom.ts)) and `pve` ([BotRoom](apps/server/src/BotRoom.ts)) rooms plus accounts/persistence/finalization ([accounts.ts](apps/server/src/accounts.ts), [persistence.ts](apps/server/src/persistence.ts), [matchFinalizer.ts](apps/server/src/matchFinalizer.ts), [privateRooms.ts](apps/server/src/privateRooms.ts)). **Don't build new features here — port to `apps/realtime`.**
- [apps/web](apps/web/) — `@twcardgame/web`, Vite vanilla-TS client. It talks to the realtime Worker over a **native-WebSocket transport adapter** in [apps/web/src/app/](apps/web/src/app/) — `@colyseus/sdk` and the client schema mirror were removed in the migration. Entry [main.ts](apps/web/src/main.ts) just calls `startApp` in [runtime.ts](apps/web/src/runtime.ts); rendering, animation, audio, and DOM patching are split into [apps/web/src/app/](apps/web/src/app/). Hosted on Cloudflare Pages; media (`/images /audio /video`) served from R2 — see [docs/cloudflare-operations.md](docs/cloudflare-operations.md).
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
npm run dev:web            # vite --host 0.0.0.0 (serves public/ assets from disk in dev)
npm run dev -w @twcardgame/realtime   # wrangler dev — the live backend (runs tsc -b first)
npm run dev:server         # tsx watch apps/server/src/index.ts — LEGACY Colyseus, being retired
```

Deploying the live stack (URLs, `--branch=main`, R2 asset upload, rollback, troubleshooting) is documented in [docs/cloudflare-operations.md](docs/cloudflare-operations.md). In short: web → `npm run pages:deploy -w @twcardgame/web -- --branch=main`; backend → `npm run deploy -w @twcardgame/realtime`; assets → `npm run assets:upload -w @twcardgame/web`. It is **not** git-push auto-deploy.

Run a single test file: `npx vitest run packages/rules/src/rules.test.ts` (or `-t "<name pattern>"` for a single test).

Vitest is configured with `resolve.conditions: ["source"]` — workspace packages' `exports."."."source"` (their `src/index.ts`) is consumed directly, so tests do not require a prior `tsc -b`. Production consumers go through `dist/` instead.

## Architecture invariants

These rules are load-bearing for the v2 design — violating them breaks determinism, replay, or the trust boundary between client and server.

**Command flow.** All gameplay mutations go through one path:

```
client → Worker WS message "command" → GameSession.applyClientCommand → rules.reduce(state, command) → MatchState + GameEvents → state/publicSync (toPublicState) + private hand messages (toHandView)
```

The client never mutates state; it sends `CommandEnvelope`s and renders synced state. Gameplay logic must not live in `apps/realtime`, `apps/server`, or `apps/web` — those are transport/orchestration adapters only. (The legacy Colyseus path was `client → "command" → GameRoom.handleCommand → reduce → syncPublicState`; same shape, different transport.)

**Determinism in `packages/rules`.** The rules package must be pure and reproducible:

- No DOM, no Colyseus, no Supabase, no network, no timers.
- No `Math.random()` — use the seeded RNG in [packages/rules/src/rng.ts](packages/rules/src/rng.ts) (`nextInt`, `shuffleInPlace`, seed from the match seed).
- No `Date.now()` — time-dependent fields (e.g. `startedAtMs`, reconnect deadlines) come from `input.nowMs` / command envelopes provided by the server (in `apps/realtime`, the DO injects `now()`).

**Private vs public state.** Public synced state is a plain JSON snapshot built from `toPublicState` — broadcast as the `state`/`publicSync` messages by [apps/realtime/src/GameSession.ts](apps/realtime/src/GameSession.ts) — and exposes counts only, never hand contents or deck order. Each player's own hand is the `hand` direct message built from `toHandView`. Do not leak private fields into the public snapshot. (The legacy Colyseus schema in [apps/server/src/schema.ts](apps/server/src/schema.ts) enforced the same boundary via schema delta.)

**Colyseus Schema gotcha (legacy `apps/server` only).** The Colyseus path uses `defineTypes(...)` instead of decorator field syntax and relies on `useDefineForClassFields: false` in [tsconfig.base.json](tsconfig.base.json) — `@colyseus/schema` v4 needs this to track field metadata. The flag stays set repo-wide while `apps/server` exists; `apps/realtime` and `apps/web` no longer depend on Colyseus schema.

**Deck rules.** PvP decks are strict 30-card public decks validated by `validateDeck` in [packages/rules/src/deck.ts](packages/rules/src/deck.ts) against the card catalog. The catalog is the single source of truth: cards live in [packages/cards/src/catalog.generated.ts](packages/cards/src/catalog.generated.ts), shapes in [types.ts](packages/cards/src/types.ts)/[schema.ts](packages/cards/src/schema.ts), version exported as `CARD_CATALOG_VERSION` and embedded in `MatchState.cardCatalogVersion`.

**Adding card effects.** New battlecry / effect types need both (a) a schema entry in `packages/cards` so `validate:cards` accepts them, and (b) a handler under [packages/rules/src/effects/](packages/rules/src/effects/) registered in [effects/registry.ts](packages/rules/src/effects/registry.ts) so `resolveEffect` can dispatch it. Handlers are grouped by domain (`core.ts`, `damage-heal.ts`, `hand.ts`, `summon-destroy-bounce.ts`, `buff-keyword-lock.ts`, `channel.ts`, `environment.ts`, `voteEvents.ts`); [effects.ts](packages/rules/src/effects.ts) is just the public re-export façade. An unregistered effect type throws `Unhandled effect type` at runtime — if either side is missing, validation or runtime fails closed.

**AI / bot determinism.** The PvE opponent's decisions live in [packages/rules/src/bot.ts](packages/rules/src/bot.ts) (`decide`, fed by `legalMoves` in [legalMoves.ts](packages/rules/src/legalMoves.ts)) and obey the same purity rules as the rest of `packages/rules` — the bot is seeded from a `BotRngState` so a recorded command log replays identically. [BotGameSession](apps/realtime/src/BotGameSession.ts) (live) — and the legacy [BotRoom](apps/server/src/BotRoom.ts) — is only the adapter that paces (via DO Alarms) and submits the bot's commands; it must not contain decision logic.

## Web animation lessons

- Attack animations depend on the pre-sync DOM. `publicSync` can arrive before the paired `events` message, so attack/death visuals must give events a short grace window to enqueue cues, then hold public sync while `attackAnimationBusy()` is true.
- Keep attack timing constants and CSS keyframes coupled. If contact is at 70% of `ATTACK_LUNGE_MS`, schedule damage numbers and attack SFX at that derived impact delay; delay `destroy` cues and board removal until the full lunge has returned to origin.
- For lethal or mutual-destruction bugs, instrument with scoped logs around cue enqueue, DOM lookup, lunge start/abort/success, and publicSync flush/apply before changing gameplay or animation logic.

## Workflow expectations

The repo's own skills document the project workflow and coding style:

- General project workflow: [.claude/skills/twcardgame-v2/SKILL.md](.claude/skills/twcardgame-v2/SKILL.md)
- Coding style and module boundaries: [.claude/skills/twcardgame-v2-coding-style/SKILL.md](.claude/skills/twcardgame-v2-coding-style/SKILL.md)
- Web battle animation (event→cue model, publicSync hold/flush, declarative-vs-imperative animation, anchoring to appearing/dead units): [.claude/skills/twcardgame-v2-web-animation/SKILL.md](.claude/skills/twcardgame-v2-web-animation/SKILL.md)

Validation cadence:

- After meaningful changes: `npm run validate:cards && npm test && npm run check`.
- After server/web changes: also `npm run build`.
- Card or rules changes: update or add tests before declaring done — rules behavior is exercised in [packages/rules/src/rules.test.ts](packages/rules/src/rules.test.ts) and the catalog in [packages/cards/src/catalog.test.ts](packages/cards/src/catalog.test.ts).

The Chinese build guide is [docs/製作.md](docs/製作.md), and the architecture overview is [docs/v2-architecture.md](docs/v2-architecture.md).

## Cloudflare hosting (Plan B — now live)

Hosting has been migrated from Colyseus-on-Railway + Vercel to a near-free Cloudflare stack (Workers/Durable Objects + Pages + R2), **keeping Supabase for Auth + DB**. The live backend is `apps/realtime`; `apps/web` runs on Pages with media on R2; `apps/server` (Colyseus) is legacy pending decommission. Migration Phases 0–4 (PoC → realtime parity → matchmaking/reconnect → web cutover → Pages+R2 deploy) are **code-complete**; Phase 5 (Supabase→D1) is optional and not planned.

- **Operating the live stack** (player URL, how to deploy/update each piece, "no git-push auto-deploy", rollback, troubleshooting): [docs/cloudflare-operations.md](docs/cloudflare-operations.md).
- **Migration history / rationale** (locked decisions, Colyseus→DO mapping, per-phase tracker): [docs/cloudflare-migration-roadmap.md](docs/cloudflare-migration-roadmap.md).

Invariant for this migration: `packages/rules` / `shared` / `cards` stayed **byte-identical** — only the transport/room/persistence plumbing changed. Gameplay logic and balance must stay that way.
