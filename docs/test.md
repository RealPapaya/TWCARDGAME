
Terminal 1 — 啟動 Colyseus 伺服器


npm run dev:server
等到看到 Listening on ws://localhost:2567

Terminal 2 — 啟動 Vite 客戶端


npm run dev:web
等到看到 Local: http://localhost:5173

Terminal 3 — 執行 Playwright e2e 測試


node e2e/game-loop.spec.mjs
測試會自動打開兩個 Chrome 視窗（非 headless），跑完後在 Terminal 3 印出結果，格式如下：


══════════════════════════════════════════
  Playwright E2E — Core Game Loop Results
══════════════════════════════════════════
  ✓  Both players joined
  ✓  Game reached in_progress after mulligan (TURN_STARTED seen)
  ✓  Step 1: CARD_PLAYED on both pages
  ...
  Total: 12  Passed: 12  Failed: 0
══════════════════════════════════════════
注意事項：

若伺服器 port 2567 仍被上次的 process 佔用，先 Get-Process node | Stop-Process 再重啟
Vite 需要重啟（Ctrl+C 再 npm run dev:web）才能吃到 vite.config.ts 的新設定