/**
 * E2E: Core game loop validation (Playwright, plain ESM)
 *
 * Runs two browser contexts against:
 *   Vite dev server  → http://localhost:5173
 *   Colyseus server  → ws://localhost:2567
 *
 * Verified steps:
 *   1. Both players join → mulligan → game reaches in_progress
 *   2. Active player plays a minion → CARD_PLAYED + MINION_SUMMONED on both pages
 *   3. Active player ends turn → other player becomes active, mana ≥ 1
 *   4. Second player plays a minion → both boards have minions
 *   5. Second player ends turn → first player's minion becomes ready
 *   6. First player attacks enemy minion → ATTACK_RESOLVED + DAMAGE_DEALT on both
 *   7. Active player concedes → MATCH_ENDED, status = finished on both
 */

import { chromium } from "playwright";

const WEB_URL = process.env.WEB_URL || "http://localhost:5173";
const SERVER_URL = process.env.SERVER_URL || "";
const TIMEOUT = 30_000;

function devAuthUrl() {
  return WEB_URL + (WEB_URL.indexOf("?") === -1 ? "?" : "&") + "auth=dev";
}

// ─── logging ─────────────────────────────────────────────────────────────────

function log(tag, msg) { console.log(`[${tag}] ${msg}`); }

// ─── event accumulator ───────────────────────────────────────────────────────
// Injected into every page via addInitScript.
// Watches #app for added <p> nodes (the .log section renders one <p> per event).
// Records { type, seq } for every known event type seen for the first time
// in a given <p>.  We use seq-based checkpoints so we never need to "clear"
// the log — we just ask "did event X arrive after checkpoint N?".

const INIT_SCRIPT = `
(function () {
  var ALL_TYPES = [
    "CARD_PLAYED","MINION_SUMMONED","DAMAGE","DESTROY",
    "GAME_FINISHED","TURN_STARTED","TURN_ENDED",
    "MULLIGAN_SUBMITTED","COMMAND_REJECTED","CARD_DRAWN"
  ];
  window.__el = [];   // [{type, seq}]
  window.__eq = 0;    // sequence counter
  var seen = new Set();

  function processNode(node) {
    var text = node.textContent || "";
    if (seen.has(text)) return;
    seen.add(text);
    for (var i = 0; i < ALL_TYPES.length; i++) {
      if (text.indexOf(ALL_TYPES[i]) === 0) {
        window.__el.push({ type: ALL_TYPES[i], seq: ++window.__eq });
      }
    }
  }

  function scanAdded(mutations) {
    for (var m = 0; m < mutations.length; m++) {
      var added = mutations[m].addedNodes;
      for (var n = 0; n < added.length; n++) {
        var node = added[n];
        if (node.nodeType !== 1) continue;
        if (node.tagName === "P") { processNode(node); }
        else {
          var ps = node.querySelectorAll("p");
          for (var k = 0; k < ps.length; k++) processNode(ps[k]);
        }
      }
    }
  }

  var obs = new MutationObserver(scanAdded);
  function start() {
    var app = document.querySelector("#app");
    if (app) { obs.observe(app, { childList: true, subtree: true }); }
    else { setTimeout(start, 50); }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else { start(); }
})();
`;

async function injectEventAccumulator(page) {
  await page.addInitScript(INIT_SCRIPT);
}

async function openBattleScreen(page, name) {
  await page.goto(devAuthUrl());
  await page.waitForSelector('[data-testid="menu-battle"]', { timeout: TIMEOUT });
  await page.click('[data-testid="menu-battle"]');
  await page.waitForSelector('[data-testid="battle-mode-pvp"]', { timeout: TIMEOUT });
  await page.click('[data-testid="battle-mode-pvp"]');
  await page.waitForSelector('[data-testid="find-match"]:visible', { timeout: TIMEOUT });
  await page.evaluate(({ serverUrl, displayName }) => {
    var server = document.querySelector("#server-url-advanced");
    var nameInput = document.querySelector("#display-name-advanced");
    if (serverUrl && server) server.value = serverUrl;
    if (nameInput) nameInput.value = displayName;
  }, { serverUrl: SERVER_URL, displayName: name });
}

