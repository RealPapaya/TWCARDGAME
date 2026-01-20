---
name: TW Card Game 開發規範
description: 台灣卡牌遊戲專案的嚴格開發規範,所有改動必須遵守
---

# TW Card Game 開發規範

## 🎯 核心原則

### 1. 模組化架構
所有代碼必須遵循嚴格的模組化原則:

- **單一職責原則**: 每個模組只負責一個明確的功能
- **低耦合高內聚**: 模組之間的依賴關係必須清晰且最小化
- **可測試性**: 所有模組必須可以獨立測試

### 2. 代碼清理原則
**在進行任何改動前,必須先檢查並清理無用代碼:**

- ✅ 刪除未使用的函數
- ✅ 刪除未使用的變數
- ✅ 刪除註解掉的舊代碼
- ✅ 刪除重複的代碼
- ✅ 移除未引用的 CSS 樣式
- ✅ 移除未使用的圖片資源

### 3. 改動前必讀
**凡是改動都要先閱讀此 SKILL.md 文件,確保完全理解並遵守所有規範。**

---

## 📁 專案架構

### 核心模組劃分

```
TWCARDGAME/
├── core/                    # 核心遊戲邏輯
│   ├── GameEngine.js       # 遊戲引擎
│   ├── GameState.js        # 遊戲狀態管理
│   └── CardDatabase.js     # 卡牌資料庫
├── ui/                      # UI 相關
│   ├── UIManager.js        # UI 管理器
│   ├── AnimationManager.js # 動畫管理器
│   └── components/         # UI 組件
├── auth/                    # 認證系統
│   └── auth_manager.js     # 認證管理器
├── utils/                   # 工具函數
│   └── helpers.js          # 輔助函數
├── assets/                  # 資源文件
│   ├── audio/              # 音效資源
│   │   ├── bgm/            # 背景音樂
│   │   └── sfx/            # 音效
│   └── images/             # 圖片資源
│       ├── avatars/        # 頭像
│       ├── backgrounds/    # 背景圖
│       ├── cards/          # 卡牌圖
│       ├── cursors/        # 游標圖
│       ├── illustrations/  # 插畫
│       └── ui/             # UI 介面圖
└── styles/                  # 樣式文件
    ├── style.css           # 主樣式
    └── components/         # 組件樣式
```

---

## 🔧 開發流程

### 測試環境

**本地測試伺服器**: http://localhost:5500/index.html

- 所有改動都應該在本地伺服器上即時驗證
- 使用 Live Server 或類似工具來運行本地伺服器
- 測試前務必清除瀏覽器快取 (Ctrl+F5)

### 改動前檢查清單

在進行任何改動前,**必須**完成以下檢查:

1. **閱讀此 SKILL.md** - 確保理解所有規範
2. **檢查相關模組** - 理解現有代碼結構
3. **識別無用代碼** - 使用工具或手動檢查
4. **規劃改動範圍** - 明確改動的影響範圍
5. **確認模組邊界** - 不要跨越模組職責

### 改動執行流程

```
1. 清理階段
   ├─ 刪除無用代碼
   ├─ 整理現有結構
   └─ 確保代碼乾淨

2. 實作階段
   ├─ 遵循模組化原則
   ├─ 添加必要註解
   └─ 保持代碼簡潔

3. 驗證階段
   ├─ 在 http://localhost:5500/index.html 測試
   ├─ 檢查是否引入新的無用代碼
   └─ 確認模組邊界清晰
```

---

## 📝 編碼規範

### JavaScript 規範

```javascript
// ✅ 好的範例: 清晰的模組化函數
class CardManager {
    constructor(database) {
        this.database = database;
    }
    
    // 單一職責: 只負責獲取卡牌
    getCard(cardId) {
        return this.database.find(card => card.id === cardId);
    }
    
    // 單一職責: 只負責驗證卡牌
    validateCard(card) {
        return card && card.cost >= 0 && card.name;
    }
}

// ❌ 壞的範例: 職責混亂
class BadCardManager {
    getCardAndRender(cardId) {  // 違反單一職責
        const card = this.database.find(c => c.id === cardId);
        document.getElementById('card').innerHTML = card.name; // UI 邏輯不該在這
        return card;
    }
}
```

