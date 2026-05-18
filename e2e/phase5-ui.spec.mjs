/**
 * E2E: Phase 5 UI affordances.
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
    if (text.indexOf("TURN_STARTED") === 0) window.__el.push({ type: "TURN_STARTED", seq: ++window.__eq });
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

async function waitTurnStarted(page) {
  await page.waitForFunction(
    () => (window.__el || []).some((event) => event.type === "TURN_STARTED"),
    null,
    { timeout: TIMEOUT }
  );
}

async function joinAndMulligan(page, name) {
  await page.goto(devAuthUrl());
  await page.waitForSelector("#join-form", { timeout: TIMEOUT });
  if (SERVER_URL) await page.fill("#server-url", SERVER_URL);
  await page.fill("#display-name", name);
  await page.click("#join-form button");
  await page.waitForSelector('[data-testid="mulligan-overlay"]', { timeout: TIMEOUT });
  await page.locator("[data-mulligan-id]").first().click();
  await page.waitForFunction(() => {
    var card = document.querySelector("[data-mulligan-id]");
    return card && card.classList.contains("selected");
  }, null, { timeout: 5000 });
  await page.click("#mulligan");
}

(async function () {
  var browser = await chromium.launch({ headless: false, slowMo: 100 });
  var mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  var desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  var p1 = await mobile.newPage();
  var p2 = await desktop.newPage();
  await p1.addInitScript(INIT_SCRIPT);
  await p2.addInitScript(INIT_SCRIPT);

  try {
    await Promise.all([joinAndMulligan(p1, "Mobile UI"), joinAndMulligan(p2, "Desktop UI")]);
    await Promise.all([waitTurnStarted(p1), waitTurnStarted(p2)]);

    await p1.waitForSelector('[data-testid="battle-surface"]', { timeout: TIMEOUT });
    var layout = await p1.evaluate(() => {
      var surface = document.querySelector('[data-testid="battle-surface"]');
      var hand = document.querySelector('[data-testid="player-hand"]');
      var board = document.querySelector('[data-testid="player-board"]');
      var maxRight = 0;
      for (var el of [surface, hand, board]) {
        if (!el) continue;
        var rect = el.getBoundingClientRect();
        maxRight = Math.max(maxRight, rect.right);
      }
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        maxRight: Math.ceil(maxRight),
        minLeft: Math.floor(Math.min(
          surface ? surface.getBoundingClientRect().left : 0,
          hand ? hand.getBoundingClientRect().left : 0,
          board ? board.getBoundingClientRect().left : 0
        )),
        minionCount: document.querySelectorAll('[data-testid="board-minion"]').length,
        handCount: document.querySelectorAll('[data-testid="hand-card"]').length
      };
    });

    if (layout.scrollWidth > layout.viewport + 2 || layout.maxRight > layout.viewport + 2 || layout.minLeft < -2) {
      throw new Error("mobile battle layout overflows viewport: " + JSON.stringify(layout));
    }
    if (layout.handCount <= 0) throw new Error("mobile player hand did not render");

    console.log("PASS phase5-ui: mulligan selection and mobile battle layout fit viewport");
    await browser.close();
    process.exit(0);
  } catch (error) {
    console.error("FAIL phase5-ui:", error);
    await browser.close();
    process.exit(1);
  }
})();
