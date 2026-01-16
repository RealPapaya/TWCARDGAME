---
description: 寶島遊戲王 (TWCARDGAME) 模組化架構開發規範
---

# 模組化架構開發規範 (Modular Architecture Standard)

本技能定義了專案從舊版單一檔案 (`app.js`) 遷移至現代化模組架構的標準與工作流程。所有新功能的開發與重構**必須**嚴格遵守此規範。

## 0. 語言與溝通 (Language & Communication)

- **中文優先**: 所有的 Implementation Plan、註解、文件說明，**必須使用繁體中文**撰寫，確保團隊溝通無礙。
- **術語統一**: 遊戲內術語 (如「戰吼」、「手牌」、「法力」) 請參照 `translations.js` 或現有遊戲內容，保持一致。

## 1. 核心原則 (Core Principles)

- **關注點分離 (Separation of Concerns)**: 邏輯 (Logic) 與 顯示 (UI) 必須完全分開。
- **單一真值來源 (Single Source of Truth)**: `GameState` 是唯一的狀態持有者。
- **依賴注入 (Dependency Injection)**: 禁止隱式依賴全域變數，依賴項目必須透過參數傳遞。

## 2. 目錄結構與檔案職責 (Directory Structure & File Responsibilities)

每個檔案都必須遵守統一的邏輯職責：

```
src/
├── logic/          # 純遊戲邏輯 (Pure JS)
│   ├── GameState.js    # 狀態模型 (Players, Board, Hand)
│   ├── GameEngine.js   # 遊戲控制器 (Turn, Phases)
│   └── AIEngine.js     # AI 決策
│
├── ui/             # 視覺與互動
│   ├── VisualEffects.js # 粒子、動畫、特效
│   ├── DragManager.js   # 拖曳與輸入
│   ├── AuthUI.js        # (待遷移) 登入/註冊介面
│   └── RenderEngine.js  # (未來) 核心渲染器
│
├── auth/           # (新增) 認證系統
│   └── AuthManager.js   # (待遷移) Firebase/Local 登入邏輯
│
├── system/         # (新增) 系統功能
│   └── Updates.js       # (待遷移) 更新日誌與版本控制
│
├── i18n/           # (新增) 多語系
│   └── translations.js  # (原 ui_translations.js)
│
├── styles/         # (新增) 樣式表
│   └── main.css    # (原 style.css，未來可拆分為 components/)
│
├── data/           # 靜態資料
│   ├── cards.js    # (原 card_data.js)
│   └── decks.js    # (原 default_decks.js)
│
├── legacy/         # 舊代碼暫存區 (最終需清空)
│   └── app.js      # 正在拆解的 Monolith
│
└── main.js         # 新架構入口點
    # 職責: 系統啟動與依賴組裝

其他目錄:
tools/              # 開發與維護腳本 (如 process_cursor.ps1)
public/             # 靜態資源 (原 img/ 移動至 public/assets/)


│
├── legacy/         # 舊代碼暫存區
│   └── app.js      # 正在被拆解的舊核心，最終應完全移除。
│
└── main.js         # 新架構入口點 (Entry Point)
    # 職責: 系統啟動與依賴組裝
    # 邏輯: 初始化 GameEngine -> 掛載 RenderEngine -> 綁定 DragManager -> 啟動遊戲迴圈。
```

## 3. 開發規則 (Development Rules)

### 3.1 邏輯層 (Logic Layer)
- **禁止 DOM 操作**: `src/logic` 下的檔案**嚴禁**使用 `document` 或 `window`。
- **純函式優先**: 盡量設計為輸入 State -> 輸出 New State。
- **事件驅動**: 邏輯層發生變化時，應發出事件或呼叫回調，而非直接呼叫渲染函式。

### 3.2 UI 層 (UI Layer)
- **集中視覺效果**: 所有動畫必須寫在 `VisualEffects.js`。
- **異步動畫**: 需要等待的動畫 (如卡牌預覽入場)，應使用 `async/await`，確保邏輯流程在動畫完成後才繼續。

### 3.3 遺留代碼介接 (Legacy Interop)
- 必須使用**依賴注入**。
- **錯誤**: `const p1 = window.gameState.players[0];`
- **正確**: `export function doSomething(gameState) { ... }`

### 3.4 代碼清潔 (Code Hygiene)
- **即時刪除**: 當舊代碼因重構而不再被使用時，**必須立即刪除**，不要註解掉或保留在檔案中。保持代碼庫乾淨是防止技術債累積的關鍵。

## 4. 重構工作流 (Refactoring Workflow)

1. **Plan (繁體中文)**: 在 `implementation_plan.md` 中用中文規劃重構範圍。
2. **Move Logic**: 將邏輯移至 `src/logic`，寫單元測試驗證。
3. **Move UI**: 將視覺移至 `src/ui`。
4. **Wiring**: 在 `main.js` 或 `app.js` 中連接新模組。
5. **Verify**: 確認 `dev.html` 運作正常。
