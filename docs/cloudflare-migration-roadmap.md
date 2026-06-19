# Cloudflare 幾乎零成本架構 — 遷移 Roadmap

> 目標:把 TWCARDGAME v2 從「Colyseus on Node(Railway)＋ Supabase ＋ Vercel」搬到
> 「Cloudflare Workers / Durable Objects ／ D1 ／ R2 ／ Pages」這套**幾乎全免費**的堆疊,
> 達成那篇戰鬥陀螺文章描述的「除了網域,幾乎不花錢」效果。
>
> 本文是評估 + 計畫文件,**不是**叫你立刻動手。先讀「方案比較」決定走哪條路,再看對應階段。

---

## ⭐ 給接手的 session / agent:從這裡開始讀

這是一個**會跨很多次 session 執行**的長期專案。如果你是新開的 session 被要求「繼續做這個遷移」,請依序:

1. **先看 §A 進度追蹤** —— 知道做到哪、下一步是什麼。
2. **已鎖定的決策(不要再重新討論):**
   - 走**方案 B**:只把即時層搬到 Cloudflare,**Auth + DB 留在 Supabase**。
   - 用 **PartyKit / Durable Objects**,不是 raw WebSocket 自架。
   - 用 **DO Alarms** 取代回合倒數計時器。
   - **`packages/rules` / `shared` / `cards` 一律不動**;只改傳輸/房間/持久化的管線。遊戲邏輯與平衡必須維持不變。
3. **動手前**:跑 `npm test && npm run check` 確認 baseline 綠燈,完工後再跑一次比對。
4. **完成任何一步後**:回來更新 §A 的勾選與「最後更新」欄,讓下一個 session 接得上。
5. 相關現有程式入口:[apps/server/src/GameRoom.ts](../apps/server/src/GameRoom.ts)(要被取代的房間)、
   [apps/server/src/index.ts](../apps/server/src/index.ts)(配對入口)、
   [apps/web/src/runtime.ts](../apps/web/src/runtime.ts)(`new Client` 連線處)、
   [apps/web/src/app/config.ts](../apps/web/src/app/config.ts)(伺服器 URL 推斷)。

---

## §A. 進度追蹤(每個 session 完成後更新這裡)

> **最後更新**:2026-06-20 — **Phase 3 完成全面切換(full cut)**:`apps/web` 移除 `@colyseus/sdk`、
> 客戶端 schema 鏡像(`schema.ts`/`schema.test.ts`)、`ws-browser-shim` 與 vite `ws` alias、config 的
> `:2567` 推斷與 `VITE_COLYSEUS_URL`/`VITE_GAME_TRANSPORT`;**realtime 成為唯一傳輸**。
> 最後一個綁死 Colyseus 的 dev-test PvE 面板已移植到 DO:新增
> [`apps/realtime/src/devTest.ts`](../apps/realtime/src/devTest.ts)(移植 `applyDevTestMatchSetup` + localhost gate)、
> worker `POST /pve/devtest` 端點、DO 暫存/套用 setup、`BotGameSession.customizeInitialMatch` 套牌局並
> env-gate 跳過 finalize(`metadata.devTest`),附 8 個單元測試。
> 全套驗證綠燈(`npm run check`、`npm test` 464、`npm run build`、`wrangler --dry-run` 1561KiB/275KiB gzip;
> `packages/rules|shared|cards` 對 master 零 diff)。**剩**:瀏覽器 visual QA(PvP/私人房/重連/PvE/dev-test UI 流程,需實機)
> 與真 Supabase round-trip(需憑證)。`apps/server`(Colyseus/Railway)尚未動,尚未切換 DNS/下線。