### CSS 規範

```css
/* ✅ 好的範例: 模組化的 CSS */
.card {
    /* 基礎樣式 */
}

.card--highlighted {
    /* 狀態修飾 */
}

.card__title {
    /* 子元素樣式 */
}

/* ❌ 壞的範例: 過度具體的選擇器 */
#game-board .player-area .card-container .card .title {
    /* 太深的嵌套 */
}
```

### 命名規範

- **變數/函數**: camelCase (例: `getUserDeck`, `cardList`)
- **類別**: PascalCase (例: `GameEngine`, `CardManager`)
- **常數**: UPPER_SNAKE_CASE (例: `MAX_HAND_SIZE`, `DEFAULT_HEALTH`)
- **CSS 類別**: kebab-case (例: `card-container`, `player-area`)
- **檔案名稱**: PascalCase.js 或 kebab-case.css

---

## 🗑️ 代碼清理指南

### 識別無用代碼的方法

1. **未使用的函數**
   ```javascript
   // 搜尋函數定義,檢查是否有調用
   function unusedFunction() { } // 如果沒有任何地方調用,刪除!
   ```

2. **未使用的變數**
   ```javascript
   const unusedVar = 10; // 如果從未讀取,刪除!
   ```

3. **註解掉的代碼**
   ```javascript
   // const oldCode = "delete this";
   // function oldFunction() { }
   // 直接刪除,不要保留!使用 Git 來追蹤歷史
   ```

4. **重複的代碼**
   ```javascript
   // 如果發現相同邏輯出現多次,提取成共用函數
   function extractCommonLogic() { }
   ```

### 清理工具建議

- 使用 IDE 的「尋找參考」功能
- 使用 ESLint 檢查未使用的變數
- 定期進行代碼審查

---

## ✅ 改動檢查清單

每次提交前,確認以下項目:

- [ ] 已閱讀此 SKILL.md
- [ ] 已刪除所有無用代碼
- [ ] 遵循模組化原則
- [ ] 函數職責單一且清晰
- [ ] 沒有重複代碼
- [ ] CSS 樣式有被使用
- [ ] 圖片資源有被引用
- [ ] 代碼有適當註解(繁體中文)
- [ ] 已測試功能正確性
- [ ] 沒有引入新的技術債

---

## 🚫 禁止事項

1. **禁止**在不清理舊代碼的情況下添加新功能
2. **禁止**創建職責不清的「萬能」函數
3. **禁止**保留註解掉的舊代碼
4. **禁止**使用全域變數(除非絕對必要)
5. **禁止**跨模組直接訪問內部狀態
6. **禁止**在 HTML 中內嵌大量 JavaScript
7. **禁止**使用 `!important` (除非處理第三方樣式衝突)

---

## 📚 模組職責定義

### GameEngine.js
- ✅ 遊戲規則邏輯
- ✅ 回合管理
- ✅ 卡牌效果處理
- ❌ UI 渲染
- ❌ 動畫控制

### UIManager.js
- ✅ DOM 操作
- ✅ 視圖切換
- ✅ 事件綁定
- ❌ 遊戲邏輯
- ❌ 狀態管理

### GameState.js
- ✅ 狀態存儲
- ✅ 狀態查詢
- ✅ 狀態更新
- ❌ UI 更新
- ❌ 業務邏輯

### auth_manager.js
- ✅ 用戶認證
- ✅ 登入/登出
- ✅ Session 管理
- ❌ 遊戲邏輯
- ❌ UI 渲染

---

## 🎨 UI/UX 規範

