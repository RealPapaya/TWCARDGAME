/**
 * Firebase 設定檔
 * 用途: 初始化 Firebase Realtime Database 連線
 * 
 * ⚠️ 重要：請將下方 firebaseConfig 替換為您自己的 Firebase 專案設定
 * 
 * 設定步驟：
 * 1. 前往 https://console.firebase.google.com/
 * 2. 建立新專案或選擇現有專案
 * 3. 點擊「新增應用程式」→「網頁」
 * 4. 複製 firebaseConfig 物件貼到下方
 * 5. 在「Realtime Database」中建立資料庫，選擇「測試模式」
 */

// Firebase SDK 載入（使用 CDN 模組化版本）
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase, ref, set, get, push, onValue, update, remove, onDisconnect, serverTimestamp }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// ============================================
// tw-card-game Firebase 設定
// ============================================
const firebaseConfig = {
    apiKey: "AIzaSyCdZY1lWFeitAu4rS46_VnxetSSYhnEWGk",
    authDomain: "tw-card-game.firebaseapp.com",
    databaseURL: "https://tw-card-game-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "tw-card-game",
    storageBucket: "tw-card-game.firebasestorage.app",
    messagingSenderId: "674675050385",
    appId: "1:674675050385:web:d688bf943f343461a27c30"
};

// 初始化 Firebase
let app = null;
let database = null;

try {
    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    console.log('[Firebase] 初始化成功');
} catch (error) {
    console.error('[Firebase] 初始化失敗:', error);
}

// 匯出 Firebase 相關函數
export {
    database,
    ref,
    set,
    get,
    push,
    onValue,
    update,
    remove,
    onDisconnect,
    serverTimestamp
};

// 檢查 Firebase 是否已正確設定
export function isFirebaseConfigured() {
    return firebaseConfig.apiKey !== "YOUR_API_KEY" && database !== null;
}
