/**
 * AuthManager - Handling Account, Login, and Data Persistence via Google Sheets
 */

/**
 * auth_manager.js
 * 檔案用途: 處理用戶認證、API 通訊及本地儲存 (LocalStorage) 管理
 * 相依性: 無 (使用原生 fetch)
 * 調用者: auth_ui.js (按鈕點擊後的行為), app.js (獲取用戶狀態)
 */
const AuthManager = {
    // 這裡填入部署後的 Google Apps Script 網址
    API_URL: "https://script.google.com/macros/s/AKfycbxgyK3pOaHPtWkHaw1oIbc-RRM-rUiZKyMbOul6mgDNV9ELd9spyMB11kmq7j8NTY6R6A/exec",

    currentUser: null,
    isSaving: false,
    saveQueue: [],

    /**
     * 註冊新帳號
     */
    async register(username, password) {
        if (!this.API_URL) return { success: false, message: "API URL 未設定" };

        try {
            const url = `${this.API_URL}?action=register&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&_t=${Date.now()}`;
            console.log("正在嘗試註冊:", username);

            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache',
                redirect: 'follow'
            });

            if (!response.ok) throw new Error(`HTTP 錯誤! 狀態碼: ${response.status}`);

            const result = await response.json();
            console.log("註冊回應內容:", result);
            return result;
        } catch (error) {
            console.error("Register Fetch Error:", error);
            // 檢查是否為 CORS 或是 404 等問題
            return { success: false, message: "連線失敗，請確認 API URL 是否正確，且 GAS 已部署為「所有人」皆可存取的網頁應用程式。" };
        }
    },

    /**
     * 登入
     */
    async login(username, password) {
        if (!this.API_URL) return { success: false, message: "API URL 未設定" };

        try {
            const url = `${this.API_URL}?action=login&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&_t=${Date.now()}`;
            console.log("正在嘗試登入:", username);

            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache',
                redirect: 'follow'
            });

            if (!response.ok) throw new Error(`HTTP 錯誤! 狀態碼: ${response.status}`);

            const result = await response.json();

            if (result.success) {
                // [修正] 比對時間戳，防止雲端舊資料覆寫本地新資料
                const cloudLastSaved = parseInt(result.data.lastsaved || 0);
                const localUser = this.checkAuth();
                const localLastSaved = localUser ? parseInt(localUser.lastsaved || 0) : 0;

                if (localUser && localLastSaved > cloudLastSaved) {
                    console.warn(`[Auth] 雲端資料較舊 (${cloudLastSaved})，已保留本地最新狀態 (${localLastSaved})`);
                    this.currentUser = localUser;
                } else {
                    this.currentUser = this.parseUserData(result.data);
                }

                localStorage.setItem("tw_card_game_user", JSON.stringify(this.currentUser));
                return { success: true, user: this.currentUser };
            } else {
                return { success: false, message: result.message };
            }
        } catch (error) {
            console.error("Login Error:", error);
            return { success: false, message: "登入失敗，伺服器無回應" };
        }
    },

    /**
     * 儲存資料
     */
    async saveData() {
        if (!this.currentUser || !this.API_URL) return;

        // [關鍵修復] 如果正在存檔，回傳一個 Promise 讓呼叫者能真正 await 排隊的結果
        if (this.isSaving) {
            console.log("[Auth] 正在存檔中，將此請求排入序列等待...");
            return new Promise(resolve => {
                this.saveQueue.push(resolve);
            });
        }

        this.isSaving = true;

        try {
            // [關鍵] 更新時間戳，讓系統知道這是最新的版本
            this.currentUser.lastsaved = Date.now();

            // 同步更新本地儲存
            localStorage.setItem("tw_card_game_user", JSON.stringify(this.currentUser));

            // [關鍵] 使用 keepalive 確保 F5 時請求仍能完成
            await fetch(this.API_URL, {
                method: "POST",
                mode: "no-cors",
                keepalive: true,
                headers: {
                    "Content-Type": "text/plain",
                },
                body: JSON.stringify({
                    action: "update",
                    username: this.currentUser.username,
                    level: this.currentUser.level,
                    gold: this.currentUser.gold,
                    deck_data: JSON.stringify(this.currentUser.deck_data),
                    selected_avatar: this.currentUser.selectedAvatar,
                    selected_title: this.currentUser.selectedTitle,
                    owned_avatar: JSON.stringify(this.currentUser.ownedAvatars || []),
                    owned_titles: JSON.stringify(this.currentUser.ownedTitles || []),
                    stats: JSON.stringify(this.currentUser.stats || {}),
                    owned_cards: JSON.stringify(this.currentUser.ownedCards || {}),
                    vouchers: this.currentUser.vouchers || 0,
                    last_saved: this.currentUser.lastsaved
                })
            });
            console.log(`資料已同步至本地與雲端 (${this.currentUser.lastsaved})`);
        } catch (error) {
            console.error("Save Error:", error);
        } finally {
            this.isSaving = false;
            // 如果佇列中有待處理的存檔，執行一次最新的即可
            if (this.saveQueue.length > 0) {
                const resolvers = [...this.saveQueue];
                this.saveQueue = [];
                console.log("[Auth] 執行佇列中的最新存檔請求...");
                const result = await this.saveData();
                resolvers.forEach(resolve => resolve(result));
            }
        }
    },

    logout() {
        this.currentUser = null;
        localStorage.removeItem("tw_card_game_user");
    },

    checkAuth() {
        const savedUser = localStorage.getItem("tw_card_game_user");
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                this.currentUser = user;
                return user;
            } catch (e) {
                return null;
            }
        }
        return null;
    },

    /**
     * 解析從雲端讀取的原始資料 (確保格式一致)
     */
    parseUserData(rawData) {
        // [重要] 將 GAS 回傳的所有小寫鍵名對應回前端預期的名稱
        const user = {
            username: rawData.username,
            password: rawData.password,
            level: parseInt(rawData.level || 1),
            gold: parseInt(rawData.gold || 100),
            deck_data: rawData.deck_data || "[]",
            selectedAvatar: rawData.selected_avatar || rawData.selectedAvatar || rawData.selectedavatar || "avatar1",
            selectedTitle: rawData.selected_title || rawData.selectedTitle || rawData.selectedtitle || "beginner",
            ownedAvatars: rawData.owned_avatar || rawData.ownedavatar || rawData.ownedAvatars || "[\"avatar1\"]",
            ownedTitles: rawData.owned_titles || rawData.ownedTitles || rawData.ownedtitles || "[\"beginner\"]",
            stats: rawData.stats || "{}",
            ownedCards: rawData.owned_cards || rawData.ownedcards || rawData.ownedCards || "{}",
            vouchers: parseInt(rawData.vouchers || 0),
            lastsaved: parseInt(rawData.last_saved || rawData.lastSaved || rawData.lastsaved || 0)
        };

        // 處理 deck_data
        if (typeof user.deck_data === 'string') {
            try { user.deck_data = JSON.parse(user.deck_data || "[]"); }
            catch (e) { user.deck_data = []; }
        }

        // 處理 stats
        if (typeof user.stats === 'string') {
            try { user.stats = JSON.parse(user.stats || "{}"); }
            catch (e) { user.stats = {}; }
        }

        // 處理 ownedCards
        if (typeof user.ownedCards === 'string') {
            try {
                console.log("[Auth] 嘗試解析 ownedCards:", user.ownedCards);
                user.ownedCards = JSON.parse(user.ownedCards || "{}");
            }
            catch (e) {
                console.error("[Auth] ownedCards 解析失敗，載入初始卡組", e);
                user.ownedCards = this.generateStarterCollection();
            }
        }

        // 處理 ownedAvatars
        if (typeof user.ownedAvatars === 'string') {
            try { user.ownedAvatars = JSON.parse(user.ownedAvatars || "[\"avatar1\"]"); }
            catch (e) { user.ownedAvatars = ["avatar1"]; }
        }

        // 處理 ownedTitles
        if (typeof user.ownedTitles === 'string') {
            try { user.ownedTitles = JSON.parse(user.ownedTitles || "[\"beginner\"]"); }
            catch (e) { user.ownedTitles = ["beginner"]; }
        }

        // 確保基本數值存在
        if (user.gold === undefined || user.gold === null) user.gold = 100;
        if (user.level === undefined || user.level === null) user.level = 1;

        return user;
    },

    /**
     * 生成初始卡牌收藏 (20 種卡 x 2 張)
     */
    generateStarterCollection() {
        // 精選 20 種 COMMON/RARE 卡牌，費用 1-5 並包含各陣營
        const starterCardIds = [
            'TW001', // 窮酸大學生 1/2
            'TW003', // 大樓保全 1/2 嘲諷
            'TW004', // 條碼師 1/4
            'TW005', // 水電徒弟 2/3
            'TW030', // 朱立倫 1/1 戰吼
            'TW053', // 老鳥中年 1/3 戰吼抽新聞
            'TW006', // 廟口管委 3/2
            'TW007', // 外送師 3/1 衝鋒
            'TW008', // 手搖員工 2/2 戰吼回血
            'TW013', // 水電師傅 3/5 嘲諷
            'TW012', // 四叉貓 1/1 戰吼+1生命
            'TW017', // 勞工局 0/5 戰吼勞工+2血
            'S006',
            'S009',
            'S016',
            'S022',
            'S026',
            'TW068',
            'TW027',
            'TW017',
            'TW028'
        ];

        const collection = {};
        starterCardIds.forEach(cardId => {
            collection[cardId] = 2; // 每種給 2 張
        });

        console.log('[AuthManager] 發放初始卡牌：', collection);
        return collection;
    }
};

// 為了方便 Debug，掛載到 window
window.AuthManager = AuthManager;
