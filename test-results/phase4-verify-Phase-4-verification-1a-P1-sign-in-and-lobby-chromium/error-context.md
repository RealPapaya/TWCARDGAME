# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase4-verify.spec.ts >> Phase 4 verification >> 1a. P1 sign-in and lobby
- Location: docs\phase4-verify.spec.ts:96:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('text=/104 owned cards/')
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for locator('text=/104 owned cards/')

```

```yaml
- main:
  - main:
    - heading "TWCARDGAME v2" [level=1]
    - paragraph: Authoritative PvP
    - textbox "Server URL": ws://localhost:2567
    - textbox "Display name" [disabled]: Player
    - button "Join" [disabled]
    - heading "Player" [level=2]
    - paragraph: 0 owned cards - Catalog v2-seed-from-v0.9.0
    - button "Sync Collection"
    - button "New Deck"
    - button "Refresh"
    - button "Sign Out"
    - paragraph: Account action failed.
    - paragraph: Collection synced.
    - heading "Saved Decks" [level=3]
    - paragraph: No saved decks yet.
    - paragraph: Select a legal deck before joining PvP.
    - heading "New Deck" [level=3]
    - text: 0/30
    - textbox "Deck name": New Deck
    - paragraph: Collection is not ready yet. Click Sync Collection, then try adding cards again.
    - button "Save Deck" [disabled]
    - button "Autofill" [disabled]
    - button "Clear"
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 謝長廷 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 黃捷 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 蘇巧慧 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 賴清德 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 陳建仁 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 蔡英文 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 吳敦義 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 陳玉珍 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 馬英九 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 朱立倫 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 韓國瑜 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 蔣萬安 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 郝龍斌 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 趙少康 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 江啟臣 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 連勝文 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 盧秀燕 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 柯文哲 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 黃瀞瑩 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 高虹安 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 陳珮琪 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 黃國昌 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 黃珊珊 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 民眾黨黨部 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 國民黨黨部 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 民進黨黨部 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 京華城 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 四叉貓 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 館長 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 勞工局 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 台積電 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 沈慶京 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 窮酸大學生 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 青鳥大學生 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 小草大學生 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 大樓保全 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 條碼師 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 水電徒弟 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 廟口管委 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 外送師 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 手搖員工 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 台積電工程師 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 水電師傅 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 老草中年 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 老鳥中年 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 發票中獎 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 彈劾賴皇 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 大罷免 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 造勢晚會 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 倒閣 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 砸雞蛋 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 召開記者會 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 法院傳票 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 政治切割 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 921大地震 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 高端疫苗 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 抗中保台 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 芒果乾 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 側翼出動 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 武漢肺炎 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 八卦 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 緋聞 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 炎上 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 查水表 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 政治清算 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 哈們 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 電子腳鐐 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 無期徒刑 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 鉅額交保 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 普發一萬 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 停班停課 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 沉默不是金 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 贏了夫人又逃兵 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 網軍 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 陳時中 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 連戰 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 謝和弦 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 老榮民 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 傅崐萁 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 徐巧芯 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 謝龍介 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 鋼鐵韓粉 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 柯文哲(獄中) 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 蔡璧如 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 陳珮琪(老公獄中) 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 蕭美琴 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 蔡樂樂 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 蔡想想 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 蘇貞昌 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 陳其邁 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 藍亦明 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 核電廠 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 鄭文燦 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 8+9 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 王定宇 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 卓榮泰 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 大法官 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 林佳龍 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 蠻牛 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 死亡之握 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: TOYZ 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 卡車司機 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 王ADEN 0/0
    - button "+" [disabled]
    - button "-" [disabled]
    - text: 豬大哥 0/0
    - heading "Match History" [level=3]
    - paragraph: No completed matches yet.
