# Phase 6 — Production Launch Runbook

This is the operator runbook for taking TWCARDGAME v2 live. The repo-side artifacts
(config files, structured logging, load-test harness, CI/CD) are already committed.
The steps below need real accounts, credentials, and DNS access — execute them in order.

- **Web client** → Vercel (`apps/web`, built to `apps/web/dist-public`)
- **Game server** → Fly.io (`apps/server`, app `twcardgame`, region `nrt`)
- **Database** → a production Supabase project, separate from dev

Architecture note: matches live in the server process's memory. Run a **single Fly
machine** for launch. Multi-instance scaling requires the Colyseus Redis presence
driver (see `docs/phase3-multiplayer-reliability.md`) and is out of scope here.

---

## 1. Production Supabase project

1. Create a new Supabase project (do **not** reuse the dev project). Note its
   Project URL, `anon` key, and `service_role` key.
2. Apply migrations in order, via the SQL editor or `supabase db push`:
   - `packages/db/migrations/0001_v2_core.sql`
   - `packages/db/migrations/0002_phase4_account_deck_collection.sql`
   - `packages/db/migrations/0003_phase4_browser_table_grants.sql`
   - `packages/db/migrations/0004_phase4_service_role_grants.sql`
   - `packages/db/migrations/0005_phase5_social_shop_ai.sql`
3. Publish the card catalog to the new project:
   ```bash
   SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key> \
     npm run publish:catalog
   ```
4. Verify RLS coverage: `npm run test:rls` (static check of the migration files).
5. Enable Auth providers: email/password and Google OAuth. Add the production web
   origin to the allowed redirect URLs.

---

## 2. Fly.io — game server

Prereq: `flyctl` installed and `fly auth login` done.

1. Create the app if it does not exist (name must match `apps/server/fly.toml`):
   ```bash
   fly apps create twcardgame
   ```
2. Set secrets (these are **not** in the repo):
   ```bash
   fly secrets set \
     SUPABASE_URL=<prod-url> \
     SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key> \
     --app twcardgame
   ```
   `NODE_ENV` and `PORT` are already set in `fly.toml [env]`.
3. First deploy — run from the **repo root** so the Docker build context includes
   `apps/` and `packages/`:
   ```bash
   flyctl deploy --config apps/server/fly.toml --dockerfile apps/server/Dockerfile --remote-only
   ```
4. Keep a single machine: `fly scale count 1 --app twcardgame`.
5. Verify: `curl https://twcardgame.fly.dev/health` returns
   `{"ok":true,...,"supabase":{"configured":true}}`.

---

## 3. Vercel — web client

1. Import the repository into Vercel. `vercel.json` at the repo root drives the
   build — leave the framework preset as "Other":
   - Install command: `npm install`
   - Build command: `npm run build -w @twcardgame/web`
   - Output directory: `apps/web/dist-public`
2. Set Environment Variables (Production scope) in the Vercel project:
   - `VITE_COLYSEUS_URL` = `wss://twcardgame.fly.dev`
   - `VITE_SUPABASE_URL` = production Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = production Supabase anon key
   These are inlined at build time, so a redeploy is needed after any change.
3. Deploy. Open the deployment URL and confirm the menu loads and a PvE match
   connects to the Fly server.
4. From the project Settings, capture the **Project ID** and **Org/Team ID** for CI.

---

## 4. GitHub Actions secrets

CI (`.github/workflows/ci.yml`) runs on PRs and non-`master` pushes with no secrets.
Deploy (`.github/workflows/deploy.yml`) runs on push to `master` and needs:

| Secret | Where to get it |
| --- | --- |
| `FLY_API_TOKEN` | `fly tokens create deploy --app twcardgame` |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
| `VERCEL_ORG_ID` | Vercel project Settings (Org/Team ID) |
| `VERCEL_PROJECT_ID` | Vercel project Settings (Project ID) |

Add them under GitHub repo → Settings → Secrets and variables → Actions.

---

## 5. Load test

With the server running (Fly or local):

```bash
LOAD_TEST_URL=wss://twcardgame.fly.dev \
LOAD_TEST_ROOMS=50 \
  npm run test:load
```

The script reports connect success rate, matches completed, and command
round-trip p50/p95. Watch server resources in parallel:

```bash
fly metrics --app twcardgame   # or the Fly dashboard Metrics tab
```

Record peak memory and CPU. If memory climbs and does not fall after matches end,
investigate room disposal before launch. Start at ~25 rooms, then ramp.

---

## 6. Closed beta

- Invite a small group; share the Vercel production URL.
- Confirm: account signup (email + Google), deck building, PvP matchmaking, PvE
  match, reconnect after a dropped connection, match history.
- Collect feedback and triage blockers before the DNS cutover.

---

## 7. Rollback plan

- **Server**: `fly releases --app twcardgame` lists prior releases;
  roll back with `fly deploy --image <previous-image-ref>` or
  `fly releases rollback` (or `fly machine update` to a known-good image).
- **Web**: in the Vercel dashboard, promote a previous deployment (instant
  rollback) — no rebuild required.

