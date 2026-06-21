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

/** Warm one URL into the HTTP cache. Failures (404, offline) resolve, never reject. */
async function warm(url: string, signal: AbortSignal): Promise<void> {
  try {
    const res = await fetch(url, { cache: "force-cache", signal });
    // Drain the body so the response is fully committed to cache, then drop it.
    await res.arrayBuffer().catch(() => undefined);
  } catch {
    // Aborted, offline, or missing — the live `<img>`/`<audio>` request will
    // surface its own onerror fallback. Boot must not hang on one asset.
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

  // Fill the bar and let the final transition land before the menu takes over.
  if (splash?.bar) splash.bar.style.width = "100%";
  if (splash?.pct) splash.pct.textContent = "100%";
  await new Promise((r) => window.setTimeout(r, 180));

  // Clear the splash so startApp's first render writes into an empty #app (a
  // clean innerHTML set rather than morphing the splash subtree).
  splash?.root.remove();

  // The deferred tier keeps loading even if the player skipped the blocking one.
  startDeferredPrefetch(deferred);
}

let deferredStarted = false;
function startDeferredPrefetch(urls: string[]): void {
  if (deferredStarted || urls.length === 0) return;
  deferredStarted = true;
  // Fire-and-forget, never aborted: these only matter after audio unlock.
  void warmAll(urls, DEFERRED_CONCURRENCY, new AbortController().signal);
}