### 中世紀主題一致性
- 所有 UI 元素必須符合手繪中世紀風格
- 禁止使用霓虹色或現代化元素
- 按鈕、面板、卡牌必須有統一的視覺語言

### 動畫規範
- 所有動畫必須流暢(60fps)
- 動畫時長應合理(通常 200-500ms)
- 避免過度動畫導致的性能問題

### 響應式設計
- 必須支援 16:9 比例
- 使用黑邊確保內容不變形
- UI 元素必須按比例縮放

---

## 🔍 代碼審查要點

在提交改動前,自我審查:

1. **可讀性**: 其他開發者能否快速理解?
2. **可維護性**: 未來修改是否容易?
3. **性能**: 是否有明顯的性能問題?
4. **安全性**: 是否有潛在的安全風險?
5. **一致性**: 是否符合專案風格?

---

## 📖 註解規範

所有註解必須使用**繁體中文**:

```javascript
/**
 * 計算卡牌的實際費用
 * @param {Object} card - 卡牌物件
 * @param {Object} gameState - 當前遊戲狀態
 * @returns {number} 實際費用
 */
function calculateCardCost(card, gameState) {
    // 檢查是否有費用減免效果
    const reduction = getCostReduction(card, gameState);
    return Math.max(0, card.cost - reduction);
}
```

---

## 🎯 總結

**記住三大原則:**

1. **改動前先清理** - 刪除無用代碼
2. **嚴格模組化** - 職責清晰,低耦合
3. **必讀此文件** - 每次改動前都要閱讀

**違反此規範的代碼將不被接受!**

---

## 📡 後端 (Google Apps Script) 規範

### 寶島遊戲王 後端 v2.0 - 完整版

此代碼部署於 Google Sheets 的 Apps Script 中，負責處理：
- **認證 (Auth)**: 註冊、登入
- **資料庫 (DB)**: 讀寫 Google Sheets
- **排行榜 (Leaderboard)**: 讀取並排序玩家資料
- **好友系統 (Friend System)**: 好友邀請、接受、拒絕、刪除