---

## 8. DNS cutover

1. Add the production domain to the Vercel project (Settings → Domains) and
   complete domain verification.
2. Update the DNS record at the registrar to the value Vercel provides
   (`CNAME` to Vercel, or `A`/`ALIAS` for an apex domain).
3. Lower the record TTL **before** the cutover so a rollback propagates fast.
4. After propagation, verify the production domain serves v2 and a full match
   plays end to end.
5. Keep the prior v1 DNS target documented so step 7's fallback is one record
   change away.

---

## 9. Cost and traffic notes

These estimates describe the current Vercel + Railway + Supabase deployment
shape. They are planning numbers, not billing guarantees. Re-check provider
pricing before launch because quotas and overage prices can change.

### Local development vs hosted traffic

| Scenario | Railway usage? | Network used | Notes |
| --- | --- | --- | --- |
| `npm run dev:server` and clients connect to `localhost` | No | Local machine only | No Railway traffic is involved. |
| `npm run dev:server` and LAN clients connect to the host machine | No | Host machine and player network | Useful for local playtests; Railway is not in the path. |
| `npm run dev:server` exposed through ngrok or Cloudflare Tunnel | No | Host machine plus tunnel provider | Railway is not charged, but the tunnel provider may have limits. |
| Production clients connect to a Railway-hosted Colyseus server | Yes | Railway egress plus player network | This is the normal PvP production path. |
| Local or hosted server talks to remote Supabase | No Railway egress unless the server is on Railway | Supabase plus caller network | Auth, deck reads, match history, rewards, and RPC calls hit Supabase. |

### Per-match traffic estimate

| Item | Rough traffic per match/session | Billed mostly to | Notes |
| --- | ---: | --- | --- |
| Vercel first page load | 5-30 MB per player | Vercel | Images, audio, JS, CSS, and cache misses dominate. Repeat visits are much lower. |
| Railway Colyseus WebSocket match traffic | 0.5-2 MB per PvP match total | Railway | Card-game state sync is small; commands, `publicSync`, events, and private hand messages are the main frames. |
| Supabase auth/deck/collection reads | 50-500 KB per player session | Supabase | Depends on account data size and table reads. |
| Supabase match result/reward writes | 10-100 KB per match | Supabase | Mostly end-of-match persistence and reward RPCs. |
| Player-side total download | 5-35 MB first session, then 1-5 MB cached | Player network | Frontend assets are the visible cost to players. |

For Railway planning, use 1 MB per PvP match as the normal estimate and
2 MB per match as a conservative estimate.

| Railway egress budget | At 1 MB per match | At 2 MB per match |
| ---: | ---: | ---: |
| 10 GB | ~10,000 matches | ~5,000 matches |
| 50 GB | ~50,000 matches | ~25,000 matches |
| 100 GB | ~100,000 matches | ~50,000 matches |

### Service limits and scaling watchpoints

| Service | Role | Main quota/watchpoint | Traffic triggers | Rough planning scale |
| --- | --- | --- | --- | --- |
| Vercel | Web client hosting and static asset delivery | Fast Data Transfer: Hobby 100 GB/month, Pro 1 TB/month, then overage on Pro | Opening the site, downloading new builds, loading uncached images/audio | At 20 MB first load, 100 GB is about 5,000 first-time player sessions; 1 TB is about 50,000. |
| Railway | Colyseus authoritative game server | CPU, RAM, and network egress are usage-based; egress is priced per GB | PvP WebSocket connections, matchmaking, room sync, reconnects | Traffic allows many matches; CPU/RAM/concurrent sockets are likely to limit first. Start by load testing 100-500 concurrent players. |
| Supabase Database/Auth | Accounts, decks, collections, match history, rewards | Free: 50,000 MAU, 500 MB DB, 5 GB egress. Pro: 100,000 MAU, 250 GB egress | Login, profile/deck/collection reads, match writes, leaderboard/shop reads | Free is fine for tests and small beta; Pro is safer for a public launch. |
| Supabase Realtime | Optional realtime features, not the current PvP path | Free: 200 concurrent connections and 2M messages. Pro: 500 concurrent connections and 5M messages | Only used if chat, presence, notifications, or realtime DB listeners use Supabase Realtime | Current PvP uses Colyseus, so this should not cap match concurrency unless new features depend on it. |

Provider references captured on 2026-05-25:

- Railway pricing: https://docs.railway.com/pricing/plans
- Vercel pricing: https://vercel.com/pricing
- Supabase pricing: https://supabase.com/pricing
- Supabase Realtime pricing: https://supabase.com/docs/guides/realtime/pricing
- Supabase Realtime limits: https://supabase.com/docs/guides/realtime/limits

---

## Done criteria

- `/health` on the Fly app returns `ok` with `supabase.configured = true`.
- The production domain serves the v2 web client and connects to the Fly server.
- A full PvP match and a PvE match complete against production.
- `npm run test:load` shows 100% connect success and stable server memory.
- CI is green; a push to `master` deploys both server and web automatically.
