# Deploying `@twcardgame/web` to Cloudflare Pages + R2

Phase 4 of the Cloudflare migration (see
[docs/cloudflare-migration-roadmap.md](../../docs/cloudflare-migration-roadmap.md)).
The static bundle (HTML/JS/CSS) is hosted on **Cloudflare Pages**; the heavy media
(`/images`, `/audio`, `/video` — ~129 MB) live in an **R2 bucket** and are streamed
by the Pages Functions in [`functions/`](functions/) (zero egress on Cloudflare's
network). The web sources keep their root-relative asset paths unchanged.

```
browser ──► Pages (dist-public: index.html, /assets/*.js, *.css)   static
        ├─► Pages Function /images/* /audio/* /video/*  ──► R2 bucket "twcardgame-assets"
        └─► wss:// VITE_REALTIME_URL ──► twcardgame-realtime Worker (separate deploy)
```

`_routes.json` (emitted by the Vite build) scopes Functions to those three media
prefixes only, so every other request is served as a plain static asset with **no**
function invocation. The Vite build does **not** copy `public/` into the deploy
(`build.copyPublicDir: false`); the dev server still serves it from disk, so local
play is unchanged.

## One-time setup

```bash
# 1. Authenticate wrangler (opens a browser).
npx wrangler login

# 2. Create the R2 bucket the Pages Functions read from.
npm run assets:bucket -w @twcardgame/web        # wrangler r2 bucket create twcardgame-assets

# 3. Create the Pages project (first deploy below also creates it if missing).
#    In the Cloudflare dashboard set the production env vars (Settings ->
#    Environment variables): VITE_REALTIME_URL=wss://<your-worker-host>,
#    VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY. These are baked in at BUILD time,
#    so they must be present wherever `npm run build` runs (CI / your machine).
```

## Upload the media to R2

Run after assets change (idempotent — overwrites by key):

```bash
npm run assets:upload -w @twcardgame/web        # node scripts/upload-assets.mjs
npm run assets:upload -w @twcardgame/web -- --dry-run   # preview keys + content-types
```

Keys mirror `public/` (e.g. `public/images/a.webp` → `images/a.webp`). For a faster
bulk sync, point [`rclone`](https://rclone.org/s3/) at R2's S3 endpoint
(`https://<account-id>.r2.cloudflarestorage.com`) and
`rclone copy public/images r2:twcardgame-assets/images` (etc.).

## Build & deploy the frontend

```bash
# Build from the repo root so VITE_* env vars are inlined.
npm run build                                   # tsc -b + vite build -> apps/web/dist-public
npm run pages:deploy -w @twcardgame/web         # wrangler pages deploy (reads wrangler.jsonc)
```

`wrangler.jsonc` binds the R2 bucket (`ASSETS_BUCKET`) and sets
`pages_build_output_dir: dist-public`. Add a custom domain in the Pages project's
**Custom domains** tab.

## Verify

- `dist-public/` after a build contains the JS/CSS bundle, `_routes.json`,
  `_headers`, and the two HTML entry points — **no** `images/audio/video/`.
- `https://<pages-domain>/images/card_back.webp` returns the asset from R2 with
  `cache-control: public, max-age=31536000, immutable`.
- The game loads, plays, and animates (run the `twcardgame-visual-qa` skill).
