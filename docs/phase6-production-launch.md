# Phase 6 — Production Launch Runbook

This is the operator runbook for taking TWCARDGAME v2 live. The repo-side artifacts
(config files, structured logging, load-test harness, CI/CD) are already committed.
The steps below need real accounts, credentials, and DNS access — execute them in order.

- **Web client** → Vercel (`apps/web`, built to `apps/web/dist-public`)
- **Game server** → Fly.io (`apps/server`, app `twcardgame-v2-server`, region `nrt`)
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
   fly apps create twcardgame-v2-server
   ```
2. Set secrets (these are **not** in the repo):
   ```bash
   fly secrets set \
     SUPABASE_URL=<prod-url> \
     SUPABASE_SERVICE_ROLE_KEY=<prod-service-role-key> \
     --app twcardgame-v2-server
   ```
   `NODE_ENV` and `PORT` are already set in `fly.toml [env]`.
3. First deploy — run from the **repo root** so the Docker build context includes
   `apps/` and `packages/`:
   ```bash
   flyctl deploy --config apps/server/fly.toml --dockerfile apps/server/Dockerfile --remote-only
   ```
4. Keep a single machine: `fly scale count 1 --app twcardgame-v2-server`.
5. Verify: `curl https://twcardgame-v2-server.fly.dev/health` returns
   `{"ok":true,...,"supabase":{"configured":true}}`.

---

## 3. Vercel — web client

1. Import the repository into Vercel. `vercel.json` at the repo root drives the
   build — leave the framework preset as "Other":
   - Install command: `npm install`
   - Build command: `npm run build -w @twcardgame/web`
   - Output directory: `apps/web/dist-public`
2. Set Environment Variables (Production scope) in the Vercel project:
   - `VITE_COLYSEUS_URL` = `wss://twcardgame-v2-server.fly.dev`
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
| `FLY_API_TOKEN` | `fly tokens create deploy --app twcardgame-v2-server` |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
| `VERCEL_ORG_ID` | Vercel project Settings (Org/Team ID) |
| `VERCEL_PROJECT_ID` | Vercel project Settings (Project ID) |

Add them under GitHub repo → Settings → Secrets and variables → Actions.

---

## 5. Load test

With the server running (Fly or local):

```bash
LOAD_TEST_URL=wss://twcardgame-v2-server.fly.dev \
LOAD_TEST_ROOMS=50 \
  npm run test:load
```

The script reports connect success rate, matches completed, and command
round-trip p50/p95. Watch server resources in parallel:

```bash
fly metrics --app twcardgame-v2-server   # or the Fly dashboard Metrics tab
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

- **Server**: `fly releases --app twcardgame-v2-server` lists prior releases;
  roll back with `fly deploy --image <previous-image-ref>` or
  `fly releases rollback` (or `fly machine update` to a known-good image).
- **Web**: in the Vercel dashboard, promote a previous deployment (instant
  rollback) — no rebuild required.
- **Whole-game fallback**: v1 is preserved verbatim under `LEGACY/` and is a
  standalone static app. If v2 has a critical issue, re-serve `LEGACY/` and revert
  the DNS record (step 8) to the v1 host.

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

## Done criteria

- `/health` on the Fly app returns `ok` with `supabase.configured = true`.
- The production domain serves the v2 web client and connects to the Fly server.
- A full PvP match and a PvE match complete against production.
- `npm run test:load` shows 100% connect success and stable server memory.
- CI is green; a push to `master` deploys both server and web automatically.
