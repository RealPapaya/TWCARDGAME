/**
 * E2E: DOM stability for the string renderer.
 *
 * Prerequisite:
 *   Vite dev server - http://localhost:5173
 */

import { chromium } from "playwright";

const WEB_URL = process.env.WEB_URL || "http://localhost:5173";
const TIMEOUT = 30_000;

function devAuthUrl() {
  return WEB_URL + (WEB_URL.indexOf("?") === -1 ? "?" : "&") + "auth=dev";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async function () {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("[PAGE ERR]", e.message));

  try {
    await page.goto(devAuthUrl());
    await page.waitForSelector('[data-testid="menu-battle"]', { timeout: TIMEOUT });
    await page.click('[data-testid="menu-battle"]');
    await page.waitForSelector('[data-testid="battle-mode-challenge"]', { timeout: TIMEOUT });

    await page.evaluate(() => {
      window.__stableShell = document.querySelector(".app-shell");
      window.__stableChallenge = document.querySelector('[data-testid="battle-mode-challenge"]');
      window.__stablePvp = document.querySelector('[data-testid="battle-mode-pvp"]');
    });

    await page.click('[data-testid="battle-mode-pvp"]');
    await page.click('[data-testid="battle-mode-ai"]');
    await page.click('[data-testid="battle-mode-challenge"]');

    const battleStable = await page.evaluate(() => ({
      shell: window.__stableShell === document.querySelector(".app-shell"),
      challenge: window.__stableChallenge === document.querySelector('[data-testid="battle-mode-challenge"]'),
      pvp: window.__stablePvp === document.querySelector('[data-testid="battle-mode-pvp"]')
    }));
    assert(battleStable.shell, "app shell was replaced while toggling battle modes");
    assert(battleStable.challenge, "challenge battle-mode card was replaced");
    assert(battleStable.pvp, "pvp battle-mode card was replaced");

    await page.click('[data-testid="battle-challenge-entry"]');
    await page.waitForSelector('[data-testid="ai-theme-options"]', { timeout: TIMEOUT });
    await page.evaluate(() => {
      window.__stableAiShell = document.querySelector(".app-shell");
      window.__stableTheme = document.querySelector("[data-ai-theme]");
    });
    await page.evaluate(() => {
      document.querySelectorAll("[data-ai-theme]")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const difficulty = document.querySelector('input[name="ai-difficulty"]');
      difficulty.checked = true;
      difficulty.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const aiStable = await page.evaluate(() => ({
      shell: window.__stableAiShell === document.querySelector(".app-shell"),
      firstThemeStillMounted: window.__stableTheme === document.querySelector("[data-ai-theme]")
    }));
    assert(aiStable.shell, "app shell was replaced while changing AI challenge options");
    assert(aiStable.firstThemeStillMounted, "AI theme node was replaced while changing selection");

    console.log("Render stability checks passed");
    await browser.close();
  } catch (error) {
    await browser.close();
    console.error(error);
    process.exit(1);
  }
})();
