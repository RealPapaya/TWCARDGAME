import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const requireFromCwd = createRequire(pathToFileURL(join(process.cwd(), "package.json")));
const { chromium } = requireFromCwd("playwright");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith("--")) continue;
  args.set(key.slice(2), process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : "1");
}

const url = args.get("url") ?? "http://localhost:5174/?auth=dev&devTest=1";
const rawBoardCsv = args.has("board") ? args.get("board") : "TW010,TW014";
const boardCsv = ["", "none", "empty", "solo"].includes(String(rawBoardCsv).toLowerCase()) ? "" : rawBoardCsv;
const screenshot = args.get("screenshot") ?? ".tmp-ko-heal-visual.png";
const timeout = Number(args.get("timeout") ?? 60_000);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 768 }, deviceScaleFactor: 1 });

try {
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[browser:error] ${msg.text()}`);
  });

  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await page.waitForSelector("#dev-test-start-pve", { timeout });
  await page.fill("#dev-test-target-card", "TW011");
  await page.fill("#dev-test-player-board", boardCsv);
  await page.fill("#dev-test-player-mana-current", "10");
  await page.fill("#dev-test-player-mana-max", "10");
  await page.click("#dev-test-start-pve");

  await page.waitForSelector('[data-testid="battle-surface"], [data-testid="mulligan-overlay"]', { timeout });
  await page.waitForTimeout(800);
  if (await page.locator("#mulligan").count()) {
    await page.click("#mulligan");
    await page.waitForSelector('[data-testid="battle-surface"]', { timeout });
  }

  await page.waitForSelector('[data-testid="hand-card"]', { timeout });
  const koIndex = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="hand-card"]')];
    const index = cards.findIndex((el) => el.textContent?.includes("柯文哲") || el.getAttribute("data-card-id") === "TW011");
    return index >= 0 ? index : 0;
  });

  const handCard = page.locator('[data-testid="hand-card"]').nth(koIndex);
  const board = page.locator('[data-testid="player-board"]');
  const handBox = await handCard.boundingBox();
  const boardBox = await board.boundingBox();
  if (!handBox || !boardBox) throw new Error("Missing hand or board geometry.");

  await page.mouse.move(handBox.x + handBox.width / 2, handBox.y + handBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(boardBox.x + boardBox.width / 2, boardBox.y + boardBox.height / 2, { steps: 14 });
  await page.mouse.up();

  const plusSelector = boardCsv ? ".aoe-heal-plus" : "[data-testid='heal-burst'] > span";
  if (boardCsv) {
    await page.waitForFunction((selector) => {
      const pluses = [...document.querySelectorAll(selector)];
      return pluses.some((el) => Number(getComputedStyle(el).opacity) > 0.2);
    }, plusSelector, { timeout });
    await page.waitForTimeout(120);
  } else {
    await page.waitForFunction((selector) => document.querySelectorAll(selector).length > 0, plusSelector, { timeout });
    await page.waitForTimeout(320);
  }

  const result = await page.evaluate(() => {
    const aoePluses = [...document.querySelectorAll(".aoe-heal-plus")];
    const burstPluses = [...document.querySelectorAll("[data-testid='heal-burst'] > span")];
    const visible = [...aoePluses, ...burstPluses].filter((el) => Number(getComputedStyle(el).opacity) > 0);
    return {
      hasHealSweep: Boolean(document.querySelector(".aoe-sweep-heal")),
      aoePlusCount: aoePluses.length,
      healBurstPlusCount: burstPluses.length,
      visiblePlusCount: visible.length,
      healBurstCount: document.querySelectorAll("[data-testid='heal-burst']").length,
      floatNumbers: [...document.querySelectorAll("[data-testid='float-number']")].map((el) => el.textContent)
    };
  });

  await page.screenshot({ path: screenshot, fullPage: false });
  console.log(JSON.stringify({ screenshot, boardCsv, ...result }, null, 2));

  if (result.visiblePlusCount <= 0) {
    throw new Error("No visible green heal plus was detected.");
  }
} finally {
  await browser.close();
}
