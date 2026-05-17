TWCARDGAME v2 — Development Roadmap

Project: 寶島遊戲王 v2 parallel rewrite
Architecture: Colyseus + TypeScript monorepo · Supabase · Vite · Fly.io · Vercel
Last updated: 2026-05-17


Phase Overview
PhaseNameStatus0Architecture Setup & Legacy Isolation✅ Complete1PvP Core Scaffold✅ Complete2Rules Parity✅ Complete3Multiplayer Reliability⬜ Pending4Account, Deck & Collection⬜ Pending5Real UI / UX⬜ Pending6Production Launch⬜ Pending

Phase 0 — Architecture Setup & Legacy Isolation
Status: ✅ Complete
What was done

Moved all v1 source code into legacy/ (preserved for reference, not touched)
Established v2 monorepo with apps/, packages/, docs/ separation
Set up Claude Code / Codex agent skills under .agent/skills/
Committed clean architecture baseline

Folder structure established
/apps
  /web        Vite + vanilla TypeScript client
  /server     Colyseus authoritative game server
/packages
  /cards      Card catalog, schemas, validators
  /rules      Deterministic rules engine (pure functions, no I/O)
  /shared     Commands, events, public DTOs, shared types
  /db         Supabase migrations, typed queries, RLS policies
  /test-utils Fixtures, seeded RNG helpers, replay harness
/legacy       v1 original source (reference only)
/docs         Architecture notes, ADRs, this roadmap
/assets       Card art, audio, UI media (shared between v1 and v2)

Phase 1 — PvP Core Scaffold
Status: ✅ Complete

 Colyseus authoritative GameRoom with server-owned GameState
 TypeScript deterministic rules engine (packages/rules)
 Card catalog with validation — 104 cards validated (npm run validate:cards)
 Strict deck legality — 30 cards, max 2 copies per non-legendary, max 1 per legendary
 Mulligan flow and turn start sequence
 Core commands: playCard, attack, endTurn, concede, submitMulligan
 Private hand sync (opponent hand count only, no card data leaked)
 Vite prototype client — two clients confirmed joining same room and syncing state
 Fly.io Docker scaffold
 Server health endpoint at /health
 COMMAND_REJECTED authoritative enforcement confirmed working
 Playwright e2e script (e2e/game-loop.spec.mjs) — two-browser full game loop, npm run test:e2e
 ArraySchema in-place reconciliation fix (no more splice insertCount crash)
 Client-side Colyseus schema registration (apps/web/src/schema.ts) for correct state decode
 vite.config.ts esbuild.useDefineForClassFields: false — Colyseus 4.x compatibility
 Target legality enforcement — validatePlayTarget() rejects bad battlecry targets; taunt blocks attacks
 Golden tests — all supported battlecry/effect handlers covered (effects.golden.test.ts)
 Reconnect e2e — e2e/reconnect.spec.mjs: disconnect detection, reconnect restores state, timeout→game over
 RECONNECT_WINDOW_MS env var on server; npm run test:reconnect; dev.bat option [8] for 5 s test mode


Phase 2 — Rules Parity
Status: ✅ Complete

Goal: every card effect that existed in v1 is fully implemented, tested, and produces identical outcomes given the same seed and command sequence.

Effect families to cover

 DAMAGE / DAMAGE_SELF / DAMAGE_ALL_ENEMY_MINIONS / DAMAGE_ALL_NON_CATEGORIES / DAMAGE_NON_CATEGORY
 HEAL / FULL_HEAL
 BUFF_ALL / BUFF_CATEGORY
 DRAW
 DESTROY
 BOUNCE_ALL_ENEMY
 Deathrattle triggers
 Ongoing aura effects
 Enrage (stat change on damage taken)
 Quest mechanics and quest turn counters
 Lock timer (lockedTurns, deathTimer)
 Discard triggers
 newsPower NEWS card effects

Testing requirements

 Every battlecry/effect type has at least one golden test
 Every card in the 104-card catalog has a corresponding behavior test or is covered by its effect type test
 Cross-reference legacy/js/engine/game_engine.js line by line for behavioral parity
 Replay determinism test: same seed + same command log → identical final state and event sequence

What was completed

 Golden coverage expanded for supported handlers, including currently-unused catalog-safe handlers
 Phase 2 parity mechanics tests added for deathrattles, auras, enrage, quests, lock/death timers, discard triggers, newsPower, and NEWS cost reduction
 Catalog coverage assertion added for all 104 current cards
 Legacy parity audit documented in docs/phase2-rules-parity-audit.md
 BOUNCE_SELF deathrattle parity fixed so returned hand cards use original catalog stats
 Validation passed: npm run validate:cards, npm test, npm run check