```javascript
/* 寶島遊戲王 後端 v2.0 - 完整版 (含好友系統與排行榜) */
function doGet(e) {
  var action = e.parameter.action;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().toLowerCase().trim(); });
  
  var JSONResponse = function(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };
  
  // 輔助函數：搜尋玩家所在的列號 (不分大小寫)
  var findRowByUsername = function(name) {
    var uIdx = headers.indexOf("username");
    if (uIdx === -1) return -1;
    var searchName = name.toString().toLowerCase().trim();
    for (var i = 1; i < data.length; i++) {
        if (data[i][uIdx].toString().toLowerCase().trim() === searchName) return i + 1;
    }
    return -1;
  };

  // ========== 排行榜 API ==========
  if (action === 'leaderboard') {
    var sortBy = e.parameter.sortBy || 'level';
    var limit = parseInt(e.parameter.limit || 50);
    var offset = parseInt(e.parameter.offset || 0);
    
    var players = [];
    var levelIdx = headers.indexOf("level");
    var usernameIdx = headers.indexOf("username");
    var goldIdx = headers.indexOf("gold");
    var statsIdx = headers.indexOf("stats");
    
    // 找到 selected_avatar 欄位（可能有底線或沒有）
    var selectedAvatarIdx = headers.indexOf("selectedavatar");
    if (selectedAvatarIdx === -1) selectedAvatarIdx = headers.indexOf("selected_avatar");
    
    var selectedTitleIdx = headers.indexOf("selectedtitle");
    if (selectedTitleIdx === -1) selectedTitleIdx = headers.indexOf("selected_title");
    
    // 收集所有玩家資料
    for (var i = 1; i < data.length; i++) {
      var playerObj = {
        username: data[i][usernameIdx],
        level: parseInt(data[i][levelIdx] || 1),
        gold: parseInt(data[i][goldIdx] || 0),
        stats: data[i][statsIdx] || "{}",
        selectedavatar: selectedAvatarIdx !== -1 ? data[i][selectedAvatarIdx] : "avatar1",
        selectedtitle: selectedTitleIdx !== -1 ? data[i][selectedTitleIdx] : "beginner"
      };
      players.push(playerObj);
    }
    
    // 排序
    players.sort(function(a, b) {
      if (sortBy === 'level') return b.level - a.level;
      if (sortBy === 'gold') return b.gold - a.gold;
      return 0;
    });
    
    // 分頁
    var pagedPlayers = players.slice(offset, offset + limit);
    
    return JSONResponse({ success: true, players: pagedPlayers, total: players.length });
  }

  // ========== 帳號註冊 ==========
  if (action === 'register') {
    var username = e.parameter.username;
    var password = e.parameter.password;
    
    for (var i = 1; i < data.length; i++) {
        if (data[i][0] == username) return JSONResponse({ success: false, message: "帳號已被使用" });
    }
    
    var newRow = new Array(headers.length).fill("");
    var setVal = function(name, val) {
      var idx = headers.indexOf(name.toLowerCase().trim());
      if (idx !== -1) newRow[idx] = val;
    };
    
    // 起始卡牌包 (20 種 x 2 張)
    var defaultStarterCards = {
      'TW001':2,'TW003':2,'TW004':2,'TW005':2,'TW030':2,'TW053':2,'TW006':2,'TW007':2,
      'TW008':2,'TW013':2,'TW012':2,'TW017':2,'S006':2,'S009':2,'S016':2,'S022':2,
      'S026':2,'TW068':2,'TW027':2,'TW028':2
    };
    var starterCollection = e.parameter.owned_cards || JSON.stringify(defaultStarterCards);
    
    // 初始資料賦值
    setVal("username", username);
    setVal("password", password);
    setVal("level", 1);
    setVal("gold", 100);
    setVal("vouchers", 0);
    setVal("deck_data", "[]");
    setVal("selected_avatar", "avatar1");
    setVal("selected_title", "beginner");
    setVal("owned_avatar", '["avatar1"]');
    setVal("owned_titles", '["beginner"]');
    setVal("owned_cards", starterCollection);
    setVal("stats", "{}");
    setVal("defeated_ai", "[]");
    setVal("current_xp", 0);
    setVal("last_saved", Date.now());
    setVal("friends", "[]");
    setVal("friend_requests", "[]");
    
    sheet.appendRow(newRow);
    SpreadsheetApp.flush();
    return JSONResponse({ success: true, message: "註冊成功" });
  }

  // ========== 登入 & 搜尋玩家 ==========
  if (action === 'login' || action === 'search_user') {
    var target = e.parameter.username;
    var rowNum = findRowByUsername(target);
    if (rowNum === -1) return JSONResponse({ success: false, message: "找不到玩家" });
    
    if (action === 'login') {
      var pass = e.parameter.password;
      var pIdx = headers.indexOf("password");
      if (data[rowNum-1][pIdx] != pass) return JSONResponse({ success: false, message: "密碼錯誤" });
    }
    
    var user = {};
    for (var j = 0; j < headers.length; j++) {
        var key = headers[j].replace(/_/g, "");
        user[key] = data[rowNum-1][j];
    }
    return JSONResponse({ success: true, data: user });
  }

  // ========== 好友操作 ==========
  if (action === 'friend_op') {
    var type = e.parameter.type; 
    var username = e.parameter.username;
    var targetId = e.parameter.targetId;
    
    var userRow = findRowByUsername(username);
    var targetRow = findRowByUsername(targetId);
    
    if (userRow === -1) return JSONResponse({ success: false, message: "無法識別您的帳號資訊" });
    if (targetRow === -1) return JSONResponse({ success: false, message: "目標玩家不存在" });
    
    var fIdx = headers.indexOf("friends"), rIdx = headers.indexOf("friend_requests");
    if (fIdx === -1 || rIdx === -1) return JSONResponse({ success: false, message: "資料表缺少 friends 欄位" });

    var myFriends = JSON.parse(sheet.getRange(userRow, fIdx + 1).getValue() || "[]");
    var myReqs = JSON.parse(sheet.getRange(userRow, rIdx + 1).getValue() || "[]");
    var targetFriends = JSON.parse(sheet.getRange(targetRow, fIdx + 1).getValue() || "[]");
    var targetReqs = JSON.parse(sheet.getRange(targetRow, rIdx + 1).getValue() || "[]");

    // 發送申請
    if (type === 'SEND') {
      if (myFriends.map(function(s){return s.toString().toLowerCase();}).indexOf(targetId.toLowerCase()) !== -1) 
        return JSONResponse({ success: false, message: "已經是好友了" });
      if (targetReqs.map(function(s){return s.toString().toLowerCase();}).indexOf(username.toLowerCase()) === -1) {
        targetReqs.push(username);
        sheet.getRange(targetRow, rIdx + 1).setValue(JSON.stringify(targetReqs));
      }
      return JSONResponse({ success: true });
    }
    
    // 接受申請
    if (type === 'ACCEPT') {
       if (myFriends.map(function(s){return s.toString().toLowerCase();}).indexOf(targetId.toLowerCase()) === -1) myFriends.push(targetId);
       if (targetFriends.map(function(s){return s.toString().toLowerCase();}).indexOf(username.toLowerCase()) === -1) targetFriends.push(username);
       myReqs = myReqs.filter(function(id) { return id.toString().toLowerCase() !== targetId.toLowerCase(); });
       sheet.getRange(userRow, fIdx + 1).setValue(JSON.stringify(myFriends));
       sheet.getRange(userRow, rIdx + 1).setValue(JSON.stringify(myReqs));
       sheet.getRange(targetRow, fIdx + 1).setValue(JSON.stringify(targetFriends));
       return JSONResponse({ success: true });
    }
    
    // 拒絕申請
    if (type === 'REJECT') {
      myReqs = myReqs.filter(function(id) { return id.toString().toLowerCase() !== targetId.toLowerCase(); });
      sheet.getRange(userRow, rIdx + 1).setValue(JSON.stringify(myReqs));
      return JSONResponse({ success: true });
    }
    
    // 刪除好友
    if (type === 'REMOVE') {
      myFriends = myFriends.filter(function(id) { return id.toString().toLowerCase() !== targetId.toLowerCase(); });
      targetFriends = targetFriends.filter(function(id) { return id.toString().toLowerCase() !== username.toLowerCase(); });
      sheet.getRange(userRow, fIdx + 1).setValue(JSON.stringify(myFriends));
      sheet.getRange(targetRow, fIdx + 1).setValue(JSON.stringify(targetFriends));
      return JSONResponse({ success: true });
    }
  }
}

// ========== 更新資料 (POST) ==========
function doPost(e) {
  var params = JSON.parse(e.postData.contents);
  var action = params.action;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().toLowerCase().trim(); });

  if (action === 'update') {
    var username = params.username;
    var lastSavedIdx = headers.indexOf("last_saved");
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == username) {
        // 時序檢查防止蓋檔
        if (lastSavedIdx !== -1) {
          var existingT = parseInt(data[i][lastSavedIdx] || 0);
          var incomingT = parseInt(params.last_saved || 0);
          if (incomingT <= existingT) return ContentService.createTextOutput("Ignored: Stale Data");
        }

        for (var key in params) {
          var colIndex = headers.indexOf(key.toLowerCase().replace(/_/g, ""));
          if (colIndex === -1) colIndex = headers.indexOf(key.toLowerCase());
          
          if (colIndex !== -1) {
            sheet.getRange(i + 1, colIndex + 1).setValue(params[key]);
          }
        }
        SpreadsheetApp.flush(); 
        return ContentService.createTextOutput("Success");
      }
    }
  }
}
```