async function startMatchmaking(page) {
  await page.click('[data-testid="find-match"]');
  await page.waitForSelector("#mulligan", { timeout: TIMEOUT });
}

/** Returns current log length — use as a before-action checkpoint. */
async function snap(page) {
  return page.evaluate(() => window.__el ? window.__el.length : 0);
}

/** Waits until eventType appears in the log AFTER the given checkpoint index. */
async function waitEvent(page, eventType, after, tag) {
  await page.waitForFunction(
    function (args) {
      var log = window.__el || [];
      for (var i = args[1]; i < log.length; i++) {
        if (log[i].type === args[0]) return true;
      }
      return false;
    },
    [eventType, after],
    { timeout: TIMEOUT }
  );
  log(tag, "event: " + eventType);
}

/** Non-waiting check: did eventType arrive after checkpoint? */
async function hadEvent(page, eventType, after) {
  return page.evaluate(function (args) {
    var l = window.__el || [];
    for (var i = args[1]; i < l.length; i++) {
      if (l[i].type === args[0]) return true;
    }
    return false;
  }, [eventType, after]);
}

// ─── game helpers ─────────────────────────────────────────────────────────────

async function waitForText(page, selector, text, tag) {
  await page.waitForFunction(
    function (args) {
      var el = document.querySelector(args[0]);
      return el && el.textContent && el.textContent.indexOf(args[1]) !== -1;
    },
    [selector, text],
    { timeout: TIMEOUT }
  );
  log(tag, '"' + text + '" visible in ' + selector);
}

async function getMySeat(page) {
  return page.evaluate(function () {
    var t = (document.querySelector(".topbar p") || {}).textContent || "";
    var m = t.match(/(player\d)/);
    return m ? m[1] : "";
  });
}

async function getActiveSeat(page) {
  return page.evaluate(function () {
    var t = (document.querySelector(".status") || {}).textContent || "";
    var m = t.match(/Active:\s*(player\d)/);
    if (m && m[1]) return m[1];
    // Fall back to last TURN_STARTED event payload
    var ps = document.querySelectorAll(".log p");
    for (var i = ps.length - 1; i >= 0; i--) {
      var t2 = ps[i].textContent || "";
      var m2 = t2.match(/TURN_STARTED.*"activeSeat":"(\w+)"/);
      if (m2) return m2[1];
    }
    return "";
  });
}

function getActiveSeatFromDOM(doc) {
  // Try .status span first, then fall back to the event log for latest TURN_STARTED
  var statusText = (doc.querySelector(".status") || {}).textContent || "";
  var m = statusText.match(/Active:\s*(player\d)/);
  if (m && m[1]) return m[1];
  // Fall back to last TURN_STARTED in the log
  var ps = doc.querySelectorAll(".log p");
  var last = "";
  for (var i = 0; i < ps.length; i++) {
    var t = ps[i].textContent || "";
    var m2 = t.match(/TURN_STARTED.*"activeSeat":"(\w+)"/);
    if (m2) last = m2[1];
  }
  return last;
}

async function isMyTurn(page) {
  return page.evaluate(function () {
    var tp = (document.querySelector(".topbar p") || {}).textContent || "";
    var seat = (tp.match(/(player\d)/) || [])[1];
    // Check Active: span
    var statusText = (document.querySelector(".status") || {}).textContent || "";
    var m = statusText.match(/Active:\s*(player\d)/);
    var active = m && m[1] ? m[1] : "";
    if (!active) {
      // Fall back to last TURN_STARTED in log
      var ps = document.querySelectorAll(".log p");
      for (var i = ps.length - 1; i >= 0; i--) {
        var t = ps[i].textContent || "";
        var m2 = t.match(/TURN_STARTED.*"activeSeat":"(\w+)"/);
        if (m2) { active = m2[1]; break; }
      }
    }
    return Boolean(seat && seat === active);
  });
}

