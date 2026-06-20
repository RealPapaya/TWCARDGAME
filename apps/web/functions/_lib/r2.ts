/// <reference types="@cloudflare/workers-types" />

// Shared R2 asset handler for the Cloudflare Pages Functions that serve
// `/images/*`, `/audio/*`, `/video/*`. See docs/cloudflare-migration-roadmap.md
// Phase 4: the heavy media live in R2 (zero egress on Cloudflare's network), not
// in the Pages static deploy. The web sources keep their root-relative paths
// (`/images/...`) untouched — Pages routes those prefixes here (see _routes.json),
// everything else is served as a static asset with no function invocation.
//
// Files in `functions/_lib/` are NOT treated as routes by Pages (leading `_` is
// ignored), so this is a plain shared module the route files import.

export interface AssetEnv {
  // R2 bucket binding configured in apps/web/wrangler.jsonc.
  ASSETS_BUCKET: R2Bucket;
}

// Media is content-addressed by path and effectively immutable; if an asset ever
// changes, reference it under a new filename (or cache-bust at the call site).
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm"
};

function guessContentType(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

// Strip the query string so the edge cache key is stable per asset path.
function canonicalUrl(request: Request): string {
  const url = new URL(request.url);
  return url.origin + url.pathname;
}

/**
 * Serve a single R2 object as an HTTP response.
 *
 * - Plain full GETs are served from (and populate) the edge cache, so repeat hits
 *   never re-invoke R2 — keeping us well under the free Workers request budget.
 * - `Range` requests stream a partial body (206) so `<audio>`/`<video>` seeking
 *   works; `If-None-Match` / `If-Modified-Since` resolve to 304.
 */
export async function serveR2Asset(
  ctx: { request: Request; env: AssetEnv; waitUntil(promise: Promise<unknown>): void },
  key: string
): Promise<Response> {
  const { request, env } = ctx;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const hasRange = request.headers.has("range");
  const isConditional =
    request.headers.has("if-none-match") || request.headers.has("if-modified-since");

  const cache = caches.default;
  const cacheKey = new Request(canonicalUrl(request), { method: "GET" });

  // Only plain full GETs may use the edge cache (range / conditional responses vary).
  if (request.method === "GET" && !hasRange && !isConditional) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const object = await env.ASSETS_BUCKET.get(key, {
    onlyIf: isConditional ? request.headers : undefined,
    range: hasRange ? request.headers : undefined
  });

  if (!object) {
    return new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", IMMUTABLE_CACHE);
  headers.set("accept-ranges", "bytes");
  if (!headers.has("content-type")) headers.set("content-type", guessContentType(key));

  const bodied = object as R2ObjectBody;
  if (!bodied.body) {
    // A matched precondition returns no body → Not Modified.
    return new Response(null, { status: 304, headers });
  }

  let status = 200;
  const range = bodied.range as { offset?: number; length?: number } | undefined;
  if (hasRange && range && (range.offset !== undefined || range.length !== undefined)) {
    const offset = range.offset ?? 0;
    const length = range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    status = 206;
  } else {
    headers.set("content-length", String(object.size));
  }

  if (request.method === "HEAD") return new Response(null, { status, headers });

  const response = new Response(bodied.body, { status, headers });
  if (status === 200) {
    // Populate the edge cache off the request path so subsequent hits skip R2.
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

/** Derive the R2 object key from the request path (e.g. `/images/a b.webp` -> `images/a b.webp`). */
export function keyFromRequest(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ""));
}
