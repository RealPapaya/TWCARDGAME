測試模式: http://localhost:5173/?auth=dev&devTest=1
測試模式: http://localhost:5173/?auth=dev&testMode=1
平衡修改:
    第一步：啟動編輯器網頁=
        瀏覽器開啟： http://localhost:5173/balance-editor.html
    第二步：進行數值修改
        卡牌/增幅/事件：點選列表中的任意資料列，會展開編輯面板，直接輸入文字或透過 + / − 按鈕修改數值。
        AI 牌組：點選展開牌組，可編輯英雄、政黨與關卡名。透過 +、− 增減張數或 🗑️ 刪除，並在搜尋欄輸入關鍵字點選即可加入新卡。
        進度：直接於進度分頁頂部修改等級與 XP 常數。
    第三步：匯出並覆蓋專案檔案
        點選右上角「📄 匯出 TS 檔案 ▾」下載對應檔案並依序覆蓋：
        下載檔案名稱	覆蓋至專案目標路徑
            1.catalog.generated.ts	packages/cards/src/catalog.generated.ts
            2.amplificationDb.ts	packages/cards/src/amplificationDb.ts
            3.voteEventDb.ts	packages/cards/src/voteEventDb.ts
        AI 牌組額外步驟： 
            打開下載的 aiDecks.generated.ts，複製裡面的 AI_THEMES 與 AI_THEME_DECKS 內容，覆蓋並取代 
            packages/shared/src/index.ts
            內對應的同名宣告。
        遊戲進度額外步驟：
            打開下載的 progression.generated.ts，複製裡面的常數值，覆蓋並取代 
            packages/shared/src/progression.ts
            的 MAX_LEVEL、LEVEL_UP_GOLD、MAX_LEVEL_XP_REQUIREMENT 常數。
    第四步：重新建置使遊戲生效