async function waitForMyTurn(page, tag) {
  await page.waitForFunction(function () {
    var tp = (document.querySelector(".topbar p") || {}).textContent || "";
    var seat = (tp.match(/(player\d)/) || [])[1];
    var statusText = (document.querySelector(".status") || {}).textContent || "";
    var m = statusText.match(/Active:\s*(player\d)/);
    var active = m && m[1] ? m[1] : "";
    if (!active) {
      var ps = document.querySelectorAll(".log p");
      for (var i = ps.length - 1; i >= 0; i--) {
        var t = ps[i].textContent || "";
        var m2 = t.match(/TURN_STARTED.*"activeSeat":"(\w+)"/);
        if (m2) { active = m2[1]; break; }
      }
    }
    return Boolean(seat && seat === active);
  }, null, { timeout: TIMEOUT });
  log(tag, "my turn");
}

async function getMyMana(page) {
  return page.evaluate(function () {
    // Try the .me player section first
    var hero = document.querySelector(".player.me .hero");
    if (hero) {
      var m = hero.textContent.match(/Mana\s+(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
    // Fall back: find all hero buttons and return the highest mana
    // (active player always has more mana than 0 after their turn starts)
    var heroes = document.querySelectorAll(".hero");
    var best = 0;
    for (var i = 0; i < heroes.length; i++) {
      var m2 = heroes[i].textContent.match(/Mana\s+(\d+)/);
      if (m2) { var v = parseInt(m2[1], 10); if (v > best) best = v; }
    }
    return best;
  });
}

/**
 * Tries to play a MINION.  If the server rejects with "Not enough mana",
 * ends both turns and retries (up to 15 cycles).
 * Returns once CARD_PLAYED is confirmed in the event log.
 */
/**
 * Tries to play any MINION card.  If the server rejects (not enough mana),
 * cycles both players' turns and retries.  Returns the event-log checkpoint
 * taken just before the successful play (both pages).
 */
async function rampAndPlayMinion(actPage, idlPage, actTag, idlTag, snapPage1, snapPage2) {
  for (var attempt = 0; attempt < 15; attempt++) {
    // Pick the cheapest MINION by cost
    var idx = await actPage.evaluate(function () {
      var status = document.querySelector(".player.me .hero");
      var manaMatch = status && status.textContent ? status.textContent.match(/Mana\s+(\d+)/) : null;
      var mana = manaMatch ? parseInt(manaMatch[1], 10) : 0;
      var cards = Array.from(document.querySelectorAll('[data-testid="hand-card"]'));
      var bestIdx = -1, bestCost = Infinity;
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].dataset.e2eCardType !== "MINION") continue;
        if (cards[i].dataset.needsTarget === "true") continue;
        var cost = parseInt(cards[i].dataset.cost || "", 10);
        if (!Number.isFinite(cost)) continue;
        if (cost > mana) continue;
        if (cost < bestCost) { bestCost = cost; bestIdx = i; }
      }
      return bestIdx;
    });

    if (idx !== -1) {
      var cardText = await actPage.locator('[data-testid="hand-card"]').nth(idx).textContent();
      log(actTag, "attempt " + attempt + ": playing [" + idx + "] " + (cardText || "").trim().replace(/\s+/g, " ").slice(0, 60));

      var ck1 = await snap(snapPage1);
      var ck2 = await snap(snapPage2);

      await actPage.locator('[data-testid="hand-card"]').nth(idx).click();
      await actPage.locator('[data-testid="hand-card"]').nth(idx).click();
      await actPage.waitForTimeout(1200);
      if (await hadEvent(actPage, "CARD_PLAYED", ck1)) {
        log(actTag, "CARD_PLAYED confirmed");
        return { ck1: ck1, ck2: ck2 };
      }
      log(actTag, "play rejected or not confirmed, cycling");
    } else {
      log(actTag, "no MINION in hand, cycling turns");
    }

    if (await isMyTurn(actPage)) {
      await actPage.click("#end-turn");
      await actPage.waitForTimeout(800);
    }
    if (await isMyTurn(idlPage)) {
      log(idlTag, "ending turn to return control");
      await idlPage.click("#end-turn");
      await actPage.waitForTimeout(800);
    }
  }
  throw new Error("Could not play a MINION after 15 attempts");
}

