TWCARDGAME v2 — Development Roadmap

Project: 寶島遊戲王 v2 parallel rewrite
Architecture: Colyseus + TypeScript monorepo · Supabase · Vite · Fly.io · Vercel
Last updated: 2026-05-20


Phase Overview
| Phase | Name | Status |
| --- | --- | --- |
| 0 | Architecture Setup & Legacy Isolation | Complete |
| 1 | PvP Core Scaffold | Complete |
| 2 | Rules Parity | Complete |
| 3 | Multiplayer Reliability | Complete |
| 4 | Account, Deck & Collection | Complete |
| 5 | Real UI / UX | Complete |
| 6 | Production Launch | Pending |

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
Status: ✅ Complete

Goal: players have real accounts, can build and save decks, and match history is recorded.

Tasks

 Supabase Auth integration (email/password + Google OAuth)
 Player profile creation on first login
 Deck CRUD — create, read, update, delete saved decks via authenticated Supabase RPC
 Deck ownership, catalog version, legality, and collection quantity enforced server-side before match start
 Card catalog snapshot publish pipeline (repo files → Supabase table versioned)
 Match history write on game end and browser history read through RLS
 Card collection system with full current-catalog starter grants
 Row Level Security (RLS) policy coverage tested for all browser-exposed tables

What was completed

 Web account lobby added for Supabase auth, profile, collection count, deck CRUD, deck selection, and match history
 Production PvP joins now pass Supabase accessToken + saved deckId; dev mode still supports displayName/deckIds fallback
 Server validates saved deck ownership, current catalog version, 30-card legality, copy limits, and owned quantities
 Supabase RPCs added for ensure_full_seed_collection, save_user_deck, and delete_user_deck
 npm run publish:catalog publishes CARD_CATALOG_VERSION + CARD_CATALOG to card_catalog_snapshots
 npm run test:rls statically verifies Phase 4 RLS/RPC migration coverage


Phase 5 — Real UI / UX
Status: ✅ Complete

Goal: the game looks and feels like 寶島保護戰, not a developer scaffold.

Visual reference

legacy/css/ — v1 color system, card frame styles, board layout (safe to port)
legacy/js/ — v1 rendering logic (do not port logic; use only as visual reference)
assets/ — card art, audio (shared, already in place)

What was completed (commit 2b07d36)

 Full game board UI — hero zones, hand rows, board rows, mana crystals
 Card component rendering — cost gem, title, art box, rarity, attack/health stats
 Card click-to-play with valid-target highlighting and drag-and-drop arrow layer
 Target selection UI — taunt glow, valid-target ring animation, attacker-selected state
 Animation event playback — card preview slam, event cues (play/summon/damage/heal/buff/destroy)
 Mulligan selection UI — overlay, card selection with replace tag, confirm count button
 Reconnect / waiting-for-opponent banner
 Mobile responsive layout — 390 px viewport verified, no horizontal overflow
 COMMAND_REJECTED feedback — toast with shake animation + rejected-card border
 End-of-match screen — result overlay (Victory/Defeat) + Back to Lobby
 E2E spec (e2e/phase5-ui.spec.mjs) — extended with core-gameplay-feel coverage (attack lunge, float numbers, hover tooltip, concede modal)
 Attack animation — attacker lunges toward target then snaps back (new ATTACK GameEvent drives the cue)
 Floating damage/heal numbers — amount floats up from the affected target (red for damage, green for heal)
 Minion death particle effect — dust-cloud particles burst on death alongside the grayscale fade
 Card hover tooltip — desktop hover (≥220 ms) shows full-size card detail popup, dismissed on leave / drag
 Concede confirmation modal — overlay with Stay / Concede intercepts accidental surrender

Completed Phase 5 parity gap

Main menu & navigation
 Main menu page — game title logo, arena background, cloud animation, Enter Battle / Profile / Shop / Collection buttons
 View transition animations — slide-up / fade between lobby → game → result screens

Battle UI polish
 Audio system — background music and sound effects for attacks, plays, deaths, turn change, rejects, and pack opening
 Custom cursor — webp cursor sprite on desktop (see legacy/css/style.css); optional / desktop-only