| 階段 | 狀態 | 備註 |
|---|---|---|
| 規劃 + 研究 + 鎖定方案 B | ✅ 完成 | 本文件 |
| Phase 0 — 技術驗證 PoC | ✅ 完成 | `apps/realtime`:DO + `reduce` + 原生 WS;PvP 房號對打;回合/階段/重連倒數走單一 DO Alarm;Hibernation 持久化;`GameSession` 純核心測試綠燈;`wrangler deploy --dry-run` 通過 |
| Phase 1 — 即時層平移 | ✅ 完成(程式) | PvE(`BotGameSession`、`/pve`、`bot` 訊息、Hibernation bot RNG/pacing)+ **Supabase 牌組解析/`validateDeck`**([`accounts.ts`](../apps/realtime/src/accounts.ts))+ **finalize hook:戰績持久化 + 獎勵 + 任務事件 + 每席 `reward_summary`**([`matchServices.ts`](../apps/realtime/src/matchServices.ts),env-gated,無憑證時降級零獎勵)。整局 AI 模擬 + finalize/reward 單元測試綠燈。剩:真 Supabase round-trip 驗證(需憑證) |
| Phase 2 — 配對/私人房/重連 | ✅ 完成(程式) | `apps/realtime`:Lobby DO 公開配對 queue、私人 joinCode registry、`/pvp?joinCode=` 解析、`reconnectToken` 發放與 `/pvp?token=` 路由;**新增重連成功路徑/座位解析/累計重連預算/Hibernation 欄位保存/大廳 queue TTL 單元測試**。剩:Phase 3 端到端瀏覽器重連 smoke(實機) |
| Phase 3 — 前端傳輸層替換 | ✅ 完成(程式) | **full cut**:`@colyseus/sdk`/schema 鏡像/`ws-browser-shim`/`:2567`/`VITE_COLYSEUS_URL`/`VITE_GAME_TRANSPORT` 全移除,**realtime 為唯一傳輸**;`state` 快照投影成既有 `view.state`、`reward_summary` 端到端、`deckId`/`accessToken` 透傳。最後一塊綁死 Colyseus 的 **dev-test PvE 已移植到 DO**([`devTest.ts`](../apps/realtime/src/devTest.ts) + worker `POST /pve/devtest` + `BotGameSession.customizeInitialMatch`,finalize env-gate 跳過,8 單元測試)。剩:瀏覽器 visual QA(PvP/私人房/重連/PvE/dev-test,實機) |
| Phase 4 — Pages + R2 部署 | ⬜ 未開始 | |
| Phase 5 — Supabase→D1(可選) | ⬜ 未開始 | 方案 B 預設**不做** |

> **Phase 0 交付重點(給下一個 session):**
> - 設計分層:`apps/realtime/src/GameSession.ts` = 純粹、可在 vitest 測試的 gameplay 編排(GameRoom 的搬遷);
>   `GameDurableObject.ts` = 薄 adapter(Hibernation WebSocket + 單一 Alarm + storage 持久化)。遊戲邏輯零改動。
> - 線路協定:JSON `{ type, payload }`,server→client 的 `type` 名稱**完全對齊**現有 web client 的
>   `onMessage` 事件,外加一個 `state`(完整 `PublicGameState` 快照,對應舊 client 的 `room.onStateChange`)。
> - **Phase 3 關鍵發現**(傳輸面測繪):web client 會直接讀 `room.state`,且整個對戰 UI 以 `view.state.matchId`
>   是否存在來 gating;但只用 room 級 `onStateChange`(無 granular schema callback),所以 adapter 只要把
>   整包 JSON 快照塞進 `view.state`(player1/player2 為 top-level 欄位、turn/specialPhase/pendingPromptId 等)即可,
>   **不需**複刻 Colyseus delta。共 10 個 onMessage 事件、2 個 send 事件,已全數確認。
> - 跑法見 `apps/realtime/README.md`:`npm run build -w @twcardgame/realtime && npm run dev -w @twcardgame/realtime`,
>   開兩個分頁打 `apps/realtime/poc/client.html`。

狀態圖例:⬜ 未開始 / 🟡 進行中 / ✅ 完成 / ⛔ 卡住(備註寫原因)

---

## 0. 先講結論(TL;DR)

