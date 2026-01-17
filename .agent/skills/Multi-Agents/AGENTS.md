# 寶島保護戰 (TWCARDGAME) Multi-Agent 職位分配表

為了讓《寶島保護戰》的開發流程更順暢、代碼更模組化，我們採用 Multi-Agent 協作模式。
以下是本專案的 Agent 職位定義、職責與工作流程。

## 1. 核心團隊 (Agent Roles)

### 🧑‍💼 1. Project Manager (PM) - 專案經理
*   **代號**: `PM_Agent`
*   **職責**:
    *   **任務管理**: 維護 `.agent/task.md`，追蹤進度。
    *   **資源調度**: 決定目前需要哪位 Agent 介入，並確保他們遵循 `.agent/skills/` 中的規範。
    *   **需求分析**: 將使用者的需求轉化為具體的開發任務。
    *   **文檔維護**: 
        *   **對內**: 熟讀並維護 `.agent/skills` 下的工作流與規範。
        *   **對外**: 協助使用者維護 `README.md` (作為使用者的專案入口)。
*   **關注文件**: `task.md`, `.agent/skills/*`

### 🎨 2. Game Designer (GD) - 遊戲企劃
*   **代號**: `Design_Agent`
*   **職責**:
    *   **卡牌設計**: 構思新卡牌的數值、關鍵字與技能 (Battlecry)。
    *   **風格定義**: 確立 **AI Game Style** (如：手繪中古世紀與現代科技的衝突美感)。
    *   **邏輯設計**: 定義打牌的邏輯流程 (Card Playing Logic)，不僅是規則，還包含玩家決策的引導與流暢度。
    *   **敘事**: 定義卡牌的描述 (`description`) 與名稱。
*   **關注文件**: `src/data/cards.js`, `card_data.js`

### 🏗️ 3. Core Logic Engineer (Core) - 核心邏輯工程師
*   **代號**: `Logic_Agent`
*   **職責**:
    *   **規則實作**: 維護 `game_engine.js`，實作回合流程、戰鬥計算、勝負判定。
    *   **技能系統**: 實作 `battlecry` 的具體邏輯。
    *   **模組化重構**: 負責將 `app.js` 中的遊戲邏輯拆分至 `src/logic/` 目錄。
*   **關注文件**: `game_engine.js`, `src/logic/*.js`

### 💅 4. Frontend Developer (FE) - 前端工程師
*   **代號**: `Frontend_Agent`
*   **職責**:
    *   **UI/UX Pro Max**: 嚴格執行「Visual Excellence」與「Dynamic Design」標準 (參考 Global UI/UX Skill)。
    *   **介面開發**: 維護 `index.html` 與 `style.css`，確保介面達到 Premium 等級。
    *   **互動體驗**: 實作細膩的卡牌互動、粒子特效與轉場動畫。
    *   **RWD**: 確保 16:9 完美適配。
*   **關注文件**: `style.css`, `index.html`, Global UI/UX Skill

### 🧪 5. QA Engineer (QA) - 測試工程師
*   **代號**: `QA_Agent`
*   **職責**:
    *   **功能驗證**: 測試新卡牌是否能正常打出、技能是否生效。
    *   **Bug 追蹤**: 記錄並重現遊戲中的錯誤 (Glitch, Logic Error)。
    *   **自動化測試**: 編寫簡單的單元測試或整合測試腳本。
*   **關注文件**: `dev.html` (開發測試入口), `tests/` (如有)

---

## 2. 協作工作流程 (Workflows)

### 📌 案例 A：新增一張功能型卡牌 (Function Card)
1.  **PM**: 收到需求，建立任務卡。
2.  **GD**: 設計卡牌數值與技能 ID，更新 `card_data.js`。
3.  **Logic**: 在 `game_engine.js` 實作該技能的具體效果 (Function)。
4.  **FE**: 如果有特殊視覺效果 (如全場震動)，在 View 層實作。
5.  **QA**: 在 `dev.html` 進行測試，確認無誤後回報 PM。

### 📌 案例 B：UI 介面改版 (UI Revamp)
1.  **PM**: 定義改版目標 (如：更換設定選單)。
2.  **FE**: 修改 `index.html` 結構與 `style.css` 樣式。
3.  **Logic**: 確保 UI 改動不影響底層 State 變數。
4.  **QA**: 檢查 RWD 與按鈕響應是否正常。

## 3. 當前專案狀態與建議
目前專案處於 **「重構與新功能並行」** 階段。
*   **High Priority**: 繼續將 `app.js` 的龐大邏輯拆分 (Refactoring)。
*   **Action Item**: 請 `Logic_Agent` 優先處理 `src/logic/Player.js` 的完整整合。