Account & profile
 Player profile page — level display, XP bar, win/loss stats, avatar, title
 Card collection gallery — filterable card grid (all / owned / not owned) with card art
 Matchmaking waiting UI — animated searching state, elapsed time counter, cancel matchmaking button

Single-player mode
 AI opponent — server-side BotRoom with easy / normal / hard difficulties and rules-engine decisions
 Difficulty and theme deck selection screen

Store & progression (lower priority)
 Shop page — card pack purchase UI, gold currency display, free Phase 5 grant stub
 Pack opening animation
 Leaderboard page
 Friends system — friend list, invitations, private challenge code flow

Before Phase 6 starts

 Phase 5 implementation is code-complete in web/server/rules/db.
 Run the full validation suite on the final tree: npm run validate:cards, npm test, npm run check, npm run build, npm run test:e2e, npm run test:rls.
 Apply packages/db/migrations/0005_phase5_social_shop_ai.sql to the dev Supabase project and verify the RPCs manually.
 Manual browser pass: menu navigation, audio toggle, cursor, PvP matchmaking cancel, private room code join, AI match, profile edit/avatar, collection filters, shop claim/pack open, leaderboard, friends.
 Decide Phase 6 production choices: Vercel project, Fly app, production Supabase project, monitoring provider, load-test target, beta testers, rollback/DNS plan.


Phase 6 — Production Launch
Status: 🟡 In Progress

Goal: v2 is live, stable, and replaces v1 as the canonical game URL.

Tasks

 Vercel deployment configured for apps/web (environment variables, build command)
 Fly.io deployment for apps/server (Dockerfile, fly.toml, secrets)
 Supabase production project (separate from dev, migrations applied)
 Environment config — .env.example for all apps, no secrets in repo
 Structured logging and error monitoring (e.g. Sentry or Fly.io logs)
 Load test — simulate concurrent rooms, verify memory and CPU under load
 Closed beta test with real players, collect feedback
 Rollback plan — v1 remains in legacy/ and can be re-deployed if critical issues found
 DNS cutover — point production domain to v2 Vercel deployment

Repo artifacts completed

 Structured JSON logging — apps/server/src/logger.ts (stdout/stderr) wired into
   index.ts, GameRoom lifecycle, and match persistence; process-level
   uncaughtException / unhandledRejection handlers added
 Web global error capture — apps/web/src/logger.ts installed from main.ts
 vercel.json — root build config for apps/web (build command, output dir)
 apps/server/.env.example and apps/web/.env.example — documented, no secrets
 fly.toml — HTTP /health check added; single-machine note recorded
 Load-test harness — e2e/load-test.mjs (headless Colyseus PvE clients),
   npm run test:load
 GitHub Actions — .github/workflows/ci.yml (PR/branch CI) and deploy.yml
   (master → Fly.io + Vercel)
 Deployment runbook — docs/phase6-production-launch.md

Pending operator execution (needs accounts / credentials / DNS)

 Create production Supabase project, apply migrations, publish catalog
 Fly.io deploy with secrets; Vercel project import with env vars
 GitHub secrets: FLY_API_TOKEN, VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
 Run load test against the deployed server; record memory/CPU
 Closed beta, DNS cutover — see docs/phase6-production-launch.md


Architecture Constraints (always enforced)
RuleDetailServer is authoritativeClients send commands only; server mutates and broadcasts statepackages/rules is pureNo DOM, no Colyseus, no Supabase, no timers inside the rules enginePrivate state never leaves the serverOpponent hand contents are never sent to the clientNo Math.random() in rulesAll randomness via seeded PRNG stored in private room stateCard additions require only packages/cards changesNew cards do not require touching engine or UI modulesAll DB tables use RLSNo table exposed to browser without row-level security policy

Key References
ResourceURLColyseus conceptshttps://docs.colyseus.io/conceptsColyseus state synchttps://docs.colyseus.io/stateColyseus StateView (private state)https://docs.colyseus.io/state/viewColyseus scalabilityhttps://docs.colyseus.io/scalabilitySupabase RLShttps://supabase.com/docs/guides/database/postgres/row-level-securityv1 reference (legacy)legacy/ directory in this repoArchitecture notesdocs/v2-architecture.md