1. **那篇陀螺最關鍵的「算一次」招數,對卡牌遊戲不適用** —— 你是回合互動制,每個 command 都要 `reduce`。
   但好消息:卡牌遊戲**本質上比即時遊戲更省**(沒有 60fps loop、大半時間 idle),所以 WebSocket
   Hibernation 的「沒訊息就不計費」對你**更有利**。
2. **最划算的路不是「全部重寫」,而是「絞殺者(strangler)式」只搬即時層**:
   把 Colyseus 即時伺服器換成 **PartyKit / Durable Object**,**保留 Supabase**(它的免費額度已經夠用,
   而且 Auth 是一塊很難自己重做的硬骨頭)。等穩定後再選擇性地把 DB 搬到 D1。
3. **比 raw Durable Objects 更好的做法是用 PartyKit**(已被 Cloudflare 收購,就是 DO 的官方高階封裝),
   它的 `onConnect / onMessage / broadcast` 心智模型幾乎和你現在的 `onJoin / onMessage / broadcast` 一對一。
4. **你早就做對了最難的部分**:`packages/rules` 是純函式、確定性、seeded RNG、不碰 `Date.now()` ——
   這正是「能搬到任何 runtime」的前提。`rules` 與 `shared` **幾乎原封不動**。

---

## 1. 成本現實(2026 免費額度,已查證)

| 服務 | 免費額度(2026) | 對你的意義 |
|---|---|---|
| **Workers** | ~3M 請求/月、免費方案含 Pages Functions | API 邏輯、配對入口 |
| **Durable Objects(SQLite-backed)** | 已在**免費方案**;~3M 請求/月、~390K GB-s/月運算、5GB 儲存(**單一 DO 上限 1GB**) | 一個對局/大廳 = 一個 DO |
| **WebSocket Hibernation** | 出站訊息、底層 ping 不計費;**入站訊息以 20:1 折算**請求 | 卡牌入站=玩家指令,量極少,計費可忽略 |
| **D1(SQLite)** | 5GB 儲存、**5M 讀/日、100K 寫/日** | 帳號/牌組/戰績(若決定搬離 Supabase) |
| **R2(物件儲存)** | 10GB 儲存、Class A 1M/月、Class B 10M/月、**出口流量 $0** | 卡圖/音效,**省最多的就是零出口費** |
| **Pages** | 靜態託管、500 builds/月 | 取代 Vercel 放前端 |

