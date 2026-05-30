/**
 * E2E: Reconnect flow validation (Playwright, plain ESM)
 *
 * Prerequisites:
 *   Vite dev server  → http://localhost:5173
 *   Colyseus server  → ws://localhost:2567
 *
 * For Scenario 3 (timeout), start the server with:
 *   RECONNECT_WINDOW_MS=5000 npm run dev:server
 * The test waits ~7 seconds; with the default 30 s window it would wait ~32 s.
 *
 * Scenarios:
 *   1. Disconnect detected — P1 sees connected=false in public state after P2 closes
 *   2. Reconnect restores state — P2 rejoins, receives hand and active turn info
 *   3. Timeout → game over — P1 sees GAME_FINISHED after reconnect window expires
 *   4. Cumulative budget — the reconnect window is a one-time per-seat allowance;
 *      a second disconnect resumes from the remaining budget, it does not reset.
 *      Run this one against the DEFAULT 30 s window (no RECONNECT_WINDOW_MS override).
 */

import { chromium } from "playwright";

const WEB_URL = process.env.WEB_URL || "http://localhost:5173";
const SERVER_URL = process.env.SERVER_URL || "";
const TIMEOUT = 30_000;

function log(tag, msg) { console.log(`[${tag}] ${msg}`); }

function devAuthUrl(extra = "") {
  return WEB_URL + (WEB_URL.indexOf("?") === -1 ? "?" : "&") + "auth=dev" + extra;
}

// ─── event accumulator (same as game-loop.spec.mjs) ─────────────────────────
const INIT_SCRIPT = `
(function () {
  var ALL_TYPES = [
    "CARD_PLAYED","MINION_SUMMONED","ATTACK_RESOLVED","DAMAGE_DEALT",
    "MINION_DIED","MATCH_ENDED","TURN_STARTED","TURN_ENDED",
    "MULLIGAN_SUBMITTED","COMMAND_REJECTED","CARD_DRAWN","GAME_FINISHED"
  ];
  window.__el = [];
  window.__eq = 0;
  var seen = new Set();
  function scanAdded() {
    var ps = document.querySelectorAll("#history-list p, p");
    for (var k = 0; k < ps.length; k++) {
      var text = ps[k].textContent || "";
      if (seen.has(text)) continue;
      seen.add(text);
      for (var i = 0; i < ALL_TYPES.length; i++) {
        if (text.indexOf(ALL_TYPES[i]) === 0) {
          window.__el.push({ type: ALL_TYPES[i], seq: ++window.__eq });
        }
      }
    }
  }
  var obs = new MutationObserver(scanAdded);
  function start() {
    var app = document.querySelector("#app");
    if (app) obs.observe(app, { childList: true, subtree: true, characterData: true });
    else setTimeout(start, 50);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
`;

async function injectEventAccumulator(page) {
  await page.addInitScript(INIT_SCRIPT);
}

async function snap(page) {
  return page.evaluate(() => window.__el ? window.__el.length : 0);
}

