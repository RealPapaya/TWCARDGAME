/**
 * E2E: stale action sequence rejection.
 *
 * Prerequisites:
 *   Vite dev server  - http://localhost:5173
 *   Colyseus server  - ws://localhost:2567
 */

import { chromium } from "playwright";

const WEB_URL = process.env.WEB_URL || "http://localhost:5173";
const SERVER_URL = process.env.SERVER_URL || "";
const TIMEOUT = 30_000;

function devAuthUrl() {
  return WEB_URL + (WEB_URL.indexOf("?") === -1 ? "?" : "&") + "auth=dev";
}

const INIT_SCRIPT = `
(function () {
  window.__el = [];
  window.__eq = 0;
  var seen = new Set();
  function processNode(node) {
    var text = node.textContent || "";
    if (seen.has(text)) return;
    seen.add(text);
    if (text.indexOf("COMMAND_REJECTED") === 0 || text.indexOf("TURN_STARTED") === 0) {
      window.__el.push({ type: text.indexOf("COMMAND_REJECTED") === 0 ? "COMMAND_REJECTED" : "TURN_STARTED", seq: ++window.__eq, text: text });
    }
  }
  function scanAdded(mutations) {
    for (var m = 0; m < mutations.length; m++) {
      var added = mutations[m].addedNodes;
      for (var n = 0; n < added.length; n++) {
        var node = added[n];
        if (node.nodeType !== 1) continue;
        if (node.tagName === "P") processNode(node);
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
    if (app) obs.observe(app, { childList: true, subtree: true });
    else setTimeout(start, 50);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
`;

async function joinAndMulligan(page, name) {
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
  await page.click('[data-testid="find-match"]');
  await page.waitForSelector("#mulligan", { timeout: TIMEOUT });
  await page.click("#mulligan");
}

async function waitEvent(page, eventType, after) {
  await page.waitForFunction(
    (args) => {
      var l = window.__el || [];
      for (var i = args[1]; i < l.length; i++) if (l[i].type === args[0]) return true;
      return false;
    },
    [eventType, after],
    { timeout: TIMEOUT }
  );
}

(async function () {
  var browser = await chromium.launch({ headless: false, slowMo: 100 });
  var ctx1 = await browser.newContext();
  var ctx2 = await browser.newContext();
  var p1 = await ctx1.newPage();
  var p2 = await ctx2.newPage();
  await p1.addInitScript(INIT_SCRIPT);
  await p2.addInitScript(INIT_SCRIPT);

  try {
    await Promise.all([joinAndMulligan(p1, "Seq A"), joinAndMulligan(p2, "Seq B")]);
    await Promise.all([waitEvent(p1, "TURN_STARTED", 0), waitEvent(p2, "TURN_STARTED", 0)]);

    var before = await p1.evaluate(() => window.__gameState.turn.actionSeq);
    var count = await p1.evaluate(() => window.__el.length);
    await p1.evaluate(() => {
      window.__room.send("command", {
        commandId: "stale-action-seq-e2e",
        expectedActionSeq: -1,
        command: { type: "endTurn" }
      });
    });
    await waitEvent(p1, "COMMAND_REJECTED", count);
    await p1.waitForSelector('[data-testid="toast"]', { timeout: 5000 });
    var after = await p1.evaluate(() => window.__gameState.turn.actionSeq);

    if (after !== before) {
      throw new Error("stale command changed actionSeq from " + before + " to " + after);
    }

    console.log("PASS action-seq: stale expectedActionSeq was rejected without advancing actionSeq and displayed toast feedback");
    await browser.close();
    process.exit(0);
  } catch (error) {
    console.error("FAIL action-seq:", error);
    await browser.close();
    process.exit(1);
  }
})();
