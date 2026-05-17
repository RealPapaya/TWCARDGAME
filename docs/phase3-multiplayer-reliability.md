# Phase 3 Multiplayer Reliability

Phase 3 hardens the v2 Colyseus PvP server against common network and process lifecycle failures while keeping gameplay mutations inside `packages/rules`.

## Single Instance Runtime

- Clients send `ClientCommandMessage` with `commandId`, `expectedActionSeq`, and a gameplay `command`.
- The server ignores exact duplicate `commandId` values before checking `expectedActionSeq`, preserving idempotent retries.
- Non-duplicate commands must match the current public `turn.actionSeq`; stale or future commands emit `COMMAND_REJECTED` and do not call `reduce(...)`.
- Reconnect uses Colyseus `allowReconnection` with `RECONNECT_WINDOW_MS`; public state exposes `connected` and `reconnectUntilMs`, while private hand state is resent only to the reconnecting client.

## Match Finish And Cleanup

- Match completion is centralized in `GameRoom` through `MatchResultFinalizer`.
- Finished and abandoned matches persist at most once, then schedule room cleanup after `MATCH_CLEANUP_DELAY_MS` milliseconds.
- Disconnect timeout finishes the match with `reason: "disconnect_timeout"` and awards the opponent.
- Graceful shutdown marks unfinished matches as `abandoned`, syncs public state, broadcasts `GAME_FINISHED`, and disconnects clients during Colyseus drain.

## Supabase Persistence

- Persistence is optional and enabled only when both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present.
- Results are written to `public.match_history` with final public state, catalog version, result reason, winner seat, and UUID player ids when available.
- Missing env vars make persistence a no-op for local development and CI.
- Write failures are logged and never block match state sync or room cleanup.

## Scaling Strategy

The current implementation is single-instance authoritative PvP. For multi-instance deployment:

- Add `@colyseus/redis-presence` and Redis driver configuration to the Colyseus `Server` options.
- Use a shared Redis instance for presence, room discovery, and cross-process matchmaking.
- Keep active match state owned by one room process; do not split a single match across instances.
- Add a separate active-match persistence/recovery design before enabling automatic match rehydration after process restart.
