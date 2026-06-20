# TWCARDGAME v2 — Cloudflare 營運手冊

> 這份文件說明遊戲上線後「**怎麼運作、怎麼更新、出事怎麼查**」。
> 想看「為什麼搬到 Cloudflare、怎麼搬的」請看
> [cloudflare-migration-roadmap.md](cloudflare-migration-roadmap.md)。

---

## 0. 一眼看懂:現在線上有什麼

| 角色 | 服務 | 正式位址 | 由哪個資料夾部署 |
|---|---|---|---|
| 🌐 玩家網站(前端) | Cloudflare **Pages** | **https://twcardgame-web.pages.dev** | `apps/web` |
| 🔌 即時對戰(後端) | Cloudflare **Workers + Durable Objects** | `wss://twcardgame-realtime.ptr0905.workers.dev` | `apps/realtime` |
| 🗂️ 卡圖 / 音效 / 影片 | Cloudflare **R2**(bucket `twcardgame-assets`) | 經 Pages Functions 以 `/images /audio /video` 對外 | `apps/web/public` → `scripts/upload-assets.mjs` |
| 🔐 帳號 / 牌組 / 戰績 | **Supabase**(沿用,沒搬) | `https://ocyertnlgsosuuiwddti.supabase.co` | `packages/db` |

```
玩家瀏覽器
  ├─ HTML/JS/CSS ───────────► Pages 靜態(twcardgame-web.pages.dev)
  ├─ /images /audio /video ─► Pages Functions ─► R2(twcardgame-assets)
  ├─ wss:// 對戰 ───────────► Worker(twcardgame-realtime)─► Durable Object
  └─ 登入 / 牌組 / 戰績 ─────► Supabase
```

**給玩家的連結就是** `https://twcardgame-web.pages.dev`(綁了自訂網域後改用自己的網域,見 §5)。

Cloudflare 帳號:`ptr0905@gmail.com`(Account ID `cfd7057f74fe5cc9b57c40aa2269510f`)。
後台:<https://dash.cloudflare.com> → Workers & Pages。

---

## 1. 最重要的觀念:**不是 git push 自動部署**

我們用 **wrangler 直接上傳(CLI deploy)**,不是 GitHub 連動。

- ✅ `git push` 只是把程式碼推上 GitHub,**對線上沒有任何影響**。
- ✅ 要讓改動上線,必須跑下面 §2 的**部署指令**。
- ✅ 三塊(前端 / 後端 / 資產)**各自獨立部署**,改到哪塊就只部署那塊,其它不受影響。
- ✅ 部署完玩家**重新整理頁面**就拿到新版,網址永遠不變。

> 想改成「push 到 main 自動部署」也可以(見 §6 選配),但目前不是這個模式。

---

## 2. 日常更新流程(改完東西要上線時)

所有指令都從 repo 根目錄 `D:\Google AI\TWCARDGAME`、用 PowerShell 跑。
**前置(每次開新終端機如果沒登入過):** `npx wrangler login`。

### 2-1. 改了前端(畫面、UI、`apps/web/src`、CSS)

```powershell
npm run build                                                  # 編譯 + 打包到 dist-public
npm run pages:deploy -w @twcardgame/web -- --branch=main       # 部署到 Production
```

> `--branch=main` 很關鍵:不加會被當成「預覽部署」,玩家網址不會更新(見 §7 疑難排解)。

### 2-2. 改了遊戲邏輯 / 伺服器(`apps/realtime`、`packages/rules|shared|cards|db`)

```powershell
npm run deploy -w @twcardgame/realtime
```

> 這會先 `tsc -b` 再 `wrangler deploy`。`packages/rules` 是純函式,改它就是改平衡/規則。
> 改完**強烈建議先** `npm test && npm run check` 綠燈再部署。

### 2-3. 換了卡圖 / 音效 / 影片(`apps/web/public/{images,audio,video}`)

```powershell
npm run assets:upload -w @twcardgame/web            # 上傳到 R2(可重跑,覆蓋同名檔)
npm run assets:upload -w @twcardgame/web -- --dry-run   # 先預覽會傳哪些
```

> R2 物件設了 `immutable` 長快取。**檔名沒變、內容換了**的話,Cloudflare 邊緣可能還快取舊圖;
> 最穩做法是**換檔名**(例如 `bg_v2.webp`)並改引用,或在 dashboard 對該物件做 cache purge。
> 純加新檔(新卡)沒這問題,傳完即時可用、**前端不必重新部署**。

### 2-4. 改了環境變數 / 金鑰

- **前端的 `VITE_*`**(供瀏覽器用,build 時烤進去)→ 改 `apps/web/.env.local` → **重跑 2-1**。
  目前內容:`VITE_REALTIME_URL`(對戰 Worker)、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、
  `VITE_BETA_DB_RESET_ENABLED`。anon key 是公開金鑰可外洩,沒關係。
- **Worker 的機密**(Supabase service_role 等,**絕不進前端**):
  ```powershell
  wrangler secret put SUPABASE_URL --name twcardgame-realtime
  wrangler secret put SUPABASE_SERVICE_ROLE_KEY --name twcardgame-realtime
  ```
  設完即時生效,**不必重新部署 Worker**。

---

## 3. 三塊的「設定檔在哪」

