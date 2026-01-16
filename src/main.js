
/**
 * main.js
 * 
 * 用途: 應用程式的入口點 (Entry Point)。
 * 負責匯入所有核心模組與資料，並動態加載遺留的應用程式代碼 (legacy/app.js) 以啟動遊戲。
 * 
 * 會被誰應用:
 * - dev.html / index.html (透過 script type="module" 引入)
 * 
 * 又會用到誰:
 * - src/logic/* (核心邏輯模組)
 * - src/data/* (遊戲資料)
 * - src/legacy/app.js (舊版主程式，作為控制器)
 */

// Import Core Logic Modules
import { GameEngine } from './logic/GameEngine.js';
import { GameState } from './logic/GameState.js';
import { Player } from './logic/Player.js';
import { AIEngine } from './logic/AIEngine.js';

// Import Data Modules
import { CARD_DATA } from './data/cards.js';
import { DEFAULT_THEME_DECKS } from './data/decks.js';
import { UI_TEXT } from './data/translations.js';

// Import UI Modules (New) - Phase 2 (Not ready yet)
// import { AuthUI } from './ui/auth.js';
// import { initNavigation } from './ui/navigation.js';
// import { ThemeSelectionUI } from './ui/theme-selection.js';
// import { AuthManager } from './logic/auth_manager.js';
// import { store } from './state/store.js';

// Legacy UI Loading (Temporary)
import '../auth_manager.js';
import '../auth_ui.js';

console.log("[Setup] Loading Modules...");

// 1. Expose Globals for Legacy Compatibility (app.js)
window.GameEngine = GameEngine;
window.GameState = GameState;
window.Player = Player;
window.AIEngine = AIEngine;
window.CARD_DATA = CARD_DATA;
window.DEFAULT_THEME_DECKS = DEFAULT_THEME_DECKS;
window.UI_TEXT = UI_TEXT;
window.AuthManager = AuthManager; // app.js might need this if it uses it

// 2. Initialize New UI Components
// We need to ensure DOM is ready. src/main.js is deferred, so DOM should be ready?
// Yes, type=module is deferred.

// 3. Import Legacy App (Dynamic to ensure globals are set)
console.log("[Setup] Loading legacy/app.js dynamically...");
import('./legacy/app.js')
    .then(() => {
        console.log("[Setup] legacy/app.js loaded.");
    })
    .catch(err => {
        console.error("[Setup] Failed to load legacy/app.js:", err);
    });
