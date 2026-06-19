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

### Wire protocol

JSON `{ type, payload }` both directions. Server→client `type` names are exactly
the Colyseus `onMessage` events the existing web client already handles
(`seat`, `hand`, `publicSync`, `events`, `presence`, `amplificationOptions`,
`promptChoice`, `joinCode`, `error`) plus `state` (the full snapshot the legacy
client read off `room.onStateChange`). See `src/protocol.ts`.

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

- ✅ **Phase 0** — DO + `reduce` + native WebSocket; PvP-by-room-code; turn /
  mulligan / special-phase deadlines on a DO Alarm; disconnect→reconnect window;
  hibernation-safe persistence; unit tests green.
- ⬜ **Phase 1** — PvE (`BotRoom`) bot pacing on Alarms; Supabase deck resolution
  + match persistence/rewards hooks (`onMatchComplete`).
- ⬜ **Phase 2** — public matchmaking (Lobby DO) + private-room code registry +
  full reconnect-token flow.
- ⬜ **Phase 3** — `apps/web` transport adapter: translate these JSON messages
  into the existing client event interface, and synthesise `view.state` from the
  `state` snapshot (the renderer is otherwise untouched). The web transport map
  is captured in the roadmap.
- ⬜ **Phase 4/5** — Pages + R2 deploy; optional Supabase → D1.

## Not yet wired (intentional, next phases)

- `/pve` returns **501** — bot pacing is Phase 1.
- No Supabase: connections use a default dev deck; `onMatchComplete` is a hook
  with no persistence/reward dispatch yet.
- Public matchmaking: `/pvp` is **room-code only** (no `joinOrCreate` queue yet).