| 設定 | 檔案 |
|---|---|
| Pages 專案名 + R2 binding(`ASSETS_BUCKET`)+ 輸出目錄 | [apps/web/wrangler.jsonc](../apps/web/wrangler.jsonc) |
| 前端環境變數(本機,**不進 git**) | `apps/web/.env.local`(範本見 [.env.example](../apps/web/.env.example)) |
| R2 路由 + 快取(build 時自動產生到 `dist-public`) | `_routes.json`(只對 `/images /audio /video` 啟用 Functions)、`_headers` |
| R2 串流邏輯(edge cache / Range / 304 / immutable) | [apps/web/functions/](../apps/web/functions/) |
| 資產上傳腳本 | [apps/web/scripts/upload-assets.mjs](../apps/web/scripts/upload-assets.mjs) |
| Worker(DO / Alarm / migrations) | [apps/realtime/wrangler.jsonc](../apps/realtime/wrangler.jsonc) |
| Worker 機密 | Cloudflare 端(`wrangler secret`),**不在 repo** |

---

## 4. 部署後驗證 checklist

```powershell
# 前端首頁
curl.exe -s -o NUL -w "index=%{http_code}\n" https://twcardgame-web.pages.dev/
# R2 資產(應 200 + image/webp + immutable 快取)
curl.exe -s -I https://twcardgame-web.pages.dev/images/mana/player-crystal.webp
# 對戰 Worker 健康
curl.exe -s https://twcardgame-realtime.ptr0905.workers.dev/health
```

預期:首頁 `200`、資產 `200` 且帶 `Cache-Control: ...immutable`、Worker 回 `{"ok":true}`。
最後**開瀏覽器實際玩一輪**(主選單背景圖出來=R2 通;兩分頁配對對打=Worker 通;登入/牌組=Supabase 通)。

---

## 5. 綁自訂網域(選配,要你自己操作 DNS)

1. dashboard → Workers & Pages → **twcardgame-web** → **Custom domains** → Set up a domain → 輸入你的網域。
2. 若網域的 DNS 也在 Cloudflare,點一下就好;在別家就照指示加一筆 CNAME。
3. **對戰 Worker 若也要自訂網域**(例如 `realtime.你的網域`):
   Worker → Settings → Domains & Routes 加;然後把 `apps/web/.env.local` 的
   `VITE_REALTIME_URL` 改成 `wss://realtime.你的網域`,**重跑 2-1**。
4. Supabase Auth 的 redirect URL 記得把新網域加進去(Supabase dashboard → Authentication → URL Configuration)。

---

## 6.（選配)改成「push 到 main 自動部署」前端

如果想要 GitHub 一推就自動 build + 部署前端:
dashboard → Pages → twcardgame-web → Settings → **Builds & deployments → Connect to Git**,
選 repo、production branch `main`、build command `npm run build`、output `apps/web/dist-public`,
並在 dashboard 設好 `VITE_*` 環境變數(因為改成 Cloudflare 幫你 build,金鑰要放它那邊)。
連動後,本機就不必再手動 `pages:deploy`。Worker 與 R2 仍維持 CLI 部署。

---

## 7. 疑難排解

| 症狀 | 原因 / 解法 |
|---|---|
| 部署後玩家網址沒更新 | 八成是**漏了 `--branch=main`**,變成預覽部署。重跑 2-1 並加上該旗標。 |
| 圖片 404 | 該檔還沒上 R2 → 跑 `npm run assets:upload`;或檔名/路徑大小寫不符(R2 key 區分大小寫,要對齊 `public/` 佈局)。 |
| 換了圖但還是舊的 | `immutable` 邊緣快取 → 換檔名,或 dashboard 對該 R2 物件 purge cache。 |
| 連不上對戰 / 一直 connecting | `VITE_REALTIME_URL` 沒指對,或 Worker 沒上線。先 `curl .../health`;再確認前端有用最新 `.env.local` 重 build。 |
| 上傳資產大量 `FAILED ... after N attempts` | wrangler 在 Windows 連續大量 spawn 會偶發 libuv 崩潰(`async.c` assertion)。腳本已加 retry+間隔;殘餘失敗檔**單獨重傳一定成功**,或改用 rclone(見下)。 |
| 想批次快傳 / 殘檔很多 | 用 **rclone** 走 R2 S3 端點:dashboard → R2 → Manage R2 API Tokens 建一組(Object Read & Write),`rclone config` 設成 S3/Cloudflare,`rclone copy apps/web/public/images r2:twcardgame-assets/images`(audio、video 同理)。 |
| 獎勵 / 戰績沒寫進 DB | Worker 的 `SUPABASE_*` 機密沒設 → 走 §2-4 設定。沒設時會降級成「零獎勵」不會壞,但不會落地。 |

### 回滾(rollback)

- **前端**:dashboard → Pages → twcardgame-web → Deployments → 找舊的成功部署 → **Rollback**。
- **Worker**:`wrangler rollback --name twcardgame-realtime`(或 dashboard → Worker → Deployments 選版本)。
- **資產**:R2 沒有版本概念;重新上傳舊檔覆蓋即可。

---

## 8. 成本與額度(免費方案,粗估)

卡牌是回合制、大半時間 idle,WebSocket Hibernation 下「沒訊息不計費」,加上 R2 出口 $0、
Pages 流量免費,實務上**除了網域幾乎不花錢**。額度細節與官方連結見 roadmap §1、§7。
真正要留意的是 Supabase 免費方案(Auth + Postgres)的用量,那塊沒搬。

---

## 9. 快速指令速查

```powershell
# 一次更新全部(前端+後端,資產有換才加第三行)
npm test && npm run check
npm run build && npm run pages:deploy -w @twcardgame/web -- --branch=main
npm run deploy -w @twcardgame/realtime
npm run assets:upload -w @twcardgame/web

# 健康檢查
curl.exe -s https://twcardgame-realtime.ptr0905.workers.dev/health
curl.exe -s -o NUL -w "%{http_code}\n" https://twcardgame-web.pages.dev/

# 登入 / 身分
npx wrangler whoami
```
