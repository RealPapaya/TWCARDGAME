---
name: Parallel Development Workflow
description: 用於重構舊代碼庫的工作流程，通過使用平行入口點（dev.html）確保不破壞生產環境。
---

# 平行開發工作流程 (Parallel Development Workflow)

當重構關鍵或遺留代碼（特別是引入 ES Modules 或重大架構變更）時，**絕對不要**直接修改生產環境的入口點（`index.html`），直到新的實作經過完全驗證。

## 1. 黃金法則
> **「生產環境必須隨時保持可遊玩狀態。」**

## 2. 工作流程步驟

### 步驟 1：建立沙盒 (Sandbox)
複製入口檔案（例如 `dev.html`）作為開發環境。
-   **來源**：`index.html`（生產環境 - 舊版）
-   **目標**：`dev.html`（開發環境 - 現代化/模組化）

### 步驟 2：由下而上模組化 (Modularize Bottom-Up)
分階段重構代碼，從最獨立的模組（資料層）開始，向上到依賴性最高的模組（UI 層）。

1.  **資料層 (Data Layer)**：提取常數和資料（例如 `card_data.js` -> `src/data/cards.js`）。
2.  **邏輯層 (Logic Layer)**：提取業務邏輯（例如 `game_engine.js` -> `src/logic/GameEngine.js`）。
3.  **UI 層 (UI Layer)**：提取 DOM 操作和事件處理器。

### 步驟 3：雙重連結 (Dual Linking)
在過渡期間，如果檔案部分被重構，可能需要以兩種狀態存在：
-   **舊版**：`app.js`（由 `index.html` 載入）
-   **新版**：`src/main.js`（由 `dev.html` 以 `type="module"` 載入）

### 步驟 4：驗證 (Verification)
使用 `dev.html` 驗證新模組。`dev.html` 中的遊戲功能必須與 `index.html` 1:1 完全一致。

### 步驟 5：切換 (The Switch)
只有當 `dev.html` 功能完全正常且經過測試後：
1.  備份 `index.html`（選用，但強烈建議）。
2.  用 `dev.html` 的內容替換 `index.html`。
3.  刪除 `dev.html`。

## 3. 應避免的反模式 (Anti-Patterns)
-   ❌ 在模組準備好之前，就更改 `index.html` 中的 `<script>` 標籤。
-   ❌ 在沒有打包工具的情況下，由同一個檔案中混合使用 `require` 和 `import`。
-   ❌ 在新模組於 `dev.html` 驗證通過之前，就刪除舊檔案。

## 4. 待辦重構任務 (Pending Refactoring Tasks)

- [ ] **導入 Import Maps**: 
    在 `dev.html` 中設置 `<script type="importmap">`，定義 `src/logic/`、`src/ui/` 等路徑別名，簡化模組引用 (例如 `import { GameEngine } from 'logic/GameEngine.js'`)。

- [ ] **狀態存取監控 (Proxy Debugging)**: 
    將 `window.gameState` 包裝為 `Proxy`，攔截並記錄所有寫入操作 (`set` trap)。若發現非預期的修改（如 UI 直接改值而非透過 GameEngine），則在控制台輸出警告與堆疊追蹤。

- [ ] **提取核心遊戲引擎 (GameEngine Extraction)**: 
    將 `app.js` 中的核心對戰流程（回合管理、抽牌邏輯、法力計算）遷移至 `src/logic/GameEngine.js`。
    - 目標：使 `app.js` 僅負責 DOM 事件綁定與 UI 渲染調度。

- [ ] **CSS 模組化 (CSS Modularization)**: 
    拆解龐大的 `style.css`。
    - 建立 `src/styles/` 目錄。
    - 按功能拆分：`base.css`, `layout.css`, `components/card.css`, `components/board.css`, `animations.css`。
    - 在 `dev.html` 中使用多個 `<link>` 或 `@import` 引入。
