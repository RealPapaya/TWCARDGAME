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

    /**
     * 註冊新帳號
     */
    async register(username, password) {
        if (!this.API_URL) return { success: false, message: "API URL 未設定" };

        try {
            const url = `${this.API_URL}?action=register&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
            console.log("正在嘗試註冊:", username);

            const response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache',
                redirect: 'follow'
            });

            if (!response.ok) throw new Error(`HTTP 錯誤! 狀態碼: ${response.status}`);

            const result = await response.json();
            return result;
        } catch (error) {
            console.error("Register Fetch Error:", error);
            return { success: false, message: "連線失敗，請檢查網路或 API 設定" };
        }
    },

    /**
     * 登入
     */
    async login(username, password) {
        if (!this.API_URL) return { success: false, message: "API URL 未設定" };

        try {
            const url = `${this.API_URL}?action=login&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
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
                this.currentUser = result.data;
                // 處理可能為 null 或字串的 deck_data
                if (typeof result.data.deck_data === 'string') {
                    try {
                        this.currentUser.deck_data = JSON.parse(result.data.deck_data || "[]");
                    } catch (e) {
                        this.currentUser.deck_data = [];
                    }
                }
                // 處理 stats
                if (typeof result.data.stats === 'string') {
                    try {
                        this.currentUser.stats = JSON.parse(result.data.stats || "{}");
                    } catch (e) {
                        this.currentUser.stats = {};
                    }
                } else {
                    this.currentUser.stats = result.data.stats || {};
                }

                // 設定金幣 (如果是新帳號或沒有值，預設給 100)
                if (this.currentUser.gold === undefined || this.currentUser.gold === null) {
                    this.currentUser.gold = 100;
                }

                // 初始化卡牌收藏 (如果是新帳號或沒有卡牌)
                if (!this.currentUser.ownedCards || Object.keys(this.currentUser.ownedCards).length === 0) {
                    this.currentUser.ownedCards = this.generateStarterCollection();
                    this.saveData(); // 立刻同步到雲端
                } else if (typeof this.currentUser.ownedCards === 'string') {
                    // 處理從雲端讀取的 JSON 字串
                    try {
                        this.currentUser.ownedCards = JSON.parse(this.currentUser.ownedCards);
                    } catch (e) {
                        this.currentUser.ownedCards = this.generateStarterCollection();
                    }
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

        try {
            // POST 由於 GAS 的重定向機制，使用 no-cors 雖然看不到回傳，但能確保資料送達
            await fetch(this.API_URL, {
                method: "POST",
                mode: "no-cors",
                headers: {
                    "Content-Type": "text/plain", // 避免 OPTIONS 預檢請求
                },
                body: JSON.stringify({
                    action: "update",
                    username: this.currentUser.username,
                    level: this.currentUser.level,
                    gold: this.currentUser.gold,
                    deck_data: JSON.stringify(this.currentUser.deck_data),
                    selectedAvatar: this.currentUser.selectedAvatar,
                    selectedTitle: this.currentUser.selectedTitle,
                    stats: JSON.stringify(this.currentUser.stats || {}),
                    ownedCards: JSON.stringify(this.currentUser.ownedCards || {})
                })
            });
            console.log("資料已同步至雲端");
        } catch (error) {
            console.error("Save Error:", error);
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
                this.currentUser = JSON.parse(savedUser);
                if (this.currentUser.gold === undefined) {
                    this.currentUser.gold = 100;
                }
                return this.currentUser;
            } catch (e) {
                return null;
            }
        }
        return null;
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
// 123