async function waitEvent(page, eventType, after, tag) {
  await page.waitForFunction(
    (args) => { var l = window.__el || []; for (var i = args[1]; i < l.length; i++) if (l[i].type === args[0]) return true; return false; },
    [eventType, after],
    { timeout: TIMEOUT }
  );
  log(tag, "event: " + eventType);
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function joinAndMulligan(p, name) {
  await p.goto(devAuthUrl());
  await p.waitForSelector("#join-form");
  if (SERVER_URL) await p.fill("#server-url", SERVER_URL);
  await p.fill("#display-name", name);
  await p.click("#join-form button");
  await p.waitForSelector("#mulligan", { timeout: TIMEOUT });
  await p.click("#mulligan");
}

async function waitForTurnStarted(p, tag) {
  await waitEvent(p, "TURN_STARTED", 0, tag);
  await p.waitForTimeout(500);
}

async function getReconnectToken(page) {
  return page.evaluate(() => window.__room && window.__room.reconnectionToken);
}

async function getConnectedStatus(page, side) {
  return page.evaluate((s) => {
    var st = window.__gameState;
    if (!st) return null;
    var player = st.players && st.players.get ? st.players.get(s) : (st.players && st.players[s]) || st[s];
    return player ? player.connected : null;
  }, side);
}

async function getReconnectUntilMs(page, side) {
  return page.evaluate((s) => {
    var st = window.__gameState;
    if (!st) return null;
    var player = st.players && st.players.get ? st.players.get(s) : (st.players && st.players[s]) || st[s];
    return player ? player.reconnectUntilMs : null;
  }, side);
}

// ─── main ───────────────────────────────────────────────────────────────────

(async function () {
  var passed = 0, failed = 0, results = [];
  function pass(name) { passed++; results.push("  ✓  " + name); }
  function fail(name, err) { failed++; results.push("  ✗  " + name + ": " + (err && err.message ? err.message : String(err))); }

  // ══════════════════════════════════════════════════════════════
  // SCENARIO 1 + 2: Disconnect detected, then reconnect restores state
  // ══════════════════════════════════════════════════════════════
  log("S1+S2", "Starting disconnect + reconnect scenario");
  {
    var browser = await chromium.launch({ headless: false, slowMo: 150 });
    var ctx1 = await browser.newContext();
    var ctx2 = await browser.newContext();
    var p1 = await ctx1.newPage();
    var p2 = await ctx2.newPage();
    p1.on("pageerror", (e) => console.error("[P1]", e.message));
    p2.on("pageerror", (e) => console.error("[P2]", e.message));
    await injectEventAccumulator(p1);
    await injectEventAccumulator(p2);

    try {
      await Promise.all([joinAndMulligan(p1, "Alice"), joinAndMulligan(p2, "Bob")]);
      await Promise.all([waitForTurnStarted(p1, "P1"), waitForTurnStarted(p2, "P2")]);
      pass("S1+S2: Both players joined and game started");

      // Capture P2 reconnect token before closing
      var token = await getReconnectToken(p2);
      log("S2", "reconnection token: " + (token ? token.slice(0, 20) + "…" : "MISSING"));

      if (!token) {
        fail("S1+S2 setup", new Error("reconnectionToken not available on window.__room"));
      } else {
        // Determine P2's seat
        var p2Seat = await p2.evaluate(() => {
          var t = (document.querySelector(".topbar p") || {}).textContent || "";
          var m = t.match(/(player\d)/);
          return m ? m[1] : "";
        });
        log("S2", "P2 seat: " + p2Seat);

        // ── Scenario 1: close P2, P1 sees connected=false ─────────────────
        log("S1", "Closing P2 page...");
        await p2.close();
        await p1.waitForTimeout(2000); // allow server to process disconnect

        var connected = await getConnectedStatus(p1, p2Seat);
        log("S1", "P2 connected=" + connected + " (via P1 state)");
        if (connected === false) pass("Scenario 1: P1 sees opponent connected=false after disconnect");
        else fail("Scenario 1: connected flag not false (got " + connected + ")");

        // ── Scenario 2: reconnect, state restored ──────────────────────────
        log("S2", "Reconnecting P2 via token...");
        var p2b = await ctx2.newPage();
        p2b.on("pageerror", (e) => console.error("[P2b]", e.message));
        await injectEventAccumulator(p2b);
        await p2b.goto(devAuthUrl("&reconnect=" + encodeURIComponent(token)));
        await p2b.waitForSelector("#join-form");
        if (SERVER_URL) await p2b.fill("#server-url", SERVER_URL);
        await p2b.click("#join-form button"); // triggers joinRoom which detects ?reconnect
        await p2b.waitForTimeout(3000);

        // Check P2 has hand cards (private state restored)
        var handCount = await p2b.evaluate(() => document.querySelectorAll(".hand .card").length);
        log("S2", "P2 hand cards visible: " + handCount);
        if (handCount > 0) pass("Scenario 2: Reconnected P2 receives private hand");
        else fail("Scenario 2: No hand cards after reconnect (handCount=" + handCount + ")");

        // Check P1 sees P2 connected again
        await p1.waitForTimeout(1000);
        var connectedAfter = await getConnectedStatus(p1, p2Seat);
        log("S2", "P2 connected after reconnect=" + connectedAfter);
        if (connectedAfter === true) pass("Scenario 2: P1 sees opponent connected=true after reconnect");
        else fail("Scenario 2: connected flag not restored (got " + connectedAfter + ")");

        await p2b.close();
      }
    } catch (err) {
      fail("S1+S2 unexpected", err);
      console.error(err);
    }

    await browser.close();
  }

  // ══════════════════════════════════════════════════════════════
  // SCENARIO 3: Timeout → GAME_FINISHED on remaining player
  // (requires server started with RECONNECT_WINDOW_MS=5000)
  // ══════════════════════════════════════════════════════════════
  log("S3", "Starting timeout scenario (server must use RECONNECT_WINDOW_MS=5000)");
  {
    var browser3 = await chromium.launch({ headless: false, slowMo: 150 });
    var ctx3a = await browser3.newContext();
    var ctx3b = await browser3.newContext();
    var q1 = await ctx3a.newPage();
    var q2 = await ctx3b.newPage();
    q1.on("pageerror", (e) => console.error("[Q1]", e.message));
    q2.on("pageerror", (e) => console.error("[Q2]", e.message));
    await injectEventAccumulator(q1);
    await injectEventAccumulator(q2);

    try {
      await Promise.all([joinAndMulligan(q1, "Charlie"), joinAndMulligan(q2, "Dana")]);
      await Promise.all([waitForTurnStarted(q1, "Q1"), waitForTurnStarted(q2, "Q2")]);

      var ck1 = await snap(q1);
      log("S3", "Closing Q2 to trigger timeout...");
      await q2.close();

      // Wait for GAME_FINISHED (server timeout window + buffer)
      // With RECONNECT_WINDOW_MS=5000 this should fire in ~5 s; with 60 s it takes ~62 s.
      await waitEvent(q1, "GAME_FINISHED", ck1, "Q1");
      pass("Scenario 3: GAME_FINISHED received after disconnect timeout");

      // Verify status is finished in public state
      await q1.waitForFunction(() => {
        var el = document.querySelector(".status");
        return el && /Status:\s*(finished|abandoned)/.test(el.textContent || "");
      }, { timeout: TIMEOUT });
      var status = await q1.evaluate(() => {
        var el = document.querySelector(".status");
        return el ? el.textContent : "";
      });
      log("S3", "status text: " + status);
      if (status && status.includes("finished")) pass("Scenario 3: Game status shows finished");
      else fail("Scenario 3: Status does not show finished (got: " + status + ")");

    } catch (err) {
      fail("S3 unexpected", err);
      console.error(err);
    }

    await browser3.close();
  }

  // ══════════════════════════════════════════════════════════════
  // SCENARIO 4: Cumulative reconnect budget (run with DEFAULT 30 s window)
  // Disconnect, reconnect after a few seconds, disconnect again, then verify the
  // remaining budget the second time is clearly less than a fresh 30 s — proving
  // the window is a one-time allowance and not reset on each disconnect.
  // ══════════════════════════════════════════════════════════════
  log("S4", "Starting cumulative-budget scenario (server must use DEFAULT 30s window)");
  {
    var browser4 = await chromium.launch({ headless: false, slowMo: 150 });
    var ctx4a = await browser4.newContext();
    var ctx4b = await browser4.newContext();
    var r1 = await ctx4a.newPage();
    var r2 = await ctx4b.newPage();
    r1.on("pageerror", (e) => console.error("[R1]", e.message));
    r2.on("pageerror", (e) => console.error("[R2]", e.message));
    await injectEventAccumulator(r1);
    await injectEventAccumulator(r2);

    try {
      await Promise.all([joinAndMulligan(r1, "Erin"), joinAndMulligan(r2, "Frank")]);
      await Promise.all([waitForTurnStarted(r1, "R1"), waitForTurnStarted(r2, "R2")]);

      var r2Seat = await r2.evaluate(() => {
        var t = (document.querySelector(".topbar p") || {}).textContent || "";
        var m = t.match(/(player\d)/);
        return m ? m[1] : "";
      });
      var token4 = await getReconnectToken(r2);
      if (!token4) {
        fail("S4 setup", new Error("reconnectionToken not available"));
      } else {
        // First disconnect, stay away ~6 s, then reconnect (spends ~6 s of budget).
        var GAP_MS = 6000;
        log("S4", "First disconnect of R2...");
        await r2.close();
        await r1.waitForTimeout(GAP_MS);

        var r2b = await ctx4b.newPage();
        r2b.on("pageerror", (e) => console.error("[R2b]", e.message));
        await injectEventAccumulator(r2b);
        await r2b.goto(devAuthUrl("&reconnect=" + encodeURIComponent(token4)));
        await r2b.waitForSelector("#join-form");
        if (SERVER_URL) await r2b.fill("#server-url", SERVER_URL);
        await r2b.click("#join-form button");
        await r2b.waitForTimeout(2500);

        // Second disconnect — read remaining budget from R1's view of R2.
        var token4b = await getReconnectToken(r2b);
        log("S4", "Second disconnect of R2...");
        await r2b.close();
        await r1.waitForTimeout(2000);

        var untilMs = await getReconnectUntilMs(r1, r2Seat);
        var remaining = (typeof untilMs === "number" && untilMs > 0) ? untilMs - Date.now() : null;
        log("S4", "remaining budget on 2nd disconnect ≈ " + remaining + "ms");
        // A fresh window would be ~30 s; cumulative should leave well under ~26 s.
        if (remaining !== null && remaining < 26000) {
          pass("Scenario 4: second disconnect resumes from remaining budget (cumulative)");
        } else {
          fail("Scenario 4: budget appears reset (remaining=" + remaining + "ms, token4b=" + Boolean(token4b) + ")");
        }
      }
    } catch (err) {
      fail("S4 unexpected", err);
      console.error(err);
    }

    await browser4.close();
  }

  // ─── results ────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════");
  console.log("  Playwright E2E — Reconnect Results");
  console.log("══════════════════════════════════════════");
  for (var r of results) console.log(r);
  console.log("──────────────────────────────────────────");
  console.log("  Total: " + (passed + failed) + "  Passed: " + passed + "  Failed: " + failed);
  console.log("══════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
})();
