# @twcardgame/realtime — Cloudflare Workers + Durable Objects realtime layer

This is the **Plan B** realtime layer from
[docs/cloudflare-migration-roadmap.md](../../docs/cloudflare-migration-roadmap.md):
the Colyseus `GameRoom` replaced by a Cloudflare **Durable Object**, keeping
`packages/rules` / `shared` / `cards` **byte-identical**. Auth + DB stay on
Supabase.

## Architecture

```
client  ─wss─►  Worker (src/index.ts, routes by room code)
                   └─► GameDurableObject  (one DO == one match room)
                          • WebSocket Hibernation  (connections, idle = no cost)
                          • a single DO Alarm        (every deadline)
                          • storage                  (survives eviction)
                          └─► GameSession  (PURE gameplay orchestration)
                                 └─► reduce() / toPublicState() / toHandView()
                                       from @twcardgame/rules  (UNCHANGED)
```

The split is the load-bearing design decision:

- **`GameSession.ts`** is a transport-agnostic port of GameRoom's gameplay
  orchestration (`applyEnvelope`, public/private sync, deadline logic,
  disconnect/reconnect budget, finalize). It talks only to a `SessionHost`
  interface and uses an injected `now()` — so it is **fully unit-testable in
  vitest** with no Workers runtime (`src/GameSession.test.ts`), and gameplay
  stays deterministic.
- **`GameDurableObject.ts`** is the thin adapter: hibernatable WebSockets, one
  Alarm, durable storage. No gameplay logic lives here — the same boundary
  Colyseus's `GameRoom` kept.

### Colyseus → DO mapping (implemented)

| Colyseus | Here |
|---|---|
| `onJoin` / seat assign | `fetch()` WS upgrade + `GameSession.resolveSeat/setPlayer` |
| `setState` + schema delta | plain JSON `state` (full `PublicGameState`) + `publicSync` messages |
| `onMessage("command")` | `webSocketMessage` → `GameSession.applyClientCommand` |
| `client.send` / `broadcast` | `sendToSeat` / `broadcast` over hibernatable sockets |
| `clock.setTimeout` (turn/phase) | **single DO Alarm** ← `GameSession.nextDeadline()` |
| `allowReconnection` | reconnect budget on the seat + Alarm timeout |
| reconnection survives eviction | `GameSession` snapshot persisted to DO storage |
| match finalize + `reward_summary` | `MatchServices` (env-gated Supabase persist / rewards / quests) — `src/matchServices.ts` |
| deck resolution + `validateDeck` | `AccountStore` (Supabase owned-deck or dev deck) — `src/accounts.ts` |

### Wire protocol

JSON `{ type, payload }` both directions. Server→client `type` names are exactly
the Colyseus `onMessage` events the existing web client already handles
(`seat`, `hand`, `publicSync`, `events`, `presence`, `amplificationOptions`,
`promptChoice`, `reward_summary`, `joinCode`, `error`) plus `state` (the full
snapshot the legacy client read off `room.onStateChange`). See `src/protocol.ts`.

## Lobby / Phase 2 endpoints

- `POST /matchmaking/public` returns `{ room, status }` and pairs every two
  callers into the same PvP room.
- `POST /private` creates a private challenge and returns `{ room, joinCode }`.
- `GET /private/:joinCode` resolves a private room; `DELETE /private/:joinCode`
  releases it after match cleanup.
- `GET /pvp` without `room` or `joinCode` now uses public matchmaking.
- `GET /pvp?joinCode=ABC123` resolves the room through the Lobby DO.
- WebSocket clients receive `reconnectToken`; reconnect with
  `/pvp?token=<token>` or `/pvp?reconnectToken=<token>`.
- `POST /pve/devtest` (localhost only) stages a scripted dev-test board in a fresh
  PvE room and returns `{ room }`; the client then connects to `/pve?room=…` as
  usual. The setup is applied in `BotGameSession.customizeInitialMatch`, and
  finalize side-effects are skipped (`metadata.devTest`). See `src/devTest.ts`.

## Run the PoC (Phase 0 acceptance: two tabs play a full PvP game)

Workspace packages are consumed from `dist/`, so build first (NodeNext + explicit
`.js` specifiers don't bundle cleanly from source under esbuild):

```bash
npm install
npm run build -w @twcardgame/realtime      # tsc -b (builds rules/shared/cards too)
npm run dev   -w @twcardgame/realtime      # wrangler dev  →  ws://127.0.0.1:8787
```

Then open `apps/realtime/poc/client.html` in **two browser tabs**, set the same
room code, and Connect in each. Mulligan → play → attack → end turn until one
hero dies. (Special phases trigger automatically at turns 7/14/20 and are
handled.)

> `wrangler dev` runs the DO + Hibernation + Alarms locally via Miniflare.

## Status (see roadmap §A)

Phases 0–3 are complete on the Worker/DO path — **the web client now talks only to
this Worker; Colyseus is fully removed from `apps/web`.** The remaining work is
live-environment verification (a real Supabase backend + browser visual QA), not
missing code.

- ✅ **Phase 0** — DO + `reduce` + native WebSocket; PvP-by-room-code; turn /
  mulligan / special-phase deadlines on a DO Alarm; disconnect→reconnect window;
  hibernation-safe persistence; unit tests green.
- ✅ **Phase 1** — PvE (`BotRoom`) bot pacing on Alarms; **Supabase-backed deck
  resolution + `validateDeck`** (`src/accounts.ts`); **match persistence + rewards
  + quest events** behind `onMatchComplete` (`src/matchServices.ts`), pushing a
  per-seat `reward_summary`. All env-gated: without `SUPABASE_*` it degrades to a
  dev deck + server-authoritative zero-reward summaries.
- ✅ **Phase 2** — public matchmaking (Lobby DO) + private-room code registry +
  full reconnect-token flow; reconnect-budget / seat-resolution / hibernation
  preservation now unit-tested.
- ✅ **Phase 3** — `apps/web` now talks ONLY to this Worker: `@colyseus/sdk`, the
  client schema mirror (`schema.ts`), and the `ws` browser shim are deleted, and
  the `:2567` / `VITE_COLYSEUS_URL` config paths are gone. The transport adapter
  maps the JSON messages onto the existing client event interface (incl.
  `reward_summary`) and synthesises `view.state` from the `state` snapshot. The
  localhost dev-test PvE panel was ported here too (`src/devTest.ts` +
  `POST /pve/devtest`). **Remaining: full browser visual QA across PvP /
  private-room / reconnect / PvE / dev-test.**
- ⬜ **Phase 4/5** — Pages + R2 deploy; optional Supabase → D1.

## Configuration

Set these Worker vars/secrets (e.g. `wrangler secret put`) to activate the
Supabase-backed persistence/rewards/deck resolution; leave them unset for the
PoC / dev path:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Not yet verified (needs live infra, not code)

- The Supabase round-trip (deck ownership/legality resolution, `match_history`
  upsert, `apply_match_rewards` / quest RPCs) is implemented and bundles, but has
  only been exercised against fakes in `src/matchServices.test.ts` — verify it
  against a real Supabase project before cutover.
- Phase 3 still needs full gameplay / visual QA against `wrangler dev` + Vite.
