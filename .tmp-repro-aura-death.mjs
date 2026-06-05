import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:5174";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const logs = [];
page.on("console", (msg) => {
  const t = msg.text();
  if (t.includes("CAP-DBG") || t.includes("DEATHSHATTER-DBG") || t.includes("hold publicSync for destroy") || t.includes("flush start")) {
    logs.push(t);
    console.log("LOG>", t);
  }
});

await page.goto(BASE + "/?auth=dev", { waitUntil: "networkidle" });
await sleep(700);

async function clickText(text, timeout = 4000) {
  const el = page.getByText(text, { exact: false }).first();
  await el.click({ timeout });
}
async function clickTestId(id, timeout = 4000) {
  await page.locator(`[data-testid="${id}"]`).first().click({ timeout });
}
async function nextStep(times = 1) {
  for (let i = 0; i < times; i++) {
    await page.locator("#training-next").click({ timeout: 4000 });
    await sleep(450);
  }
}
async function isNextVisible() {
  return page.locator("#training-next").isVisible().catch(() => false);
}
async function advanceWhileNext(max = 12) {
  let n = 0;
  while (n < max && (await isNextVisible())) {
    await page.locator("#training-next").click({ timeout: 4000 });
    await sleep(450);
    n++;
  }
  return n;
}
async function attack(attackerId, targetId) {
  await page.locator(`[data-attacker-id="${attackerId}"]`).click({ timeout: 4000 });
  await sleep(200);
  await page.locator(`[data-target-key="${targetId}"]`).click({ timeout: 4000 });
  await sleep(300);
  // fallback explicit attack button if present
  const atk = page.locator('[data-testid="attack-target"]');
  if (await atk.isVisible().catch(() => false) && await atk.isEnabled().catch(() => false)) {
    await atk.click().catch(() => {});
  }
  await sleep(900);
}

try {
  // Into training
  await clickTestId("menu-battle");
  await sleep(500);
  await clickTestId("battle-mode-training");
  await sleep(500);
  await clickTestId("start-training-advanced_keywords");
  await sleep(800);

  // intro + enrage_explain (next) -> enrage_do gated
  await advanceWhileNext();
  console.log("STATE> at enrage attack");
  await attack("l4-enrage", "l4-enrage-enemy");

  // enrage_result(heal), enrage_calmed (next) -> death_do gated
  await advanceWhileNext();
  console.log("STATE> at death attack");
  await attack("l4-death", "l4-killer");

  // death_result, aura_explain (next) -> aura_do gated (play 京華城)
  await advanceWhileNext();
  console.log("STATE> at aura play");
  // Drag 京華城 from hand to board
  const hand = page.locator(`[data-dom-key="hand-l4-aura-hand"]`).first();
  const board = page.locator('[data-testid="player-board"]').first();
  const hb = await hand.boundingBox();
  const bb = await board.boundingBox();
  if (hb && bb) {
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await sleep(120);
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 12 });
    await sleep(120);
    await page.mouse.up();
  } else {
    console.log("STATE> could not find hand/board boxes", { hb, bb });
  }
  await sleep(Number(process.env.SETTLE || 1500));
  console.log("STATE> aura played, board now:");
  const ids1 = await page.$$eval("[data-target-key]", (els) => els.map((e) => ({ k: e.getAttribute("data-target-key"), x: Math.round(e.getBoundingClientRect().left) })));
  console.log(JSON.stringify(ids1));

  // Advance once -> l4_aura_result.apply runs 政治清算 kill. Capture frames.
  console.log("STATE> advancing into 政治清算 kill");
  await page.locator("#training-next").click({ timeout: 4000 });
  for (let i = 0; i < 14; i++) {
    await page.screenshot({ path: `.tmp-auradeath-${String(i).padStart(2, "0")}.png` });
    await sleep(220);
  }
  console.log("DONE logs count:", logs.length);
} catch (err) {
  console.error("DRIVER ERROR:", err.message);
  await page.screenshot({ path: ".tmp-auradeath-error.png" });
} finally {
  await browser.close();
}