Phase 3 — Multiplayer Reliability
Status: ✅ Complete

Goal: the server handles all real-world network conditions without corrupting match state.

Tasks

 Reconnect / disconnect timeout with configurable grace period (reconnectUntilMs)
 Duplicate command rejection (idempotency via actionSeq)
 Out-of-turn command rejection (confirmed in scaffold, needs full test coverage)
 Room cleanup on match end or abandonment
 Server restart strategy (graceful shutdown, match state recovery)
 Match result persistence to Supabase on game end
 Colyseus scaling strategy documented (Redis presence driver for multi-instance)

What was completed

 Client command sequencing via expectedActionSeq, with duplicate commandId idempotency preserved
 Out-of-turn and stale/future command rejection covered by tests and e2e
 Reconnect timeout now emits GAME_FINISHED, syncs public status, and schedules room cleanup
 Match finalization centralized with best-effort, once-only Supabase match_history persistence
 Graceful Colyseus shutdown drains rooms and marks unfinished matches abandoned
 Phase 3 reliability/scaling notes added in docs/phase3-multiplayer-reliability.md


Phase 4 — Account, Deck & Collection
Status: ⬜ Pending — Supabase scaffold only

Goal: players have real accounts, can build and save decks, and match history is recorded.

Tasks

 Supabase Auth integration (email + OAuth)
 Player profile creation on first login
 Deck CRUD — create, read, update, delete saved decks
 Deck ownership check enforced server-side before match start
 Card catalog snapshot publish pipeline (repo files → Supabase table versioned)
 Match history write on game end
 Card collection system (which cards the player owns)
 Row Level Security (RLS) policies tested for all browser-exposed tables


Phase 5 — Real UI / UX
Status: ⬜ Pending — prototype only

Goal: the game looks and feels like 寶島保護戰, not a developer scaffold.

Visual reference

legacy/css/ — v1 color system, card frame styles, board layout (safe to port)
legacy/js/ — v1 rendering logic (do not port logic; use only as visual reference)
assets/ — card art, audio (shared, already in place)

Tasks

 Full game board UI — hero zones, hand, board rows, mana display
 Card component rendering with art, cost, attack/health stats, rarity
 Card drag-and-drop or click-to-play with valid target highlighting
 Target selection UI (taunt indicators, valid target glow)
 Animation event playback — play card, attack, damage numbers, minion death
 Mulligan selection UI
 Reconnect / waiting-for-opponent UI
 Mobile responsive layout
 COMMAND_REJECTED feedback shown to player (toast / shake effect)
 End-of-match screen (winner, stats, back to lobby)


Phase 6 — Production Launch
Status: ⬜ Pending

Goal: v2 is live, stable, and replaces v1 as the canonical game URL.

Tasks

 Vercel deployment configured for apps/web (environment variables, build command)
 Fly.io deployment for apps/server (Dockerfile, fly.toml, secrets)
 Supabase production project (separate from dev, migrations applied)
 Environment config — .env.production for all apps, no secrets in repo
 Structured logging and error monitoring (e.g. Sentry or Fly.io logs)
 Load test — simulate concurrent rooms, verify memory and CPU under load
 Closed beta test with real players, collect feedback
 Rollback plan — v1 remains in legacy/ and can be re-deployed if critical issues found
 DNS cutover — point production domain to v2 Vercel deployment


Architecture Constraints (always enforced)
RuleDetailServer is authoritativeClients send commands only; server mutates and broadcasts statepackages/rules is pureNo DOM, no Colyseus, no Supabase, no timers inside the rules enginePrivate state never leaves the serverOpponent hand contents are never sent to the clientNo Math.random() in rulesAll randomness via seeded PRNG stored in private room stateCard additions require only packages/cards changesNew cards do not require touching engine or UI modulesAll DB tables use RLSNo table exposed to browser without row-level security policy

Key References
ResourceURLColyseus conceptshttps://docs.colyseus.io/conceptsColyseus state synchttps://docs.colyseus.io/stateColyseus StateView (private state)https://docs.colyseus.io/state/viewColyseus scalabilityhttps://docs.colyseus.io/scalabilitySupabase RLShttps://supabase.com/docs/guides/database/postgres/row-level-securityv1 reference (legacy)legacy/ directory in this repoArchitecture notesdocs/v2-architecture.md