⚠️ **務必自己再確認**:Cloudflare 額度與計費規則會變動(SQLite DO 的儲存計費自 2026/01 起生效)。
動手前以 [官方 Durable Objects 定價頁](https://developers.cloudflare.com/durable-objects/platform/pricing/) 為準。

**對照組**:Fly.io 在 2026 已**無免費方案**(只剩 2 VM 小時/7 天試用),Railway 免費額度對「always-on
WebSocket」也撐不久。也就是說:**要長期免費跑即時對戰,Cloudflare 的休眠模型幾乎是唯一選項**(否則就是自架)。

---

## 2. 為什麼適合你的遊戲(以及哪招不適用)

### 適用 ✅
- 卡牌是**事件驅動**:只有玩家出牌那一刻 Worker 才醒來跑 `reduce`,其餘時間 DO 休眠不計費。
- 你的對局狀態天然對應「一個房間一個 Durable Object」。
- 大半時間在等對方思考 → idle 比即時遊戲更多 → 休眠紅利更大。

### 不適用 ❌
- 陀螺的「送發射參數→伺服器一次算完整場→廣播 2KB 重跑結果」靠的是**「對戰中不能操作」**。
  你的卡牌全程互動,**無法**壓縮成一次計算。這招直接放棄。

### 可以借用的精神 💡
- 你已有確定性引擎 + `eventLog`。未來可考慮**只廣播指令 + 事件 delta**讓前端重算,而非每回合送完整
  public state,進一步縮小封包。但這是優化,不是遷移前提(入站計費對卡牌本來就可忽略)。

---

## 3. 方案比較(先決定走哪條)

| 方案 | 內容 | 月成本 | 重寫量 | 適合場景 |
|---|---|---|---|---|
| **A. 維持現狀** | Colyseus 自架 / Tailscale / 便宜 VPS | 0(自架)~ $5 | 無 | 只跟朋友玩 |
| **B. 絞殺即時層(推薦)** | Colyseus→**PartyKit/DO**;**保留 Supabase**;前端→Pages;圖檔→R2 | 0(+ 網域) | 中 | 想公開、長期免費、誰都點網址就玩 |
| **C. 全 Cloudflare 化** | B + Supabase→**D1** + 自建 Auth | 0(+ 網域) | 中大 | 想完全不依賴 Supabase |
| **D. 完整重寫** | 連 rules/前端一起重做 | 0 | 巨大 | ❌ 不建議,浪費你已做對的部分 |

> **建議:走 B,並把 C 當成 B 成功後的可選續章。**
> 理由:Supabase 免費方案已能涵蓋 Auth + Postgres + 收藏/牌組/戰績,而 **Auth 是 D1 沒有、要自己重做的最痛點**。
> 先只換「會一直燒錢的即時伺服器」,風險最小、收益最大。

---

## 4. 遷移面地圖(哪些動、哪些不動)

| 套件/路徑 | 處置 | 說明 |
|---|---|---|
| `packages/rules` | ✅ **原封不動** | 純函式、確定性,可直接在 Worker/DO 的 V8 runtime 跑 |
| `packages/shared` | ✅ **原封不動** | 命令/狀態/事件契約,runtime 無關 |
| `packages/cards` | ✅ **原封不動** | 目錄資料 + 驗證 |
| `packages/db` | 🟡 B 不動 / C 改寫 | B 保留 Supabase;C 才改成 D1 + 自建 query |
| `apps/server`(Colyseus) | 🔴 **改寫** | `GameRoom`/`BotRoom`/`schema`/`index` → DO/PartyKit;**業務 hook 全可搬**(見 §5) |
| `apps/web`(`@colyseus/sdk`) | 🔴 **改傳輸層** | `new Client` / `room.onMessage` / `room.send` → 原生 WebSocket;**渲染/動畫完全不動** |
| 卡圖、音效 | 🟡 搬到 R2 | 換 CDN 來源 URL |
| 前端部署 | 🟡 Vercel→Pages | 純設定 |

**關鍵洞察**:`apps/server` 裡真正綁死 Colyseus 的只有「傳輸 + 房間生命週期 + schema 同步」。
你的對局邏輯早就抽在 `reduce / toPublicState / toHandView / toPromptChoiceOffer` 後面,
**搬家時這些函式呼叫一行都不用改**。

---

## 5. Colyseus → Durable Object / PartyKit 功能對照

你目前在 [GameRoom.ts](../apps/server/src/GameRoom.ts) 用到的每個 Colyseus 能力,都有對應做法:

| 你現在用的 Colyseus | 用途 | DO / PartyKit 對應 | 工作量 |
|---|---|---|---|
| `Room` 生命週期 `onCreate/onJoin/onLeave/onDispose` | 房間生命週期 | PartyKit `onStart/onConnect/onClose` 或 DO `fetch`+WebSocket | 中 |
| `setState` + Schema delta 同步 | 自動增量同步公開狀態 | **自己送**:你已有 `toPublicState`,改成 broadcast JSON(或自做 delta) | 中(最主要工作) |
| `onMessage("command")` | 收指令 | `onMessage` → 解析 JSON → 走原本的 `applyEnvelope` | 低 |
| `client.send` / `broadcast` | 推 hand / publicSync / events | `conn.send` / `room.broadcast`(語意幾乎相同) | 低 |
| `allowReconnection(client, sec)` | 斷線重連視窗 | DO 內自管:連線帶 `sessionId`,保留 seat→budget 映射,Hibernation 友善 | 中 |
| `this.clock.setTimeout` | 回合/階段倒數 | **DO Alarms**(`storage.setAlarm`)——休眠也能準時喚醒 | 中 |
| `lock()/setPrivate()/setMetadata()/filterBy(["joinCode"])` | 配對/私人房 | 一個 **Lobby DO** 或 D1/KV 維護 joinCode→roomId(取代 [privateRooms.ts](../apps/server/src/privateRooms.ts) 的記憶體 Map) | 中 |
| `@colyseus/monitor` | 後台 | 拿掉或自建簡易管理頁 | 低 |
| `onBeforeShutdown` 排空 | 優雅關機 | DO 無「關機」概念,改用 Alarms + 持久化 | 低 |

> **DO Alarms 是這裡的隱形英雄**:它讓「休眠中的對局」也能在回合時限到時被準時叫醒跑 timeout 指令,
> 完美取代 `clock.setTimeout`,且不需要房間一直醒著。這是把 [GameRoom.ts](../apps/server/src/GameRoom.ts)
> 的 `scheduleActionDeadline / handleActionDeadline / handlePhaseDeadline` 搬過去的標準解法。

---

## 6. 分階段 Roadmap

> 每階段都有明確產出與驗收;**強烈建議 PoC 先行**,確認可行再投入大改。

### Phase 0 — 技術驗證 PoC(1–2 天)
**目標**:證明「DO + 你的 `reduce` + 原生 WebSocket」能跑完一局。
- 建一個最小 PartyKit/Worker 專案,引入 `@twcardgame/rules` 與 `@twcardgame/shared`。
- 一個 DO 房:收 `command` → `reduce` → broadcast `publicSync` + 私發 `hand`。
- 一個極簡 HTML 客戶端用原生 `WebSocket` 跑兩個分頁互打。
- **驗收**:兩個瀏覽器分頁能用同一房號完成一局(含勝負結算)。不需要 Auth/Timer/重連。
- **決策點**:若 PoC 順利 → 繼續;若 DO 限制踩雷 → 回頭考慮方案 A 自架。

### Phase 1 — 即時層平移(核心工作)
**目標**:DO 房達到 Colyseus `GameRoom` 的功能對等。
- 移植 `applyEnvelope` 流程:`reduce → publicSync → events → hand`(直接呼叫現有函式)。
- 移植**私有狀態分流**:`toHandView` / `amplificationOptions` / `toPromptChoiceOffer`(per-seat 私發,別洩漏進公開狀態 —— 這是架構不變條款)。
- 移植**回合/階段倒數**:`clock.setTimeout` → **DO Alarms**;搬 `handleActionDeadline`/`handlePhaseDeadline` 的 timeout 指令邏輯。
- 移植 **mulligan / 特殊階段** 流程。
- **驗收**:不含帳號的 PvP,一局含倒數逾時自動結束,行為與現版一致。

### Phase 2 — 配對、私人房、重連
**目標**:取代 Colyseus matchmaking 與 `privateRooms.ts`。
- **Lobby DO**(或 Worker + D1/KV)維護 joinCode↔roomId,複刻 [privateRooms.ts](../apps/server/src/privateRooms.ts)。
- 私人房建立/加入流程(對應 `createPrivateChallenge` / `joinPrivateByCode`)。
- 重連:連線帶 `sessionId`/token,DO 內維護 seat→reconnectBudget(複刻 `nextReconnectBudgetMs`),Hibernation 下保留。
- **驗收**:朋友用房號加入;中途刷新頁面能回到原座位續玩。

### Phase 3 — 前端傳輸層替換
**目標**:`apps/web` 改用原生 WebSocket,渲染零改動。
- 把 `new Client(...)` / `room.onMessage(...)` / `room.send(...)` 抽成一層 transport adapter,
  對外維持現有事件介面(`seat/hand/publicSync/events/presence/amplificationOptions/promptChoice/reward_summary`)。
- 移除 `@colyseus/sdk` 與客戶端 schema 鏡像([apps/web/src/schema.ts](../apps/web/src/schema.ts))。
- `VITE_COLYSEUS_URL` → 改成指向 Worker 的 `wss://` 入口(注意 [config.ts](../apps/web/src/app/config.ts) 目前會推斷 `:2567`,要改)。
- **驗收**:整個現有 UI/動畫在新傳輸層上行為一致(用 [twcardgame-visual-qa] 跑一輪)。

### Phase 4 — 靜態資產 + 部署
**目標**:Vercel→Pages、圖檔→R2。
- 卡圖/音效上傳 R2,前端改用 R2 來源 URL(零出口費)。
- 前端用 Cloudflare Pages 部署;設好 `VITE_*` 環境變數與自訂網域。
- **驗收**:從你的網域點開能完整遊玩,資產走 R2/CDN。

### Phase 5(可選,方案 C)— 搬離 Supabase 到 D1
**目標**:完全 Cloudflare 化。**只有想擺脫 Supabase 才做。**
- `packages/db` 改寫:Supabase queries → D1 SQL;搬移 RLS 邏輯到 Worker 層授權。
- **Auth 是最大難點**:Supabase Auth 沒有等價免費替代。選項:
  (a) 封閉小圈子 → **Cloudflare Access** 擋登入;
  (b) 自建 JWT(Worker 簽發 + 驗證);
  (c) 維持 Supabase Auth 只當身分供應商,其餘搬 D1(混合)。
- **驗收**:帳號、牌組、收藏、戰績、獎勵全走 D1,Supabase 可下線。

> **PvE / BotRoom**:`bot.decide` 也是純函式,Phase 1–2 期間 [BotRoom.ts](../apps/server/src/BotRoom.ts)
> 的「定時送出 bot 指令」邏輯改用 DO Alarms 來 pacing 即可,決策邏輯一行不改。

---

## 7. 風險與決策點

| 風險 | 影響 | 緩解 |
|---|---|---|
| DO 免費額度/計費規則變動 | 成本失準 | 動手前查官方頁;入站 20:1 對卡牌可忽略 |
| 單一 DO 1GB 儲存上限(免費) | 對局狀態爆量 | 對局狀態極小(KB 級),無虞;戰績放 D1/Supabase |
| 失去 Colyseus 的 schema 自動 delta | 要自己做狀態同步 | 先送完整 `toPublicState`(夠用),之後再優化成 delta |
| 失去 Supabase Auth(僅方案 C) | 要自建登入 | 走方案 B 先不碰;或用 Cloudflare Access |
| 重連 + Hibernation 互動細節 | 邊角 bug | Phase 0 PoC 早點驗證;保留 sessionId 對應 |
| 前端傳輸層替換波及動畫時序 | 視覺回歸 | adapter 維持相同事件介面;visual-qa 把關 |

---

## 8. 建議的下一步

1. **先決定方案**(建議 B)。
2. **做 Phase 0 PoC**(1–2 天):這是整個計畫風險最高、但最便宜的驗證,做完就知道值不值得全力投入。
3. PoC 用 **PartyKit**(DO 的高階封裝)起手最快;若想完全掌控再降到 raw Durable Objects。

需要的話,下一步我可以直接幫你把 **Phase 0 PoC 的骨架**(PartyKit server + 引入 `@twcardgame/rules`
+ 一個最小原生 WebSocket 客戶端)寫出來,讓你當天就能兩個分頁對打驗證可行性。

---

## 參考來源
- [Cloudflare Durable Objects 定價](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [SQLite-backed Durable Objects 限制](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Cloudflare D1 限制](https://developers.cloudflare.com/d1/platform/limits/) ／ [D1 定價](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare R2 定價(零出口)](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare 收購 PartyKit](https://blog.cloudflare.com/cloudflare-acquires-partykit/) ／ [PartyKit 運作原理](https://docs.partykit.io/how-partykit-works/)
- [Durable Objects 適合 turn-based 遊戲(官方 best practices)](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Fly.io 2026 免費方案現況](https://www.saaspricepulse.com/blog/flyio-free-tier-2026)
