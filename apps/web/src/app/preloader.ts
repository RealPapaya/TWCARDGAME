import { assetManifest } from "virtual:asset-manifest";

// Boot-time asset preloader.
//
// The user is happy to wait at a loading screen in exchange for a flicker-free
// session afterwards (any element on any page should display immediately once
// past boot). So we warm the browser's HTTP cache with `fetch()` before the menu
// renders. We do NOT keep the decoded bytes alive (that would pin ~20MB+ of
// bitmaps in memory on mobile) — warming the cache is enough that the later
// `<img src>` / `background-image` / `new Audio()` loads from disk, not network.
//
// Tiering keeps the wait honest:
//   • Blocking  — every image + the small SFX clips. These are the "elements" the
//     user means: visual UI/cards/backgrounds plus the click sounds. ~20MB.
//   • Deferred  — BGM tracks (~32MB) and the mode video. Heavy, and only needed
//     after the first user gesture unlocks audio, so they prefetch in the
//     background once the menu is up and never gate the loading screen.

const BLOCKING_CONCURRENCY = 8;
const DEFERRED_CONCURRENCY = 3;
// After this long the loading screen offers a "skip" affordance so a player on a
// poor connection is never trapped — the deferred prefetch still finishes later.
const SKIP_AFFORDANCE_DELAY_MS = 10_000;
// Hard cap per asset fetch. A request that never settles (server accepts the
// connection but never responds) would otherwise keep its worker — and the whole
// loading screen — hung forever unless the player clicks skip. Bounding each fetch
// guarantees warmAll() always resolves, so boot proceeds with or without skip.
const PER_ASSET_TIMEOUT_MS = 8_000;

type SplashElements = {
  root: HTMLElement;
  bar: HTMLElement | null;
  pct: HTMLElement | null;
  skip: HTMLElement | null;
};

function findSplash(): SplashElements | undefined {
  const root = document.getElementById("preload-screen");
  if (!root) return undefined;
  return {
    root,
    bar: document.getElementById("preload-bar"),
    pct: document.getElementById("preload-pct"),
    skip: document.getElementById("preload-skip")
  };
}

/** Warm one URL into the HTTP cache. Failures (404, offline, timeout) resolve, never reject. */
async function warm(url: string, signal: AbortSignal): Promise<void> {
  // Per-asset abort: fires on the outer `signal` (skip / overall abort) OR after
  // PER_ASSET_TIMEOUT_MS, whichever comes first. Aborting only this controller
  // skips the slow asset without stopping the rest of the pool (the outer signal,
  // not this one, is what warmAll checks to halt entirely).
  const local = new AbortController();
  const onOuterAbort = (): void => local.abort();
  if (signal.aborted) local.abort();
  else signal.addEventListener("abort", onOuterAbort, { once: true });
  const timer = window.setTimeout(() => local.abort(), PER_ASSET_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: "force-cache", signal: local.signal });
    // Drain the body so the response is fully committed to cache, then drop it.
    await res.arrayBuffer().catch(() => undefined);
  } catch {
    // Aborted (timeout/skip), offline, or missing — the live `<img>`/`<audio>`
    // request will surface its own onerror fallback. Boot must not hang on one asset.
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * Run `urls` through a fixed-size worker pool, invoking `onSettled` after each
 * one finishes (in any order). Resolves when all have settled or `signal` aborts.
 */
async function warmAll(
  urls: string[],
  concurrency: number,
  signal: AbortSignal,
  onSettled?: () => void
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < urls.length && !signal.aborted) {
      const url = urls[cursor++];
      await warm(url, signal);
      onSettled?.();
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
  await Promise.all(workers);
}

/**
 * Block on visual assets + SFX behind the loading screen, then kick off a
 * background prefetch of BGM + video. Resolves once the blocking tier is done (or
 * the player skips). Safe to call when no splash markup exists — it just warms.
 */
export async function preloadAssets(): Promise<void> {
  if (typeof fetch !== "function") return;

  const splash = findSplash();
  const blocking = [...assetManifest.images, ...assetManifest.audioSfx];
  const deferred = [...assetManifest.audioBgm, ...assetManifest.video];

  if (blocking.length === 0) {
    startDeferredPrefetch(deferred);
    return;
  }

  const controller = new AbortController();
  let done = 0;
  const total = blocking.length;

  const paint = (): void => {
    const ratio = total === 0 ? 1 : done / total;
    const pct = Math.min(100, Math.round(ratio * 100));
    if (splash?.bar) splash.bar.style.width = `${pct}%`;
    if (splash?.pct) splash.pct.textContent = `${pct}%`;
  };
  paint();

  let skipTimer: number | undefined;
  if (splash?.skip) {
    const skipEl = splash.skip;
    skipTimer = window.setTimeout(() => {
      skipEl.classList.add("preload-skip-visible");
    }, SKIP_AFFORDANCE_DELAY_MS);
    skipEl.addEventListener(
      "click",
      () => {
        // Stop blocking; let whatever has loaded suffice and continue in the
        // background. controller.abort() ends the blocking pool early.
        controller.abort();
      },
      { once: true }
    );
  }

  await warmAll(blocking, BLOCKING_CONCURRENCY, controller.signal, () => {
    done++;
    paint();
  });

  if (skipTimer !== undefined) window.clearTimeout(skipTimer);

  // Fill the bar to 100%. The splash is intentionally NOT removed here: startApp
  // keeps it up while it loads the player's account data (collection/decks), then
  // calls dismissSplash() so the menu never flashes in with an empty collection.
  if (splash?.bar) splash.bar.style.width = "100%";
  if (splash?.pct) splash.pct.textContent = "100%";

  // The deferred tier keeps loading even if the player skipped the blocking one.
  startDeferredPrefetch(deferred);
}

/**
 * Remove the boot splash. Called by startApp once the initial account data is
 * loaded (or a boot timeout fires) so the first menu render writes into an empty
 * #app. Idempotent and safe to call when no splash markup exists.
 */
export async function dismissSplash(): Promise<void> {
  const root = document.getElementById("preload-screen");
  if (!root) return;
  // Let the final 100% bar state land before the menu takes over.
  await new Promise((r) => window.setTimeout(r, 180));
  root.remove();
}

let deferredStarted = false;
function startDeferredPrefetch(urls: string[]): void {
  if (deferredStarted || urls.length === 0) return;
  deferredStarted = true;
  // Fire-and-forget, never aborted: these only matter after audio unlock.
  void warmAll(urls, DEFERRED_CONCURRENCY, new AbortController().signal);
}