```

# Test source

```ts
  1   | /**
  2   |  * Phase 4 Playwright verification — runs against http://localhost:5173 + http://localhost:2567
  3   |  *
  4   |  * Run with:
  5   |  *   npx playwright test docs/phase4-verify.spec.ts --headed
  6   |  *
  7   |  * Credentials are disposable test accounts.
  8   |  * Service-role keys are never read or printed here.
  9   |  */
  10  | 
  11  | import { test, expect, type BrowserContext, type Page } from "@playwright/test";
  12  | 
  13  | const WEB = "http://localhost:5173";
  14  | const EMAIL_P1 = "twcardgame.p1@gmail.com";
  15  | const EMAIL_P2 = "twcardgame.p2@gmail.com";
  16  | const PASSWORD = "Test1234!phase4";
  17  | 
  18  | // ── helpers ──────────────────────────────────────────────────────────────────
  19  | 
  20  | async function fillAuth(page: Page, email: string, password: string) {
  21  |   await page.fill("#auth-email", email);
  22  |   await page.fill("#auth-password", password);
  23  | }
  24  | 
  25  | /** Sign in with pre-created account credentials. */
  26  | async function signIn(page: Page, email: string, password: string) {
  27  |   await page.goto(WEB);
  28  |   await fillAuth(page, email, password);
  29  |   await page.locator('button[data-auth-mode="signin"]').click();
  30  | }
  31  | 
  32  | /** Wait for account lobby (collection count visible). */
  33  | async function waitForLobby(page: Page, label: string) {
  34  |   await expect(page.locator("text=/owned cards/")).toBeVisible({ timeout: 20_000 });
  35  |   console.log(`[PASS] ${label} reached account lobby`);
  36  | }
  37  | 
  38  | /** Ensure 104 owned cards, clicking Sync Collection if needed. */
  39  | async function ensureCollection(page: Page, label: string) {
  40  |   const ownedText = page.locator("text=/owned cards/");
  41  |   await ownedText.waitFor({ timeout: 10_000 });
  42  |   const raw = await ownedText.textContent() ?? "";
  43  |   const count = parseInt(raw.match(/\d+/)?.[0] ?? "0", 10);
  44  |   if (count === 0) {
  45  |     await page.click("#sync-collection");
  46  |     // Wait for either success or failure
  47  |     await page.waitForTimeout(5_000);
  48  |     // Capture any error message shown
  49  |     const errEl = page.locator(".error-text, .account-status.error-text");
  50  |     if (await errEl.isVisible({ timeout: 1000 }).catch(() => false)) {
  51  |       const errText = await errEl.textContent();
  52  |       console.log(`[DIAG] ${label} sync error: "${errText?.trim()}"`);
  53  |     }
  54  |     const rawAfter = await page.locator("text=/owned cards/").textContent() ?? "";
  55  |     const countAfter = parseInt(rawAfter.match(/\d+/)?.[0] ?? "0", 10);
  56  |     console.log(`[DIAG] ${label} owned cards after sync click: ${countAfter}`);
> 57  |     await expect(page.locator("text=/104 owned cards/")).toBeVisible({ timeout: 20_000 });
      |                                                          ^ Error: expect(locator).toBeVisible() failed
  58  |     console.log(`[PASS] ${label} synced → 104 owned cards`);
  59  |   } else {
  60  |     expect(count).toBe(104);
  61  |     console.log(`[PASS] ${label} already has ${count} owned cards`);
  62  |   }
  63  | }
  64  | 
  65  | // ── shared state ──────────────────────────────────────────────────────────────
  66  | 
  67  | let ctxA: BrowserContext;
  68  | let ctxB: BrowserContext;
  69  | let pageA: Page;
  70  | let pageB: Page;
  71  | let p1DeckId: string | null = null;
  72  | 
  73  | // ── tests ─────────────────────────────────────────────────────────────────────
  74  | 
  75  | test.describe("Phase 4 verification", () => {
  76  |   test.beforeAll(async ({ browser }) => {
  77  |     ctxA = await browser.newContext();
  78  |     ctxB = await browser.newContext();
  79  |     pageA = await ctxA.newPage();
  80  |     pageB = await ctxB.newPage();
  81  |     pageA.on("console", (m) => {
  82  |       if (m.type() === "error" || m.type() === "warn") console.log(`[A ${m.type().toUpperCase()}] ${m.text()}`);
  83  |     });
  84  |     pageB.on("console", (m) => {
  85  |       if (m.type() === "error" || m.type() === "warn") console.log(`[B ${m.type().toUpperCase()}] ${m.text()}`);
  86  |     });
  87  |   });
  88  | 
  89  |   test.afterAll(async () => {
  90  |     await ctxA.close();
  91  |     await ctxB.close();
  92  |   });
  93  | 
  94  |   // ── Step 1: Login and collection sync ────────────────────────────────────
  95  | 
  96  |   test("1a. P1 sign-in and lobby", async () => {
  97  |     await signIn(pageA, EMAIL_P1, PASSWORD);
  98  |     await waitForLobby(pageA, "P1");
  99  |     // Catalog version text: "N owned cards - Catalog <version>"
  100 |     const lobbyText = await pageA.locator("text=/owned cards/").textContent() ?? "";
  101 |     console.log(`[INFO] P1 lobby text: "${lobbyText.trim()}"`);
  102 |     await ensureCollection(pageA, "P1");
  103 |   });
  104 | 
  105 |   test("1b. P2 sign-in and lobby", async () => {
  106 |     await signIn(pageB, EMAIL_P2, PASSWORD);
  107 |     await waitForLobby(pageB, "P2");
  108 |     await ensureCollection(pageB, "P2");
  109 |   });
  110 | 
  111 |   // ── Step 2: Deck CRUD ────────────────────────────────────────────────────
  112 | 
  113 |   test("2a. P1 deck CRUD — create, edit, verify save disabled at 29/30", async () => {
  114 |     // Open new deck editor
  115 |     await pageA.click("#new-deck");
  116 | 
  117 |     // Autofill
  118 |     await pageA.click("#autofill-deck");
  119 |     await expect(pageA.locator("text=/30\\/30/")).toBeVisible({ timeout: 10_000 });
  120 |     console.log("[PASS] P1 deck counter shows 30/30");
  121 | 
  122 |     // Save
  123 |     await pageA.locator("#deck-form").locator('button[type="submit"]').click();
  124 |     await expect(pageA.locator(".success-text")).toBeVisible({ timeout: 10_000 });
  125 |     console.log("[PASS] P1 deck saved (success message visible)");
  126 | 
  127 |     // Deck row should appear in saved decks list
  128 |     const deckRow = pageA.locator(".saved-deck").first();
  129 |     await expect(deckRow).toBeVisible({ timeout: 5_000 });
  130 |     console.log("[PASS] P1 saved deck row visible in deck list");
  131 | 
  132 |     // Capture deck id from data-select-deck attribute
  133 |     p1DeckId = await deckRow.locator("[data-select-deck]").getAttribute("data-select-deck");
  134 |     console.log(`[INFO] P1 deck id: ${p1DeckId ?? "not found"}`);
  135 | 
  136 |     // Click Edit on that deck
  137 |     await deckRow.locator("[data-edit-deck]").click();
  138 | 
  139 |     // Remove one card
  140 |     const enabledMinus = pageA.locator("[data-remove-card]:not([disabled])").first();
  141 |     await expect(enabledMinus).toBeVisible({ timeout: 5_000 });
  142 |     await enabledMinus.click();
  143 |     await expect(pageA.locator("text=/29\\/30/")).toBeVisible({ timeout: 5_000 });
  144 |     console.log("[PASS] P1 deck counter shows 29/30 after removing one card");
  145 | 
  146 |     // Save Deck button should be disabled at 29/30
  147 |     const saveBtn = pageA.locator("#deck-form").locator('button[type="submit"]');
  148 |     await expect(saveBtn).toBeDisabled();
  149 |     console.log("[PASS] P1 Save Deck is disabled at 29/30");
  150 | 
  151 |     // Add it back
  152 |     const cardId = await enabledMinus.getAttribute("data-remove-card");
  153 |     if (cardId) {
  154 |       const addBtn = pageA.locator(`[data-add-card="${cardId}"]`);
  155 |       if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  156 |         await addBtn.click();
  157 |       }
```