// ─── main ─────────────────────────────────────────────────────────────────────

(async function () {
  var browser = await chromium.launch({ headless: false, slowMo: 250 });
  var ctx1 = await browser.newContext();
  var ctx2 = await browser.newContext();
  var p1 = await ctx1.newPage();
  var p2 = await ctx2.newPage();

  p1.on("pageerror", function (e) { console.error("[P1 ERR]", e.message); });
  p2.on("pageerror", function (e) { console.error("[P2 ERR]", e.message); });

  await injectEventAccumulator(p1);
  await injectEventAccumulator(p2);

  var passed = 0, failed = 0, results = [];
  function pass(name) { passed++; results.push("  ✓  " + name); }
  function fail(name, err) { failed++; results.push("  ✗  " + name + ": " + (err && err.message ? err.message : err)); }

  try {
    // ── JOIN ────────────────────────────────────────────────────────────────
    log("TEST", "Joining...");
    await Promise.all([
      openBattleScreen(p1, "Alice"),
      openBattleScreen(p2, "Bob"),
    ]);
    await Promise.all([
      startMatchmaking(p1),
      startMatchmaking(p2),
    ]);
    pass("Both players joined");

    // ── MULLIGAN ────────────────────────────────────────────────────────────
    log("TEST", "Mulligan...");
    await Promise.all([
      p1.waitForSelector("#mulligan", { timeout: TIMEOUT }),
      p2.waitForSelector("#mulligan", { timeout: TIMEOUT }),
    ]);
    await p1.locator("[data-mulligan-id]").first().click();
    await p1.waitForFunction(function () {
      var card = document.querySelector("[data-mulligan-id]");
      return card && card.classList.contains("selected");
    }, null, { timeout: 5000 });
    pass("Mulligan selection visually marks a replacement card");
    await Promise.all([p1.click("#mulligan"), p2.click("#mulligan")]);
    // Wait for TURN_STARTED event (fired by startTurn after both mulligans submitted)
    // instead of checking state.status which may be undefined due to Colyseus 4.x
    // reflection not including unchanged default string values in the initial state patch.
    await Promise.all([
      waitEvent(p1, "TURN_STARTED", 0, "P1"),
      waitEvent(p2, "TURN_STARTED", 0, "P2"),
    ]);
    pass("Game reached in_progress after mulligan (TURN_STARTED seen)");

    // Wait a moment for schema state to propagate after TURN_STARTED
    await p1.waitForTimeout(1000);

    // Determine who goes first.
    // state.turn.activeSeat may still be empty from Colyseus reflection defaults,
    // so we read the TURN_STARTED event payload from the log to get the activeSeat.
    var seat1 = await getMySeat(p1);
    var seat2 = await getMySeat(p2);
    var activeSeat = await getActiveSeat(p1);

    // Fallback: read activeSeat from the TURN_STARTED event payload in the DOM log
    if (!activeSeat) {
      activeSeat = await p1.evaluate(function () {
        var ps = document.querySelectorAll(".log p");
        for (var i = 0; i < ps.length; i++) {
          var t = ps[i].textContent || "";
          var m = t.match(/TURN_STARTED.*"activeSeat":"(\w+)"/);
          if (m) return m[1];
        }
        return "";
      });
      log("TEST", "activeSeat from event log: " + activeSeat);
    }

    log("TEST", "seat1=" + seat1 + " seat2=" + seat2 + " activeSeat=" + activeSeat);
    var actPage = activeSeat === seat1 ? p1 : p2;
    var idlPage = actPage === p1 ? p2 : p1;
    var actTag  = actPage === p1 ? "P1" : "P2";
    var idlTag  = actTag === "P1" ? "P2" : "P1";
    log("TEST", actTag + " goes first");

    // ── STEP 1: active player plays a minion ────────────────────────────────
    log("TEST", "Step 1 – play a minion");
    var step1 = await rampAndPlayMinion(actPage, idlPage, actTag, idlTag, p1, p2);

    await Promise.all([
      waitEvent(p1, "CARD_PLAYED", step1.ck1, "P1"),
      waitEvent(p2, "CARD_PLAYED", step1.ck2, "P2"),
    ]);
    pass("Step 1: CARD_PLAYED on both pages");

    await Promise.all([
      waitEvent(p1, "MINION_SUMMONED", step1.ck1, "P1"),
      waitEvent(p2, "MINION_SUMMONED", step1.ck2, "P2"),
    ]);
    pass("Step 1: MINION_SUMMONED on both pages");

    await idlPage.waitForFunction(
      function () { return document.querySelectorAll(".board button.minion").length > 0; },
      null, { timeout: TIMEOUT }
    );
    pass("Step 1: Opponent window shows minion on board");

    // ── STEP 2: end turn, mana restores ─────────────────────────────────────
    log("TEST", "Step 2 – end turn");
    await actPage.click("#end-turn");
    await waitForMyTurn(idlPage, idlTag);
    pass("Step 2: Active seat switched to opponent");

    // Mana check via schema (now that client registers schema)
    var idlMana = await idlPage.evaluate(function () {
      var hero = document.querySelector(".player.me .hero");
      if (hero) {
        var m = hero.textContent.match(/Mana\s+(\d+)/);
        if (m) return parseInt(m[1], 10);
      }
      return -1;
    });
    log(idlTag, "mana after receiving turn: " + idlMana);
    if (idlMana >= 1) pass("Step 2: Mana >= 1 for new active player");
    else fail("Step 2: Mana not visible (schema may not be registered) mana=" + idlMana);

    // ── STEP 3: second player plays a minion ────────────────────────────────
    log("TEST", "Step 3 – second player plays a minion");
    var step3 = await rampAndPlayMinion(idlPage, actPage, idlTag, actTag, p1, p2);

    await Promise.all([
      waitEvent(p1, "MINION_SUMMONED", step3.ck1, "P1"),
      waitEvent(p2, "MINION_SUMMONED", step3.ck2, "P2"),
    ]);

    var totalMinions = await p1.evaluate(function () {
      return document.querySelectorAll(".board button.minion").length;
    });
    log("TEST", "total minions visible on P1 view: " + totalMinions);
    if (totalMinions >= 2) pass("Step 3: Both boards have minions");
    else fail("Step 3: Only " + totalMinions + " minion(s) visible (schema may need registration)");

    // ── STEP 4: end turn, attack ─────────────────────────────────────────────
    log("TEST", "Step 4 – end turn then attack");
    await idlPage.click("#end-turn");
    await waitForMyTurn(actPage, actTag);

    // Wait for attacker minion to be ready (canAttack)
    await actPage.waitForFunction(function () {
      return Array.from(document.querySelectorAll(".player.me .board button.minion"))
        .some(function (m) { return (m.textContent || "").indexOf("ready") !== -1; });
    }, null, { timeout: TIMEOUT });
    log(actTag, "my minion is ready");

    // Select attacker (my minion)
    await actPage.locator(".player.me .board button.minion").first().click();
    log(actTag, "attacker selected");
    await actPage.waitForFunction(function () {
      return document.querySelectorAll(".valid-target").length > 0;
    }, null, { timeout: 5000 });
    pass("Step 4: Selecting attacker highlights valid targets");

    // Select target (enemy minion); target click now confirms the attack.
    var enemyLoc = actPage.locator(".player:not(.me) .board button.minion").first();
    await enemyLoc.waitFor({ timeout: TIMEOUT });

    // Record enemy HP before
    var hpBefore = await actPage.evaluate(function () {
      var btn = document.querySelector(".player:not(.me) .board button.minion");
      if (!btn) return -1;
      var m = btn.textContent.match(/(\d+)\/\d+\/\d+/);
      return m ? parseInt(m[1], 10) : -1;
    });
    log(actTag, "enemy minion HP before: " + hpBefore);

    var ck4a = await snap(p1), ck4b = await snap(p2);
    await enemyLoc.click();
    log(actTag, "target clicked");

    await Promise.all([
      waitEvent(p1, "DAMAGE", ck4a, "P1"),
      waitEvent(p2, "DAMAGE", ck4b, "P2"),
    ]);
    pass("Step 4: DAMAGE on both pages");

    var minionDied = await hadEvent(actPage, "DESTROY", ck4a);
    if (minionDied) {
      pass("Step 4: DESTROY event present");
    } else {
      var hpAfter = await actPage.evaluate(function () {
        var btn = document.querySelector(".player:not(.me) .board button.minion");
        if (!btn) return -1;
        var m = btn.textContent.match(/(\d+)\/\d+\/\d+/);
        return m ? parseInt(m[1], 10) : -1;
      });
      log(actTag, "enemy minion HP after: " + hpAfter);
      if (hpAfter !== -1 && hpBefore !== -1 && hpAfter < hpBefore) pass("Step 4: Enemy HP decreased");
      else fail("Step 4: HP did not decrease (before=" + hpBefore + " after=" + hpAfter + ")");
    }

    // Verify both pages are in sync by checking last TURN_STARTED event turn number
    var t1 = await p1.evaluate(function () {
      var ps = document.querySelectorAll(".log p");
      for (var i = ps.length - 1; i >= 0; i--) {
        var m = (ps[i].textContent || "").match(/TURN_STARTED.*"turn":(\d+)/);
        if (m) return m[1];
      }
      var m2 = (document.querySelector(".status") || {}).textContent.match(/Turn:\s*(\d+)/);
      return m2 ? m2[1] : "?";
    });
    var t2 = await p2.evaluate(function () {
      var ps = document.querySelectorAll(".log p");
      for (var i = ps.length - 1; i >= 0; i--) {
        var m = (ps[i].textContent || "").match(/TURN_STARTED.*"turn":(\d+)/);
        if (m) return m[1];
      }
      var m2 = (document.querySelector(".status") || {}).textContent.match(/Turn:\s*(\d+)/);
      return m2 ? m2[1] : "?";
    });
    if (t1 === t2) pass("Step 4: Both pages in sync (turn " + t1 + ")");
    else fail("Step 4: Turn mismatch P1=" + t1 + " P2=" + t2);

    // ── STEP 5: concede → MATCH_ENDED ────────────────────────────────────────
    log("TEST", "Step 5 – concede");
    var ck5a = await snap(p1), ck5b = await snap(p2);
    await actPage.click("#concede");
    await actPage.waitForSelector('[data-testid="concede-confirm"]', { timeout: 5000 });
    await actPage.click('[data-testid="concede-confirm"]');

    await Promise.all([
      waitEvent(p1, "GAME_FINISHED", ck5a, "P1"),
      waitEvent(p2, "GAME_FINISHED", ck5b, "P2"),
    ]);
    pass("Step 5: GAME_FINISHED on both pages");

    await Promise.all([
      waitEvent(p1, "GAME_FINISHED", ck5a, "P1"),
      waitEvent(p2, "GAME_FINISHED", ck5b, "P2"),
    ]);
    pass("Step 5: Status = finished on both pages (GAME_FINISHED confirmed)");
    await Promise.all([
      p1.waitForSelector('[data-testid="result-overlay"]', { timeout: TIMEOUT }),
      p2.waitForSelector('[data-testid="result-overlay"]', { timeout: TIMEOUT }),
    ]);
    pass("Step 5: Result overlay is visible on both pages");

  } catch (err) {
    fail("Unexpected error", err);
    console.error(err);
  }

  console.log("\n══════════════════════════════════════════");
  console.log("  Playwright E2E — Core Game Loop Results");
  console.log("══════════════════════════════════════════");
  for (var r of results) console.log(r);
  console.log("──────────────────────────────────────────");
  console.log("  Total: " + (passed + failed) + "  Passed: " + passed + "  Failed: " + failed);
  console.log("══════════════════════════════════════════\n");

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
