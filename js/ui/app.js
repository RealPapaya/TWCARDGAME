/**
 * app.js
 * 檔案用途: 遊戲的主要 UI 控制器與進入點，負責視圖切換、對戰渲染及交互
 * 相依性: game_engine.js, auth_manager.js, card_data.js, updates.js, ui_translations.js
 * 調用者: index.html (透過 script 標籤載入)
 */
// ===== Responsive Scaling System =====
// Design base: 1920x1080 (adjusted for battle view)
function updateGameScale() {
    const container = document.getElementById('game-container-16-9');
    const scaler = document.getElementById('game-content-scaler');

    if (!container || !scaler) return;

    // Use current window size for better responsiveness on mobile
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Design base dimensions
    const baseWidth = 1920;
    const baseHeight = 1080;

    // Calculate scale factor (fit within container)
    const scaleX = containerWidth / baseWidth;
    const scaleY = containerHeight / baseHeight;
    const scale = Math.min(scaleX, scaleY);

    // Apply scale transform
    scaler.style.transform = `scale(${scale})`;

    // Center the scaled content
    const scaledWidth = baseWidth * scale;
    const scaledHeight = baseHeight * scale;
    const offsetX = (containerWidth - scaledWidth) / 2;
    const offsetY = (containerHeight - scaledHeight) / 2;

    scaler.style.left = `${offsetX}px`;
    scaler.style.top = `${offsetY}px`;
}

// Initialize on load
window.addEventListener('load', updateGameScale);

// Update on resize
window.addEventListener('resize', updateGameScale);

// Update on orientation change (mobile)
window.addEventListener('orientationchange', () => {
    setTimeout(updateGameScale, 100);
});

// ===== Game Engine & State =====
let gameEngine;
let gameState;
// Card data is now loaded from card_data.js
// CARD_DATA is available globally via window.CARD_DATA

let cardDB = [];

// [新增] UserCache：緩存帳號與暱稱的對應關係，解決好友列表顯示問題
window.UserCache = JSON.parse(localStorage.getItem('tw_user_cache') || '{}');
function cacheUser(username, nickname) {
    if (!username) return;
    window.UserCache[username] = nickname || username;
    localStorage.setItem('tw_user_cache', JSON.stringify(window.UserCache));
}
window.cacheUser = cacheUser;

// [修正] 不再直接從 localStorage 讀取 userDecks，而是等 AuthManager 初始化後從 currentUser 讀取
let userDecks = [];

let tempDeck = null; // Temporary deck for editing

// 可用項目列表 (從 profile_data.js 取得)
const AVAILABLE_TITLES = window.PROFILE_DATA?.TITLE_DATA || [];
const AVAILABLE_AVATARS = window.PROFILE_DATA?.AVATAR_DATA || [];

// AI Theme Decks - loaded from default_decks.js
// DEFAULT_THEME_DECKS is available globally via window.DEFAULT_THEME_DECKS

function generateDefaultDeck() {
    const allIds = CARD_DATA.map(c => c.id);
    const deck = [];
    while (deck.length < 30) deck.push(allIds[Math.floor(Math.random() * allIds.length)]);
    return deck;
}

const defaultAIThemes = [
    { id: 'dpp', name: '賴清德-新聞湧動', image: 'assets/images/illustrations/lai_illustration.webp', cards: DEFAULT_THEME_DECKS.dpp },
    { id: 'dpp2', name: '蔡英文-無限回溯', image: 'assets/images/illustrations/tsai_illustration.webp', cards: DEFAULT_THEME_DECKS.dpp2 },
    { id: 'kmt', name: '韓國瑜-政壇輪迴', image: 'assets/images/illustrations/han_illustration.webp', cards: DEFAULT_THEME_DECKS.kmt },
    { id: 'kmt2', name: '傅崑萁-江湖棄殺', image: 'assets/images/illustrations/fu_kun_chi.webp', cards: DEFAULT_THEME_DECKS.kmt2 },
    { id: 'tpp', name: '柯文哲-台大醫科', image: 'assets/images/illustrations/ko_illustration.webp', cards: DEFAULT_THEME_DECKS.tpp }
];

let aiThemeDecks = JSON.parse(localStorage.getItem('aiThemeDecks')) || defaultAIThemes;

// 自動同步：確保所有使用者看到的名稱、圖片與 ID 都與預設一致
let needsUpdate = false;
defaultAIThemes.forEach(defDeck => {
    let existing = aiThemeDecks.find(d => d.id === defDeck.id);
    if (!existing) {
        aiThemeDecks.push(JSON.parse(JSON.stringify(defDeck)));
        needsUpdate = true;
    } else {
        // 強制更新名稱與圖片，確保與最新版本相符
        if (existing.name !== defDeck.name || existing.image !== defDeck.image) {
            existing.name = defDeck.name;
            existing.image = defDeck.image;
            needsUpdate = true;
        }
    }
});

// 如果有補齊或修正資料，則寫回快取
if (needsUpdate) {
    localStorage.setItem('aiThemeDecks', JSON.stringify(aiThemeDecks));
}
let editingThemeIdx = -1; // -1 means not editing theme



// Removed: This section caused crashes when userDecks is empty
// Ensure valid Slot 2 if empty or broken (for testing convenience)
// if (userDecks.length > 1 && userDecks[1].cards && userDecks[1].cards.length === 0) {
//     const defaultDeck = [];
//     const allIds = CARD_DATA.map(c => c.id);
//     for (let i = 0; i < 30; i++) {
//         defaultDeck.push(allIds[i % allIds.length]);
//     }
//     userDecks[1].cards = defaultDeck;
// }
let selectedDeckIdx = parseInt(localStorage.getItem('selectedDeckIdx')) || 0;
let selectedThemeId = 'dpp'; // Default theme
let editingDeckIdx = -1;
let pendingViewMode = 'BATTLE'; // 'BATTLE', 'BUILDER', or 'DEBUG'
let isDebugMode = false;
window.isDebugMode = isDebugMode; // 暴露出全域變數供其他模組存取

// Debug Command: Kill Opponent
window.killOpponent = async function () {
    if (!gameState || !gameState.players[1]) {
        console.warn("Game not running or gameState invalid!");
        return;
    }
    console.log("Killing opponent...");

    // Set HP to 0
    gameState.players[1].hero.hp = 0;

    // Update view immediately
    if (typeof render === 'function') render();

    // Trigger death resolution
    if (typeof resolveDeaths === 'function') {
        await resolveDeaths();
    } else {
        console.warn("resolveDeaths not found globally, falling back to manual check");
        gameState.resolveDeaths();
        if (typeof render === 'function') render();
    }
    console.log("Opponent killed!");
};

// [權限控制] 判斷是否為 admin 帳號
function isAdmin() {
    if (!AuthManager.currentUser?.username) return false;
    const username = String(AuthManager.currentUser.username).toLowerCase();
    return username === 'admin' || username === 'realpapaya';
}
window.isAdmin = isAdmin;
let currentDifficulty = 'NORMAL';
let currentOpponentDeckId = null; // 記錄當前對戰的AI牌組ID
let currentSort = { field: 'cost', direction: 'asc' }; // 'cost', 'category', 'rarity'

// UI Transition state
let currentViewId = null;
let transitionTimeout = null;

// Drag-related state variables (declared early to avoid TDZ)
let dragging = false;
let attackerIndex = null;
let draggingFromHand = false;
let draggedEl = null;
let isBattlecryTargeting = false;
let battlecrySourceIndex = -1;
let battlecrySourceType = 'MINION'; // 'MINION' or 'NEWS'
let battlecryTargetRule = null;
let draggingMode = 'DAMAGE'; // 'DAMAGE', 'HEAL', 'BUFF'
let currentInsertionIndex = -1;
let dragLine = null; // Will be initialized in init()
let animatingDrawCards = new Set(); // Track cards currently in draw animation

// Mulligan Phase Variables
let mulliganPhase = false;
let mulliganCurrentPlayer = 0; // 0 = PLAYER, 1 = AI
let selectedMulliganCards = [];

/**
 * 對戰歷史紀錄管理器
 */
const MatchHistory = {
    logs: [],

    add(type, data) {
        let template = UI_TEXT[`HISTORY_${type}`] || "{msg}";
        let html = template;

        // 格式化模板
        for (const [key, value] of Object.entries(data)) {
            html = html.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }

        const logEntry = {
            type: type.toLowerCase(),
            html: html,
            timestamp: Date.now()
        };

        this.logs.push(logEntry);
        this.renderEntry(logEntry);

        // 自動捲動到最底
        const list = document.getElementById('history-list');
        if (list) list.scrollTop = list.scrollHeight;
    },

    renderEntry(entry) {
        const list = document.getElementById('history-list');
        if (!list) return;

        const div = document.createElement('div');
        div.className = `history-item ${entry.type}`;
        div.innerHTML = entry.html;
        list.appendChild(div);

        // 為卡牌名稱添加預覽功能（類似更新日誌）
        const boldElements = div.querySelectorAll('b');
        boldElements.forEach(el => {
            const text = el.innerText;
            // 嘗試在卡牌資料庫中找到這張卡
            const card = CARD_DATA.find(c => c.name === text);
            if (card) {
                el.style.cursor = 'pointer';
                el.style.textDecoration = 'underline';
                el.addEventListener('mouseenter', () => {
                    showPreview(card);
                    // 將預覽定位在歷史面板右側
                    const panel = document.getElementById('match-history-panel');
                    if (panel) {
                        const preview = document.getElementById('card-preview');
                        const panelRect = panel.getBoundingClientRect();
                        preview.style.position = 'fixed';
                        preview.style.left = `${panelRect.right + 20}px`;
                        preview.style.top = `${panelRect.top + 50}px`;
                    }
                });
                el.addEventListener('mouseleave', hidePreview);
            }
        });
    },

    clear() {
        this.logs = [];
        const list = document.getElementById('history-list');
        if (list) list.innerHTML = '';
    }
};

/**
 * 獲取單位名稱用於紀錄
 */
function getUnitName(side, index, type) {
    if (type === 'HERO') {
        return side === 'PLAYER' ? "你" : "對手";
    }

    // Fix: Properly map side to players[0/1] regardless of whose turn it is
    const player = (side === 'PLAYER') ? gameState.players[0] : gameState.players[1];

    if (!player || !player.board) {
        console.warn(`[getUnitName] Invalid player for side:`, side);
        return "未知隨從";
    }

    const minion = player.board[index];
    if (!minion) {
        console.warn(`[getUnitName] Minion not found at index ${index} for side ${side}`);
        return "未知隨從";
    }

    return minion.name;
}

function init() {
    // [新增] 防止 init 被重複呼叫導致事件重複綁定
    if (window.isGameInitialized) {
        console.warn('[INIT] 偵測到重複初始化，已跳過');
        return;
    }
    window.isGameInitialized = true;
    console.log('[INIT] 遊戲正在初始化...');

    // Initialize drag line element
    dragLine = document.getElementById('drag-line');

    gameEngine = new GameEngine(CARD_DATA);

    // Initialize AudioManager
    window.audioManager = new AudioManager();
    audioManager.loadBGM('assets/audio/bgm/Earthbound Ember.mp3');

    // WORKAROUND: 手動添加 performMulligan 方法到 GameState.prototype
    // 因為瀏覽器快取問題可能導致舊版 game_engine.js 被載入
    if (typeof GameState !== 'undefined' && !GameState.prototype.performMulligan) {
        console.warn('[INIT] 手動添加 performMulligan 方法到 GameState.prototype');
        GameState.prototype.performMulligan = function (playerIdx, selectedIndices) {
            const player = this.players[playerIdx];
            if (!player) return [];

            const replacedCards = [];

            // 從手牌中移除選中的卡並放回牌組底部
            selectedIndices.sort((a, b) => b - a).forEach(idx => {
                if (idx >= 0 && idx < player.hand.length) {
                    const card = player.hand.splice(idx, 1)[0];
                    player.deck.push(card);
                    replacedCards.push(card);
                }
            });

            // 洗牌 (Fisher-Yates shuffle)
            for (let i = player.deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [player.deck[i], player.deck[j]] = [player.deck[j], player.deck[i]];
            }

            // 重抽等量的牌
            for (let i = 0; i < selectedIndices.length; i++) {
                player.drawCard();
            }

            return replacedCards;
        };
    }

    // --- Main Menu Listeners ---
    document.getElementById('btn-main-battle').addEventListener('click', () => {
        isDebugMode = false;
        window.isDebugMode = false;
        showView('mode-selection');
    });

    document.getElementById('btn-main-test').addEventListener('click', () => {
        isDebugMode = true;
        window.isDebugMode = true;
        pendingViewMode = 'DEBUG';
        showView('test-mode-selection');
    });

    document.getElementById('btn-save-nickname')?.addEventListener('click', handleNicknameSave);

    // --- Mode Selection Listeners ---
    document.getElementById('btn-mode-ai').addEventListener('click', () => {
        const videoOverlay = document.getElementById('video-overlay');
        const video = document.getElementById('transition-video');

        if (videoOverlay && video) {
            videoOverlay.style.display = 'flex';
            video.currentTime = 0;
            video.play().catch(e => console.error("Video play failed:", e));

            let transitionTriggered = false;

            const triggerTransition = () => {
                if (transitionTriggered) return;
                transitionTriggered = true;

                if (videoOverlay) {
                    videoOverlay.style.pointerEvents = 'none'; // [修正] 立即放開點擊攔截
                    videoOverlay.classList.add('video-fade-out');
                }

                renderAIBattleSetup();
                showView('ai-battle-setup', true);

                // Apply staggered fade-in
                const previewPanel = document.querySelector('.setup-preview-panel');
                const optionsPanel = document.querySelector('.setup-options-panel');
                if (previewPanel) {
                    previewPanel.classList.remove('animate-fade-in', 'stagger-1');
                    void previewPanel.offsetWidth;
                    previewPanel.classList.add('animate-fade-in', 'stagger-1');
                }
                if (optionsPanel) {
                    optionsPanel.classList.remove('animate-fade-in', 'stagger-2');
                    void optionsPanel.offsetWidth;
                    optionsPanel.classList.add('animate-fade-in', 'stagger-2');
                }
            };

            // Allow clicking the overlay to skip
            videoOverlay.addEventListener('click', () => {
                console.log('[Video] Skip triggered by click');
                triggerTransition();
                // We'll let the video continue playing in the background or pause it
                // To be safe and clean, we can pause it after some time
                setTimeout(() => {
                    video.pause();
                    videoOverlay.style.display = 'none';
                    videoOverlay.classList.remove('video-fade-out');
                    video.ontimeupdate = null;
                }, 500);
            }, { once: true });

            video.ontimeupdate = () => {
                const triggerTime = video.duration - 0.6;
                if (!transitionTriggered && video.currentTime >= triggerTime) {
                    triggerTransition();
                }
            };

            video.onended = () => {
                videoOverlay.style.display = 'none';
                videoOverlay.classList.remove('video-fade-out');
                video.ontimeupdate = null;
            };
        } else {
            showView('ai-battle-setup');
            renderAIBattleSetup();
        }
    });


    // --- PvP Mode Listener ---
    let matchmakingTimer = null;
    let matchmakingStartTime = null;

    document.getElementById('btn-mode-player').addEventListener('click', async () => {
        // 檢查是否有選擇牌組
        if (!userDecks || userDecks.length === 0) {
            showToast('請先建立一個牌組！');
            return;
        }

        // 檢查 Firebase 是否已設定
        if (window.pvpManager && !window.pvpManager.isReady()) {
            showToast('PvP 功能尚未設定完成');
            console.warn('[PvP] Firebase 尚未設定，請先完成 firebase_config.js');
            return;
        }

        // 顯示牌組選擇畫面，而不是直接配對
        showView('deck-selection');
        document.getElementById('deck-select-title').textContent = "選擇對戰牌組";

        // 渲染牌組選擇，並傳入確認回調
        renderDeckSelection(async (selectedDeck) => {
            const deckCards = selectedDeck?.cards || [];

            // 顯示配對畫面
            const modal = document.getElementById('pvp-matchmaking-modal');
            modal.style.display = 'flex';
            matchmakingStartTime = Date.now();

            // 開始計時器
            if (matchmakingTimer) clearInterval(matchmakingTimer);
            matchmakingTimer = setInterval(() => {
                const elapsed = Math.floor((Date.now() - matchmakingStartTime) / 1000);
                document.getElementById('matchmaking-timer').textContent = `等待時間: ${elapsed} 秒`;
            }, 1000);

            // 加入配對佇列
            if (window.pvpManager) {
                // 先設定配對成功回調
                window.pvpManager.onMatchFound = (roomId, playerId) => {
                    clearInterval(matchmakingTimer);
                    modal.style.display = 'none';
                    showToast('配對成功！正在載入對戰...');
                    console.log('[PvP] 進入房間:', roomId, '身份:', playerId);

                    // 進入 PvP 對戰畫面
                    startPvPGame(roomId, playerId, deckCards);
                };

                const result = await window.pvpManager.joinMatchmaking({
                    username: AuthManager.currentUser.username,
                    nickname: AuthManager.currentUser.nickname || AuthManager.currentUser.username,
                    avatar: AuthManager.currentUser.selectedAvatar || '👤',
                    title: AuthManager.currentUser.selectedTitle || '',
                    level: AuthManager.currentUser.level || 1,
                    deckId: selectedDeck?.name || 'default',
                    deckCards: deckCards
                });

                if (!result.success) {
                    showToast(result.message);
                    modal.style.display = 'none';
                    clearInterval(matchmakingTimer);
                }
            }
        });
    });

    // 取消配對按鈕
    document.getElementById('btn-cancel-matchmaking').addEventListener('click', async () => {
        const modal = document.getElementById('pvp-matchmaking-modal');
        modal.style.display = 'none';

        if (matchmakingTimer) {
            clearInterval(matchmakingTimer);
            matchmakingTimer = null;
        }

        if (window.pvpManager) {
            await window.pvpManager.leaveMatchmaking(AuthManager.currentUser.username);
        }

        showToast('已取消配對');
    });

    // --- PvP 斷線處理 ---
    let disconnectTimer = null;
    let disconnectCountdown = 60;
    const MAX_WAIT_TIME = 60;

    // 顯示斷線等待 Modal
    function showDisconnectModal() {
        const modal = document.getElementById('pvp-disconnect-modal');
        const countdownEl = document.getElementById('disconnect-countdown');
        const progressCircle = document.getElementById('timer-progress');

        if (!modal || !countdownEl || !progressCircle) {
            console.error('[Disconnect UI] Modal 元素未找到');
            return;
        }

        modal.style.display = 'flex';
        disconnectCountdown = MAX_WAIT_TIME;
        countdownEl.textContent = disconnectCountdown;

        // 開始倒數
        if (disconnectTimer) clearInterval(disconnectTimer);

        disconnectTimer = setInterval(() => {
            disconnectCountdown--;
            countdownEl.textContent = disconnectCountdown;

            // 更新圓形進度條 (SVG circle circumference = 2 * π * r = 2 * π * 54 ≈ 339.292)
            const dashOffset = (disconnectCountdown / MAX_WAIT_TIME) * 339.292;
            progressCircle.style.strokeDashoffset = dashOffset;

            if (disconnectCountdown <= 0) {
                clearInterval(disconnectTimer);
                handleDisconnectTimeout();
            }
        }, 1000);

        console.log('[Disconnect UI] 顯示斷線等待 Modal');
    }

    // 隱藏斷線等待 Modal
    function hideDisconnectModal() {
        const modal = document.getElementById('pvp-disconnect-modal');
        if (modal) modal.style.display = 'none';

        if (disconnectTimer) {
            clearInterval(disconnectTimer);
            disconnectTimer = null;
        }

        console.log('[Disconnect UI] 隱藏斷線等待 Modal');
    }

    // 超時處理
    async function handleDisconnectTimeout() {
        hideDisconnectModal();
        if (window.pvpManager) {
            await window.pvpManager.claimVictoryByTimeout();
        }
        showToast('對手未能重連,您獲勝了!');
    }

    // 設定 PvP Manager 回調
    if (window.pvpManager) {
        // 對手斷線回調
        window.pvpManager.onOpponentDisconnect = () => {
            console.log('[PvP] 對手斷線');
            showDisconnectModal();
        };

        // 對手重連回調
        window.pvpManager.onOpponentReconnect = () => {
            console.log('[PvP] 對手重連');
            hideDisconnectModal();
            showToast('對手已重新連線');
        };
    }

    // 判定勝利按鈕
    document.getElementById('btn-claim-victory')?.addEventListener('click', async () => {
        const confirmed = await showCustomConfirm('確定要結束等待並判定勝利嗎?');
        if (confirmed) {
            hideDisconnectModal();
            if (window.pvpManager) {
                await window.pvpManager.claimVictoryByTimeout();
            }
        }
    });

    // 繼續等待按鈕
    document.getElementById('btn-keep-waiting')?.addEventListener('click', () => {
        // 重置倒數計時
        disconnectCountdown = MAX_WAIT_TIME;
        document.getElementById('disconnect-countdown').textContent = disconnectCountdown;
        document.getElementById('timer-progress').style.strokeDashoffset = 339.292;
        showToast('繼續等待對手重連...');
    });

    // 放棄重連按鈕 (在重連 Modal 中)
    document.getElementById('btn-reconnect-abandon')?.addEventListener('click', async () => {
        const confirmed = await showCustomConfirm('確定要放棄重連嗎? 您將認輸。');
        if (confirmed) {
            if (window.pvpManager) {
                await window.pvpManager.abandonReconnection();
            }
            const reconnectModal = document.getElementById('pvp-reconnect-modal');
            if (reconnectModal) reconnectModal.style.display = 'none';
            showToast('您已放棄重連');
            showView('main-menu');
        }
    });

    // --- Difficulty Selection Listeners ---
    document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentDifficulty = btn.dataset.diff;
            pendingViewMode = 'BATTLE';
            showView('theme-selection');
            renderThemeSelection();
        });
    });

    // --- Test Mode Selection Listeners ---
    document.getElementById('btn-test-player-decks').addEventListener('click', () => {
        showView('deck-selection');
        document.getElementById('deck-select-title').innerText = '測試模式：選擇玩家牌組';
        renderDeckSelect();
    });

    document.getElementById('btn-test-ai-themes').addEventListener('click', () => {
        showView('theme-selection');
        document.getElementById('theme-selection').querySelector('.sub-title').innerText = '選擇要編輯的主題牌組';
        renderThemeSelection(true); // Pass true for edit mode
    });

    // --- Back Buttons ---
    document.querySelectorAll('.btn-back').forEach(btn => {
        btn.addEventListener('click', () => {
            if (document.getElementById('mode-selection').style.display === 'flex') {
                showView('main-menu');
            } else if (document.getElementById('ai-battle-setup').style.display === 'flex') {
                showView('mode-selection');
            } else if (document.getElementById('difficulty-selection').style.display === 'flex') {
                showView('mode-selection');
            } else if (document.getElementById('test-mode-selection').style.display === 'flex') {
                showView('main-menu');
            } else if (document.getElementById('theme-selection').style.display === 'flex') {
                // Check if we're in edit mode or battle mode
                const title = document.getElementById('theme-selection').querySelector('.sub-title').innerText;
                if (title.includes('編輯')) {
                    showView('test-mode-selection');
                } else {
                    showView('difficulty-selection');
                }
            } else if (document.getElementById('deck-selection').style.display === 'flex') {
                // Check if we're in test mode, pvp mode, or builder mode
                const title = document.getElementById('deck-select-title').innerText;
                if (title.includes('測試')) {
                    showView('test-mode-selection');
                } else if (title.includes('對戰牌組')) {
                    showView('mode-selection');
                } else {
                    // Default fallback
                    showView('mode-selection');
                }
            }
        });
    });

    document.getElementById('btn-builder-back').addEventListener('click', async () => {
        if (tempDeck) {
            if (tempDeck.isTheme) {
                // Editing theme deck
                const original = aiThemeDecks[editingThemeIdx];
                const tempStr = JSON.stringify({ name: tempDeck.name, cards: tempDeck.cards });
                const origStr = JSON.stringify({ name: original.name, cards: original.cards });

                if (tempStr !== origStr) {
                    const confirmed = await showCustomConfirm("您有未保存的修改，確定要放棄並離開嗎？");
                    if (!confirmed) return;
                }
                tempDeck = null;
                editingThemeIdx = -1;
                showView('test-mode-selection');
            } else {
                // Editing player deck - 返回個人頁面而非牌組選擇
                const original = userDecks[editingDeckIdx];
                const tempStr = JSON.stringify({ name: tempDeck.name, cards: tempDeck.cards });
                const origStr = JSON.stringify({ name: original.name, cards: original.cards });

                if (tempStr !== origStr) {
                    const confirmed = await showCustomConfirm("您有未保存的修改，確定要放棄並離開嗎？");
                    if (!confirmed) return;
                }
                tempDeck = null;
                showView('profile-view');
                updateProfilePage();
            }
        } else {
            // 無編輯中的牌組，也返回個人頁面
            showView('profile-view');
            updateProfilePage();
        }
    });

    // --- Deck Builder Listeners ---
    document.getElementById('btn-save-deck').addEventListener('click', () => {
        if (!tempDeck) return;
        const nameInput = document.getElementById('deck-name-input');

        if (tempDeck.isTheme) {
            // Saving theme deck
            tempDeck.name = nameInput.value || aiThemeDecks[editingThemeIdx].name;
            aiThemeDecks[editingThemeIdx].cards = JSON.parse(JSON.stringify(tempDeck.cards));
            aiThemeDecks[editingThemeIdx].name = tempDeck.name;
            localStorage.setItem('aiThemeDecks', JSON.stringify(aiThemeDecks));
            showToast("主題牌組保存成功！");
        } else {
            // Saving player deck
            tempDeck.name = nameInput.value || `牌組 ${editingDeckIdx + 1}`;
            userDecks[editingDeckIdx] = JSON.parse(JSON.stringify(tempDeck));
            // 同步至本地與雲端
            if (AuthManager.currentUser) {
                AuthManager.currentUser.deck_data = userDecks;
                AuthManager.saveData();
            }
            showToast("保存成功！");
        }
        renderDeckBuilder();
    });

    // Edit Player Deck
    function editPlayerDeck(index) {
        if (index < 0 || index >= userDecks.length) return;
        editingDeckIdx = index;
        // Deep copy to tempDeck to avoid direct mutation until save
        tempDeck = JSON.parse(JSON.stringify(userDecks[index]));
        tempDeck.isTheme = false;

        showView('deck-builder');
        renderDeckBuilder();
    }

    // This function is responsible for rendering the list of decks in the profile view.
    function renderProfileDeckList() {
        const container = document.getElementById('profile-deck-list');
        if (!container) return;
        container.innerHTML = ''; // Clear existing decks

        // Add existing decks
        userDecks.forEach((deck, index) => {
            const deckItem = document.createElement('div');
            deckItem.className = 'deck-item';
            deckItem.innerHTML = `
                <img src="${deck.image || 'assets/card_back.png'}" alt="Deck Image" class="deck-image">
                <div class="deck-name">${deck.name}</div>
                <div class="deck-card-count">${deck.cards.length}/30</div>
                <div class="deck-actions">
                    <button class="btn btn-sm btn-primary btn-edit-deck" data-index="${index}">編輯</button>
                    <button class="btn btn-sm btn-danger btn-delete-deck" data-index="${index}">刪除</button>
                </div>
            `;
            container.appendChild(deckItem);
        });

        // Add "Add New Deck" button if less than 6 decks
        if (userDecks.length < 6) {
            const addItem = document.createElement('div');
            addItem.className = 'deck-item add-new-deck';
            addItem.innerHTML = `
                <i class="fas fa-plus"></i>
                <span>新增牌組</span>
            `;
            addItem.addEventListener('click', () => {
                if (editingDeckIdx !== -1) return; // Prevent if already editing? No, simple logic
                // Create new deck
                const newDeck = {
                    id: `deck_${Date.now()}`,
                    name: `新牌組 ${userDecks.length + 1}`,
                    cards: [],
                    image: ''
                };
                userDecks.push(newDeck);
                // Save
                if (AuthManager.currentUser) {
                    AuthManager.currentUser.deck_data = userDecks;
                    AuthManager.saveData();
                }
                renderProfileDeckList();
            });
            container.appendChild(addItem);
        }

        // Fill remaining slots up to 6 (Fixed Grid Layout)
        const currentCount = container.children.length;
        if (currentCount < 6) {
            const remaining = 6 - currentCount;
            for (let i = 0; i < remaining; i++) {
                const placeholder = document.createElement('div');
                placeholder.className = 'deck-item-placeholder';
                container.appendChild(placeholder);
            }
        }

        // Add event listeners for edit and delete buttons
        container.querySelectorAll('.btn-edit-deck').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                editPlayerDeck(index);
            });
        });

        container.querySelectorAll('.btn-delete-deck').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const index = parseInt(e.target.dataset.index);
                const confirmed = await showCustomConfirm(`確定要刪除牌組 "${userDecks[index].name}" 嗎？`);
                if (confirmed) {
                    userDecks.splice(index, 1);
                    if (AuthManager.currentUser) {
                        AuthManager.currentUser.deck_data = userDecks;
                        AuthManager.saveData();
                    }
                    showToast('牌組已刪除');
                    renderProfileDeckList();
                }
            });
        });
    }

    // Clear Deck Listener
    document.getElementById('btn-clear-deck')?.addEventListener('click', async () => {
        if (!tempDeck || tempDeck.cards.length === 0) return;
        const confirmed = await showCustomConfirm("確定要清空目前牌組嗎？");
        if (confirmed) {
            tempDeck.cards = [];
            renderDeckBuilder();
            showToast("牌組已清空");
        }
    });

    // Auto Build Listener (New)
    document.getElementById('btn-auto-build')?.addEventListener('click', async () => {
        if (!tempDeck) return;

        // 檢查是否已滿
        if (tempDeck.cards.length >= 30) {
            showToast("牌組已滿！");
            return;
        }

        const confirmed = await showCustomConfirm("確定要自動補滿牌組嗎？這將從您的收藏中隨機挑選卡牌。");
        if (!confirmed) return;

        autoBuildDeck();
    });

    // Search Listener
    document.getElementById('card-search-input').addEventListener('input', () => {
        renderDeckBuilder();
    });

    // Filter Listeners
    ['filter-category', 'filter-rarity', 'filter-cost'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderDeckBuilder);
    });

    // Populate Category Filter
    const categories = [...new Set(CARD_DATA.map(c => c.category || '一般'))].sort();
    const catSelect = document.getElementById('filter-category');
    if (catSelect) {
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.innerText = cat;
            catSelect.appendChild(opt);
        });
    }


    // --- Deck Creation Modal Listeners ---
    // 防止重複建立牌組的旗標
    let deckCreationInProgress = false;
    document.getElementById('btn-create-custom')?.addEventListener('click', () => {
        if (deckCreationInProgress) return;
        deckCreationInProgress = true;
        document.getElementById('deck-creation-modal').style.display = 'none';
        addNewPlayerDeck(null, null, false); // 明確指定為一般牌組，非測試牌組
        // 讓旗標在下一個事件循環重置，避免影響其他操作
        setTimeout(() => { deckCreationInProgress = false; }, 0);
    });

    document.getElementById('btn-create-theme')?.addEventListener('click', () => {
        if (deckCreationInProgress) return;
        deckCreationInProgress = true;
        document.getElementById('deck-creation-modal').style.display = 'none';
        showPlayerThemeSelection();
        setTimeout(() => { deckCreationInProgress = false; }, 0);
    });

    document.getElementById('btn-create-cancel')?.addEventListener('click', () => {
        document.getElementById('deck-creation-modal').style.display = 'none';
    });

    // Volume Slider Control
    const volumeSlider = document.getElementById('volume-slider');
    const volumeValue = document.getElementById('volume-value');
    const muteBtn = document.getElementById('mute-btn');

    if (volumeSlider && volumeValue && audioManager) {
        // Initialize slider with saved volume
        const savedVolume = audioManager.getBGMVolume() * 100;
        volumeSlider.value = savedVolume;
        volumeValue.textContent = Math.round(savedVolume) + '%';

        volumeSlider.addEventListener('input', (e) => {
            const volume = e.target.value / 100;
            audioManager.setBGMVolume(volume);
            volumeValue.textContent = e.target.value + '%';

            // Update mute button icon
            if (muteBtn) {
                muteBtn.textContent = volume === 0 ? '🔇' : '🔊';
            }
        });
    }

    // Mute Button Control
    if (muteBtn && audioManager) {
        muteBtn.addEventListener('click', () => {
            audioManager.toggleMute();
            const isMuted = audioManager.isMuted();
            muteBtn.textContent = isMuted ? '🔇' : '🔊';

            // Update slider to reflect mute state
            if (volumeSlider && volumeValue) {
                if (isMuted) {
                    volumeSlider.value = 0;
                    volumeValue.textContent = '0%';
                } else {
                    const currentVolume = audioManager.getBGMVolume() * 100;
                    volumeSlider.value = currentVolume;
                    volumeValue.textContent = Math.round(currentVolume) + '%';
                }
            }
        });
    }

    // SFX Volume Slider Control
    const sfxVolumeSlider = document.getElementById('sfx-volume-slider');
    const sfxVolumeValue = document.getElementById('sfx-volume-value');
    const sfxMuteBtn = document.getElementById('sfx-mute-btn');

    if (sfxVolumeSlider && sfxVolumeValue && audioManager) {
        // Initialize slider with saved volume
        const savedSFXVolume = audioManager.getSFXVolume() * 100;
        sfxVolumeSlider.value = savedSFXVolume;
        sfxVolumeValue.textContent = Math.round(savedSFXVolume) + '%';

        sfxVolumeSlider.addEventListener('input', (e) => {
            const volume = e.target.value / 100;
            audioManager.setSFXVolume(volume);
            sfxVolumeValue.textContent = e.target.value + '%';

            // Update mute button icon
            if (sfxMuteBtn) {
                sfxMuteBtn.textContent = volume === 0 ? '🔇' : '🔊';
            }
        });
    }

    // SFX Mute Button Control
    if (sfxMuteBtn && audioManager) {
        sfxMuteBtn.addEventListener('click', () => {
            const currentVolume = audioManager.getSFXVolume();
            if (currentVolume > 0) {
                sfxMuteBtn.dataset.previousVolume = currentVolume;
                audioManager.setSFXVolume(0);
                sfxMuteBtn.textContent = '🔇';
                if (sfxVolumeSlider && sfxVolumeValue) {
                    sfxVolumeSlider.value = 0;
                    sfxVolumeValue.textContent = '0%';
                }
            } else {
                const restoreVolume = parseFloat(sfxMuteBtn.dataset.previousVolume) || 0.5;
                audioManager.setSFXVolume(restoreVolume);
                sfxMuteBtn.textContent = '🔊';
                if (sfxVolumeSlider && sfxVolumeValue) {
                    const vol = restoreVolume * 100;
                    sfxVolumeSlider.value = vol;
                    sfxVolumeValue.textContent = Math.round(vol) + '%';
                }
            }
        });
    }

    updatePlayerInfo(); // [修正] 初始化時根據當前狀態更新 UI

    console.log("Game initialized.");
}

// Sort Listeners
document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const field = btn.dataset.sort;
        if (currentSort.field === field) {
            // Toggle direction
            currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.field = field;
            currentSort.direction = 'asc';
        }
        renderDeckBuilder();
    });
});

// --- Battle Listeners ---
document.getElementById('end-turn-btn').addEventListener('click', async () => {
    if (isBattlecryTargeting || dragging) return;
    if (gameState.currentPlayerIdx !== 0) {
        logMessage(UI_TEXT.NOT_YOUR_TURN);
        return;
    }
    try {
        // PvP 模式：同步結束回合到 Firebase
        if (isPvPMode && window.pvpManager) {
            // 先同步動作
            await window.pvpManager.syncGameAction('END_TURN', {});
            // 通知 Firebase 切換回合
            await window.pvpManager.endTurn();

            // 本地結束回合 (不觸發 startTurn，等 Firebase 通知)
            gameState.endTurn(true); // skipStartTurn = true
            syncLocalStateToFirebase(); // 同步回合結束後的狀態 (Mana, HandSize)
            render();
            await resolveDeaths();

            console.log('[PvP] 已結束回合，等待對手...');
        } else {
            // AI 模式：原有邏輯
            gameState.endTurn();
            render();
            await resolveDeaths();
            if (gameState.currentPlayerIdx === 1) {
                setTimeout(aiTurn, 1000);
            }
        }
    } catch (e) { logMessage(e.message); }
});

// Settings Menu Toggle (Battle View)
document.getElementById('settings-button').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('settings-menu-battle');
    if (menu.style.display === 'none' || !menu.style.display) {
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
});

// Close settings menu when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('settings-menu');
    const button = document.getElementById('settings-button');
    if (menu && button && !menu.contains(e.target) && !button.contains(e.target)) {
        menu.style.display = 'none';
    }
});

// View Deck button in settings menu
document.getElementById('btn-view-deck-menu').addEventListener('click', () => {
    showDeckView();
    document.getElementById('settings-menu-battle').style.display = 'none';
});

// Audio Settings button in settings menu
document.getElementById('btn-audio-settings')?.addEventListener('click', () => {
    document.getElementById('audio-settings-modal').style.display = 'flex';
    document.getElementById('settings-menu-battle').style.display = 'none';
});

document.getElementById('btn-audio-close')?.addEventListener('click', () => {
    document.getElementById('audio-settings-modal').style.display = 'none';
});

document.getElementById('btn-deck-view-close')?.addEventListener('click', () => {
    document.getElementById('deck-view-modal').style.display = 'none';
});

// Surrender button in settings menu
document.getElementById('btn-surrender-menu').addEventListener('click', () => {
    document.getElementById('settings-menu-battle').style.display = 'none';
    document.getElementById('surrender-modal').style.display = 'flex';
});

document.getElementById('btn-surrender-confirm').addEventListener('click', () => {
    document.getElementById('surrender-modal').style.display = 'none';
    endGame('DEFEAT');
});

document.getElementById('btn-surrender-cancel').addEventListener('click', () => {
    document.getElementById('surrender-modal').style.display = 'none';
});

// Update Log Listeners
document.getElementById('btn-update-log')?.addEventListener('click', () => {
    const list = document.getElementById('update-log-list');
    if (list && typeof UPDATE_LOGS !== 'undefined') {
        // 渲染日誌內容
        list.innerHTML = UPDATE_LOGS.map(log => `
            <div class="update-version-section">
                <h3 style="color: #5d2e17; margin-bottom: 10px;">版本 ${log.version} (${log.date})</h3>
                <ul style="list-style: none; padding: 0;">
                    ${log.items.map(item => `
                        <li style="margin-bottom: 15px; border-left: 4px solid #8b4513; padding-left: 15px;">
                            <b style="color: #5d2e17;">${item.title}</b><br>
                            <span style="color: #7a4a3a; font-size: 14px; display: block; margin-top: 4px; white-space: pre-wrap;">${item.desc}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `).join('<hr style="border: 0; border-top: 1px solid #c19a6b; margin: 20px 0;">');

        // 自動掃描並包裝卡牌名稱以實現懸停預覽
        const allCardNames = CARD_DATA.map(c => c.name);
        allCardNames.sort((a, b) => b.length - a.length);

        const sections = list.querySelectorAll('.update-version-section li span, .update-version-section li b');
        sections.forEach(el => {
            let text = el.innerText;
            // 避免在 innerHTML 中直接取代，改用一個暫存標記來處理
            let segments = [{ text: text, isLink: false }];

            allCardNames.forEach(name => {
                const card = CARD_DATA.find(c => c.name === name);
                let newSegments = [];
                segments.forEach(seg => {
                    if (seg.isLink) {
                        newSegments.push(seg);
                    } else {
                        const parts = seg.text.split(name);
                        for (let i = 0; i < parts.length; i++) {
                            if (parts[i]) newSegments.push({ text: parts[i], isLink: false });
                            if (i < parts.length - 1) {
                                newSegments.push({ text: name, isLink: true, cardId: card.id });
                            }
                        }
                    }
                });
                segments = newSegments;
            });

            // 重新組裝 HTML
            el.innerHTML = segments.map(seg => {
                if (seg.isLink) {
                    return `<span class="log-card-link" data-card-id="${seg.cardId}">${seg.text}</span>`;
                }
                return seg.text;
            }).join('');
        });

        // 為所有連結綁定事件
        list.querySelectorAll('.log-card-link').forEach(link => {
            const cardId = link.dataset.cardId;
            const card = CARD_DATA.find(c => c.id === cardId);
            if (!card) return;

            link.addEventListener('mouseenter', (e) => {
                const preview = document.getElementById('card-preview');
                if (!preview || !card) return;

                // 修正置中邏輯：使用 fixed 並重置所有位移
                preview.style.position = 'fixed';
                preview.style.top = '50%';
                preview.style.left = '50%';
                preview.style.bottom = 'auto';
                preview.style.right = 'auto';
                // 必須移除內部可能干擾的 transform: none
                preview.style.transform = 'translate(-50%, -50%)';
                preview.style.display = 'block';

                showPreview(card);

                // 再次確保 transform 有生效 (有些時候 showPreview 會覆寫 innerHTML 導致重繪)
                setTimeout(() => {
                    preview.style.transform = 'translate(-50%, -50%)';
                }, 0);
            });
            link.addEventListener('mouseleave', hidePreview);
        });
    }
    document.getElementById('update-log-modal').style.display = 'flex';
});

document.getElementById('btn-update-log-close')?.addEventListener('click', () => {
    document.getElementById('update-log-modal').style.display = 'none';
});

document.getElementById('btn-player-theme-cancel')?.addEventListener('click', () => {
    document.getElementById('player-theme-selection-modal').style.display = 'none';
});

// Mulligan Confirm Button
document.getElementById('btn-mulligan-confirm')?.addEventListener('click', () => {
    confirmMulligan();
});

// --- Result View Listeners ---
document.getElementById('btn-result-continue').addEventListener('click', () => {
    showView('main-menu');
});

// --- Settings & Logout (Main Menu) ---
// --- Settings & Logout (Main Menu) ---
const settingsBtn = document.getElementById('btn-settings-main');
const logoutBtn = document.getElementById('btn-logout-main');
const settingsModal = document.getElementById('settings-modal');
const settingsCloseBtn = document.getElementById('btn-settings-close');

if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (settingsModal) settingsModal.style.display = 'flex';
    });
}

if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener('click', () => {
        if (settingsModal) settingsModal.style.display = 'none';
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const confirmed = await showCustomConfirm('確定要登出嗎？');
        if (confirmed) {
            if (settingsModal) settingsModal.style.display = 'none';
            AuthManager.logout();
            showView('auth-view');
            if (window.AuthUI) AuthUI.reset();

            // 清除玩家資訊
            updatePlayerInfo();
        }
    });
}

// Close modal when clicking outside (on overlay)
if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
    });
}

// --- Friends Modal ---
const friendsBtn = document.getElementById('btn-friends');
const friendsModal = document.getElementById('friends-modal');
const friendsCloseBtn = document.getElementById('btn-friends-close');

if (friendsBtn) {
    friendsBtn.addEventListener('click', () => {
        if (friendsModal) {
            friendsModal.style.display = 'flex';
            renderFriendsList();
            updateFriendRequestBadge();
        }
    });
}

if (friendsCloseBtn) {
    friendsCloseBtn.addEventListener('click', () => {
        friendsModal.style.display = 'none';
    });
}

// Friends Search Logic
document.getElementById('btn-friends-search')?.addEventListener('click', handleFriendsSearch);
document.getElementById('friends-search-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleFriendsSearch();
});

async function handleFriendsSearch() {
    const input = document.getElementById('friends-search-input');
    const resultArea = document.getElementById('friends-search-result');
    const searchBtn = document.getElementById('btn-friends-search');
    const username = input.value.trim();

    if (!username) return;
    if (username.toLowerCase() === AuthManager.currentUser?.username.toLowerCase()) {
        showToast("不能搜尋自己喔！");
        return;
    }

    resultArea.style.display = 'block';
    resultArea.innerHTML = '<div class="loading">搜尋中...</div>';
    if (searchBtn) searchBtn.classList.add('btn-loading');

    try {
        const result = await AuthManager.searchUser(username);
        if (result.success && result.data) {
            const u = result.data;
            cacheUser(u.username, u.nickname); // 快取搜尋結果
            const isAlreadyFriend = AuthManager.currentUser.friends.includes(u.username);

            const nickname = u.nickname || u.username;
            const displayName = u.nickname ? `${u.nickname} (${u.username})` : u.username;

            resultArea.innerHTML = `
                <div class="friend-item">
                    <div class="avatar">${nickname.charAt(0)}</div>
                    <div class="info">
                        <div class="name">${displayName} (Lv.${u.level || 1})</div>
                        <div class="title">#${u.selected_title || '新手'}</div>
                    </div>
                    <div class="friend-actions">
                        ${isAlreadyFriend ?
                    '<span class="status-tag">已是好友</span>' :
                    `<button class="medieval-button btn-small" onclick="sendFriendRequest(this, '${u.username}')">發送申請</button>`
                }
                    </div>
                </div>
            `;
        } else {
            resultArea.innerHTML = `<div class="empty-message">${result.message || "找不到該玩家"}</div>`;
        }
    } finally {
        if (searchBtn) searchBtn.classList.remove('btn-loading');
    }
}

window.sendFriendRequest = async function (btn, targetId) {
    if (btn) btn.classList.add('btn-loading');
    try {
        const result = await AuthManager.handleFriendOp('SEND', targetId);
        if (result.success) {
            showToast("申請已發送！");
            document.getElementById('friends-search-result').style.display = 'none';
            document.getElementById('friends-search-input').value = '';
        } else {
            showToast(result.message);
        }
    } finally {
        if (btn) btn.classList.remove('btn-loading');
    }
};

// Friends Tabs
document.getElementById('tab-friends-list')?.addEventListener('click', () => {
    switchFriendsTab('list');
});
document.getElementById('tab-friends-requests')?.addEventListener('click', () => {
    switchFriendsTab('requests');
});

function switchFriendsTab(tab) {
    const listTab = document.getElementById('tab-friends-list');
    const reqTab = document.getElementById('tab-friends-requests');

    if (tab === 'list') {
        listTab.classList.add('active');
        reqTab.classList.remove('active');
        renderFriendsList();
    } else {
        listTab.classList.remove('active');
        reqTab.classList.add('active');
        renderFriendRequests();
    }
}

async function renderFriendsList() {
    const container = document.getElementById('friends-list-container');
    container.innerHTML = '<div class="loading">載入中...</div>';

    const friendIds = AuthManager.currentUser.friends || [];
    if (friendIds.length === 0) {
        container.innerHTML = '<div class="empty-message">目前還沒有好友，快去搜尋玩家吧！</div>';
        return;
    }

    // 這裡為了簡單，目前先只顯示名稱。未來可以批次抓取好友詳情。
    let html = '';
    for (const id of friendIds) {
        const nickname = window.UserCache[id] || id;
        html += `
            <div class="friend-item">
                <div class="avatar">${nickname.charAt(0)}</div>
                <div class="info">
                    <div class="name">${nickname}</div>
                    ${window.UserCache[id] ? `<div class="account-hint">@${id}</div>` : ''}
                </div>
                <div class="friend-actions">
                    <button class="medieval-button danger btn-small" onclick="handleFriendAction(this, 'REMOVE', '${id}')">刪除</button>
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

function renderFriendRequests() {
    const container = document.getElementById('friends-list-container');
    const requests = AuthManager.currentUser.friendRequests || [];

    if (requests.length === 0) {
        container.innerHTML = '<div class="empty-message">目前沒有待處理的邀請。</div>';
        return;
    }

    let html = '';
    for (const id of requests) {
        const nickname = window.UserCache[id] || id;
        html += `
            <div class="friend-item">
                <div class="avatar">${nickname.charAt(0)}</div>
                <div class="info">
                    <div class="name">${nickname} 向你發送了邀請</div>
                    ${window.UserCache[id] ? `<div class="account-hint">@${id}</div>` : ''}
                </div>
                <div class="friend-actions">
                    <button class="medieval-button btn-small" onclick="handleFriendAction(this, 'ACCEPT', '${id}')">接受</button>
                    <button class="medieval-button secondary btn-small" onclick="handleFriendAction(this, 'REJECT', '${id}')">拒絕</button>
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

window.handleFriendAction = async function (btn, type, targetId) {
    if (btn) btn.classList.add('btn-loading');
    try {
        const result = await AuthManager.handleFriendOp(type, targetId);
        if (result.success) {
            showToast(type === 'ACCEPT' ? "已成為好友！" : "操作成功");
            const activeTab = document.getElementById('tab-friends-list').classList.contains('active') ? 'list' : 'requests';
            switchFriendsTab(activeTab);
            updateFriendRequestBadge();
        } else {
            showToast(result.message);
        }
    } finally {
        if (btn) btn.classList.remove('btn-loading');
    }
};

function updateFriendRequestBadge() {
    const badge = document.getElementById('friends-req-count');
    const dot = document.getElementById('friends-notification-dot');
    const count = AuthManager.currentUser.friendRequests?.length || 0;

    // 更新 Modal 內的文字標籤
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }

    // 更新入口按鈕處的紅點
    if (dot) {
        dot.style.display = count > 0 ? 'block' : 'none';
    }
}

// 實作自動背景同步 (每 30 秒檢查一次好友邀請)
setInterval(async () => {
    if (AuthManager.currentUser) {
        const result = await AuthManager.syncUserData();
        if (result.success) {
            updateFriendRequestBadge();
        }
    }
}, 30000);

// Close menus when clicking outside
document.addEventListener('click', (e) => {
    const battleMenu = document.getElementById('settings-menu-battle');
    const battleBtn = document.getElementById('settings-button');
    if (battleMenu && battleBtn && !battleMenu.contains(e.target) && !battleBtn.contains(e.target)) {
        battleMenu.style.display = 'none';
    }

    // Close friends modal if clicking outside content
    if (friendsModal && e.target === friendsModal) {
        friendsModal.style.display = 'none';
    }
});


// Global drag events
document.addEventListener('pointermove', (e) => {
    onDragMove(e);

    // Update tooltip position if visible
    const tooltip = document.getElementById('ui-tooltip');
    if (tooltip && tooltip.style.opacity === '1') {
        const x = e.clientX;
        const y = e.clientY;

        // Prevent tooltip from going off screen
        const rect = tooltip.getBoundingClientRect();
        let left = x + 15;
        let top = y + 15;

        if (left + rect.width > window.innerWidth) {
            left = x - rect.width - 5;
        }
        if (top + rect.height > window.innerHeight) {
            top = y - rect.height - 5;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }
});
document.addEventListener('pointerup', onDragEnd);

// Global Tooltip Delegation
document.addEventListener('pointerover', (e) => {
    const target = e.target.closest('[data-hover]');
    if (target) {
        const text = target.getAttribute('data-hover');
        if (text) {
            const tooltip = document.getElementById('ui-tooltip');
            if (tooltip) {
                tooltip.textContent = text;
                tooltip.style.opacity = '1';
                // Initial positioning
                tooltip.style.left = `${e.clientX + 15}px`;
                tooltip.style.top = `${e.clientY + 15}px`;
            }
        }
    }
});

document.addEventListener('pointerout', (e) => {
    const target = e.target.closest('[data-hover]');
    if (target) {
        const tooltip = document.getElementById('ui-tooltip');
        if (tooltip) {
            tooltip.style.opacity = '0';
        }
    }
});

// Expose globally for AuthManager/AuthUI
window.App = {
    showView: showView,
    onUserLogin: onUserLogin
};

function onUserLogin(user) {
    if (!user) return;

    // [重要] user 已經是經由 AuthManager.parseUserData 處理過的物件
    AuthManager.currentUser = user;
    cacheUser(user.username, user.nickname); // 快取登入者
    console.log('[Auth] onUserLogin 觸發，用戶：', user.username);

    // 處理牌組資料：優先從 user 物件中讀取
    if (user.deck_data && Array.isArray(user.deck_data)) {
        userDecks = user.deck_data;
        console.log(`[Auth] 成功從用戶資料載入 ${userDecks.length} 個牌組`);
    } else if (typeof user.deck_data === 'string' && user.deck_data !== "[]") {
        try {
            userDecks = JSON.parse(user.deck_data);
            console.log(`[Auth] 成功解析字串格式牌組：${userDecks.length} 個`);
        } catch (e) {
            console.error('[Auth] 牌組字串解析失敗:', e);
            userDecks = [];
        }
    } else {
        userDecks = [];
        console.warn('[Auth] 用戶資料中未發現任何牌組');
    }

    // 更新本地快取，確保兩邊一致
    // 更新本地快取，確保兩邊一致 (Disabled for session-only login)
    // localStorage.setItem('tw_card_game_user', JSON.stringify(user));
    // localStorage.setItem('userDecks', JSON.stringify(userDecks));

    // [新增] 檢查是否已設定名稱
    if (!user.nickname || user.nickname.trim() === '') {
        // 判斷是否為全新帳號：level 1 且無牌組
        const isNewAccount = (user.level === 1 || user.level === '1') && userDecks.length === 0;

        if (isNewAccount) {
            // 新玩家：彈窗要求設定名稱
            showView('auth-view'); // 保持在 auth 背景
            document.getElementById('nickname-modal').style.display = 'flex';
        } else {
            // 舊帳號（已有遊戲進度）：自動設為 username 以避免每次登入都彈窗
            user.nickname = user.username;
            AuthManager.currentUser = user;
            AuthManager.saveData().catch(err => console.warn('[登入] 自動設定名稱失敗:', err));
            showView('main-menu');
            showToast(`歡迎回來，${user.username}！`);
        }
    } else {
        showView('main-menu');
        showToast(`歡迎回來，${user.nickname}！`);
    }

    updatePlayerInfo(); // 登入後確保更新按鈕可見性
    updateLevelDisplay(); // 更新等級和經驗條顯示

    // [PVP 重連] 延遲檢查，確保畫面切換完成和 Firebase 準備好
    setTimeout(async () => {
        if (window.pvpManager && window.pvpManager.isReady()) {
            await checkPvPReconnection();
        }
    }, 300);
}

/**
 * 處理儲存暱稱
 */
async function handleNicknameSave() {
    const input = document.getElementById('nickname-input');
    const nickname = input.value.trim();

    if (nickname.length < 2 || nickname.length > 10) {
        showToast("名稱長度需在 2-10 字之間");
        return;
    }

    const modal = document.getElementById('nickname-modal');
    const btn = document.getElementById('btn-save-nickname');

    btn.disabled = true;
    btn.innerText = "設定中...";

    try {
        AuthManager.currentUser.nickname = nickname;
        AuthManager.currentUser.lastsaved = Date.now(); // 更新時間戳

        console.log('[Nickname] 準備儲存名稱:', nickname);
        console.log('[Nickname] 當前用戶資料:', AuthManager.currentUser);

        await AuthManager.saveData();

        console.log('[Nickname] 名稱已儲存至後端');

        modal.style.display = 'none';

        // 判斷當前視圖，若在個人頁面則留在該頁面
        const currentView = document.querySelector('.view[style*="display: flex"], .view[style*="display: block"]');
        if (currentView && currentView.id === 'profile-view') {
            showToast(`名稱已更新為「${nickname}」`);
            updateProfilePage();
        } else {
            showView('main-menu');
            showToast(`你好，${nickname}！冒險開始。`);

            // [Tutorial] Now that nickname is set, check if we need to start tutorial
            if (window.tutorialManager) {
                setTimeout(() => {
                    window.tutorialManager.checkTutorialStatus(AuthManager.currentUser);
                }, 500);
            }
        }

        updatePlayerInfo();
    } catch (e) {
        console.error("Save Nickname Error:", e);
        showToast("設定失敗，請稍後再試");
    } finally {
        btn.disabled = false;
        btn.innerText = "確定進入";
    }
}

/**
 * 更新主選單的玩家資訊顯示
 */
function updatePlayerInfo() {
    const playerCard = document.getElementById('player-info-card');
    const usernameEl = document.getElementById('player-username');
    const avatarEl = document.getElementById('player-avatar');
    const titleEl = document.getElementById('player-title');

    if (!playerCard) return;

    if (AuthManager.currentUser) {
        // 已登入：顯示玩家資訊
        playerCard.style.display = 'flex';
        usernameEl.textContent = AuthManager.currentUser.nickname || AuthManager.currentUser.username;

        // 頭像：使用選擇的頭像或名稱第一個字
        const selectedAvatar = AuthManager.currentUser.selectedAvatar;
        if (selectedAvatar) {
            const avatar = AVAILABLE_AVATARS.find(a => a.id === selectedAvatar);
            if (avatar) {
                avatarEl.style.backgroundImage = `url('${avatar.path}')`;
                avatarEl.style.backgroundSize = 'cover';
                avatarEl.style.backgroundPosition = 'center';
                avatarEl.textContent = '';
            }
        } else {
            // 沒有選擇頭像，使用名稱第一個字
            avatarEl.style.backgroundImage = '';
            const firstChar = (AuthManager.currentUser.nickname || AuthManager.currentUser.username).charAt(0);
            avatarEl.textContent = firstChar || '👤';
        }

        // 稱號
        const titleId = AuthManager.currentUser.selectedTitle || 'beginner';
        const titleObj = AVAILABLE_TITLES.find(t => t.id === titleId);
        if (titleEl) titleEl.textContent = `#${titleObj ? titleObj.name : titleId}`;

        // [權限控制] 只有 admin 可以看到測試模式
        const testBtn = document.getElementById('btn-main-test');
        if (testBtn) {
            testBtn.style.display = isAdmin() ? 'block' : 'none';
        }
    } else {
        // 未登入：隱藏資訊卡
        playerCard.style.display = 'none';
    }
}

/**
 * 初始化玩家資訊卡片的點擊事件
 */
function initPlayerInfoEvents() {
    const playerCard = document.getElementById('player-info-card');

    // 整個卡片點擊跳轉到個人頁面
    if (playerCard) {
        playerCard.addEventListener('click', () => {
            if (AuthManager.currentUser) {
                showProfilePage();
            }
        });

        // 加上 cursor pointer
        playerCard.style.cursor = 'pointer';
    }
}

/**
 * 顯示稱號選擇彈窗
 */
function showTitleSelectionModal() {
    const modal = document.getElementById('title-selection-modal');
    const container = document.getElementById('title-options');
    if (!modal || !container) return;

    // 獲取當前稱號與已擁有稱號
    const user = AuthManager.currentUser;
    const currentTitleId = user?.selectedTitle || 'beginner';
    const ownedTitles = user?.ownedTitles || ['beginner'];

    // 渲染稱號選項
    container.innerHTML = AVAILABLE_TITLES.map(title => {
        const isLocked = !ownedTitles.includes(title.id);
        const isSelected = title.id === currentTitleId;
        return `
            <div class="title-option ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''}" 
                 data-title="${title.id}">
                #${title.name}
            </div>
        `;
    }).join('');

    // 綁定點擊事件
    container.querySelectorAll('.title-option').forEach(option => {
        option.addEventListener('click', () => {
            if (option.classList.contains('locked')) {
                showToast("此稱號尚未解鎖");
                return;
            }
            const selectedTitleId = option.dataset.title;
            selectPlayerTitle(selectedTitleId);
            modal.style.display = 'none';
        });
    });

    modal.style.display = 'flex';
}

/**
 * 選擇玩家稱號
 */
function selectPlayerTitle(titleId) {
    if (AuthManager.currentUser) {
        AuthManager.currentUser.selectedTitle = titleId;
        updatePlayerInfo();
        if (typeof updateProfilePage === 'function') updateProfilePage();
        AuthManager.saveData();
        const titleObj = AVAILABLE_TITLES.find(t => t.id === titleId);
        showToast(`稱號已更換為：#${titleObj ? titleObj.name : titleId}`);
    }
}

/**
 * 顯示頭像選擇彈窗
 */
function showAvatarSelectionModal() {
    const modal = document.getElementById('avatar-selection-modal');
    const container = document.getElementById('avatar-options');
    if (!modal || !container) return;

    // 獲取當前頭像與已擁有頭像
    const user = AuthManager.currentUser;
    const currentAvatar = user?.selectedAvatar || 'avatar1';
    const ownedAvatars = user?.ownedAvatars || ['avatar1'];

    // 渲染頭像選項
    container.innerHTML = AVAILABLE_AVATARS.map(avatar => {
        const isLocked = !ownedAvatars.includes(avatar.id);
        return `
            <div class="avatar-option ${avatar.id === currentAvatar ? 'selected' : ''} ${isLocked ? 'locked' : ''}" 
                 data-avatar="${avatar.id}">
                <img src="${avatar.path}" alt="${avatar.name}">
            </div>
        `;
    }).join('');

    // 綁定點擊事件
    container.querySelectorAll('.avatar-option').forEach(option => {
        option.addEventListener('click', () => {
            if (option.classList.contains('locked')) {
                showToast("此頭像尚未解鎖");
                return;
            }
            const selectedAvatar = option.dataset.avatar;
            selectPlayerAvatar(selectedAvatar);
            modal.style.display = 'none';
        });
    });

    modal.style.display = 'flex';
}

/**
 * 選擇玩家頭像
 */
function selectPlayerAvatar(avatarId) {
    if (AuthManager.currentUser) {
        AuthManager.currentUser.selectedAvatar = avatarId;
        updatePlayerInfo();
        updateProfilePage();
        AuthManager.saveData();
        showToast('頭像已更換');
    }
}

/**
 * 選擇玩家稱號
 */


/**
 * 顯示個人頁面
 */
function showProfilePage() {
    if (!AuthManager.currentUser) {
        showToast('請先登入');
        showView('auth-view');
        return;
    }

    showView('profile-view');
    updateProfilePage();
}

/**
 * 更新個人頁面資料
 */
function updateProfilePage() {
    const user = AuthManager.currentUser;
    if (!user) return;

    // 更新頭像
    const avatarEl = document.getElementById('profile-avatar');
    if (avatarEl) {
        if (user.selectedAvatar) {
            const avatar = AVAILABLE_AVATARS.find(a => a.id === user.selectedAvatar);
            if (avatar) {
                avatarEl.style.backgroundImage = `url('${avatar.path}')`;
                avatarEl.style.backgroundSize = 'cover';
                avatarEl.style.backgroundPosition = 'center';
                avatarEl.textContent = '';
            }
        } else {
            avatarEl.style.backgroundImage = '';
            avatarEl.textContent = (user.nickname || user.username).charAt(0) || '👤';
        }
    }

    // 更新名稱和稱號
    const usernameEl = document.getElementById('profile-username');
    const titleEl = document.getElementById('profile-title');
    if (usernameEl) {
        usernameEl.textContent = `${user.nickname || user.username} ✏️`;
        // 綁定點擊事件以修改名稱
        usernameEl.onclick = () => {
            const modal = document.getElementById('nickname-modal');
            const input = document.getElementById('nickname-input');
            if (modal && input) {
                input.value = user.nickname || '';
                modal.style.display = 'flex';
            }
        };
    }
    const titleId = user.selectedTitle || 'beginner';
    const titleObj = AVAILABLE_TITLES.find(t => t.id === titleId);
    if (titleEl) titleEl.textContent = `#${titleObj ? titleObj.name : titleId} ✏️`;

    // 更新等級與經驗值
    const levelEl = document.getElementById('profile-level-val');
    const currentXPEl = document.getElementById('profile-current-xp');
    const requiredXPEl = document.getElementById('profile-required-xp');
    const xpBar = document.getElementById('profile-xp-bar');

    if (levelEl) levelEl.textContent = user.level || 1;

    // 計算經驗值需求
    const currentXP = user.currentXP || 0;
    const requiredXP = getXPRequiredForLevel(user.level || 1);

    if (currentXPEl) currentXPEl.textContent = currentXP;
    if (requiredXPEl) requiredXPEl.textContent = requiredXP;

    if (xpBar) {
        const percentage = Math.min((currentXP / requiredXP) * 100, 100);
        xpBar.style.width = `${percentage}%`;
    }

    // 更新金幣
    const goldEl = document.getElementById('profile-gold-amount');
    if (goldEl) {
        goldEl.textContent = user.gold !== undefined ? user.gold : 100;
    }

    // 更新消費券
    const vouchersEl = document.getElementById('profile-vouchers-amount');
    if (vouchersEl) {
        vouchersEl.textContent = user.vouchers || 0;
    }

    // 更新加入時間
    const joinDateEl = document.getElementById('profile-join-date');
    if (joinDateEl) {
        let dateStr = '未知';
        // Debug: Check what fields we actually have
        console.log('[Profile Debug] Current User Object:', user);
        console.log('[Profile Debug] created_at:', user.created_at);
        console.log('[Profile Debug] createdAt:', user.createdAt);

        // Check both created_at (DB column) and createdAt (camelCase convention)
        // GAS returns keys as lowercase without underscores, so we also check user.createdat
        const dateValue = user.created_at || user.createdAt || user.createdat;
        if (dateValue) {
            let date = new Date(dateValue);

            // 如果直接 parse 失敗 (Invalid Date) 且是字串，嘗試處理中文格式 (如: "2026/1/19 下午 8:37:09")
            if (isNaN(date.getTime()) && typeof dateValue === 'string') {
                console.log('[Profile Debug] Standard parse failed, trying fallback for:', dateValue);
                // 嘗試只取空白前的第一段日期 (YYYY/MM/DD)
                const simpleDate = dateValue.split(' ')[0];
                date = new Date(simpleDate);
            }

            console.log('[Profile Debug] Final Parsed Date:', date);
            if (!isNaN(date.getTime())) {
                dateStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
            }
        }
        joinDateEl.textContent = `加入時間：${dateStr}`;
    }

    // 更新統計數據 - 按難度分類
    // 確保 stats 物件存在且有預設值
    const defaultStats = {
        totalWins: 0,
        pvpWins: 0, pvpGames: 0,
        normalWins: 0, normalGames: 0,
        hardWins: 0, hardGames: 0, // Expert
        hellWins: 0, hellGames: 0, // Master
        ownedCards: []
    };
    const stats = { ...defaultStats, ...(user.stats || {}) };

    // 1. 總勝場
    // 如果 totalWins 沒紀錄，嘗試從各難度加總
    const calcTotalWins = stats.totalWins || (stats.normalWins + stats.hardWins + stats.hellWins + stats.pvpWins);
    const winsTotalEl = document.getElementById('stat-total-wins');
    if (winsTotalEl) {
        winsTotalEl.textContent = calcTotalWins;
    }

    // 2. 對戰勝率(與玩家)
    const pvpWinRate = stats.pvpGames > 0
        ? Math.round((stats.pvpWins / stats.pvpGames) * 100)
        : 0;
    const pvpWinrateEl = document.getElementById('stat-pvp-winrate');
    if (pvpWinrateEl) {
        pvpWinrateEl.textContent = `${pvpWinRate}%`;
        pvpWinrateEl.setAttribute('data-hover', `勝場: ${stats.pvpWins} 總場次: ${stats.pvpGames}`);
    }

    // 3. 對戰電腦勝率(普通)
    const normalWinRate = stats.normalGames > 0
        ? Math.round((stats.normalWins / stats.normalGames) * 100)
        : 0;
    const normalWinsEl = document.getElementById('stat-ai-normal');
    if (normalWinsEl) {
        normalWinsEl.textContent = `${normalWinRate}%`;
        normalWinsEl.setAttribute('data-hover', `勝場: ${stats.normalWins} 總場次: ${stats.normalGames}`);
    }

    // 4. 對戰電腦勝率(專家)
    const hardWinRate = stats.hardGames > 0
        ? Math.round((stats.hardWins / stats.hardGames) * 100)
        : 0;
    const expertWinsEl = document.getElementById('stat-ai-expert');
    if (expertWinsEl) {
        expertWinsEl.textContent = `${hardWinRate}%`;
        expertWinsEl.setAttribute('data-hover', `勝場: ${stats.hardWins} 總場次: ${stats.hardGames}`);
    }

    // 5. 對戰電腦勝率(大師)
    const hellWinRate = stats.hellGames > 0
        ? Math.round((stats.hellWins / stats.hellGames) * 100)
        : 0;
    const masterWinsEl = document.getElementById('stat-ai-master');
    if (masterWinsEl) {
        masterWinsEl.textContent = `${hellWinRate}%`;
        masterWinsEl.setAttribute('data-hover', `勝場: ${stats.hellWins} 總場次: ${stats.hellGames}`);
    }


    // 6. 擁有卡牌
    const ownedCardsCount = stats.ownedCards ? stats.ownedCards.length : 0;
    const ownedCardsEl = document.getElementById('stat-owned-cards');
    if (ownedCardsEl) ownedCardsEl.textContent = ownedCardsCount;

    // 更新牌組列表
    renderProfileDeckList();
}

/**
 * 渲染卡牌收藏
 */
// 渲染個人頁面牌組列表
function renderProfileDeckList() {
    console.log('[RENDER] ===== 開始渲染牌組列表 =====');
    const container = document.getElementById('profile-deck-list');
    if (!container) {
        console.error('[RENDER] 錯誤：找不到 profile-deck-list 容器！');
        return;
    }
    console.log('[RENDER] 容器找到:', container);

    console.log('[RENDER] 準備渲染', userDecks ? userDecks.length : 0, '個牌組');
    container.innerHTML = '';

    // Render existing decks
    if (userDecks && userDecks.length > 0) {
        userDecks.forEach((deck, idx) => {
            const item = createDeckItem(deck, idx);
            container.appendChild(item);
        });
    }

    // Add "Add New Deck" button
    if (!userDecks || userDecks.length < 10) {
        const addItem = document.createElement('div');
        addItem.className = 'add-deck-item';
        addItem.innerHTML = `
            <div class="add-deck-icon">+</div>
            <div class="add-deck-text">建立新牌組</div>
        `;
        addItem.addEventListener('click', () => {
            if (editingDeckIdx !== -1) return;
            showDeckCreationOptions();
        });
        container.appendChild(addItem);
    }

    // Fill remaining slots up to 6 with placeholders
    const currentCount = container.children.length;
    if (currentCount < 6) {
        const remaining = 6 - currentCount;
        for (let i = 0; i < remaining; i++) {
            const placeholder = document.createElement('div');
            placeholder.className = 'deck-item-placeholder';
            container.appendChild(placeholder);
        }
    }

    function createDeckItem(deck, idx) {
        const item = document.createElement('div');
        item.className = `profile-deck-item ${idx === selectedDeckIdx ? 'selected' : ''}`;

        const isDeckIncomplete = deck.cards.length !== 30;
        const countClass = isDeckIncomplete ? 'incomplete' : '';
        const warningIcon = isDeckIncomplete ? '⚠️ ' : '';

        // Minimalist Design Structure
        item.innerHTML = `
            <div class="deck-item-main">
                <div class="deck-item-name-large" title="${deck.name}">${deck.name}</div>
                <div class="deck-item-count-badge ${countClass}">${warningIcon}${deck.cards.length}/30</div>
            </div>
            <div class="deck-item-actions-bottom">
                <button class="btn-deck-action-half btn-deck-edit" data-idx="${idx}">✏️ <span style="margin-left: 6px;">編輯</span></button>
                <button class="btn-deck-action-half btn-deck-delete" data-idx="${idx}">🗑️ <span style="margin-left: 6px;">刪除</span></button>
            </div>
        `;

        item.querySelector('.deck-item-main').addEventListener('click', () => {
            selectedDeckIdx = idx;
            localStorage.setItem('selectedDeckIdx', selectedDeckIdx);
            renderProfileDeckList();
        });

        item.querySelector('.btn-deck-edit').addEventListener('click', (e) => {
            e.stopPropagation();
            editingDeckIdx = idx;
            tempDeck = JSON.parse(JSON.stringify(userDecks[idx]));
            showView('deck-builder');
            renderDeckBuilder();
        });

        item.querySelector('.btn-deck-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (userDecks.length <= 1) {
                await showCustomAlert('至少需保留一個牌組！');
                return;
            }
            const confirmed = await showCustomConfirm(`確定要刪除「${deck.name}」嗎？`);
            if (confirmed) {
                userDecks.splice(idx, 1);
                if (selectedDeckIdx >= userDecks.length) selectedDeckIdx = userDecks.length - 1;
                if (AuthManager.currentUser) {
                    AuthManager.currentUser.deck_data = userDecks;
                    AuthManager.saveData();
                }
                showToast('牌組已刪除');
                renderProfileDeckList();
            }
        });

        return item;
    }
}

// 顯示牌組創建選項模態視窗
function showDeckCreationOptions() {
    console.log('[DECK] 顯示牌組創建選項模態視窗');
    const modal = document.getElementById('deck-creation-modal');
    if (modal) {
        console.log('[DECK] 模態視窗找到，顯示中...');
        modal.style.display = 'flex';
    } else {
        console.error('[DECK] 錯誤：找不到 deck-creation-modal 元素！');
    }
}

/**
 * 檢查主題牌組中缺少的卡牌
 * @param {string[]} themeCards - 主題牌組的卡牌 ID 陣列
 * @param {Object} ownedCards - 玩家擁有的卡牌 { cardId: count }
 * @returns {Object} { missing: [], owned: [], missingCount: 0, totalCount: 0 }
 */
function checkMissingCards(themeCards, ownedCards) {
    // admin 在測試模式下不檢查缺卡
    if (window.isDebugMode && isAdmin()) {
        return { missing: [], owned: themeCards, missingCount: 0, totalCount: themeCards.length };
    }
    const missingCards = [];
    const ownedInTheme = [];

    // 統計每種卡牌在牌組中出現的次數
    const themeCardCounts = {};
    themeCards.forEach(cardId => {
        themeCardCounts[cardId] = (themeCardCounts[cardId] || 0) + 1;
    });

    // 檢查每種卡牌的擁有狀況
    Object.keys(themeCardCounts).forEach(cardId => {
        const needed = themeCardCounts[cardId];
        const owned = ownedCards[cardId] || 0;

        if (owned < needed) {
            // 缺卡
            const card = CARD_DATA.find(c => c.id === cardId);
            missingCards.push({
                id: cardId,
                name: card?.name || cardId,
                needed: needed,
                owned: owned,
                missing: needed - owned
            });
        } else {
            // 足夠
            ownedInTheme.push(cardId);
        }
    });

    return {
        missing: missingCards,
        owned: ownedInTheme,
        missingCount: missingCards.reduce((sum, c) => sum + c.missing, 0),
        totalCount: themeCards.length
    };
}

/**
 * 顯示缺卡提示視窗
 * @param {Object} missingInfo - checkMissingCards 的回傳結果
 * @param {string} themeName - 主題牌組名稱
 * @param {Function} onConfirm - 確認回調（建立不完整牌組）
 * @param {Function} onCancel - 取消回調
 */
async function showMissingCardsAlert(missingInfo, themeName, onConfirm, onCancel) {
    const { missing, missingCount, totalCount } = missingInfo;

    // 生成缺卡清單 HTML
    const missingListHtml = missing.map(card => `
        <li style="display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; border-bottom: 1px solid rgba(139, 69, 19, 0.1);">
            <span style="font-weight: bold; color: var(--wood-dark); font-size: 1em; font-family: 'Noto Serif TC', serif;">${card.name}</span>
            <span style="color: #c0392b; font-weight: bold; font-size: 0.9em;">缺 ${card.missing} <span style="color: #666; font-weight: normal; font-size: 0.85em;">(有 ${card.owned}/${card.needed})</span></span>
        </li>
    `).join('');

    const message = `
        <div style="text-align: center; max-width: 480px; font-family: 'Noto Sans TC', sans-serif; color: #3d1e0f; margin: 0 auto;">
            <h3 style="color: var(--red-medieval); margin-bottom: 8px; font-size: 1.25em; border-bottom: 2px solid var(--wood-medium); padding-bottom: 8px; font-family: 'Noto Serif TC', serif; font-weight: 900;">
                ⚠️ 缺少卡牌
            </h3>
            
            <p style="margin-bottom: 8px; font-size: 0.95em; line-height: 1.4; font-weight: bold;">
                <span style="color: var(--wood-dark);">「${themeName}」</span>缺 <span style="color: #c0392b; font-size: 1.15em;">${missingCount}</span> 張卡：
            </p>
            
            <ul style="list-style: none; padding: 0; background: rgba(255, 255, 255, 0.4); border: 1px solid var(--wood-light); border-radius: 8px; margin: 8px auto; box-shadow: inset 0 0 8px rgba(0,0,0,0.03); text-align: left;">
                ${missingListHtml}
            </ul>
            
            <p style="margin-top: 10px; font-size: 0.85em; color: #666; font-style: italic; line-height: 1.3;">
                (確定後將會建立一個不完整的牌組<br>目前擁有 ${totalCount - missingCount}/${totalCount} 張)
            </p>
        </div>
    `;

    const confirmed = await showCustomConfirm(message);

    if (confirmed) {
        onConfirm();
    } else {
        if (onCancel) onCancel();
    }
}

// 創建新的玩家牌組
function addNewPlayerDeck(themeCards = null) {
    console.log('[DECK] ===== 開始創建新牌組 =====');
    console.log('[DECK] 當前牌組數量:', userDecks.length);
    console.log('[DECK] 主題卡牌:', themeCards ? `${themeCards.length} 張` : '無（自由組建）');

    const newDeck = {
        name: `牌組 ${userDecks.length + 1}`,
        cards: themeCards || []
    };
    console.log('[DECK] 新牌組名稱:', newDeck.name);

    userDecks.push(newDeck);
    selectedDeckIdx = userDecks.length - 1;
    editingDeckIdx = selectedDeckIdx;
    console.log('[DECK] 牌組已加入陣列，新數量:', userDecks.length);
    console.log('[DECK] 選中索引:', selectedDeckIdx);

    // 同步到本地與雲端
    if (AuthManager.currentUser) {
        console.log('[DECK] 當前用戶:', AuthManager.currentUser.username);
        AuthManager.currentUser.deck_data = userDecks;
        AuthManager.saveData();
        console.log('[DECK] ✓ 已同步到本地與雲端資料庫');
    } else {
        console.warn('[DECK] ⚠ 未登入，無法同步到雲端');
    }

    // 立即更新顯示 - 這是關鍵！
    console.log('[DECK] 呼叫 renderProfileDeckList() 更新顯示...');
    renderProfileDeckList();

    // 進入編輯模式
    tempDeck = JSON.parse(JSON.stringify(newDeck));
    console.log('[DECK] 進入編輯模式，跳轉到牌組編輯器');
    showView('deck-builder');
    renderDeckBuilder();
    console.log('[DECK] ===== 創建流程完成 =====');
}

// 顯示玩家主題牌組選擇
function showPlayerThemeSelection() {
    const modal = document.getElementById('player-theme-selection-modal');
    if (!modal) return;

    const container = document.getElementById('player-theme-list');
    if (!container) return;

    container.innerHTML = '';

    // 渲染每個主題牌組
    aiThemeDecks.forEach((theme, idx) => {
        const themeItem = document.createElement('div');
        themeItem.className = 'medieval-theme-item';
        themeItem.innerHTML = `
            <div class="theme-item-image" style="background-image: url('${theme.image}'); background-size: cover; background-position: center;"></div>
            <div class="theme-item-info">
                <div class="theme-item-name">${theme.name}</div>
                <div class="theme-item-count">${theme.cards.length} 張卡</div>
            </div>
        `;

        themeItem.addEventListener('click', async () => {
            modal.style.display = 'none';

            // 檢查缺卡
            const ownedCards = AuthManager.currentUser?.ownedCards || {};
            const missingInfo = checkMissingCards(theme.cards, ownedCards);

            if (missingInfo.missingCount > 0) {
                // 有缺卡，顯示提示
                await showMissingCardsAlert(
                    missingInfo,
                    theme.name,
                    () => {
                        // 確認：僅用擁有的卡牌建立
                        const ownedThemeCards = [];
                        const cardCounts = {};

                        // 統計每種卡牌需要的數量
                        theme.cards.forEach(cardId => {
                            cardCounts[cardId] = (cardCounts[cardId] || 0) + 1;
                        });

                        // 只加入擁有的卡牌（最多到需要的數量）
                        Object.keys(cardCounts).forEach(cardId => {
                            const needed = cardCounts[cardId];
                            const owned = ownedCards[cardId] || 0;
                            const toAdd = Math.min(needed, owned);

                            for (let i = 0; i < toAdd; i++) {
                                ownedThemeCards.push(cardId);
                            }
                        });

                        addNewPlayerDeck(ownedThemeCards);
                        showToast(`已建立不完整的「${theme.name}」牌組 (${ownedThemeCards.length}/${theme.cards.length} 張)`);
                    },
                    () => {
                        // 取消：不做任何事
                        showToast('已取消建立牌組');
                    }
                );
            } else {
                // 沒有缺卡，直接建立
                addNewPlayerDeck(JSON.parse(JSON.stringify(theme.cards)));
            }
        });

        container.appendChild(themeItem);
    });

    modal.style.display = 'flex';
}


function renderThemeSelection(isEditMode = false) {
    const container = document.getElementById('theme-cards-container');
    container.innerHTML = '';

    aiThemeDecks.forEach((theme, idx) => {
        const card = document.createElement('div');
        card.className = 'theme-card';

        const imageDiv = document.createElement('div');
        imageDiv.className = 'theme-card-image';

        // Try to load image, fallback to emoji
        const img = new Image();
        img.src = theme.image;
        img.onload = () => {
            imageDiv.style.backgroundImage = `url('${theme.image}')`;
            imageDiv.style.backgroundSize = 'cover';
            imageDiv.style.backgroundPosition = 'center';
            imageDiv.innerHTML = '';
        };
        img.onerror = () => {
            // Fallback emoji based on theme
            const emojis = { 'dpp': '🟢', 'kmt': '🔵', 'tpp': '🟡' };
            imageDiv.innerHTML = emojis[theme.id] || '🎴';
        };

        const content = document.createElement('div');
        content.className = 'theme-card-content';
        content.innerHTML = `
            <h3>${theme.name}</h3>
            <p>${theme.cards.length} / 30 張卡</p>
        `;

        card.appendChild(imageDiv);
        card.appendChild(content);

        card.addEventListener('click', () => {
            if (isEditMode) {
                // Edit mode: open deck builder
                editingThemeIdx = idx;
                tempDeck = JSON.parse(JSON.stringify(theme));
                tempDeck.isTheme = true; // Mark as theme deck
                showView('deck-builder');
                renderDeckBuilder();
            } else {
                // Battle mode: select theme
                selectedThemeId = theme.id;
                showView('deck-selection');
                document.getElementById('deck-select-title').innerText = '選擇出戰牌組';
                renderDeckSelect();
            }
        });

        container.appendChild(card);
    });
}


function renderDeckSelect() {
    const container = document.getElementById('deck-select-slots');
    container.innerHTML = '';

    const startBtn = document.getElementById('btn-start-battle');
    const editBtn = document.getElementById('btn-edit-deck');
    const titleEl = document.getElementById('deck-select-title');

    // Title is already set by the caller, no need to override here
    // Just keep the existing title

    // Reset Buttons
    const isNoSelection = selectedDeckIdx < 0 || selectedDeckIdx >= userDecks.length;
    if (startBtn) {
        startBtn.style.display = 'none';
        startBtn.style.opacity = isNoSelection ? '0.5' : '1';
    }
    if (editBtn) {
        editBtn.style.display = 'none';
        editBtn.style.opacity = isNoSelection ? '0.5' : '1';
    }

    if (pendingViewMode === 'BATTLE' || pendingViewMode === 'DEBUG') {
        if (startBtn) {
            startBtn.style.display = 'block';
            startBtn.onclick = async () => {
                if (selectedDeckIdx < 0 || selectedDeckIdx >= userDecks.length) {
                    await showCustomAlert("請先選擇一個牌組再開始遊戲！");
                    return;
                }
                const deck = userDecks[selectedDeckIdx];
                const isTest = deck.isTest || isDebugMode;
                if (deck.cards.length === 30 || (isTest && deck.cards.length > 0)) {
                    // Get selected theme deck
                    const themeDeck = aiThemeDecks.find(t => t.id === selectedThemeId);
                    const oppDeck = themeDeck ? themeDeck.cards : null;
                    startBattle(deck.cards, isDebugMode, oppDeck);
                } else {
                    await showCustomAlert(`「${deck.name}」目前有 ${deck.cards.length} 張卡，需要剛好 30 張才能戰鬥！${isTest ? '(測試模式需至少 1 張)' : ''}`);
                }
            };
        }
    }

    if (pendingViewMode === 'BUILDER' || pendingViewMode === 'DEBUG') {
        if (editBtn) {
            editBtn.style.display = 'block';
            editBtn.onclick = async () => {
                if (selectedDeckIdx < 0 || selectedDeckIdx >= userDecks.length) {
                    await showCustomAlert("請先選擇一個牌組進行編輯！");
                    return;
                }
                editingDeckIdx = selectedDeckIdx;
                // Deep copy for editing
                tempDeck = JSON.parse(JSON.stringify(userDecks[editingDeckIdx]));
                showView('deck-builder');
                renderDeckBuilder();
            };
        }
    }

    // Strict Isolation: Test Mode shows ONLY test decks, Normal Mode shows ONLY normal decks
    // [權限控制] admin 在測試模式下可以看到所有牌組
    const visibleDecks = userDecks.map((d, i) => ({ ...d, originalIdx: i }))
        .filter(d => (window.isDebugMode && isAdmin()) ? true : (isDebugMode ? d.isTest : !d.isTest));

    visibleDecks.forEach((deck, idx) => {
        const slot = document.createElement('div');
        slot.className = `deck-slot ${deck.originalIdx === selectedDeckIdx ? 'selected' : ''}`;

        const isDeckIncomplete = deck.cards.length !== 30;
        const warningIcon = (isDeckIncomplete && !deck.isTest) ? '<span title="牌組未滿30張" style="color: var(--neon-yellow); margin-right: 8px;">⚠️</span>' : '';
        const testLabel = deck.isTest ? '<span style="color: var(--neon-pink); font-size: 10px; margin-left: 5px;">[測試]</span>' : '';

        slot.innerHTML = `
            <button class="btn-delete-deck" title="刪除牌組">×</button>
            <h3>${warningIcon}${deck.name}${testLabel}</h3>
            <div class="slot-info">${deck.cards.length} / 30 張卡</div>
        `;

        slot.querySelector('.btn-delete-deck').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (userDecks.length <= 1) {
                await showCustomAlert("至少需保留一個牌組！");
                return;
            }
            const confirmed = await showCustomConfirm(`確定要刪除「${deck.name}」嗎？`);
            if (confirmed) {
                userDecks.splice(deck.originalIdx, 1);
                if (selectedDeckIdx >= userDecks.length) selectedDeckIdx = userDecks.length - 1;
                // 同步至本地與雲端
                if (AuthManager.currentUser) {
                    AuthManager.currentUser.deck_data = userDecks;
                    AuthManager.saveData();
                }

                renderDeckSelect();
            }
        });

        // Click slot to select
        slot.addEventListener('click', () => {
            selectedDeckIdx = deck.originalIdx;
            localStorage.setItem('selectedDeckIdx', selectedDeckIdx);
            renderDeckSelect();
        });

        container.appendChild(slot);
    });

    // Add New Deck Slot (Only in Builder or Debug Mode)
    if (pendingViewMode !== 'BATTLE' && userDecks.length < 10) {
        const addSlot = document.createElement('div');
        addSlot.className = 'deck-slot add-deck-slot';
        addSlot.innerHTML = `
            <div class="plus-icon">+</div>
            <div>建立${isDebugMode ? '測試' : '新'}牌組</div>
        `;
        addSlot.onclick = () => {
            if (isDebugMode) {
                // 測試模式：直接創建測試牌組
                addNewPlayerDeck(null, null, true); // isTestDeck=true
            } else {
                // 一般模式：顯示選項
                showDeckCreationOptions();
            }
        };
        container.appendChild(addSlot);
    }
}

function showDeckCreationOptions() {
    document.getElementById('deck-creation-modal').style.display = 'flex';
}

function addNewPlayerDeck(cardIds = null, themeName = null, isTestDeck = false) {
    console.log('[DECK] ===== 開始創建新牌組 =====');
    console.log('[DECK] 當前牌組數量:', userDecks.length);
    console.log('[DECK] 卡牌:', cardIds ? `${cardIds.length} 張` : '無（空牌組）');
    console.log('[DECK] 是否為測試牌組:', isTestDeck);

    const newDeck = {
        name: themeName || (isTestDeck ? '測試牌組 ' : '自定義牌組 ') + (userDecks.length + 1),
        cards: cardIds ? [...cardIds] : []
    };
    if (isTestDeck) newDeck.isTest = true;

    console.log('[DECK] 新牌組名稱:', newDeck.name);
    userDecks.push(newDeck);
    console.log('[DECK] 牌組已加入，新數量:', userDecks.length);

    // 同步至本地與雲端
    if (AuthManager.currentUser) {
        console.log('[DECK] 同步到雲端:', AuthManager.currentUser.username);
        AuthManager.currentUser.deck_data = userDecks;
        AuthManager.saveData();
    }

    selectedDeckIdx = userDecks.length - 1;
    editingDeckIdx = selectedDeckIdx;

    // 更新個人頁面列表（如果在個人頁面）
    if (document.getElementById('profile-view').style.display !== 'none') {
        console.log('[DECK] 更新個人頁面列表');
        renderProfileDeckList();
    } else {
        // 更新牌組選擇頁面（如果在牌組選擇）
        renderDeckSelect();
    }

    // 立即進入編輯模式
    tempDeck = JSON.parse(JSON.stringify(newDeck));
    console.log('[DECK] 進入編輯模式');
    showView('deck-builder');
    renderDeckBuilder();
    console.log('[DECK] ===== 創建完成 =====');
}

function showPlayerThemeSelection() {
    document.getElementById('player-theme-selection-modal').style.display = 'flex';
    renderPlayerThemeList();
}

function renderPlayerThemeList() {
    const container = document.getElementById('player-theme-list');
    container.innerHTML = '';

    aiThemeDecks.forEach((theme) => {
        const card = document.createElement('div');
        card.className = 'theme-preview-card';
        card.innerHTML = `
            <div class="deck-preview-img" style="background-image: url('${theme.image}')"></div>
            <h3>${theme.name}</h3>
            <div class="deck-size">${theme.cards.length} 張卡片</div>
        `;
        card.onclick = async () => {
            document.getElementById('player-theme-selection-modal').style.display = 'none';

            // 檢查缺卡
            const ownedCards = AuthManager.currentUser?.ownedCards || {};
            const missingInfo = checkMissingCards(theme.cards, ownedCards);

            if (missingInfo.missingCount > 0) {
                // 有缺卡，顯示提示
                await showMissingCardsAlert(
                    missingInfo,
                    theme.name,
                    () => {
                        // 確認：僅用擁有的卡牌建立
                        const ownedThemeCards = [];
                        const cardCounts = {};

                        // 統計每種卡牌需要的數量
                        theme.cards.forEach(cardId => {
                            cardCounts[cardId] = (cardCounts[cardId] || 0) + 1;
                        });

                        // 只加入擁有的卡牌（最多到需要的數量）
                        Object.keys(cardCounts).forEach(cardId => {
                            const needed = cardCounts[cardId];
                            const owned = ownedCards[cardId] || 0;
                            const toAdd = Math.min(needed, owned);

                            for (let i = 0; i < toAdd; i++) {
                                ownedThemeCards.push(cardId);
                            }
                        });

                        addNewPlayerDeck(ownedThemeCards, theme.name);
                        showToast(`已建立不完整的「${theme.name}」牌組 (${ownedThemeCards.length}/${theme.cards.length} 張)`);
                    },
                    () => {
                        // 取消：不做任何事
                        showToast('已取消建立牌組');
                    }
                );
            } else {
                // 沒有缺卡，直接建立
                addNewPlayerDeck(theme.cards, theme.name);
                showToast(`已匯入${theme.name}`);
            }
        };
        container.appendChild(card);
    });
}

// --- Loading Indicator Helpers ---
function showLoadingIndicator(message = '戰場載入中...') {
    let loader = document.getElementById('global-loading-overlay');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'global-loading-overlay';
        loader.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            z-index: 99999;
            display: flex;
            justify-content: center;
            align-items: center;
            color: #d4af37; /* Gold */
            font-family: 'Noto Serif TC', serif;
            font-size: 24px;
            flex-direction: column;
            gap: 20px;
            opacity: 0;
            transition: opacity 0.3s;
        `;
        loader.innerHTML = `
            <div style="
                border: 4px solid #d4af37; 
                border-top: 4px solid transparent; 
                border-radius: 50%; 
                width: 50px; 
                height: 50px; 
                animation: spin 1s linear infinite;">
            </div>
            <div id="loading-message" style="text-shadow: 0 0 10px rgba(212, 175, 55, 0.5);"></div>
            <style>
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
        `;
        document.body.appendChild(loader);

        // Force reflow
        void loader.offsetWidth;
    }

    // Update message
    const messageEl = loader.querySelector('#loading-message');
    if (messageEl) messageEl.textContent = message;

    loader.style.display = 'flex';
    loader.style.opacity = '1';
}

function hideLoadingIndicator() {
    const loader = document.getElementById('global-loading-overlay');
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
        }, 300);
    }
}

function showView(viewId, isInstant = false) {
    const nextView = document.getElementById(viewId);
    if (!nextView) return;

    // [Optimize] Show loading indicator for heavy battle view
    if (viewId === 'battle-view') {
        showLoadingIndicator();
        // Preload large background image
        const bgImg = new Image();
        bgImg.src = 'assets/images/backgrounds/arena_bg.webp';
        bgImg.onload = () => {
            console.log('[App] Battle background loaded');
            // Consider adding a small delay or check if other assets are needed
            hideLoadingIndicator();
        };
        bgImg.onerror = () => {
            console.warn('[App] Failed to preload battle background');
            hideLoadingIndicator();
        };
    }


    // If same view is already fully displayed, ignore
    if (viewId === currentViewId && nextView.style.display === 'flex' && !nextView.classList.contains('enter-active')) {
        return;
    }

    // Cancel existing transition cleanup
    if (transitionTimeout) {
        clearTimeout(transitionTimeout);
        transitionTimeout = null;
    }

    const views = document.querySelectorAll('.view');

    if (isInstant) {
        // Instant switch: hide all, show target
        views.forEach(v => {
            v.style.display = 'none';
            v.classList.remove('enter-active', 'exit-active');
        });
        nextView.style.display = 'flex';
        nextView.scrollTop = 0;
        currentViewId = viewId;
    } else {
        // Identify and transition out all visible views except the target
        views.forEach(v => {
            if (v.style.display === 'flex' && v.id !== viewId) {
                v.classList.add('exit-active');
                v.classList.remove('enter-active');
            } else if (v.id !== viewId) {
                // Immediately hide non-active non-target views
                v.style.display = 'none';
                v.classList.remove('enter-active', 'exit-active');
            }
        });

        // Animate target view in
        nextView.style.display = 'flex';
        nextView.classList.add('enter-active');
        nextView.classList.remove('exit-active');
        nextView.scrollTop = 0;

        const previousViewId = currentViewId;
        currentViewId = viewId;

        transitionTimeout = setTimeout(() => {
            const currentViews = document.querySelectorAll('.view');
            currentViews.forEach(v => {
                if (v.id !== viewId) {
                    v.style.display = 'none';
                    v.classList.remove('exit-active', 'enter-active');
                }
            });
            nextView.classList.remove('enter-active');
            transitionTimeout = null;
        }, 800); // Reduced from 1600ms for snappier transition and less black flash risk
    }

    // --- Update Cloud Visibility ---
    if (window.cloudManager) {
        window.cloudManager.updateView(viewId);
    }

    // --- Original Logic for UI Elements ---
    const log = document.getElementById('message-log');
    if (log) {
        log.style.display = (viewId === 'battle-view') ? 'flex' : 'none';
    }

    // Control BGM based on view
    if (audioManager) {
        if (viewId === 'battle-view') {
            audioManager.play();
        } else if (currentViewId !== 'battle-view') {
            audioManager.pause();
        }
    }

    // --- 確保回主選單時更新等級與經驗條 ---
    if (viewId === 'main-menu') {
        updateLevelDisplay();
    }
}

let previousPlayerHandSize = 0;

async function startBattle(deckIds, debugMode = false, oppDeckIds = null) {
    MatchHistory.clear();
    // Use provided opponent deck or generate random one
    let oppDeck;
    if (oppDeckIds && oppDeckIds.length > 0) {
        oppDeck = oppDeckIds;
    } else {
        const allIds = CARD_DATA.map(c => c.id);
        oppDeck = [];
        while (oppDeck.length < 30) oppDeck.push(allIds[Math.floor(Math.random() * allIds.length)]);
    }

    try {
        gameState = gameEngine.createGame(deckIds, oppDeck, isDebugMode, currentDifficulty);
        // Expose for debugging
        window.gameState = gameState;
        // Store initial deck for Deck View
        gameState.players[0].initialDeckIds = [...deckIds];
        // Only call showView ONCE
        showView('battle-view');

        // Play battle BGM
        if (audioManager) {
            audioManager.play();
        }

        // 啟動 Mulligan Phase (起手換牌)
        showMulliganPhase();

        // render() 將在 Mulligan 完成後由 confirmMulligan() 呼叫
        // 不要在這裡呼叫 render(), 因為遊戲尚未開始 (startTurn 被延遲)
    } catch (e) {
        logMessage(e.message);
        return;
    }

    // ===== 初始抽牌動畫已註解 - Mulligan Phase 會處理起手牌 =====
    // Initial Draw Sequence Logic - DISABLED for Mulligan
    /*
    const initialHand = [...gameState.players[0].hand];
    gameState.players[0].hand = [];
    previousPlayerHandSize = 0;
 
    // Init Mana Containers for the new game view
    initManaContainers('player-mana-container');
    initManaContainers('opp-mana-container');
 
    render();
 
    // Animate sorting out cards one by one
    // We don't block the UI thread completely, just delay the appearance
    for (const card of initialHand) {
        await new Promise(r => setTimeout(r, 400));
        gameState.players[0].hand.push(card);
        render();
    }
 
    // If opponent starts, trigger AI
    if (gameState.currentPlayerIdx === 1) {
        setTimeout(() => {
            aiTurn();
        }, 1000);
    }
    */

    // Mulligan 會在玩家選擇完後自動呼叫 render() 和 startTurn()
}

// ===== PvP 對戰初始化 =====
let isPvPMode = false;
let pvpRoomId = null;
let pvpPlayerId = null;

async function startPvPGame(roomId, playerId, myDeckCards) {
    isPvPMode = true;
    pvpRoomId = roomId;
    pvpPlayerId = playerId;

    MatchHistory.clear();

    console.log('[PvP] 開始對戰初始化...', { roomId, playerId, deckSize: myDeckCards.length });

    // 等待對手資料
    const roomData = window.pvpManager?.currentRoom;
    if (!roomData) {
        showToast('無法取得房間資料');
        return;
    }

    try {
        // 暫時使用隨機對手牌組（未來會從 Firebase 取得）
        const allIds = CARD_DATA.map(c => c.id);
        let oppDeck = [];
        while (oppDeck.length < 30) {
            oppDeck.push(allIds[Math.floor(Math.random() * allIds.length)]);
        }

        // 根據身份決定先後手
        const isFirstPlayer = playerId === 'player1';

        // 建立遊戲狀態
        gameState = gameEngine.createGame(
            myDeckCards,
            oppDeck,
            false, // debugMode
            'NORMAL' // difficulty
        );

        // 強制設定先後手 (player1 先手)
        gameState.currentPlayerIdx = isFirstPlayer ? 0 : 1;

        window.gameState = gameState;
        // Store initial deck for Deck View
        gameState.players[0].initialDeckIds = [...myDeckCards];
        showView('battle-view');

        // PvP 模式標記
        window.isPvPMode = true;

        // Play battle BGM
        if (audioManager) {
            audioManager.play();
        }

        // ===== 檢查是否需要 Mulligan（重連判斷）=====
        const roomData = window.pvpManager?.currentRoom;
        const mulliganStatus = roomData?.gameState?.mulliganStatus;
        const myMulliganDone = mulliganStatus?.[pvpPlayerId];
        const bothCompleted = mulliganStatus?.player1 && mulliganStatus?.player2;
        const savedInitialHand = roomData?.gameState?.initialHands?.[pvpPlayerId];

        // 情況 1: 雙方都完成 Mulligan（重連且已完成換牌）
        if (bothCompleted) {
            console.log('[PvP 重連] Mulligan 已完成，跳過 Mulligan 階段');
            console.log('[PvP 重連] savedInitialHand:', savedInitialHand);
            console.log('[PvP 重連] 當前手牌 (createGame 生成的):', gameState.players[0].hand.map(c => c.id));

            // 恢復完整遊戲狀態（手牌、場面、血量、法力等）
            const myStateKey = `${pvpPlayerId}State`;
            const myState = roomData?.gameState?.[myStateKey];

            console.log('[PvP 重連] myState:', myState);
            console.log('[PvP 重連] savedInitialHand:', savedInitialHand);

            // 優先使用 myState.hand（當前手牌），否則使用 savedInitialHand（初始手牌）
            const savedHand = myState?.hand || savedInitialHand;

            if (savedHand && savedHand.length > 0) {
                console.log('[PvP 重連] 開始恢復手牌:', savedHand);
                gameState.players[0].hand = savedHand.map(cardId => {
                    const cardData = CARD_DATA.find(c => c.id === cardId);
                    if (!cardData) {
                        console.error('[PvP 重連] 找不到卡牌:', cardId);
                        return null;
                    }
                    // 使用 JSON 深拷貝創建卡牌實例
                    const cardInstance = JSON.parse(JSON.stringify(cardData));
                    cardInstance.side = 'PLAYER';
                    return cardInstance;
                }).filter(card => card !== null);
                console.log('[PvP 重連] 手牌已恢復，數量:', gameState.players[0].hand.length);
                console.log('[PvP 重連] 恢復後的手牌 ID:', gameState.players[0].hand.map(c => c.id));
            } else {
                console.warn('[PvP 重連] 沒有保存的手牌');
            }

            if (myState) {
                console.log('[PvP 重連] 恢復我的遊戲狀態:', myState);

                // 恢復血量
                if (myState.hp !== undefined) {
                    gameState.players[0].hero.hp = myState.hp;
                    gameState.players[0].hero.maxHp = myState.maxHp || 30;
                    console.log('[PvP 重連] 血量已恢復:', myState.hp, '/', myState.maxHp);
                }

                // 恢復法力
                if (myState.mana !== undefined) {
                    gameState.players[0].mana.current = myState.mana;
                    gameState.players[0].mana.max = myState.maxMana || 1;
                    console.log('[PvP 重連] 法力已恢復:', myState.mana, '/', myState.maxMana);
                }

                // 恢復場面
                if (myState.board && Array.isArray(myState.board)) {
                    console.log('[PvP 重連] 恢復場面，隨從數量:', myState.board.length);
                    gameState.players[0].board = myState.board.map(minionData => {
                        // 場面上的隨從需要完整恢復
                        const minion = JSON.parse(JSON.stringify(minionData));
                        minion.side = 'PLAYER';
                        return minion;
                    });
                    console.log('[PvP 重連] 場面已恢復');
                }
            } else {
                console.warn('[PvP 重連] 無法取得我的遊戲狀態');
            }

            // 確保我方 Mulligan 狀態標記為已完成
            gameState.mulliganCompleted = true;

            // 恢復對手狀態（英雄血量、場面等）
            const opponentId = pvpPlayerId === 'player1' ? 'player2' : 'player1';
            const opponentStateKey = `${opponentId}State`;
            const opponentState = roomData?.gameState?.[opponentStateKey];

            if (opponentState) {
                console.log('[PvP 重連] 恢復對手狀態:', opponentState);
                const opponent = gameState.players[1];

                // 恢復對手英雄血量
                if (opponentState.hp !== undefined) {
                    opponent.hero.hp = opponentState.hp;
                    opponent.hero.maxHp = opponentState.maxHp || 30;
                    console.log('[PvP 重連] 對手血量已恢復:', opponentState.hp, '/', opponentState.maxHp);
                }

                // 恢復對手法力
                if (opponentState.mana !== undefined) {
                    opponent.mana.current = opponentState.mana;
                    opponent.mana.max = opponentState.maxMana || 1;
                    console.log('[PvP 重連] 對手法力已恢復:', opponentState.mana, '/', opponentState.maxMana);
                }

                // 恢復對手場面
                if (opponentState.board && Array.isArray(opponentState.board)) {
                    console.log('[PvP 重連] 恢復對手場面，隨從數量:', opponentState.board.length);
                    opponent.board = opponentState.board.map(minionData => {
                        const minion = JSON.parse(JSON.stringify(minionData));
                        minion.side = 'OPPONENT';
                        return minion;
                    });
                    console.log('[PvP 重連] 對手場面已恢復');
                }

                // 恢復對手手牌數量（顯示為隱藏卡牌）
                if (opponentState.handSize !== undefined) {
                    opponent.hand = [];
                    for (let i = 0; i < opponentState.handSize; i++) {
                        opponent.hand.push({ id: 'HIDDEN', name: '?', cost: 0, type: 'HIDDEN' });
                    }
                    console.log('[PvP 重連] 對手手牌數量已恢復:', opponentState.handSize);
                }
            } else {
                console.warn('[PvP 重連] 無法取得對手遊戲狀態');
            }

            // 渲染當前狀態
            render();

            // 檢查是否輪到我
            const isMyTurn = window.pvpManager?.isMyTurn();
            if (isMyTurn) {
                showTurnAnnouncement('你的回合！');
            } else {
                showTurnAnnouncement('對手回合');
            }
        }
        // 情況 2: 我已完成 Mulligan，但對手未完成（重連且我已換牌）
        else if (myMulliganDone && !bothCompleted) {
            console.log('[PvP 重連] 我已完成 Mulligan，等待對手');

            // 不進入 mulligan UI，直接等待對手
            gameState.mulliganCompleted = true;
            render();
            showToast('等待對手完成換牌...');

            // 繼續監聽 mulligan 完成
            window.pvpManager.listenMulliganStatus(async () => {
                console.log('[PvP] 雙方 Mulligan 完成，開始遊戲');

                // 判斷是否為我的回合（先手）
                const isMyTurn = window.pvpManager?.isMyTurn();
                console.log('[PvP Mulligan] isMyTurn:', isMyTurn, 'currentPlayerIdx:', gameState.currentPlayerIdx);

                if (isMyTurn) {
                    console.log('[PvP Mulligan] 先手執行 startTurn()');
                    gameState.startTurn();
                    showTurnAnnouncement('你的回合！');
                    syncLocalStateToFirebase();
                } else {
                    console.log('[PvP Mulligan] 後手等待對手');
                    showTurnAnnouncement('對手回合');
                }

                render();
            });
        }
        // 情況 3: 我未完成 Mulligan（新遊戲 或 重連且還沒換牌）
        else {
            // 如果有保存的手牌，使用保存的手牌
            if (savedInitialHand && savedInitialHand.length > 0) {
                console.log('[PvP 重連] 恢復 Mulligan 手牌:', savedInitialHand);

                // 用保存的手牌替換當前手牌
                gameState.players[0].hand = savedInitialHand.map(cardId => {
                    const cardData = CARD_DATA.find(c => c.id === cardId);
                    if (!cardData) {
                        console.error('[PvP 重連] 找不到卡牌:', cardId);
                        return null;
                    }
                    // 使用 JSON 深拷貝創建卡牌實例
                    const cardInstance = JSON.parse(JSON.stringify(cardData));
                    cardInstance.side = 'PLAYER';
                    return cardInstance;
                }).filter(card => card !== null);

                console.log('[PvP 重連] 手牌已恢復，數量:', gameState.players[0].hand.length);
            } else {
                // 新遊戲：保存初始手牌到 Firebase
                const initialHandIds = gameState.players[0].hand.map(card => card.id);
                console.log('[PvP] 新遊戲，保存初始手牌:', initialHandIds);
                await window.pvpManager.saveInitialHand(initialHandIds);
            }

            // 進入 Mulligan 階段
            console.log('[PvP] 開始 Mulligan 階段');
            showMulliganPhase();
        }

        // ===== 設定 PvP 事件回調 =====
        if (window.pvpManager) {
            // 對手動作處理
            window.pvpManager.onOpponentAction = async (action) => {
                console.log('[PvP] 處理對手動作:', action);
                await handleOpponentPvPAction(action);
            };

            // 遊戲狀態更新 (回合切換 & 狀態同步)
            window.pvpManager.onGameStateUpdate = async (remoteState) => {
                console.log('[PvP] 收到遠端狀態更新:', remoteState);
                if (!remoteState) return;

                // 如果還在 Mulligan 階段，忽略狀態更新渲染，避免干擾選牌
                if (mulliganPhase) return;

                // 如果遊戲已經結束或 gameState 不存在，忽略狀態更新
                if (!gameState || !gameState.players) {
                    console.log('[PvP] 遊戲已結束或 gameState 不存在，忽略狀態更新');
                    return;
                }

                // Sync Opponent State (HP, Mana, etc.)
                const opponentId = pvpPlayerId === 'player1' ? 'player2' : 'player1';
                const oppState = remoteState[`${opponentId}State`];

                if (oppState && gameState.players[1]) {
                    const opponent = gameState.players[1];
                    if (oppState.hp !== undefined) {
                        opponent.currentHealth = oppState.hp;
                        opponent.health = oppState.maxHp;
                    }
                    if (oppState.mana !== undefined) {
                        opponent.mana.current = oppState.mana;
                        opponent.mana.max = oppState.maxMana;
                    }

                    // 同步手牌數（對手手牌不顯示具體內容，但數量需要同步）
                    if (oppState.handSize !== undefined) {
                        // 調整對手手牌陣列長度以匹配實際數量
                        const currentHandSize = opponent.hand.length;
                        const targetHandSize = oppState.handSize;

                        if (targetHandSize > currentHandSize) {
                            // 對手抽牌了，補充空白卡牌顯示
                            for (let i = currentHandSize; i < targetHandSize; i++) {
                                opponent.hand.push({ id: 'HIDDEN', name: '?', cost: 0, type: 'HIDDEN' });
                            }
                        } else if (targetHandSize < currentHandSize) {
                            // 對手出牌/丟牌了，移除多餘的卡牌
                            opponent.hand.splice(targetHandSize);
                        }
                    }

                    // 同步牌組數量
                    if (oppState.deckSize !== undefined) {
                        opponent._syncedDeckSize = oppState.deckSize;
                    }

                    // [新增] 同步場面上隨從的具體狀態，防止屬性脫節
                    if (oppState.board && Array.isArray(oppState.board)) {
                        oppState.board.forEach((remoteMinion, idx) => {
                            const localMinion = opponent.board[idx];
                            if (localMinion && localMinion.id === remoteMinion.id) {
                                // 僅在兩邊 ID 一致時同步關鍵屬性
                                localMinion.attack = remoteMinion.attack;
                                localMinion.currentHealth = remoteMinion.currentHealth;
                                localMinion.health = remoteMinion.health;
                                localMinion.keywords = remoteMinion.keywords;
                                localMinion.lockedTurns = remoteMinion.lockedTurns;
                                localMinion.sleeping = remoteMinion.sleeping;
                                localMinion.canAttack = remoteMinion.canAttack;
                            }
                        });
                    }

                    // Render to show updated stats
                    render();
                }

                // 更新本地回合資訊
                if (remoteState.currentTurn) {
                    const isMyTurn = remoteState.currentTurn === pvpPlayerId;
                    const localIdx = isMyTurn ? 0 : 1;
                    const prevIdx = gameState.currentPlayerIdx;

                    console.log('[PvP] 回合狀態檢查:', {
                        currentTurn: remoteState.currentTurn,
                        pvpPlayerId,
                        isMyTurn,
                        localIdx,
                        prevIdx,
                        willSwitch: prevIdx !== localIdx
                    });

                    // 只有在回合真正切換時才顯示提示和執行回合邏輯
                    if (prevIdx !== localIdx) {
                        console.log('[PvP] 回合切換:', isMyTurn ? '輪到我' : '對手回合');
                        gameState.currentPlayerIdx = localIdx;

                        if (isMyTurn && !gameState.gameOver) {
                            // 輪到自己，開始回合
                            console.log('[PvP] 執行 startTurn()，回合前手牌數:', gameState.players[0].hand.length);
                            gameState.startTurn();
                            console.log('[PvP] startTurn() 完成，回合後手牌數:', gameState.players[0].hand.length);
                            showTurnAnnouncement('你的回合！');

                            // 同步回合開始後的狀態 (Mana增加, 抽牌後)
                            syncLocalStateToFirebase();
                        } else if (!gameState.gameOver) {
                            // 對手回合：不調用 startTurn，避免對手也增加 mana 和抽牌
                            showTurnAnnouncement('對手回合');
                        }
                        render();
                        // 回合切換後檢查死亡（處理上一回合的計時器到期）
                        await resolveDeaths();
                    }
                    // 如果 currentPlayerIdx 沒變化，表示只是對手在其回合中的動作，不需要顯示提示
                }
            };

            // 對手斷線
            window.pvpManager.onOpponentDisconnect = () => {
                showToast('對手已斷線，等待重連中...');
            };

            // 遊戲結束
            window.pvpManager.onGameEnd = (result) => {
                console.log('[PvP] 遊戲結束:', result);
                const isWinner = result.winner === pvpPlayerId;

                // PvP 勝利經驗發放
                if (isWinner && AuthManager.currentUser && gameState) {
                    const winnerHP = gameState.players[0].hero.hp;
                    const turnCount = gameState.turnCount;

                    const pvpExp = calculatePvPExp(winnerHP, turnCount);

                    // 發放經驗
                    AuthManager.currentUser.currentXP = (AuthManager.currentUser.currentXP || 0) + pvpExp;

                    // 檢查升級
                    let levelsGained = 0;
                    while (AuthManager.currentUser.level < 50) {
                        const xpRequired = getXPRequiredForLevel(AuthManager.currentUser.level);
                        if (AuthManager.currentUser.currentXP >= xpRequired) {
                            AuthManager.currentUser.currentXP -= xpRequired;
                            AuthManager.currentUser.level++;
                            levelsGained++;
                            AuthManager.currentUser.gold += 100;
                        } else {
                            break;
                        }
                    }

                    if (levelsGained > 0) {
                        ShopManager.updateGoldDisplay();
                    }

                    AuthManager.saveData();
                    console.log('[PvP] 獲得經驗:', pvpExp, '升級次數:', levelsGained);
                }

                // 顯示勝利/失敗畫面
                endGame(isWinner ? 'VICTORY' : 'DEFEAT');

                // 延遲清理 PvP 狀態，確保結果畫面顯示後再清理
                setTimeout(() => {
                    endPvPGame();
                }, 1000);
            };

            // 開始監聽動作日誌（重連時跳過舊動作）
            await window.pvpManager.listenActionLog(true);
        }

        // 顯示對手資訊 (PVP 模式)
        if (window.pvpManager && window.pvpManager.currentRoom) {
            const room = window.pvpManager.currentRoom;
            const isPlayer1 = window.pvpManager.myPlayerId === 'player1';

            console.log('[PvP] 房間資料:', room);
            console.log('[PvP] 我的身份:', window.pvpManager.myPlayerId);
            console.log('[PvP] playerInfo:', room.playerInfo);

            const opponentInfo = room.playerInfo ? (isPlayer1 ? room.playerInfo.player2 : room.playerInfo.player1) : null;

            console.log('[PvP] 對手資訊:', opponentInfo);

            if (opponentInfo && opponentInfo.username) {
                // 從 AVATAR_DATA 查找對應的圖片路徑
                let avatarPath = '';
                if (opponentInfo.avatar && window.PROFILE_DATA && window.PROFILE_DATA.AVATAR_DATA) {
                    const avatarData = window.PROFILE_DATA.AVATAR_DATA.find(a => a.id === opponentInfo.avatar);
                    avatarPath = avatarData ? avatarData.path : '';
                }

                // 設定對手英雄頭像
                const oppHeroAvatarEl = document.querySelector('#opp-hero .avatar');
                if (oppHeroAvatarEl && avatarPath) {
                    oppHeroAvatarEl.style.backgroundImage = `url('${avatarPath}')`;
                    oppHeroAvatarEl.style.backgroundSize = 'cover';
                    oppHeroAvatarEl.style.backgroundPosition = 'center';
                    console.log('[PvP] 對手英雄頭像已設定:', avatarPath);
                }

                // 從 TITLE_DATA 查找對應的顯示名稱
                let titleDisplay = opponentInfo.title || '無稱號';
                if (opponentInfo.title && window.PROFILE_DATA && window.PROFILE_DATA.TITLE_DATA) {
                    const titleData = window.PROFILE_DATA.TITLE_DATA.find(t => t.id === opponentInfo.title);
                    titleDisplay = titleData ? titleData.name : opponentInfo.title;
                }

                // 更新資訊卡顯示（僅用戶名和稱號）
                document.getElementById('battle-opponent-username').textContent = opponentInfo.nickname || opponentInfo.username || '對手';
                document.getElementById('battle-opponent-title').textContent = titleDisplay;
                document.getElementById('battle-opponent-info').style.display = 'flex';

                console.log('[PvP] 對手資訊已顯示 - 頭像:', avatarPath, '用戶:', opponentInfo.username, '稱號:', titleDisplay);
            } else {
                console.warn('[PvP] 對手資訊不可用:', opponentInfo);
            }
        }

        console.log('[PvP] 對戰初始化完成，身份:', playerId);

    } catch (e) {
        console.error('[PvP] 對戰初始化失敗:', e);
        logMessage(e.message);
        isPvPMode = false;
        return;
    }
}

// 結束 PvP 對戰
function endPvPGame() {
    console.log('[PvP] endPvPGame() 被調用');

    isPvPMode = false;
    pvpRoomId = null;
    pvpPlayerId = null;
    window.isPvPMode = false;

    // 隱藏對手資訊卡
    document.getElementById('battle-opponent-info').style.display = 'none';

    if (window.pvpManager) {
        // 離開遊戲房間
        window.pvpManager.leaveRoom();

        // 從配對佇列中移除（如果還在佇列中）
        if (AuthManager.currentUser && AuthManager.currentUser.username) {
            console.log('[PvP] 從配對佇列中移除玩家');
            window.pvpManager.leaveMatchmaking(AuthManager.currentUser.username)
                .catch(err => console.error('[PvP] 離開佇列失敗:', err));
        }
    }

    console.log('[PvP] PvP 狀態已清理');
}

/**
 * 同步本地玩家狀態到 Firebase
 */
async function syncLocalStateToFirebase() {
    if (!isPvPMode || !window.pvpManager || !gameState) return;

    try {
        const player = gameState.players[0]; // 我方永遠是 player[0]

        // 確保所有欄位都有有效值，避免 undefined 導致 Firebase 錯誤
        // Player 結構使用 hero.hp 和 hero.maxHp，而非 currentHealth/health
        if (!player || !player.hero || player.hero.hp === undefined) {
            console.warn('[PvP] 玩家狀態尚未完整初始化，跳過同步');
            return;
        }

        // 輔助函數：移除物件中的 undefined 值
        const removeUndefined = (obj) => {
            const cleaned = {};
            for (const key in obj) {
                if (obj[key] !== undefined && obj[key] !== null) {
                    cleaned[key] = obj[key];
                }
            }
            return cleaned;
        };

        const stateUpdate = {
            hp: player.hero.hp ?? 30,
            maxHp: player.hero.maxHp ?? 30,
            mana: player.mana?.current ?? 0,
            maxMana: player.mana?.max ?? 0,
            handSize: player.hand?.length ?? 0,
            deckSize: player.deck?.length ?? 0,
            // 同步當前手牌（保存 ID）
            hand: player.hand?.map(card => card.id) ?? [],
            // 同步場面上的所有隨從
            board: player.board?.map(minion => {
                // 只保存非 undefined 的屬性
                return removeUndefined({
                    id: minion.id,
                    name: minion.name,
                    cost: minion.cost,
                    attack: minion.attack,
                    health: minion.health,
                    currentHealth: minion.currentHealth,
                    type: minion.type,
                    category: minion.category,
                    rarity: minion.rarity,
                    description: minion.description,
                    image: minion.image,
                    keywords: minion.keywords,
                    sleeping: minion.sleeping,
                    canAttack: minion.canAttack,
                    attacksThisTurn: minion.attacksThisTurn,
                    lockedTurns: minion.lockedTurns,
                    deathTimer: minion.deathTimer,
                    tempBuffs: minion.tempBuffs,
                    baseAttackOverride: minion.baseAttackOverride,
                    ongoingStats: minion.ongoingStats,
                    side: minion.side
                });
            }) ?? []
        };

        console.log('[PvP] 準備同步狀態:', stateUpdate);
        await window.pvpManager.updateGameState(stateUpdate);
        console.log('[PvP] 狀態同步成功');
    } catch (e) {
        console.error('[PvP] 狀態同步失敗:', e);
    }
}

// ===== PvP 動作隊列處理 =====
let pvpActionQueue = [];
let isProcessingPvPAction = false;

/**
 * 處理對手 PvP 動作
 * @param {Object} action - 從 Firebase 接收的動作
 */
async function handleOpponentPvPAction(action) {
    // 加入隊列
    pvpActionQueue.push(action);

    // 如果已經在處理中，等待
    if (isProcessingPvPAction) return;

    isProcessingPvPAction = true;

    while (pvpActionQueue.length > 0) {
        const currentAction = pvpActionQueue.shift();
        await executeOpponentAction(currentAction);
    }

    isProcessingPvPAction = false;
}

/**
 * 執行單個對手動作
 */
async function executeOpponentAction(action) {
    console.log('[PvP] 執行對手動作:', action.action, action.data);

    const opponent = gameState.players[1]; // 對手固定是 players[1]

    switch (action.action) {
        case 'PLAY_CARD': {
            const { cardId, handIndex, targetType, targetIndex, targetSide, insertionIndex, resolvedEffect } = action.data;

            // 從 CARD_DATA 根據 cardId 查找卡牌資料
            const cardDef = window.CARD_DATA?.find(c => c.id === cardId);
            if (!cardDef) {
                console.warn('[PvP] 找不到卡牌資料:', cardId);
                return;
            }

            // 創建卡牌實例（對手出牌，我們無法知道其手牌內容，需要自己創建）
            const card = JSON.parse(JSON.stringify(cardDef));
            card.side = opponent.side;

            // 顯示出牌動畫
            const oppBoard = document.getElementById('opp-board');
            const targetSlot = insertionIndex >= 0 && oppBoard.children[insertionIndex] ? oppBoard.children[insertionIndex] : null;
            await showCardPlayPreview(card, true, targetSlot);

            // 構建目標資訊
            let target = null;
            if (targetType) {
                target = {
                    type: targetType,
                    index: targetIndex,
                    side: targetSide === 'PLAYER' ? 'OPPONENT' : 'PLAYER' // 翻轉視角
                };
            }

            try {
                // 臨時切換到對手視角
                const originalIdx = gameState.currentPlayerIdx;
                gameState.currentPlayerIdx = 1;

                // 手動處理出牌邏輯（不調用 playCard，因為會檢查 mana 和手牌）
                // 注意：不需要手動從手牌移除，因為 onGameStateUpdate 會通過 handSize 同步自動調整
                console.log('[PvP] 執行對手出牌，當前對手手牌數:', opponent.hand.length);

                // 1. 扣除 mana（使用卡牌實際費用）
                const actualCost = gameState.getCardActualCost ? gameState.getCardActualCost(card) : card.cost;
                opponent.mana.current = Math.max(0, opponent.mana.current - actualCost);

                // 2. 如果是隨從，加入場上
                if (card.type === 'MINION') {
                    const minion = gameState.createMinion(cardDef, opponent.side);
                    const insertIdx = insertionIndex >= 0 ? insertionIndex : opponent.board.length;
                    opponent.board.splice(insertIdx, 0, minion);

                    // 處理戰吼（如果有）
                    // 【修正】使用 resolvedEffect 避免 desync
                    if (card.keywords?.battlecry) {
                        if (resolvedEffect) {
                            // 使用對方預先計算的效果值
                            const modifiedBattlecry = { ...card.keywords.battlecry, value: resolvedEffect.value };
                            gameState.resolveBattlecry(modifiedBattlecry, target, minion);
                            console.log('[PvP] 使用 resolvedEffect:', resolvedEffect);
                        } else {
                            // 舊版相容：本地計算
                            gameState.resolveBattlecry(card.keywords.battlecry, target, minion);
                        }
                    }
                } else if (card.type === 'NEWS') {
                    // 新聞牌直接執行效果
                    console.log('[PvP] 對手出 NEWS 卡，戰吼前手牌數:', opponent.hand.length);

                    let battlecryResult = null;
                    if (card.keywords?.battlecry) {
                        card.side = opponent.side;

                        // 【修正】使用 resolvedEffect 避免 desync
                        if (resolvedEffect) {
                            // 使用對方預先計算的效果值（含 News Power）
                            const modifiedBattlecry = { ...card.keywords.battlecry, value: resolvedEffect.value };
                            battlecryResult = gameState.resolveBattlecry(modifiedBattlecry, target, card);
                            console.log('[PvP] NEWS 使用 resolvedEffect:', resolvedEffect);
                        } else {
                            // 舊版相容：本地計算（可能導致 desync）
                            console.warn('[PvP] NEWS 無 resolvedEffect，使用本地計算（可能 desync）');
                            battlecryResult = gameState.resolveBattlecry(card.keywords.battlecry, target, card);
                        }
                    }

                    // 處理戰吼結果（特別是 DISCARD_DRAW 需要抽牌）
                    if (battlecryResult) {
                        console.log('[PvP] 對手戰吼結果:', battlecryResult);
                        if (battlecryResult.type === 'DISCARD_DRAW' && battlecryResult.drawCount) {
                            console.log('[PvP] DISCARD_DRAW 前手牌數:', opponent.hand.length);
                            // 對手執行抽牌
                            for (let i = 0; i < battlecryResult.drawCount; i++) {
                                opponent.drawCard();
                            }
                            console.log('[PvP] DISCARD_DRAW 抽牌完成，最終手牌數:', opponent.hand.length);
                        }
                    }
                }

                // [新增] 處理戰吼動畫
                if (target && card.keywords?.battlecry) {
                    const board = document.getElementById('opp-board');

                    // 判斷來源元素
                    let sourceEl = null;
                    if (card.type === 'NEWS') {
                        sourceEl = document.getElementById('opp-hero');
                    } else {
                        // 最新的隨從在場上最後
                        sourceEl = board.children[board.children.length - 1];
                    }

                    // 判斷目標元素（需要翻轉視角）
                    let destEl = null;
                    if (target.type === 'HERO') {
                        // 對手視角：target.side='PLAYER' 是對手自己，'OPPONENT' 是我方
                        destEl = (target.side === 'PLAYER') ?
                            document.getElementById('opp-hero') :
                            document.getElementById('player-hero');
                    } else if (target.type === 'MINION') {
                        const targetBoardId = (target.side === 'PLAYER') ? 'opp-board' : 'player-board';
                        destEl = document.getElementById(targetBoardId).children[target.index];
                    }

                    if (sourceEl && destEl) {
                        const type = card.keywords.battlecry.type;
                        let color = '#ff0000';
                        let effectType = 'DAMAGE';

                        // 根據戰吼類型設置顏色和特效
                        if (type === 'HEAL' || type === 'FULL_HEAL') {
                            color = '#43e97b';
                            effectType = 'HEAL';
                        } else if (type === 'BUFF_STAT_TARGET' || type === 'GIVE_DIVINE_SHIELD') {
                            color = '#ffa500';
                            effectType = 'BUFF';
                        } else if (type === 'EAT_FRIENDLY') {
                            color = '#ffa500';
                            effectType = 'BUFF';
                        } else if (type === 'DESTROY' || type === 'DESTROY_DAMAGED' ||
                            type === 'DESTROY_LOW_ATTACK' || type === 'DESTROY_HIGH_ATTACK' ||
                            type === 'SET_DEATH_TIMER' || type === 'DESTROY_LOCKED') {
                            color = '#4a0e4e';
                            effectType = 'DESTROY';
                        } else if (type === 'DAMAGE' || type === 'DAMAGE_NON_CATEGORY') {
                            color = '#ff0000';
                            effectType = 'DAMAGE';
                        }

                        await animateAbility(sourceEl, destEl, color);
                        triggerCombatEffect(destEl, effectType);
                        await new Promise(r => setTimeout(r, 600));
                    }
                }

                // 更新光環
                gameState.updateAuras();

                // 切換回原本視角
                gameState.currentPlayerIdx = originalIdx;

                // 記錄歷史
                MatchHistory.add('PLAY', {
                    player: "對手",
                    card: card.name
                });

                // 渲染更新（不需要額外同步，對手會自行同步其狀態）
                render();
                await resolveDeaths();

            } catch (e) {
                console.error('[PvP] 執行對手出牌失敗:', e);
            }
            break;
        }

        case 'ATTACK': {
            const { attackerIndex, targetType, targetIndex } = action.data;

            const attacker = opponent.board[attackerIndex];
            if (!attacker) {
                console.warn('[PvP] 找不到對手攻擊者:', attackerIndex);
                return;
            }

            // 取得 DOM 元素進行動畫
            const sourceEl = document.getElementById('opp-board').children[attackerIndex];
            let targetEl;

            if (targetType === 'HERO') {
                targetEl = document.getElementById('player-hero');
            } else {
                // 翻轉視角：對手攻擊的 OPPONENT 實際上是我方
                targetEl = document.getElementById('player-board').children[targetIndex];
            }

            if (sourceEl && targetEl) {
                const damage = attacker.attack;
                await animateAttack(sourceEl, targetEl, damage);
            }

            try {
                // 臨時切換到對手視角執行攻擊
                const originalIdx = gameState.currentPlayerIdx;
                gameState.currentPlayerIdx = 1;

                // 強制設置攻擊者為可攻擊狀態（繞過 sleeping 檢查）
                // 因為對手的攻擊動作已經在其本地驗證過，我們只需執行結果
                const wasAttackable = attacker.canAttack;
                const wasSleeping = attacker.sleeping;
                attacker.canAttack = true;
                attacker.sleeping = false;

                // 翻轉目標視角
                const flippedTarget = {
                    type: targetType,
                    index: targetIndex
                };

                gameState.attack(attackerIndex, flippedTarget);

                // 恢復原始狀態標記（如果需要）
                // 注意：攻擊後 canAttack 會被設為 false，這是正常的

                gameState.currentPlayerIdx = originalIdx;

                render();
                await resolveDeaths();

            } catch (e) {
                console.error('[PvP] 執行對手攻擊失敗:', e);
            }
            break;
        }

        case 'END_TURN': {
            console.log('[PvP] 對手結束回合');

            // 只處理計時器倒數，不切換 currentPlayerIdx
            // 完整的回合切換邏輯由 onGameStateUpdate 處理
            gameState.processEndOfTurnTimers();

            // 顯式調用 Buff 清理邏輯，確保「凍蒜」等暫時性 Buff 在視覺上正確移除
            // 因為我們不調用 gameState.endTurn()，所以必須手動觸發這部分
            if (gameState.cleanupTemporaryBuffs) {
                console.log('[PvP] 執行 END_TURN 清理暫時性 Buff');
                gameState.cleanupTemporaryBuffs();
            }

            // 確保死亡結算完成
            await resolveDeaths();
            render();
            break;
        }

        case 'MULLIGAN_DONE': {
            console.log('[PvP] 對手完成換牌');
            showToast('對手已準備就緒');
            break;
        }

        default:
            console.warn('[PvP] 未知動作類型:', action.action);
    }
}

function initManaContainers(id) {
    const container = document.getElementById(id);
    container.innerHTML = '';

    for (let i = 0; i < 10; i++) {
        const crystal = document.createElement('div');
        crystal.className = 'mana-crystal locked';
        container.appendChild(crystal);
    }
}

function shakeManaContainer(isPlayer = true) {
    const id = isPlayer ? 'player-mana-container' : 'opp-mana-container';
    const el = document.getElementById(id);
    if (!el) return;

    el.classList.add('shake-mana');
    setTimeout(() => el.classList.remove('shake-mana'), 500);
}

// 新增：PVP/通用 牌組選擇渲染
function renderDeckSelection(onConfirmCallback) {
    const container = document.getElementById('deck-select-slots');
    container.innerHTML = '';

    // 按鈕控制
    const btnStart = document.getElementById('btn-start-battle');
    const btnEdit = document.getElementById('btn-edit-deck');
    btnStart.style.display = 'block'; // PvP 模式顯示開始戰鬥按鈕
    btnEdit.style.display = 'none';   // 隱藏編輯按鈕

    // 解除舊的事件綁定 (透過 cloneNode)
    const newBtnStart = btnStart.cloneNode(true);
    btnStart.parentNode.replaceChild(newBtnStart, btnStart);

    let currentSelectedIndex = -1;

    userDecks.forEach((deck, index) => {
        const slot = document.createElement('div');
        slot.className = 'deck-slot';

        // 檢查牌組完整性
        const isComplete = deck.cards.length === 30;

        slot.innerHTML = `
            <div class="deck-name">${deck.name}</div>
            <div class="deck-count ${isComplete ? '' : 'incomplete'}">
                ${isComplete ? '30/30' : deck.cards.length + '/30'}
                ${isComplete ? '' : '⚠️'}
            </div>
            <div class="hero-avatar"></div>
        `;

        slot.addEventListener('click', () => {
            // 移除其他選取狀態
            document.querySelectorAll('.deck-slot').forEach(s => s.classList.remove('selected'));
            slot.classList.add('selected');
            currentSelectedIndex = index;
        });

        container.appendChild(slot);
    });

    // 綁定確認按鈕事件
    newBtnStart.addEventListener('click', () => {
        if (currentSelectedIndex === -1) {
            showToast('請先選擇一個牌組');
            return;
        }

        const selectedDeck = userDecks[currentSelectedIndex];
        if (selectedDeck.cards.length !== 30) {
            showToast('牌組必須有 30 張卡片才能進行對戰！');
            return;
        }

        if (onConfirmCallback) {
            onConfirmCallback(selectedDeck);
        }
    });
}

function renderDeckBuilder() {
    // Use tempDeck for rendering during edit
    const deck = tempDeck || userDecks[editingDeckIdx];
    document.getElementById('deck-name-input').value = deck.name;

    const gridEl = document.getElementById('all-cards-grid');
    gridEl.innerHTML = '';

    // Search Functionality & Window Filters
    const searchInput = document.getElementById('card-search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";

    // Read Filters
    const catFilter = document.getElementById('filter-category') ? document.getElementById('filter-category').value : 'ALL';
    const rarFilter = document.getElementById('filter-rarity') ? document.getElementById('filter-rarity').value : 'ALL';
    const costFilter = document.getElementById('filter-cost') ? document.getElementById('filter-cost').value : 'ALL';

    // Update Sort Indicators (UI)
    document.querySelectorAll('.sort-btn').forEach(btn => {
        const field = btn.dataset.sort;
        const arrow = btn.querySelector('.sort-arrow');
        if (field === currentSort.field) {
            btn.classList.add('active');
            arrow.innerText = currentSort.direction === 'asc' ? '↑' : '↓';
        } else {
            btn.classList.remove('active');
            arrow.innerText = '↕';
        }
    });

    // 取得玩家擁有的卡牌
    const ownedCards = AuthManager.currentUser?.ownedCards || {};

    CARD_DATA.filter(card => {
        const matchSearch = card.name.toLowerCase().includes(searchTerm) || (card.description && card.description.toLowerCase().includes(searchTerm));
        const matchCat = catFilter === 'ALL' || (card.category || '一般') === catFilter;
        const matchRarity = rarFilter === 'ALL' || (card.rarity || 'COMMON') === rarFilter;

        let matchCost = true;
        if (costFilter !== 'ALL') {
            if (costFilter === '7+') matchCost = card.cost >= 7;
            else matchCost = card.cost === parseInt(costFilter);
        }

        // 只顯示擁有的卡牌 (admin 在測試模式下全開)
        const matchOwned = (window.isDebugMode && isAdmin()) || (ownedCards[card.id] && ownedCards[card.id] > 0);

        return matchSearch && matchCat && matchRarity && matchCost && matchOwned;
    }).sort((a, b) => {
        const dir = currentSort.direction === 'asc' ? 1 : -1;
        let valA, valB;

        if (currentSort.field === 'cost') {
            valA = a.cost; valB = b.cost;
        } else if (currentSort.field === 'category') {
            valA = a.category || '一般'; valB = b.category || '一般';
            return valA.localeCompare(valB) * dir;
        } else if (currentSort.field === 'rarity') {
            const rMap = { 'COMMON': 1, 'RARE': 2, 'EPIC': 3, 'LEGENDARY': 4 };
            valA = rMap[a.rarity || 'COMMON'] || 0;
            valB = rMap[b.rarity || 'COMMON'] || 0;
        }
        return (valA - valB) * dir;
    }).forEach(card => {
        const cardEl = createCardEl(card, -1);

        // Count copies in current deck
        const countInDeck = deck.cards.filter(id => id === card.id).length;
        if (countInDeck > 0) {
            const badge = document.createElement('div');
            badge.innerText = `x${countInDeck}`;
            badge.style.position = 'absolute';
            badge.style.top = '5px';
            badge.style.right = '5px';
            badge.style.background = 'rgba(0,0,0,0.8)';
            badge.style.color = '#fff';
            badge.style.borderRadius = '50%';
            badge.style.width = '20px';
            badge.style.height = '20px';
            badge.style.display = 'flex';
            badge.style.justifyContent = 'center';
            badge.style.alignItems = 'center';
            badge.style.fontSize = '12px';
            badge.style.zIndex = '20';
            cardEl.appendChild(badge);
        }

        // Add Click to Add
        cardEl.addEventListener('click', async () => {
            // Admin tests rules bypass
            if (deck.cards.length >= 30 && !(window.isDebugMode && isAdmin())) {
                showToast("牌組已滿 (30/30)");
                return;
            }
            // Check ownership count limit
            const currentCount = deck.cards.filter(id => id === card.id).length;
            const ownedCount = (window.isDebugMode && isAdmin()) ? 99 : (ownedCards[card.id] || 0);

            if (currentCount >= ownedCount) {
                showToast("擁有的卡牌數量不足");
                return;
            }
            // Check legendary limit & normal limit
            if (!isDebugMode && card.rarity === 'LEGENDARY') {
                const legendCount = deck.cards.filter(id => {
                    const c = CARD_DATA.find(x => x.id === id);
                    return c?.rarity === 'LEGENDARY';
                }).length;
                if (legendCount >= 2) {
                    await showCustomAlert("傳說卡牌在牌組中最多只能放 2 張！");
                    return;
                }
            }
            if (!isDebugMode && currentCount >= 2) {
                await showCustomAlert("每種卡牌最多只能放 2 張！");
                return;
            }

            deck.cards.push(card.id);
            renderDeckBuilder();
        });

        // Add Drag to Add
        cardEl.setAttribute('draggable', 'false');
        gridEl.appendChild(cardEl);
    });

    updateDeckStats(deck);
}

/**
 * 自動組牌功能
 */
function autoBuildDeck() {
    if (!tempDeck) return;

    const maxCards = 30;
    let currentSize = tempDeck.cards.length;
    const cardsNeeded = maxCards - currentSize;

    if (cardsNeeded <= 0) {
        showToast("牌組已經滿了");
        return;
    }

    const ownedCards = AuthManager.currentUser?.ownedCards || {};
    const validCandidates = [];

    // 1. 找出所有合法的候選卡牌
    CARD_DATA.forEach(card => {
        const ownedCount = (window.isDebugMode && isAdmin()) ? 2 : (ownedCards[card.id] || 0);
        const currentInDeck = tempDeck.cards.filter(id => id === card.id).length;

        // 規則：必須擁有，且牌組內少於2張，且牌組內數量少於擁有數量
        if (ownedCount > 0 && currentInDeck < 2 && currentInDeck < ownedCount) {
            // 加入候選名單，數量等於剩餘可放張數
            const availableToAdd = Math.min(2 - currentInDeck, ownedCount - currentInDeck);
            for (let i = 0; i < availableToAdd; i++) {
                validCandidates.push(card.id);
            }
        }
    });

    if (validCandidates.length === 0) {
        showToast("沒有足夠的卡牌來組成完整牌組");
        return;
    }

    // 2. 隨機填滿
    let addedCount = 0;
    while (currentSize < maxCards && validCandidates.length > 0) {
        const randIdx = Math.floor(Math.random() * validCandidates.length);
        const cardId = validCandidates[randIdx];

        // 加入牌組
        tempDeck.cards.push(cardId);
        currentSize++;
        addedCount++;

        // 從候選池移除一張該卡
        validCandidates.splice(randIdx, 1);
    }

    renderDeckBuilder();
    showToast(`已自動加入 ${addedCount} 張卡牌！`);
}

function updateDeckStats(deck) {
    const listEl = document.getElementById('my-deck-list');
    listEl.innerHTML = '';

    // Sort cards by cost then name
    const sortedCards = [...deck.cards].sort((a, b) => {
        const cardA = CARD_DATA.find(c => c.id === a);
        const cardB = CARD_DATA.find(c => c.id === b);

        if (!cardA || !cardB) return 0;

        if (cardA.cost !== cardB.cost) return cardA.cost - cardB.cost;
        return cardA.name.localeCompare(cardB.name);
    });

    // Group cards
    const cardCounts = {};
    sortedCards.forEach(id => {
        cardCounts[id] = (cardCounts[id] || 0) + 1;
    });

    // Render grouped cards
    const processedIds = new Set();
    sortedCards.forEach((id) => {
        if (processedIds.has(id)) return;
        processedIds.add(id);

        const card = CARD_DATA.find(c => c.id === id);
        const count = cardCounts[id];

        const item = document.createElement('div');
        item.className = 'deck-item';
        // Fix: Add rarity border to deck list item
        item.style.borderLeft = `4px solid ${getBorderColor(card.rarity)}`;

        // Show count if > 1
        const countBadge = count > 1 ? `<span style="background:var(--neon-yellow); color:black; border-radius:50%; padding:0 6px; font-size:12px; margin-right:5px; font-weight:bold;">${count}</span>` : '';

        item.innerHTML = `<div style="display:flex; align-items:center;">${countBadge}<span>${card.name}</span></div><span>${card.cost}</span>`;

        item.addEventListener('click', () => {
            // Remove one instance of this card
            const indexToRemove = deck.cards.indexOf(id);
            if (indexToRemove > -1) {
                deck.cards.splice(indexToRemove, 1);
                renderDeckBuilder();
            }
        });

        // Add hover preview for deck list items
        item.addEventListener('mouseenter', (e) => {
            const preview = document.getElementById('card-preview');
            const builderView = document.getElementById('deck-builder');
            if (builderView.style.display === 'flex') {
                // Show on left side since list is on right
                preview.style.right = 'auto';
                preview.style.left = '40px';
                preview.style.top = '50%';
                preview.style.transform = 'translateY(-50%)';
            }
            showPreview(card);
        });
        item.addEventListener('mouseleave', hidePreview);

        listEl.appendChild(item);
    });

    if (isDebugMode) {
        document.getElementById('deck-count-indicator').innerText = `測試模式: ${deck.cards.length} 張卡 (無數量限制)`;
        document.getElementById('deck-count-indicator').style.color = 'var(--neon-blue)';
    } else {
        document.getElementById('deck-count-indicator').innerText = `已選擇: ${deck.cards.length} / 30`;
        document.getElementById('deck-count-indicator').style.color = (deck.cards.length === 30) ? 'var(--neon-green)' : 'white';
    }

    // Calculate Stats
    let totalCost = 0;
    let minionCount = 0;
    let newsCount = 0;

    deck.cards.forEach(id => {
        const card = CARD_DATA.find(c => c.id === id);
        if (card) {
            totalCost += card.cost;
            if (card.type === 'MINION') minionCount++;
            else if (card.type === 'NEWS') newsCount++;
        }
    });

    const avgCost = deck.cards.length > 0 ? (totalCost / deck.cards.length).toFixed(1) : "0.0";

    const statsEl = document.getElementById('deck-stats');
    if (statsEl) {
        statsEl.innerHTML = `
                <div class="stat-row">平均花費: <span style="color:var(--neon-cyan)">${avgCost}</span></div>
                <div class="stat-row">單位卡: <span style="color:var(--neon-yellow)">${minionCount}</span></div>
                <div class="stat-row">技能卡: <span style="color:#ff4b2b">${newsCount}</span></div>
            `;
    }
}

function getBorderColor(rarity) {
    if (!rarity) return '#ffffff';
    switch (rarity.toUpperCase()) {
        case 'LEGENDARY': return '#ffa500';
        case 'EPIC': return '#a335ee';
        case 'RARE': return '#0070dd';
        default: return '#ffffff';
    }
}

async function aiTurn() {
    logMessage(UI_TEXT.OPPONENT_THINKING);
    try {
        // Simple loop to execute actions one by one
        let moves = 0;
        const maxMoves = 10; // Prevent infinite loops

        while (moves < maxMoves) {
            // Recalculate best move each time state changes
            const action = gameEngine.ai.getNextMove(gameState);

            if (!action) {
                break; // No more good moves
            }

            if (action.type === 'PLAY_CARD') {
                const card = gameState.currentPlayer.hand[action.index];
                if (!card) break;

                logMessage(`${UI_TEXT.OPPONENT_PLAYS}${card.name}`);

                const oppBoard = document.getElementById('opp-board');
                const insertionIndex = action.insertionIndex !== undefined ? action.insertionIndex : -1;
                const targetSlot = insertionIndex === -1 ? null : oppBoard.children[insertionIndex];

                await showCardPlayPreview(card, true, targetSlot);

                try {
                    const { battlecryResult: result } = gameState.playCard(action.index, action.target, insertionIndex);
                    // Match History log
                    MatchHistory.add('PLAY', {
                        player: "對手",
                        card: card.name
                    });

                    // Visuals for BOUNCE battlecry result in AI turn
                    if (result && result.type === 'BOUNCE') {
                        const board = document.getElementById('opp-board');
                        const sourceEl = board.children[board.children.length - 1]; // Assume newly played minion is at the end
                        const side = result.target.side || 'PLAYER';
                        const targetBoardId = side === 'OPPONENT' ? 'opp-board' : 'player-board';
                        const targetEl = document.getElementById(targetBoardId).children[result.target.index];

                        if (sourceEl && targetEl) {
                            await animateAbility(sourceEl, targetEl, '#a335ee');
                            triggerCombatEffect(targetEl, 'BOUNCE');
                            await new Promise(r => setTimeout(r, 400));
                            render();
                        }
                    }
                } catch (e) {
                    console.error("AI failed to play card:", e);
                    break;
                }
                render();

                // Visual Delay for drawing battlecries
                if (card.keywords?.battlecry?.type === 'DRAW') {
                    const drawCount = card.keywords.battlecry.value || 1;
                    for (let i = 0; i < drawCount; i++) {
                        await new Promise(r => setTimeout(r, 600));
                        gameState.currentPlayer.drawCard();
                        render();
                    }
                } else if (card.keywords?.battlecry?.type === 'DISCARD_DRAW') {
                    const drawCount = card.keywords.battlecry.drawCount || 2;
                    // Ai discard visuals are usually instant render, so we just wait a bit
                    await new Promise(r => setTimeout(r, 600));
                    for (let i = 0; i < drawCount; i++) {
                        gameState.currentPlayer.drawCard();
                        render();
                        await new Promise(r => setTimeout(r, 600));
                    }
                }

                await resolveDeaths();

                // Show Battlecry Visuals
                if (action.target) {
                    const board = document.getElementById('opp-board');

                    let sourceEl = null;
                    if (card.type === 'NEWS') {
                        sourceEl = document.getElementById('opp-hero');
                    } else {
                        // Newest minion is at the end
                        sourceEl = board.children[board.children.length - 1];
                    }

                    let destEl = null;
                    if (action.target.type === 'HERO') {
                        // AI perspective side: 'OPPONENT' is Player, 'PLAYER' is AI.
                        destEl = (action.target.side === 'PLAYER') ? document.getElementById('player-hero') : document.getElementById('opp-hero');
                    } else if (action.target.type === 'MINION') {
                        const targetBoardId = (action.target.side === 'PLAYER') ? 'player-board' : 'opp-board';
                        destEl = document.getElementById(targetBoardId).children[action.target.index];
                    }

                    if (sourceEl && destEl) {
                        const type = card.keywords?.battlecry?.type;
                        let color = '#ff0000';
                        let effectType = 'DAMAGE';

                        // Match arrow colors with effect particles:
                        // Green arrow (#43e97b) -> Green "+" (HEAL)
                        // Orange arrow (#ffa500) -> Orange "↑" (BUFF)
                        // Dark purple arrow (#4a0e4e) -> DESTROY effect
                        if (type === 'HEAL' || type === 'FULL_HEAL') {
                            color = '#43e97b';
                            effectType = 'HEAL';
                        }
                        else if (type === 'BUFF_STAT_TARGET' || type === 'GIVE_DIVINE_SHIELD') {
                            color = '#ffa500';
                            effectType = 'BUFF';
                        }
                        else if (type === 'EAT_FRIENDLY') {
                            color = '#ffa500';
                            effectType = 'BUFF';
                        }
                        else if (type === 'DESTROY' || type === 'DESTROY_DAMAGED' ||
                            type === 'DESTROY_LOW_ATTACK' || type === 'DESTROY_HIGH_ATTACK' ||
                            type === 'SET_DEATH_TIMER' || type === 'DESTROY_LOCKED') {
                            color = '#4a0e4e'; // Dark purple for all destroy effects
                            effectType = 'DESTROY';
                        }
                        else if (type === 'DAMAGE' || type === 'DAMAGE_NON_CATEGORY') {
                            color = '#ff0000';
                            effectType = 'DAMAGE';
                        }

                        await animateAbility(sourceEl, destEl, color);
                        triggerCombatEffect(destEl, effectType);

                        // [Fix] Await damage number display or a short delay to ensure UI updates
                        await new Promise(r => setTimeout(r, 600));

                        // Log AI Battlecry history
                        const sourceName = card.name;
                        const destSide = action.target.side;
                        const destName = getUnitName(destSide, action.target.index, action.target.type);

                        const isAiNews = card.type === 'NEWS';
                        const bonus = isAiNews ? (gameState.getNewsPower(card.side || 'OPPONENT') || 0) : 0;
                        const aiValue = (card.keywords?.battlecry?.value || card.keywords?.battlecry?.bonus_value || 0) + bonus;

                        if (effectType === 'HEAL') {
                            const eventType = isAiNews ? 'NEWS_HEAL' : 'BATTLECRY_HEAL';
                            MatchHistory.add(eventType, { source: sourceName, target: destName, value: aiValue });
                        } else if (effectType === 'DESTROY') {
                            const eventType = isAiNews ? 'NEWS_DESTROY' : 'BATTLECRY_DESTROY';
                            MatchHistory.add(eventType, { source: sourceName, target: destName });
                        } else if (effectType === 'DAMAGE') {
                            const eventType = isAiNews ? 'NEWS_DAMAGE' : 'BATTLECRY_DAMAGE';
                            MatchHistory.add(eventType, { source: sourceName, target: destName, value: aiValue });
                        }
                    }
                } else if (card.keywords?.battlecry) {
                    const type = card.keywords.battlecry.type;
                    if (type === 'DESTROY_ALL_MINIONS') {
                        await triggerEarthquakeAnimation();
                    } else {
                        setTimeout(() => {
                            if (type === 'BUFF_ALL' || type === 'BUFF_CATEGORY') {
                                document.querySelectorAll('#opp-board .minion').forEach(m => triggerCombatEffect(m, 'BUFF'));
                            } else if (type === 'HEAL_ALL_FRIENDLY') {
                                document.querySelectorAll('#opp-board .minion').forEach(m => triggerCombatEffect(m, 'HEAL'));
                                triggerCombatEffect(document.getElementById('opp-hero'), 'HEAL');
                            } else if (type === 'BOUNCE_ALL_ENEMY') {
                                triggerFullBoardBounceAnimation(true);
                            } else if (card.id === 'S019') { // 查水表
                                triggerRippleDiffusionAnimation(false);
                            }
                        }, 100);
                    }
                }

                await new Promise(r => setTimeout(r, 1000));

            } else if (action.type === 'ATTACK') {
                const attackerIdx = action.attackerIndex;
                const targetType = action.target.type;
                const targetIndex = action.target.index;

                // Visuals
                const attacker = gameState.opponent.board[attackerIdx];
                const damage = attacker ? attacker.attack : 0;

                const attackerEl = document.getElementById('opp-board').children[attackerIdx];
                const targetEl = targetType === 'HERO' ? document.getElementById('player-hero') : document.getElementById('player-board').children[targetIndex];

                if (attackerEl && targetEl) {
                    await animateAttack(attackerEl, targetEl, damage);
                }

                const attackerName = getUnitName('OPPONENT', attackerIdx, 'MINION');
                const tSide = action.target.side === 'OPPONENT' ? 'OPPONENT' : 'PLAYER';
                const targetName = getUnitName(tSide, targetIndex, targetType);

                MatchHistory.add('NORMAL_ATTACK', {
                    attacker: attackerName,
                    target: targetName,
                    damage: damage
                });

                gameState.attack(attackerIdx, action.target);
                render();
                await resolveDeaths();
                await new Promise(r => setTimeout(r, 600));
            }

            moves++;
        }

        gameState.endTurn();
        render();
        await resolveDeaths();
        showTurnAnnouncement("你的回合");
    } catch (e) {
        logMessage("AI Error: " + e.message);
        console.error(e);
        gameState.endTurn();
        render();
        await resolveDeaths();
        showTurnAnnouncement("你的回合"); // Ensure turn passes back even on error
    }
}

/**
 * Render basic UI elements like turn indicator, mana, HP, and deck sizes.
 */
function renderGameUI(p1, p2) {
    document.getElementById('turn-indicator').innerText = `TURN: ${gameState.turnCount}`;

    // Toggle Turn Lights
    // Toggle Turn Lights & Button
    const isPlayerTurn = gameState.currentPlayerIdx === 0;
    const endBtn = document.getElementById('end-turn-btn');

    if (endBtn) {
        if (isPlayerTurn) {
            endBtn.disabled = false;
            endBtn.innerText = "結束回合";
        } else {
            endBtn.disabled = true;
            endBtn.innerText = "對手回合";
        }
    }

    renderMana('player-mana-container', p1.mana);
    renderMana('opp-mana-container', p2.mana);

    const p1HeroEl = document.getElementById('player-hero');
    const p2HeroEl = document.getElementById('opp-hero');
    if (p1HeroEl) {
        p1HeroEl.dataset.health = p1.hero.maxHp || 30;
        p1HeroEl.dataset.currentHealth = p1.hero.hp;
    }
    if (p2HeroEl) {
        p2HeroEl.dataset.health = p2.hero.maxHp || 30;
        p2HeroEl.dataset.currentHealth = p2.hero.hp;
    }

    // Hero HP Pop Animation tracking
    const p1HpEl = document.getElementById('player-hp');
    const p2HpEl = document.getElementById('opp-hp');

    if (p1HpEl) {
        if (p1.hero._lastHp !== undefined && p1.hero._lastHp !== p1.hero.hp) {
            p1HpEl.classList.remove('stat-pop');
            void p1HpEl.offsetWidth;
            p1HpEl.classList.add('stat-pop');
        }
        p1.hero._lastHp = p1.hero.hp;
        p1HpEl.innerText = p1.hero.hp;
    }

    if (p2HpEl) {
        if (p2.hero._lastHp !== undefined && p2.hero._lastHp !== p2.hero.hp) {
            p2HpEl.classList.remove('stat-pop');
            void p2HpEl.offsetWidth;
            p2HpEl.classList.add('stat-pop');
        }
        p2.hero._lastHp = p2.hero.hp;
        p2HpEl.innerText = p2.hero.hp;
    }

    // Deck counts
    document.querySelector('#player-deck .count-badge').innerText = p1.deck.length;

    // In PVP mode, use synced deck size for opponent
    if (isPvPMode && p2._syncedDeckSize !== undefined) {
        document.querySelector('#opp-deck .count-badge').innerText = p2._syncedDeckSize;
    } else {
        document.querySelector('#opp-deck .count-badge').innerText = p2.deck.length;
    }


    // Update Battle Player Info Card
    const authUser = AuthManager.currentUser;
    const playerInfo = JSON.parse(localStorage.getItem('playerInfo')) || {};

    const battleUsername = document.getElementById('battle-player-username');
    const battleTitle = document.getElementById('battle-player-title');
    const battleAvatar = document.getElementById('battle-player-avatar');

    // Also update main hero avatar if available
    const mainHeroAvatar = document.querySelector('#player-hero .avatar');

    const displayUsername = (authUser && authUser.nickname) ? authUser.nickname :
        ((authUser && authUser.username) ? authUser.username : (playerInfo.username || '玩家'));
    const displayTitleId = (authUser && authUser.selectedTitle) ? authUser.selectedTitle : (playerInfo.selectedTitle || 'beginner');
    const displayAvatarId = (authUser && authUser.selectedAvatar) ? authUser.selectedAvatar : (playerInfo.selectedAvatar || 'avatar1');

    if (battleUsername) {
        battleUsername.innerText = displayUsername;
    }
    if (battleTitle) {
        const titleData = window.PROFILE_DATA?.TITLE_DATA || [];
        const titleObj = titleData.find(t => t.id === displayTitleId);
        battleTitle.innerText = titleObj ? titleObj.name : '無稱號';
    }
    if (battleAvatar) {
        const avatarData = window.PROFILE_DATA?.AVATAR_DATA || [];
        const avatarObj = avatarData.find(a => a.id === displayAvatarId);

        if (avatarObj && avatarObj.path) {
            const url = `url('${avatarObj.path}')`;
            // Info Card Avatar
            battleAvatar.style.backgroundImage = url;
            battleAvatar.style.backgroundSize = 'cover';
            battleAvatar.style.backgroundPosition = 'center';
            battleAvatar.innerText = '';

            // Sync Main Hero Avatar
            if (mainHeroAvatar) {
                mainHeroAvatar.style.backgroundImage = url;
                mainHeroAvatar.style.backgroundSize = 'cover';
                mainHeroAvatar.style.backgroundPosition = 'center';
            }
        } else {
            // 使用顯示名稱的首字
            const initial = displayUsername.charAt(0).toUpperCase();
            battleAvatar.innerText = initial;
            battleAvatar.style.backgroundImage = 'none';
            // Main hero fallback - use a default image to ensure something is shown
            if (mainHeroAvatar) {
                // Use a default hero image if no custom avatar is set
                // You might want to replace this with a specific default hero asset path if available
                const defaultHeroImg = 'url("assets/images/avatars/avatar1.jpg")'; // Using avatar1 as a safe default
                mainHeroAvatar.style.backgroundImage = defaultHeroImg;
                mainHeroAvatar.style.backgroundSize = 'cover';
                mainHeroAvatar.style.backgroundPosition = 'center';
                mainHeroAvatar.innerText = ''; // Clear text
            }
        }
    }

    // Check for Win/Loss
    if (gameState.winner !== null) {
        setTimeout(() => {
            endGame(gameState.winner === 0 ? 'VICTORY' : 'DEFEAT');
        }, 1000);
    }
}

/**
 * Render player and opponent hands with arc effect.
 */
function renderHands(p1, p2) {
    const handEl = document.getElementById('player-hand');
    const oppHandEl = document.getElementById('opp-hand');

    // Player Hand
    handEl.innerHTML = '';
    p1.hand.forEach((card, idx) => {
        handEl.appendChild(createCardEl(card, idx));
    });

    // Detect and animate new cards
    if (p1.hand.length > previousPlayerHandSize) {
        const newCount = p1.hand.length - previousPlayerHandSize;
        const children = handEl.children;
        if (newCount > 0 && newCount < 15) {
            for (let i = Math.max(0, children.length - newCount); i < children.length; i++) {
                if (children[i]) {
                    const cardObj = p1.hand[i];
                    animateCardFromDeck(cardObj, children[i]);
                }
            }
        }
    }
    previousPlayerHandSize = p1.hand.length;

    // Force hidden opacity for cards currently animating
    p1.hand.forEach((card, idx) => {
        if (animatingDrawCards.has(card)) {
            const child = handEl.children[idx];
            if (child) child.style.opacity = '0';
        }
    });

    // Opponent Hand
    oppHandEl.innerHTML = '';
    p2.hand.forEach(() => {
        const back = document.createElement('div');
        back.className = 'card';
        oppHandEl.appendChild(back);
    });

    // Apply Hearthstone-like Arc Logic with Overlap Clamp
    [handEl, oppHandEl].forEach((container) => {
        const cards = Array.from(container.children);
        const total = cards.length;
        const center = (total - 1) / 2;

        let degPerCard = 6;
        let denseMargin = '';

        // Denser packing for larger hands
        if (total > 5) {
            degPerCard = Math.max(2, 6 - (total - 6) * 0.5); // Reduce fanning for dense hands

            // Constant width calculation:
            // Max width approx equivalent to 6 cards (6 * 110px = 660px)
            // Per-card width = 660 / total
            // marginLeft = width - 125 (140px width - 15px right margin)
            const widthPerCard = 550 / total;
            denseMargin = (widthPerCard - 125).toFixed(1) + 'px';
        }

        cards.forEach((card, i) => {
            const delta = i - center;
            const rot = delta * degPerCard;
            const y = Math.abs(delta) * Math.abs(delta) * 2 + Math.abs(delta) * 5;

            card.style.setProperty('--rot', `${rot}deg`);
            card.style.setProperty('--y', `${y}px`);

            // Verify if we need to override CSS
            // Note: CSS default is margin: 0 -15px (-15px left)
            card.style.marginLeft = denseMargin;
        });
    });
}

/**
 * Render player and opponent board minions.
 */
function renderBoards(p1, p2) {
    const boardEl = document.getElementById('player-board');
    const oppBoardEl = document.getElementById('opp-board');

    boardEl.innerHTML = '';
    p1.board.forEach((minion, idx) => {
        boardEl.appendChild(createMinionEl(minion, idx, true));
    });

    oppBoardEl.innerHTML = '';
    p2.board.forEach((minion, idx) => {
        oppBoardEl.appendChild(createMinionEl(minion, idx, false));
    });
}

function render() {
    const p1 = gameState.players[0];
    const p2 = gameState.players[1];

    renderGameUI(p1, p2);
    renderHands(p1, p2);
    renderBoards(p1, p2);
}


async function resolveDeaths() {
    const dead = gameState.checkDeaths ? gameState.checkDeaths() : [];

    if (dead.length > 0) {
        const boards = [document.getElementById('player-board'), document.getElementById('opp-board')];
        const animations = [];

        for (const death of dead) {
            // Log history
            const unitName = getUnitName(death.side, death.index, death.type);
            MatchHistory.add('DEATH', { unit: unitName });

            const board = (death.side === 'PLAYER') ? boards[0] : boards[1];
            if (board && board.children[death.index]) {
                animations.push(animateShatter(board.children[death.index]));
            }
        }

        await Promise.all(animations);
    }

    // Always resolve game state logic (Hero death, minion cleanup) and render
    gameState.resolveDeaths();
    render();
}

/**
 * 計算升級到下一級所需的經驗值
 * @param {number} level - 當前等級
 * @returns {number} 升級所需經驗值
 */
function getXPRequiredForLevel(level) {
    if (level < 1) return 0;
    if (level === 1) return 20;  // 1→2: 20
    if (level <= 9) return (level + 1) * 10; // 2→3: 30, 3→4: 40, ..., 9→10: 100
    if (level <= 19) return 100 + (level - 9) * 20; // 10→11: 120, 11→12: 140, ..., 19→20: 300
    if (level <= 29) return 300 + (level - 19) * 30; // 20→21: 330, ..., 29→30: 600
    if (level <= 39) return 600 + (level - 29) * 40; // 30→31: 640, ..., 39→40: 1000
    if (level <= 49) return 1000 + (level - 39) * 50; // 40→41: 1050, ..., 49→50: 1500
    return 1500; // 50級封頂
}

/**
 * 計算擊敗AI獲得的經驗值
 * @param {string} difficulty - 難度 (NORMAL/HARD/HELL)
 * @param {boolean} isFirstVictory - 是否首次擊敗
 * @returns {number} 獲得的經驗值
 */
function getXPReward(difficulty, isFirstVictory) {
    const rewards = {
        'NORMAL': { first: 50, repeat: 8 },
        'HARD': { first: 100, repeat: 14 },
        'HELL': { first: 150, repeat: 25 }
    };

    const reward = rewards[difficulty] || rewards['NORMAL'];
    return isFirstVictory ? reward.first : reward.repeat;
}

/**
 * 計算 PvP 勝利經驗
 * @param {number} winnerHP - 勝利者剩餘血量
 * @param {number} turnCount - 總回合數
 * @returns {number} 經驗值 (8-15)
 */
function calculatePvPExp(winnerHP, turnCount) {
    // 基礎經驗
    let exp = 8;

    // 血量獎勵 (最多 +4)
    const hpBonus = Math.floor((winnerHP / 30) * 4);
    exp += hpBonus;

    // 速度獎勵 (最多 +3)
    let speedBonus = 0;
    if (turnCount <= 5) {
        speedBonus = 3;
    } else if (turnCount <= 10) {
        speedBonus = 2;
    } else if (turnCount <= 15) {
        speedBonus = 1;
    }
    exp += speedBonus;

    console.log('[PvP 經驗] 基礎:8 血量獎勵:+' + hpBonus + ' (剩餘' + winnerHP + 'HP) 速度獎勵:+' + speedBonus + ' (' + turnCount + '回合) 總計:' + exp);

    return exp;
}

/**
 * 依序顯示獎勵通知
 * @param {Array} rewards - 獎勵事件陣列，格式：[{message: string, delay: number}, ...]
 */
async function showRewardsSequentially(rewards) {
    for (const reward of rewards) {
        await new Promise(resolve => {
            setTimeout(() => {
                showToast(reward.message);
                resolve();
            }, reward.delay);
        });
    }
}

function endGame(result) {
    const resultView = document.getElementById('game-result-view');
    const resultText = document.getElementById('result-status-text');

    resultText.innerText = result === 'VICTORY' ? '勝利' : '敗北';
    resultText.className = `result-text ${result === 'VICTORY' ? 'victory-text' : 'defeat-text'}`;

    // 更新統計數據 (僅在非除錯模式且已登入時)
    if (!isDebugMode && AuthManager.currentUser) {
        // 初始化 stats
        if (!AuthManager.currentUser.stats) {
            AuthManager.currentUser.stats = {
                totalWins: 0,
                pvpWins: 0, pvpGames: 0,
                normalWins: 0, normalGames: 0,
                hardWins: 0, hardGames: 0,
                hellWins: 0, hellGames: 0,
                ownedCards: []
            };
        }
        const stats = AuthManager.currentUser.stats;

        // 確保所有欄位都存在 (防止舊資料導致 NaN)
        stats.totalWins = stats.totalWins || 0;
        stats.normalWins = stats.normalWins || 0;
        stats.normalGames = stats.normalGames || 0;
        stats.hardWins = stats.hardWins || 0;
        stats.hardGames = stats.hardGames || 0;
        stats.hellWins = stats.hellWins || 0;
        stats.hellGames = stats.hellGames || 0;

        // 根據難度更新
        const isWin = result === 'VICTORY';
        if (isWin) stats.totalWins++;

        switch (currentDifficulty) {
            case 'NORMAL':
                stats.normalGames++;
                if (isWin) stats.normalWins++;
                break;
            case 'HARD': // Expert
                stats.hardGames++;
                if (isWin) stats.hardWins++;
                break;
            case 'HELL': // Master
                stats.hellGames++;
                if (isWin) stats.hellWins++;
                break;
        }

        // 保存並更新顯示
        AuthManager.saveData();
        updateProfilePage();
        console.log("Stats updated:", stats);
    }

    // 首次擊敗獎勵檢測與金幣發放
    let firstVictoryReward = 0;
    if (!isDebugMode && AuthManager.currentUser && result === 'VICTORY' && currentDifficulty && currentOpponentDeckId) {
        // 初始化 defeatedAI 陣列
        if (!AuthManager.currentUser.defeatedAI) {
            AuthManager.currentUser.defeatedAI = [];
        }

        // 使用「牌組ID-難度」組合鍵 (例如: "dpp-NORMAL", "kmt-HARD")
        const challengeKey = `${currentOpponentDeckId}-${currentDifficulty}`;

        // 檢查是否首次擊敗此組合
        if (!AuthManager.currentUser.defeatedAI.includes(challengeKey)) {
            // 添加到已擊敗列表
            AuthManager.currentUser.defeatedAI.push(challengeKey);

            // 發放金幣獎勵
            const rewards = {
                'NORMAL': 100,
                'HARD': 200,
                'HELL': 300
            };
            firstVictoryReward = rewards[currentDifficulty] || 0;

            if (firstVictoryReward > 0) {
                AuthManager.currentUser.gold += firstVictoryReward;

                // 更新金幣顯示
                if (window.ShopManager && typeof ShopManager.updateGoldDisplay === 'function') {
                    ShopManager.updateGoldDisplay();
                }

                // 保存數據
                AuthManager.saveData();
                console.log(`首次擊敗 ${challengeKey}，獲得 ${firstVictoryReward} 金幣`);
            }
        }
    }

    // 經驗值和升級處理（只在 AI 對戰時發放，PvP 經驗已在 onGameEnd 中處理）
    let gainedXP = 0;
    let leveledUp = false;
    let levelsGained = 0;

    if (!isDebugMode && AuthManager.currentUser && result === 'VICTORY' && currentDifficulty && currentOpponentDeckId && !isPvPMode) {
        const challengeKey = `${currentOpponentDeckId}-${currentDifficulty}`;
        const isFirstVictory = firstVictoryReward > 0;

        gainedXP = getXPReward(currentDifficulty, isFirstVictory);
        AuthManager.currentUser.currentXP = (AuthManager.currentUser.currentXP || 0) + gainedXP;

        while (AuthManager.currentUser.level < 50) {
            const xpRequired = getXPRequiredForLevel(AuthManager.currentUser.level);

            if (AuthManager.currentUser.currentXP >= xpRequired) {
                AuthManager.currentUser.currentXP -= xpRequired;
                AuthManager.currentUser.level++;
                levelsGained++;
                AuthManager.currentUser.gold += 100;
            } else {
                break;
            }
        }

        if (levelsGained > 0) {
            leveledUp = true;
            ShopManager.updateGoldDisplay();
        }

        AuthManager.saveData();
    }

    // 顯示結果畫面
    showView('game-result-view');
    document.getElementById('game-result-view').style.display = 'flex'; // Ensure flex

    // 建立獎勵事件佇列（依序顯示）
    const rewardEvents = [];

    // 經驗值獎勵
    if (gainedXP > 0) {
        rewardEvents.push({
            message: `⭐ 獲得 ${gainedXP} 經驗值`,
            delay: 800  // 初始延遲
        });
    }

    // 升級獎勵
    if (leveledUp) {
        rewardEvents.push({
            message: `🎉 升級到 Lv.${AuthManager.currentUser.level}！獲得 ${levelsGained * 100} 金幣`,
            delay: 1500  // 升級訊息較重要，多給時間閱讀
        });
    }

    // 首次擊敗獎勵
    if (firstVictoryReward > 0) {
        const difficultyNames = {
            'NORMAL': '普通級',
            'HARD': '專家級',
            'HELL': '大師級'
        };
        rewardEvents.push({
            message: `🎊 首次擊敗${difficultyNames[currentDifficulty]}！獲得 ${firstVictoryReward} 金幣 🪙`,
            delay: 1500  // 特殊成就，給更多時間
        });
    }

    // 依序顯示所有獎勵
    if (rewardEvents.length > 0) {
        showRewardsSequentially(rewardEvents);
    }

    // 更新等級與經驗條顯示
    updateLevelDisplay();
}

/**
 * 更新首頁的等級和經驗條顯示
 */
function updateLevelDisplay() {
    const user = AuthManager.currentUser;
    if (!user) {
        // 未登入時隱藏等級顯示
        const levelDisplay = document.getElementById('level-display');
        if (levelDisplay) levelDisplay.style.display = 'none';
        return;
    }

    const currentLevel = user.level || 1;
    const currentXP = user.currentXP || 0;
    const requiredXP = getXPRequiredForLevel(currentLevel);

    // 顯示等級顯示區塊
    const levelDisplay = document.getElementById('level-display');
    if (levelDisplay) levelDisplay.style.display = 'flex';

    // 更新等級數字
    const levelEl = document.getElementById('player-level');
    if (levelEl) levelEl.textContent = currentLevel;

    // 更新經驗值文字
    const currentXPEl = document.getElementById('current-xp');
    const requiredXPEl = document.getElementById('required-xp');
    if (currentXPEl) currentXPEl.textContent = currentXP;
    if (requiredXPEl) requiredXPEl.textContent = requiredXP;

    // 更新經驗條進度
    const xpBar = document.getElementById('xp-bar');
    if (xpBar) {
        const percentage = Math.min((currentXP / requiredXP) * 100, 100);
        xpBar.style.width = `${percentage}%`;
    }
}

function formatDesc(text, newsBonus = 0, isNews = false) {
    if (!text) return "";
    let formatted = text;

    // 1. Process explicit bolding: **text** -> <b>text</b>
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    // 2. Auto-bold common keywords
    const keywords = ["戰吼", "嘲諷", "衝鋒", "光盾", "激怒", "持續效果", "沉默", "沈默", "遺志", "任務"];
    keywords.forEach(k => {
        const reg = new RegExp(k, 'g');
        formatted = formatted.replace(reg, `<b>${k}</b>`);
    });


    // 4. News Power Keywords Formatting
    // Bold {新聞數值+n} or 新聞數值+n with green color
    formatted = formatted.replace(/\{新聞數值\+(\d+)\}/g, '<b style="color: #00ff00;">新聞數值+$1</b>');
    formatted = formatted.replace(/(?<!\{)新聞數值\+(\d+)(?!\})/g, '<b style="color: #00ff00;">新聞數值+$1</b>');

    // 5. Dynamic News Power Bonus highlighting
    if (isNews && newsBonus > 0) {
        // Find numbers and replace with (val + bonus) while adding green color
        // Skip numbers that are preceded by "+" or inside a tag
        formatted = formatted.replace(/(\d+)(?!>)(?![^<]*<\/)/g, (match, p1, offset) => {
            // Check context: skip if it's "張牌" or part of News Power keyword
            const post = formatted.substring(offset + match.length, offset + match.length + 5);
            if (post.includes('張牌')) return match;

            const pre = formatted.substring(offset - 1, offset);
            if (pre === '+') return match;

            const val = parseInt(match);
            return `<b class="stat-buffed">${val + newsBonus}</b>`;
        });
    }

    return formatted;
}

function renderMana(containerId, mana) {
    const container = document.getElementById(containerId);
    const textEl = document.getElementById(containerId === 'player-mana-container' ? 'player-mana-text' : 'opp-mana-text');
    const isPlayer = containerId === 'player-mana-container';

    container.innerHTML = '';

    for (let i = 0; i < 10; i++) {
        const crystal = document.createElement('div');
        crystal.className = 'mana-crystal';

        // Add player or opponent specific class
        crystal.classList.add(isPlayer ? 'player-crystal' : 'opponent-crystal');

        if (i < mana.current) {
            crystal.classList.add('active');
        } else if (i < mana.max) {
            crystal.classList.add('spent');
        } else {
            crystal.classList.add('locked');
        }
        container.appendChild(crystal);
    }

    if (textEl) {
        textEl.innerText = `${mana.current}/${mana.max}`;
    }
}

function showPreview(card) {
    const preview = document.getElementById('card-preview');
    const rarityClass = card.rarity ? card.rarity.toLowerCase() : 'common';

    // Logic moved to generateCardInnerHTML

    // Generate Keyword Tooltips
    let keywordHtml = '';
    const keywordsList = [];

    // Check for Charge
    if (card.keywords?.charge) {
        keywordsList.push({ title: "衝鋒", desc: "上場即可馬上攻擊" });
    }
    // Check for Taunt
    if (card.keywords?.taunt) {
        keywordsList.push({ title: "嘲諷", desc: "敵人必須優先攻擊此隨從" });
    }
    // Check for Divine Shield
    if (card.keywords?.divineShield) {
        keywordsList.push({ title: "光盾", desc: "抵擋一次受到的傷害" });
    }
    // Check for Battlecry (Exclude NEWS cards)
    if (card.keywords?.battlecry && card.type !== 'NEWS') {
        keywordsList.push({ title: "戰吼", desc: "從手牌打出時觸發的效果" });
    }
    // Check for Deathrattle
    if (card.keywords?.deathrattle) {
        keywordsList.push({ title: "遺志", desc: "死亡時觸發的效果" });
    }
    // Check for News Power
    if (card.keywords?.newsPower) {
        keywordsList.push({ title: "新聞數值", desc: "強化新聞卡牌的攻擊力/回復量數值" });
    }
    // Check for Ongoing
    if (card.keywords?.ongoing) {
        keywordsList.push({ title: "持續效果", desc: "只要此卡在場上就會持續生效" });
    }
    // Check for Enrage
    if (card.keywords?.enrage) {
        keywordsList.push({ title: "激怒", desc: "受傷時獲得的效果" });
    }
    // Check for Silence/Lock (Battlecry-based)
    const battlecryType = card.keywords?.battlecry?.type;
    const hasSilenceKeyword = battlecryType && battlecryType.startsWith('LOCK_');
    const hasSilenceText = card.description && (card.description.includes('沉默') || card.description.includes('沈默'));

    if (hasSilenceKeyword || hasSilenceText) {
        const turns = card.keywords?.battlecry?.value || 6; // Default to 6 turns for display if not specified (like standard silence)
        keywordsList.push({ title: "沉默", desc: `使隨從無法攻擊n回合` });
    }

    // Check for Quest
    if (card.keywords?.quest) {
        keywordsList.push({ title: "任務", desc: "達成特定條件後觸發" });
    }

    if (keywordsList.length > 0) {
        keywordHtml = `
            <div class="keyword-tooltip-container" style="
                margin-left: 20px;
                margin-right: 20px;
                display: flex;
                flex-direction: column;
                gap: 6px;
                z-index: 10002;
            ">
                ${keywordsList.map(k => `
                    <div class="keyword-box" style="
                        background: rgba(42, 42, 48, 0.95);
                        border: 1px solid #555;
                        border-radius: 6px;
                        padding: 6px 10px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.5);
                        min-width: 140px;
                        max-width: 180px;
                        white-space: nowrap;
                    ">
                        <div style="color: var(--neon-cyan); font-weight: bold; font-size: 13px; margin-bottom: 3px;">${k.title}</div>
                        <div style="color: #bbb; font-size: 11px; line-height: 1.3; white-space: normal;">${k.desc}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // Check if preview is on the right side (deck builder right panel)
    const previewStyle = window.getComputedStyle(preview);
    const isPreviewOnRight = preview.style.right === '40px' || preview.style.left === 'auto';
    const flexDirection = isPreviewOnRight ? 'row-reverse' : 'row';

    preview.innerHTML = `
        <div style="display: flex; flex-direction: ${flexDirection}; align-items: flex-start; pointer-events: none;">
            <div class="card rarity-${rarityClass} ${card.type === 'NEWS' ? 'news-card' : ''}" style="width:220px; height:320px; transform:none !important; display: flex; flex-direction: column; justify-content: flex-start; padding: 8px; flex-shrink: 0;">
                ${generateCardInnerHTML(card, gameState)}
            </div>
            ${keywordHtml}
        </div>
    `;
    preview.style.display = 'block';
}

function hidePreview() {
    document.getElementById('card-preview').style.display = 'none';
}

function positionPreviewNearElement(element) {
    const preview = document.getElementById('card-preview');
    if (!preview || preview.style.display !== 'block') return;

    const rect = element.getBoundingClientRect();
    const previewWidth = 220 + 200; // Smaller card width + keyword box width
    const previewHeight = 320; // Smaller height
    const offset = 25;

    let left = rect.right + offset;
    let top = rect.top + (rect.height / 2) - (previewHeight / 2);

    // If overflow on right, show on left side
    if (left + previewWidth > window.innerWidth) {
        left = rect.left - previewWidth - offset;
    }

    // Prevent overflow on top/bottom edges
    if (top < 10) top = 10;
    if (top + previewHeight > window.innerHeight - 10) {
        top = window.innerHeight - previewHeight - 10;
    }

    preview.style.position = 'fixed';
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
    preview.style.right = 'auto';
    preview.style.bottom = 'auto';
    preview.style.transform = 'none';
}


function createCardEl(card, index) {
    const el = document.createElement('div');
    const rarityClass = card.rarity ? card.rarity.toLowerCase() : 'common';

    // Check if card is playable (enough mana)
    let canPlayClass = '';
    if (gameState && index !== -1) {
        // Always calculate based on current player (usually player 0 during their turn)
        const p = gameState.players[0];
        const actualCost = (typeof gameState.getCardActualCost === 'function')
            ? gameState.getCardActualCost(card)
            : card.cost;

        if (gameState.currentPlayerIdx === 0 && p.mana.current >= actualCost) {
            canPlayClass = ' can-play';
        }
    }

    el.className = `card rarity-${rarityClass} ${card.type === 'NEWS' ? 'news-card' : ''}${canPlayClass}`;
    el.dataset.id = card.id;
    el.dataset.type = card.type;
    el.dataset.category = card.category || '';
    el.dataset.cost = card.cost;
    el.dataset.attack = card.attack || 0;
    el.dataset.health = card.health || 0;

    const base = CARD_DATA.find(c => c.id === card.id) || card;
    let statsHtml = '';
    if (card.attack !== undefined && card.health !== undefined) {
        const atkClass = card.attack > base.attack ? 'stat-buffed' : (card.attack < base.attack ? 'stat-damaged' : '');
        const currentHp = card.currentHealth !== undefined ? card.currentHealth : card.health;
        const hpClass = (card.currentHealth !== undefined && card.currentHealth < card.health) ? 'stat-damaged' : (card.health > base.health ? 'stat-buffed' : '');
        const hpValue = currentHp;

        // Stat Pop Animation tracking
        const atkPop = (card._lastAtk !== undefined && card._lastAtk !== card.attack) ? 'stat-pop' : '';
        const hpPop = (card._lastHp !== undefined && card._lastHp !== currentHp) ? 'stat-pop' : '';
        card._lastAtk = card.attack;
        card._lastHp = currentHp;

        statsHtml = `
        <div class="minion-stats">
            <span class="stat-atk ${atkClass} ${atkPop}"><span>${card.attack}</span></span>
            <span class="stat-hp ${hpClass} ${hpPop}">${hpValue}</span>
        </div>`;
    }

    const imageStyle = card.image ? `background: url('${card.image}') no-repeat center; background-size: cover; opacity: 0.5;` : '';
    // Use a background on the card itself or insert an element? 
    // Let's insert an element for better control, similar to minion but restricted by space.
    // Or set it as background of the card element?
    // Current .card has background color.

    // Let's try inserting a small art box under the title or behind text? 
    // Given the layout "Cost(TL), Title(Top), Category, Desc", space is tight.
    // Let's put it as a background for the whole card but darkened?

    // Simple approach: Add an art div.
    // Updated Card Layout logic
    // Structure: 
    // Top Row: Cost (Absolute TL), Title (Center/Right)
    // Middle: Image (Block)
    // Bottom: Category, Desc, Stats (Absolute Bottom)

    // We need to ensure .card is flex-col
    // But .card css is already flex-col.
    // Let's remove absolute image and use flow.

    el.style.justifyContent = 'flex-start'; // Align top
    el.style.padding = '2px';

    // Auto-center content in card if short
    // Actually, let's keep top alignment for consistency, but if image is small, the contain handles it.
    // Making background transparent so no "black bars" visible, just card background.
    const artHtml = card.image ?
        `<div class="card-art-box" style="width: 100%; height: 55px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 4px; margin: 2px 0; border: 1px solid #444; flex-shrink: 0; background-color: transparent;"></div>` :
        `<div class="card-art-box placeholder" style="width: 100%; height: 40px; background: #222; margin: 5px 0; flex-shrink: 0;"></div>`;

    const baseCard = CARD_DATA.find(c => c.id === card.id) || card;

    // Calculate actual cost considering ongoing effects
    // Pass card.side to ensure AI effects don't leak to player UI
    const actualCost = gameState ? gameState.getCardActualCost(card, card.side) : card.cost;

    const isReduced = actualCost < card.cost || card.isReduced;
    const costClass = isReduced ? 'cost-reduced' : '';
    const displayCost = actualCost; // Show the actual cost after reductions

    const bonus = (gameState && card.id) ? (gameState.getNewsPower(card.side || 'PLAYER') || 0) : 0;
    const isNews = card.type === 'NEWS';
    const bcType = card.keywords?.battlecry?.type || '';

    // Strict rules: Only DAMAGE and HEAL related effects get bonus
    const isDamage = bcType.includes('DAMAGE');
    const isHeal = bcType.includes('HEAL') || bcType.includes('RECOVER');
    const isExcluded = bcType.includes('DRAW') || bcType.includes('COST') || bcType.includes('REDUCE');
    const effectiveBonus = (isNews && (isDamage || isHeal) && !isExcluded) ? bonus : 0;

    el.innerHTML = `
        <div class="card-cost ${costClass}"><span>${displayCost}</span></div>
        
        <!-- Header spacer for Cost bubble -->
        <div style="width: 100%; height: 10px;"></div>
        
        <div class="card-title" style="margin: 2px 0; font-size: 10px; z-index: 5; text-shadow: 0 1px 2px #000;">${card.name}</div>
        
        ${artHtml}
        
        <div class="card-category" style="margin: 2px 0; font-size: 7px;">${card.category || ""}</div>
        
        <div class="card-desc" style="font-size: 8px; line-height: 1.1; overflow: hidden; padding: 2px; flex-grow: 1; text-align: center; white-space: pre-wrap;">${formatDesc(card.description, effectiveBonus, isNews)}</div>
        
        <!-- Stats are absolute positioned in CSS usually, but let's check -->
        ${statsHtml}
    `;

    // Preview Interaction
    el.addEventListener('mouseenter', (e) => {
        const preview = document.getElementById('card-preview');
        const builderView = document.getElementById('deck-builder');

        // Only show preview in deck builder, not in battle mode for hand cards
        if (builderView && builderView.style.display === 'flex') {
            // Builder Mode: Avoid overlap
            const screenWidth = window.innerWidth;
            // Reset conflict styles
            preview.style.top = 'auto';
            preview.style.transform = 'none';
            // Use CSS bottom positioning

            if (e.clientX < screenWidth / 2) {
                // Cursor Left -> Show Right
                preview.style.left = 'auto';
                preview.style.right = '40px';
            } else {
                // Cursor Right -> Show Left
                preview.style.right = 'auto';
                preview.style.left = '40px';
            }
            showPreview(card);
        }
        // Battle Mode (Hand): No preview, rely on CSS hover zoom effect
    });
    el.addEventListener('mouseleave', hidePreview);

    // Play Card Interaction (Now Drag instead of Click)
    if (index !== -1) { // Only add drag for cards in hand, not in deck builder
        el.addEventListener('pointerdown', (e) => {
            el.setPointerCapture(e.pointerId);
            onDragStart(e, index, true);
        });
    }

    return el;
}

function createMinionEl(minion, index, isPlayer) {
    const el = document.createElement('div');
    let dsClass = (minion.keywords && minion.keywords.divineShield) ? ' divine-shield' : '';
    let enrageClass = minion.isEnraged ? ' enraged' : '';
    let lockedClass = (minion.lockedTurns > 0) ? ' locked' : '';
    let unlockClass = minion.justUnlocked ? ' unlocking' : '';
    let summonClass = minion.justSummoned ? ' summoning' : '';

    if (minion.justUnlocked) {
        // Clear the flag so it only animates once
        delete minion.justUnlocked;
    }
    if (minion.justSummoned) {
        // Clear the flag so it only animates once
        delete minion.justSummoned;
    }

    const canActuallyAttack = minion.canAttack && minion.attack > 0;
    const showCanAttack = canActuallyAttack && isPlayer && gameState.currentPlayerIdx === 0;
    const rarityClass = minion.rarity ? minion.rarity.toLowerCase() : 'common';
    el.className = `minion rarity-${rarityClass} ${minion.keywords?.taunt ? 'taunt' : ''} ${minion.sleeping ? 'sleeping' : ''} ${showCanAttack ? 'can-attack' : ''}${dsClass}${enrageClass}${lockedClass}${unlockClass}${summonClass}`;
    const imageStyle = minion.image ? `background: url('${minion.image}') no-repeat center; background-size: cover;` : '';
    const base = CARD_DATA.find(c => c.id === minion.id) || minion;
    const effectiveBaseAttack = minion.baseAttackOverride !== undefined ? minion.baseAttackOverride : base.attack;
    const atkClass = minion.attack > effectiveBaseAttack ? 'stat-buffed' : (minion.attack < effectiveBaseAttack ? 'stat-damaged' : '');
    const hpClass = minion.currentHealth < minion.health ? 'stat-damaged' : (minion.health > base.health ? 'stat-buffed' : '');

    // Countdown timers
    let countdownHtml = '';
    if (minion.lockedTurns > 0) {
        countdownHtml += `<div class="countdown-badge lock-countdown">🔒 ${minion.lockedTurns}</div>`;
    }
    if (minion.keywords?.quest && minion.questTurns !== undefined) {
        const remaining = minion.keywords.quest.turns - minion.questTurns;
        if (remaining >= 0) {
            countdownHtml += `<div class="countdown-badge quest-countdown">⏳ ${remaining}</div>`;
        }
    }
    if (minion.deathTimer !== undefined && minion.deathTimer > 0) {
        countdownHtml += `<div class="countdown-badge death-countdown" style="background: rgba(139, 0, 0, 0.9); border-color: #ff4d4d; color: #fff;">💀 ${minion.deathTimer}</div>`;
    }

    // Stat Pop Animation tracking
    const atkPop = (minion._lastAtk !== undefined && minion._lastAtk !== minion.attack) ? 'stat-pop' : '';
    const hpPop = (minion._lastHp !== undefined && minion._lastHp !== minion.currentHealth) ? 'stat-pop' : '';
    minion._lastAtk = minion.attack;
    minion._lastHp = minion.currentHealth;

    el.innerHTML = `
        <div class="minion-art" style="${imageStyle}"></div>
        ${countdownHtml}
        <div class="card-title">${minion.name}</div>
        <div class="minion-stats">
            <span class="stat-atk ${atkClass} ${atkPop}"><span>${minion.attack}</span></span>
            <span class="stat-hp ${hpClass} ${hpPop}">${minion.currentHealth}</span>
        </div>
    `;

    // Preview Interaction - Fixed position near minion
    let previewTimeout = null;

    el.addEventListener('mouseenter', () => {
        // Don't show preview if dragging or targeting
        if (dragging || isBattlecryTargeting) return;

        previewTimeout = setTimeout(() => {
            showPreview(minion);
            positionPreviewNearElement(el);
        }, 100); // Short delay to avoid flicker
    });

    el.addEventListener('mouseleave', () => {
        if (previewTimeout) {
            clearTimeout(previewTimeout);
            previewTimeout = null;
        }
        hidePreview();
    });

    // Attack Drag Start
    if (isPlayer && canActuallyAttack && gameState.currentPlayerIdx === 0) {
        el.addEventListener('pointerdown', (e) => {
            el.setPointerCapture(e.pointerId);
            onDragStart(e, index);
        });
    }

    // Target Drop Data (Needed for both enemy attacks AND friendly buffs)
    el.dataset.type = 'MINION';
    el.dataset.index = index;
    el.dataset.locked = minion.lockedTurns > 0;
    el.dataset.category = minion.category || ''; // Added for category-based targeting rules
    el.dataset.cost = minion.cost !== undefined ? minion.cost : 0;
    el.dataset.attack = minion.attack !== undefined ? minion.attack : 0;
    el.dataset.health = minion.health !== undefined ? minion.health : 0;
    el.dataset.currentHealth = minion.currentHealth !== undefined ? minion.currentHealth : 0;
    el.dataset.minionId = minion.instanceId; // Added for damage animation targeting

    return el;
}

function onDragStart(e, index, fromHand = false) {
    if (gameState.currentPlayerIdx !== 0) return;
    if (isBattlecryTargeting) return; // Finish targeting first

    // Only check hand card and cost if dragging from hand
    if (fromHand) {
        const card = gameState.currentPlayer.hand[index];
        if (!card) {
            console.warn('[DRAG] Card not found in hand at index:', index);
            return;
        }

        // Use actual cost for drag start check
        const actualCost = gameState.getCardActualCost(card);
        if (gameState.currentPlayer.mana.current < actualCost) {
            shakeManaContainer(true);
        }
    }

    dragging = true;
    attackerIndex = index;
    draggingFromHand = fromHand;
    draggingMode = 'DAMAGE'; // Reset to default

    // Hide any active preview immediately
    hidePreview();

    dragLine.classList.remove('battlecry-line', 'heal-line', 'buff-line', 'bounce-line', 'destroy-line');
    dragLine.setAttribute('x1', e.clientX);
    dragLine.setAttribute('y1', e.clientY);
    dragLine.setAttribute('x2', e.clientX);
    dragLine.setAttribute('y2', e.clientY);
    dragLine.style.display = 'block';

    if (fromHand) {
        // Add dragging class to body to disable hover effects
        document.body.classList.add('dragging-active');

        hidePreview();
        // Visual feedback: clone the card to follow mouse
        const originalEl = document.getElementById('player-hand').children[index];
        draggedEl = originalEl.cloneNode(true);
        draggedEl.style.position = 'fixed';
        draggedEl.style.zIndex = '10000';
        draggedEl.style.pointerEvents = 'none';
        draggedEl.style.opacity = '0.8';
        draggedEl.style.transform = 'scale(0.8)';
        document.body.appendChild(draggedEl);
        updateDraggedElPosition(e.clientX, e.clientY);

        originalEl.style.opacity = '0.2';
        originalEl.style.pointerEvents = 'none'; // Prevent hover blocking
    }
}

function updateDraggedElPosition(x, y) {
    if (!draggedEl) return;
    draggedEl.style.left = `${x - 60}px`;
    draggedEl.style.top = `${y - 85}px`;
}

function onDragMove(e) {
    if (!dragging && !isBattlecryTargeting) return;

    if (dragging || isBattlecryTargeting) {
        // Calculate shortened line coordinates to account for arrow length (95px)
        const x1 = parseFloat(dragLine.getAttribute('x1'));
        const y1 = parseFloat(dragLine.getAttribute('y1'));
        const dx = e.clientX - x1;
        const dy = e.clientY - y1;
        const dist = Math.sqrt(dx * dx + dy * dy);

        let newX2, newY2;

        // Only shorten if line is long enough, otherwise hide or clamp
        const arrowOffset = 30;
        if (dist > arrowOffset) {
            const ratio = (dist - arrowOffset) / dist;
            newX2 = x1 + dx * ratio;
            newY2 = y1 + dy * ratio;
            dragLine.style.opacity = '1';
        } else {
            // If too close, just point at mouse (arrow will overlap start) or hide
            // Hiding is cleaner to avoid visual glitches
            newX2 = e.clientX;
            newY2 = e.clientY;
            // Optional: dragLine.style.opacity = '0'; if you want to hide it
        }

        dragLine.setAttribute('x2', newX2);
        dragLine.setAttribute('y2', newY2);

        if (dragging && draggingFromHand) {
            updateDraggedElPosition(e.clientX, e.clientY);

            // Get the card being dragged
            const card = gameState.currentPlayer.hand[attackerIndex];
            if (!card) return;

            // Only show placement indicator for minions, not newss
            const targetEl = document.elementFromPoint(e.clientX, e.clientY);
            const board = document.getElementById('player-board');

            // Strict board detection: mouse must be OVER the board or inside its container
            const isBoardHover = targetEl?.closest('#player-board') || targetEl?.id === 'player-board';

            if (isBoardHover) {
                board.classList.add('drop-highlight');

                // Only show placement indicator for minions
                if (card.type === 'MINION') {
                    let indicator = board.querySelector('.placement-indicator');
                    if (!indicator) {
                        indicator = document.createElement('div');
                        indicator.className = 'placement-indicator';
                        board.appendChild(indicator);
                    }

                    const minions = Array.from(board.children).filter(m => m.classList.contains('minion'));

                    if (minions.length === 0) {
                        currentInsertionIndex = 0;
                        if (indicator.parentElement !== board) board.appendChild(indicator);
                    } else {
                        let found = false;
                        for (let i = 0; i < minions.length; i++) {
                            const rect = minions[i].getBoundingClientRect();
                            const centerX = rect.left + rect.width / 2;

                            if (e.clientX < centerX) {
                                currentInsertionIndex = i;
                                if (board.children[i] !== indicator) {
                                    board.insertBefore(indicator, minions[i]);
                                }
                                found = true;
                                break;
                            }
                        }
                        if (!found) {
                            currentInsertionIndex = minions.length;
                            if (board.lastElementChild !== indicator) {
                                board.appendChild(indicator);
                            }
                        }
                    }
                    indicator.classList.add('active');
                } else {
                    // For news cards, hide any active indicator
                    const indicator = board.querySelector('.placement-indicator');
                    if (indicator) {
                        indicator.classList.remove('active');
                    }
                }
            } else {
                board.classList.remove('drop-highlight');
                const indicator = board.querySelector('.placement-indicator');
                if (indicator) {
                    indicator.classList.remove('active');
                }
                currentInsertionIndex = -1;
            }
        }
        else if (isBattlecryTargeting) {
            // Battlecry Logic - Check for snap target
            const targetEl = document.elementFromPoint(e.clientX, e.clientY);
            const unitEl = targetEl?.closest('[data-type]'); // Look for units (minions or heroes)

            if (unitEl) {
                const side = unitEl.id === 'player-hero' || unitEl.parentElement?.id === 'player-board' ? 'PLAYER' : 'OPPONENT';
                const type = unitEl.dataset.type;
                const idx = unitEl.dataset.index ? parseInt(unitEl.dataset.index) : -1;

                const targetInfo = {
                    type: type,
                    side: side,
                    index: idx,
                    category: unitEl.dataset.category || (type === 'HERO' ? '英雄' : ''),
                    isLocked: unitEl.dataset.locked === 'true',
                    cost: parseInt(unitEl.dataset.cost) || 0,
                    attack: parseInt(unitEl.dataset.attack) || 0,
                    health: parseInt(unitEl.dataset.health) || 0,
                    currentHealth: (unitEl.dataset.currentHealth !== undefined) ? parseInt(unitEl.dataset.currentHealth) : (parseInt(unitEl.dataset.health) || 0)
                };

                if (isTargetEligible(battlecryTargetRule, targetInfo)) {
                    // Lock-in visual (snap)
                    const rect = unitEl.getBoundingClientRect();
                    // Calculate vector to center of target
                    const tx = rect.left + rect.width / 2;
                    const ty = rect.top + rect.height / 2;

                    // Recalculate shortening based on TARGET center
                    const tdx = tx - x1;
                    const tdy = ty - y1;
                    const tdist = Math.sqrt(tdx * tdx + tdy * tdy);

                    if (tdist > arrowOffset) {
                        const tratio = (tdist - arrowOffset) / tdist;
                        dragLine.setAttribute('x2', x1 + tdx * tratio);
                        dragLine.setAttribute('y2', y1 + tdy * tratio);
                    } else {
                        dragLine.setAttribute('x2', tx);
                        dragLine.setAttribute('y2', ty);
                    }
                    return;
                }
            }
        }
    }
}

async function onDragEnd(e) {
    if (!dragging && !isBattlecryTargeting) return;

    const board = document.getElementById('player-board');

    // Capture highlight state BEFORE removing it
    const isBoardHighlighted = board.classList.contains('drop-highlight');

    board.classList.remove('drop-highlight');

    if (dragging) {
        dragging = false;
        dragLine.style.display = 'none'; // Ensure hide when dragging ends
        dragLine.setAttribute('x1', 0); // Reset coords
        dragLine.setAttribute('y1', 0);

        const indicator = board.querySelector('.placement-indicator');
        if (indicator) indicator.classList.remove('active');
        // Let it collapse naturally via CSS transition

        if (draggingFromHand) {
            // Remove dragging class from body
            document.body.classList.remove('dragging-active');

            // Cleanup visual ghost - but don't null it yet so we can check visibility
            if (draggedEl) {
                draggedEl.style.display = 'none';
            }
            const originalEl = document.getElementById('player-hand').children[attackerIndex];
            if (originalEl) {
                originalEl.style.opacity = '1';
                originalEl.style.pointerEvents = ''; // Restore pointer events
            }

            // Temporarily hide ghosts and effects to see what's underneath
            const dustClouds = document.querySelectorAll('.dust-cloud');
            dustClouds.forEach(d => d.style.pointerEvents = 'none');

            const targetEl = document.elementFromPoint(e.clientX, e.clientY);

            // Fallback: Check if coordinates are inside player board rect
            const boardRect = board.getBoundingClientRect();
            const isInBoardRect = (
                e.clientX >= boardRect.left &&
                e.clientX <= boardRect.right &&
                e.clientY >= boardRect.top &&
                e.clientY <= boardRect.bottom
            );

            // Cleanup ghost for real now
            if (draggedEl) {
                draggedEl.remove();
                draggedEl = null;
            }

            // Play condition: Board must be highlighted (user sees the visual cue) 
            // OR the mouse is physically within the board area (calculated via Rect)
            const card = gameState.currentPlayer.hand[attackerIndex];
            const isPlayValidated = isBoardHighlighted || isInBoardRect;

            // [DEBUG] Detail log for investigation
            console.log(`[DRAG_END] Card: ${card.name}, type: ${card.type}`);
            console.log(`[DRAG_END] x: ${e.clientX}, y: ${e.clientY}, targetEl:`, targetEl);
            console.log(`[DRAG_END] Flags - Highlight: ${isBoardHighlighted}, isInRect: ${isInBoardRect}`);
            console.log(`[DRAG_END] isPlayValidated: ${isPlayValidated}`);

            if (!isPlayValidated) {
                // Return to hand visuals
                logMessage(UI_TEXT.PLAY_CANCELLED);
                const originalEl = document.getElementById('player-hand').children[attackerIndex];
                if (originalEl) originalEl.style.opacity = '1';
                render();
                return;
            }

            if (isPlayValidated) {
                // Use centralized validation from game engine to ensure consistency (e.g. cost reduction)
                if (!gameState.canPlayCard(attackerIndex)) {
                    // Start: Diagnostics for UX
                    const actualCost = gameState.getCardActualCost(card);
                    if (gameState.currentPlayer.mana.current < actualCost) {
                        shakeManaContainer(true);
                        logMessage(UI_TEXT.INSUFFICIENT_MANA);
                    } else if (card.type === 'MINION' && gameState.currentPlayer.board.length >= 7) {
                        logMessage(UI_TEXT.BOARD_FULL);
                    } else if (card.keywords?.battlecry?.type === 'DISCARD_RANDOM') {
                        logMessage(UI_TEXT.DISCARD_FAILED);
                    } else {
                        logMessage(UI_TEXT.CANNOT_PLAY_CARD);
                    }
                    // End: Diagnostics

                    const originalEl = document.getElementById('player-hand').children[attackerIndex];
                    if (originalEl) originalEl.style.opacity = '1';
                    render();
                    return;
                }

                const targetSlot = document.getElementById('player-board').children[currentInsertionIndex];

                // Targeted Battlecry check
                const battlecry = card.keywords?.battlecry;
                const isTargeted = battlecry && battlecry.target && typeof battlecry.target === 'object';

                // Show Preview before playing
                await showCardPlayPreview(card, false, targetSlot);

                // Extra delay for targeted cards so player sees the card land
                if (isTargeted) await new Promise(r => setTimeout(r, 200));

                if (isTargeted) {
                    const validTargets = getValidTargets(battlecry.target);
                    // Special rule: For newss, even if no minions exist, allow hero-targeting UI to trigger
                    // to avoid "dead" drag experience (user can still cancel or try to hit hero if rule allows)
                    if (validTargets.length === 0 && card.type !== 'NEWS') {
                        logMessage(UI_TEXT.NO_VALID_TARGET);
                        render();
                        return;
                    }

                    try {
                        let mode = 'DAMAGE';
                        if (battlecry.type === 'HEAL' || battlecry.type === 'FULL_HEAL' || battlecry.type === 'HEAL_CATEGORY_BONUS') {
                            mode = 'HEAL';
                        } else if (battlecry.type === 'BUFF_STAT_TARGET' || battlecry.type === 'GIVE_DIVINE_SHIELD' || battlecry.type === 'BUFF_STAT_TARGET_TEMP' || battlecry.type === 'BUFF_STAT_TARGET_CATEGORY_BONUS' || battlecry.type === 'BUFF_HEALTH_AND_TAUNT_TARGET') {
                            mode = 'BUFF';
                        } else if (battlecry.type === 'BOUNCE_TARGET' || battlecry.type === 'BOUNCE_CATEGORY') {
                            mode = 'BOUNCE';
                        } else if (battlecry.type === 'DESTROY' || battlecry.type === 'DESTROY_DAMAGED' ||
                            battlecry.type === 'DESTROY_LOW_ATTACK' || battlecry.type === 'DESTROY_HIGH_ATTACK' ||
                            battlecry.type === 'SET_DEATH_TIMER' || battlecry.type === 'DESTROY_LOCKED') {
                            mode = 'DESTROY';
                        } else if (battlecry.type === 'DAMAGE_NON_CATEGORY') {
                            mode = 'DAMAGE';
                        }

                        if (card.type === 'NEWS') {
                            battlecrySourceType = 'NEWS';
                            // Hide the card in hand to simulate it "becoming" the arrow
                            const handCardEl = document.getElementById('player-hand').children[attackerIndex];
                            if (handCardEl) handCardEl.style.opacity = '0';

                            // Arrow starts from hero for newss
                            const heroRect = document.getElementById('player-hero').getBoundingClientRect();
                            const startX = heroRect.left + heroRect.width / 2;
                            const startY = heroRect.top + heroRect.height / 2;

                            // Pass full battlecry object to support category checks
                            startBattlecryTargeting(attackerIndex, startX, startY, mode, battlecry, 'NEWS');
                        } else { // Minion with Battlecry
                            // Log history immediately when card is spent
                            MatchHistory.add('PLAY', {
                                player: "你",
                                card: card.name
                            });

                            gameState.playCard(attackerIndex, 'PENDING', currentInsertionIndex);
                            render();

                            // The minion IS NOW ON THE BOARD at currentInsertionIndex
                            const rect = document.getElementById('player-board').children[currentInsertionIndex].getBoundingClientRect();
                            const startX = rect.left + rect.width / 2;
                            const startY = rect.top + rect.height / 2;

                            // Pass full battlecry object to support category checks
                            startBattlecryTargeting(currentInsertionIndex, startX, startY, mode, battlecry, 'MINION');
                        }
                    } catch (err) {
                        logMessage(err.message);
                        render();
                    }
                    return;
                }

                try {
                    // 1. Play Card but SKIP battlecry execution in engine
                    const { card: playedCard } = gameState.playCard(attackerIndex, null, currentInsertionIndex, true);

                    // Log history
                    MatchHistory.add('PLAY', {
                        player: "你",
                        card: playedCard.name
                    });

                    // PvP 模式：同步出牌動作到 Firebase
                    if (isPvPMode && window.pvpManager) {
                        // 計算戰吼效果值（含 News Power 加成）
                        let resolvedEffect = null;
                        if (playedCard.keywords?.battlecry) {
                            const bc = playedCard.keywords.battlecry;
                            const isNews = playedCard.type === 'NEWS';
                            const isDamage = bc.type.includes('DAMAGE');
                            const isHeal = bc.type.includes('HEAL') || bc.type.includes('RECOVER');
                            const isBuff = bc.type.includes('BUFF');
                            const needsBonus = (isDamage || isHeal || isBuff) && isNews;

                            const bonus = needsBonus ? (gameState.getNewsPower('PLAYER') || 0) : 0;
                            const effectValue = (bc.value || 0) + bonus;

                            resolvedEffect = {
                                type: bc.type,
                                value: effectValue,
                                stat: bc.stat || 'ALL'
                            };
                        }

                        await window.pvpManager.syncGameAction('PLAY_CARD', {
                            cardId: playedCard.id,
                            handIndex: attackerIndex,
                            insertionIndex: currentInsertionIndex,
                            targetType: null,
                            targetIndex: null,
                            targetSide: null,
                            resolvedEffect: resolvedEffect
                        });
                        syncLocalStateToFirebase(); // 同步出牌後的狀態 (Mana, HandSize)
                    }

                    // 2. Render to show the minion LANDING on the board
                    render();

                    // 3. Trigger Dust and Sound at newly played minion (Capture from fresh DOM)
                    const boardEl = document.getElementById('player-board');
                    const newMinionEl = boardEl.children[currentInsertionIndex];
                    if (newMinionEl && playedCard.type === 'MINION') {
                        const intensity = playedCard.cost >= 7 ? 2 : 1;
                        spawnDustEffect(newMinionEl, intensity);
                    }

                    // 4. WAIT 0.5s (as requested)
                    await new Promise(r => setTimeout(r, 500));

                    // 5. Execute Battlecry manually to get the result/target
                    if (playedCard.keywords && playedCard.keywords.battlecry) {
                        const minionOnBoard = gameState.currentPlayer.board[currentInsertionIndex];
                        const result = gameState.resolveBattlecry(playedCard.keywords.battlecry, null, minionOnBoard);

                        if (result) {
                            // 6. Show Visual Effects based on result
                            if (result.type === 'DAMAGE' || result.type === 'HEAL' || result.type === 'BUFF') {
                                // Find the DOM element for the target
                                let targetEl = null;

                                if (result.target) {
                                    if (result.target.type === 'HERO') {
                                        targetEl = result.target.side === 'OPPONENT' ? document.getElementById('opp-hero') : document.getElementById('player-hero');
                                    } else {
                                        const boardId = result.target.side === 'OPPONENT' ? 'opp-board' : 'player-board';
                                        const board = document.getElementById(boardId);
                                        if (board) targetEl = board.children[result.target.index];
                                    }
                                }

                                if (playedCard.id === 'S020' && targetEl) {
                                    triggerPurgeAnimation(targetEl);
                                }

                                if (targetEl) {
                                    // Determine arrow color based on battlecry type
                                    const bcType = playedCard.keywords?.battlecry?.type;
                                    let arrowColor = '#ff0000'; // Default red for damage
                                    let effectType = 'DAMAGE';

                                    if (result.type === 'HEAL') {
                                        arrowColor = '#43e97b';
                                        effectType = 'HEAL';
                                    } else if (result.type === 'BUFF') {
                                        arrowColor = '#ffa500';
                                        effectType = 'BUFF';
                                    } else if (result.type === 'DESTROY' || result.type === 'EAT' ||
                                        bcType === 'DESTROY' || bcType === 'DESTROY_DAMAGED' ||
                                        bcType === 'DESTROY_LOW_ATTACK' || bcType === 'DESTROY_HIGH_ATTACK' ||
                                        bcType === 'SET_DEATH_TIMER' || bcType === 'DESTROY_LOCKED') {
                                        arrowColor = '#000000'; // Black for destroy
                                        effectType = 'DESTROY';
                                    }

                                    await animateAbility(newMinionEl, targetEl, arrowColor, true);
                                    triggerCombatEffect(targetEl, effectType);
                                }

                                // Log history (moved outside targetEl check so it always logs)
                                console.log('[BATTLECRY LOG] playedCard:', playedCard.name, 'type:', playedCard.type);
                                console.log('[BATTLECRY LOG] result:', result);

                                const sourceName = playedCard.name;
                                const destSide = result.target.side;
                                const destName = getUnitName(destSide, result.target.index, result.target.type);

                                console.log('[BATTLECRY LOG] sourceName:', sourceName, 'destName:', destName, 'destSide:', destSide);

                                // 區分新聞牌和隨從的記錄
                                const isNews = playedCard.type === 'NEWS';
                                console.log('[BATTLECRY LOG] isNews:', isNews, 'result.type:', result.type);

                                if (result.type === 'HEAL') {
                                    const eventType = isNews ? 'NEWS_HEAL' : 'BATTLECRY_HEAL';
                                    console.log('[BATTLECRY LOG] Adding HEAL event:', eventType);
                                    MatchHistory.add(eventType, { source: sourceName, target: destName, value: result.value || 0 });
                                } else if (result.type === 'DAMAGE') {
                                    const eventType = isNews ? 'NEWS_DAMAGE' : 'BATTLECRY_DAMAGE';
                                    console.log('[BATTLECRY LOG] Adding DAMAGE event:', eventType, 'value:', result.value);
                                    MatchHistory.add(eventType, { source: sourceName, target: destName, value: result.value || 0 });
                                }
                            } else if (result.type === 'EAT') {
                                // Find target
                                const boardId = result.target.side === 'OPPONENT' ? 'opp-board' : 'player-board';
                                const targetEl = document.getElementById(boardId).children[result.target.index];

                                if (targetEl) {
                                    await animateAbility(newMinionEl, targetEl, '#000000', true); // Black for destroy/eat
                                    triggerCombatEffect(targetEl, 'DESTROY');
                                    // Visual delay before buffing self
                                    await new Promise(r => setTimeout(r, 200));
                                    triggerCombatEffect(newMinionEl, 'BUFF');
                                }
                            } else if (result.type === 'HEAL_ALL') {
                                // Trigger Full Board Visual Effect instead of granular ones
                                const isPlayer = result.affected[0]?.unit.side === 'PLAYER';
                                triggerFullBoardHealAnimation(isPlayer);
                            } else if (result.type === 'DAMAGE_ALL') {
                                if (playedCard.id === 'S015') { // 武漢肺炎
                                    triggerPoisonGasAnimation();
                                } else if (playedCard.id === 'S019') { // 查水表
                                    triggerRippleDiffusionAnimation(true);
                                }

                                // Apply individual damage numbers/shake
                                result.affected.forEach(aff => {
                                    const boardId = aff.unit.side === 'PLAYER' ? 'player-board' : 'opp-board';
                                    const targetEl = document.getElementById(boardId).children[aff.unit.index];
                                    if (targetEl) {
                                        triggerCombatEffect(targetEl, 'DAMAGE');
                                    }
                                });
                            } else if (result.type === 'BOUNCE_ALL') {
                                // Tsai Ing-wen or Cabinet Resignation
                                if (result.bounced && result.bounced.length > 0) {
                                    const isOpponentBoard = result.bounced[0].side === 'OPPONENT';
                                    triggerFullBoardBounceAnimation(!isOpponentBoard);
                                } else {
                                    triggerFullBoardBounceAnimation(false);
                                }
                                // Suppress deck animation for bounced cards
                                previousPlayerHandSize = gameState.currentPlayer.hand.length;

                                // If pets were summoned (Lele & Xiangxiang), animate them
                                if (result.summonedCount && result.summonedCount > 0) {
                                    render();
                                    setTimeout(() => {
                                        const boardEl = document.getElementById('player-board');
                                        const sourceIdx = gameState.currentPlayer.board.findIndex(m => m.id === playedCard.id);
                                        if (sourceIdx !== -1) {
                                            // Animate left pet (Lele)
                                            if (sourceIdx > 0 && boardEl.children[sourceIdx - 1]) {
                                                boardEl.children[sourceIdx - 1].classList.add('pop-in');
                                            }
                                            // Animate right pet (Xiangxiang)
                                            if (sourceIdx < boardEl.children.length - 1 && boardEl.children[sourceIdx + 1]) {
                                                boardEl.children[sourceIdx + 1].classList.add('pop-in');
                                            }
                                        }
                                    }, 50);
                                }
                            } else if (result.type === 'BOUNCE') {
                                // Find target
                                const side = result.target.side || 'OPPONENT';
                                const boardId = side === 'OPPONENT' ? 'opp-board' : 'player-board';
                                const board = document.getElementById(boardId);
                                const targetEl = (board && result.target.index !== undefined) ? board.children[result.target.index] : null;

                                if (targetEl) {
                                    // Visual arrow
                                    await animateAbility(newMinionEl, targetEl, '#a335ee', true);
                                    triggerCombatEffect(targetEl, 'BOUNCE');
                                    await new Promise(r => setTimeout(r, 400));
                                    render();
                                }
                                previousPlayerHandSize = gameState.currentPlayer.hand.length;
                            } else if (result.type === 'ADD_CARD') {
                                // Cards added to hand (e.g., 高端疫苗 from 陳時中)
                                // Suppress deck animation in renderHands
                                previousPlayerHandSize = gameState.currentPlayer.hand.length;

                                // Render to create the card elements (they will be visible but we'll apply pop-in)
                                render();

                                // Get hand and apply sequential pop-in
                                const handEl = document.getElementById('player-hand');
                                const newCount = result.count || 1;
                                for (let i = 0; i < newCount; i++) {
                                    const cardIdx = handEl.children.length - newCount + i;
                                    const el = handEl.children[cardIdx];
                                    if (el) {
                                        el.classList.add('pop-in');
                                        // Auto-cleanup after animation
                                        setTimeout(() => el.classList.remove('pop-in'), 600);
                                        // Small delay for sequential appearance
                                        await new Promise(r => setTimeout(r, 200));
                                    }
                                }
                            } else if (result.type === 'SUMMON_MULTIPLE') {
                                render();
                                // Animate the new minions (assumed to be at the end of the board)
                                setTimeout(() => {
                                    const boardEl = document.getElementById('player-board');
                                    const total = boardEl.children.length;
                                    for (let i = 0; i < result.count; i++) {
                                        const token = boardEl.children[total - 1 - i];
                                        if (token) {
                                            token.classList.add('pop-in');
                                        }
                                    }
                                }, 50);
                            } else if (result.type === 'DESTROY_ALL') {
                                // 921 Earthquake
                                triggerEarthquakeAnimation();
                            } else if (result.type === 'DISCARD' || result.type === 'DISCARD_DRAW') {
                                const handEl = document.getElementById('player-hand');
                                let discardEls = [];
                                if (result.indices) {
                                    discardEls = result.indices.map(idx => handEl.children[idx]).filter(el => el);
                                } else if (result.index !== undefined) {
                                    discardEls = [handEl.children[result.index]].filter(el => el);
                                } else {
                                    const count = result.count || 1;
                                    discardEls = Array.from(handEl.children).slice(-count);
                                }

                                // --- PERFECT: DO NOT TOUCH DISCARD_DRAW ANIMATION LOGIC ---
                                // Sequence: Discard -> Render Hand Gap -> Small Wait -> Draw Loop (Render after each)
                                if (discardEls.length > 0) {
                                    await Promise.all(discardEls.map(el => animateDiscard(el)));
                                    render(); // Close the gap in hand immediately
                                    await new Promise(r => setTimeout(r, 300));
                                }
                                if (result.type === 'DISCARD_DRAW' && result.drawCount) {
                                    for (let i = 0; i < result.drawCount; i++) {
                                        gameState.currentPlayer.drawCard();
                                        render();
                                        await new Promise(r => setTimeout(r, 600));
                                    }
                                }
                            } else if (result.type === 'DRAW') {
                                // Universal sequential draw handling (Matches S001 logic)
                                const count = result.value || result.count || 1;
                                for (let i = 0; i < count; i++) {
                                    gameState.currentPlayer.drawCard(result.cardIndex || -1, result.reduction || 0);
                                    render();
                                    await new Promise(r => setTimeout(r, 600));
                                }
                            } else if (result.type === 'BUFF_HAND') {
                                const handEl = document.getElementById('player-hand');
                                handEl.classList.add('hand-flash');
                                setTimeout(() => handEl.classList.remove('hand-flash'), 500);
                            } else if (result.type === 'BUFF_ALL') {
                                if (result.affected) {
                                    result.affected.forEach(aff => {
                                        const side = aff.unit.side || 'PLAYER'; // Default to player if side missing
                                        const boardId = side === 'OPPONENT' ? 'opp-board' : 'player-board';
                                        const targetEl = document.getElementById(boardId).children[aff.unit.index];
                                        if (targetEl) {
                                            triggerCombatEffect(targetEl, 'BUFF');
                                        }
                                    });
                                }
                                // Log AOE Buff
                                MatchHistory.add('PLAY', { player: "你", card: `${playedCard.name} (集體增益)` });
                            }
                        }
                    }


                    await resolveDeaths();

                } catch (err) {
                    logMessage(err.message);
                    render();
                }
            } else {
                // Return to hand visuals (already handled by cleaning up ghost)
                logMessage(UI_TEXT.PLAY_CANCELLED);
                render(); // Ensure correct state
            }
            return;
        }

        // Standard Attack
        const targetEl = document.elementFromPoint(e.clientX, e.clientY);
        const targetData = targetEl?.closest('[data-type]');
        if (targetData) {
            const type = targetData.dataset.type;
            // 修復：當目標是英雄時，index 為 undefined，parseInt 會返回 NaN
            // 改為攻擊英雄時設為 null
            const index = targetData.dataset.index ? parseInt(targetData.dataset.index) : null;

            if (type === 'HERO' && targetData.id === 'opp-hero'
                || type === 'MINION' && targetEl.closest('#opp-board')) {

                try {
                    // Pre-validation: Check if attack is legal before animating
                    gameState.validateAttack(attackerIndex, { type, index });

                    const sourceEl = document.getElementById('player-board').children[attackerIndex];
                    const attacker = gameState.currentPlayer.board[attackerIndex];
                    const damage = attacker ? attacker.attack : 0;

                    if (sourceEl && targetData) {
                        await animateAttack(sourceEl, targetData, damage);
                    }

                    // 取得攻擊者和目標名稱
                    const attackerName = getUnitName('PLAYER', attackerIndex, 'MINION');
                    const targetName = getUnitName(targetData.id === 'opp-hero' ? 'OPPONENT' : 'OPPONENT', index, type);

                    // 記錄普通攻擊
                    MatchHistory.add('NORMAL_ATTACK', {
                        attacker: attackerName,
                        target: targetName,
                        damage: damage
                    });

                    gameState.attack(attackerIndex, { type, index });

                    // PvP 模式：同步攻擊動作到 Firebase
                    if (isPvPMode && window.pvpManager) {
                        await window.pvpManager.syncGameAction('ATTACK', {
                            attackerIndex: attackerIndex,
                            targetType: type,
                            targetIndex: index  // 英雄時為 null，隨從時為數字
                        });
                        syncLocalStateToFirebase(); // 同步攻擊後的狀態 (HP)
                    }

                    render();
                    await resolveDeaths();
                } catch (err) {
                    logMessage(err.message);
                }
            }
        }
    } else if (isBattlecryTargeting) {


        const targetEl = document.elementFromPoint(e.clientX, e.clientY);
        const unitEl = targetEl?.closest('[data-type]');


        let target = null;
        if (unitEl) {
            const side = unitEl.id === 'player-hero' || unitEl.parentElement?.id === 'player-board' ? 'PLAYER' : 'OPPONENT';
            const type = unitEl.dataset.type;
            const idx = unitEl.dataset.index ? parseInt(unitEl.dataset.index) : -1;

            const targetInfo = {
                type: type,
                side: side,
                index: idx,
                category: unitEl.dataset.category || (type === 'HERO' ? '英雄' : ''),
                isLocked: unitEl.dataset.locked === 'true',
                cost: parseInt(unitEl.dataset.cost) || 0,
                attack: parseInt(unitEl.dataset.attack) || 0,
                health: parseInt(unitEl.dataset.health) || 0,
                currentHealth: (unitEl.dataset.currentHealth !== undefined) ? parseInt(unitEl.dataset.currentHealth) : (parseInt(unitEl.dataset.health) || 0)
            };

            if (isTargetEligible(battlecryTargetRule, targetInfo)) {
                target = targetInfo;
            } else {
                logMessage(UI_TEXT.INVALID_TARGET);
                // DO NOT clear targeting state, let user try again
                return;
            }
        } else {
            // Clicked background or non-unit -> Cancel
            cancelBattlecryTargeting();
            return;
        }

        // ONLY clear state if we have a valid target
        isBattlecryTargeting = false;
        dragLine.style.display = 'none'; // Critical: Hide line


        try {
            if (target) {
                // 1. Identify Source & Dest for Animation
                let sourceEl;
                if (battlecrySourceType === 'NEWS') {
                    // Source is Hand Card (it's hidden but element exists until render)
                    sourceEl = document.getElementById('player-hand').children[battlecrySourceIndex];
                } else {
                    // Source is Minion on Board (already placed)
                    sourceEl = document.getElementById('player-board').children[battlecrySourceIndex];
                }

                const destEl = target.type === 'HERO' ?
                    (target.side === 'OPPONENT' ? document.getElementById('opp-hero') : document.getElementById('player-hero')) :
                    (target.side === 'OPPONENT' ? document.getElementById('opp-board').children[target.index] : document.getElementById('player-board').children[target.index]);

                // 2. Animate BEFORE applying logic (so target is still alive)
                let effectType = 'DAMAGE';
                if (sourceEl && destEl) {
                    let color = '#ff0000'; // Default Damage Red

                    // Determine color based on card/mode
                    if (draggingMode === 'HEAL') {
                        color = '#43e97b';
                        effectType = (battlecryTargetRule?.type === 'HEAL_CATEGORY_BONUS') ? 'HEAL_ARROW' : 'HEAL';
                    }
                    else if (draggingMode === 'BUFF') { color = '#ffa500'; effectType = 'BUFF'; }
                    else if (draggingMode === 'BOUNCE') { color = '#a335ee'; effectType = 'BOUNCE'; }
                    else if (draggingMode === 'DESTROY') { color = '#000000'; effectType = 'DESTROY'; }
                    else if (battlecryTargetRule?.type === 'DESTROY' ||
                        battlecryTargetRule?.type === 'DESTROY_DAMAGED' ||
                        battlecryTargetRule?.type === 'DESTROY_LOW_ATTACK' ||
                        battlecryTargetRule?.type === 'DESTROY_HIGH_ATTACK' ||
                        battlecryTargetRule?.type === 'SET_DEATH_TIMER' ||
                        battlecryTargetRule?.type === 'DESTROY_LOCKED') {
                        color = '#000000';
                        effectType = 'DESTROY';
                    }

                    await animateAbility(sourceEl, destEl, color, effectType !== 'HEAL');
                    triggerCombatEffect(destEl, effectType);

                    // Impact Delay (Reduced for efficiency)
                    await new Promise(r => setTimeout(r, 400));
                }

                const sourceName = battlecrySourceType === 'NEWS' ?
                    (gameState.currentPlayer.hand[battlecrySourceIndex]?.name || "新聞") :
                    (gameState.currentPlayer.board[battlecrySourceIndex]?.name || "隨從");
                const destName = getUnitName(target.side, target.index, target.type);

                // 3. Execute Game Logic (Phase 2)
                let battlecryResult = null;
                if (battlecrySourceType === 'NEWS') {
                    // For News: Now we play it
                    const card = gameState.currentPlayer.hand[battlecrySourceIndex];
                    MatchHistory.add('PLAY', {
                        player: "你",
                        card: card.name
                    });
                    const outcome = gameState.playCard(battlecrySourceIndex, target);
                    battlecryResult = outcome.battlecryResult;

                    // PvP 模式：同步帶目標的新聞牌出牌
                    if (isPvPMode && window.pvpManager) {
                        // 計算效果值（含 News Power 加成）
                        let resolvedEffect = null;
                        if (card.keywords?.battlecry) {
                            const bc = card.keywords.battlecry;
                            const bonus = gameState.getNewsPower('PLAYER') || 0;
                            const effectValue = (bc.value || 0) + bonus;
                            resolvedEffect = {
                                type: bc.type,
                                value: effectValue,
                                stat: bc.stat || 'ALL'
                            };
                        }

                        await window.pvpManager.syncGameAction('PLAY_CARD', {
                            cardId: card.id,
                            handIndex: battlecrySourceIndex,
                            insertionIndex: -1,
                            targetType: target.type,
                            targetIndex: target.index,
                            targetSide: target.side,
                            resolvedEffect: resolvedEffect
                        });
                        syncLocalStateToFirebase(); // 同步出牌後的狀態 (Mana, HandSize)
                    }
                } else {
                    // For Minion: It's already pending on board, just resolve battlecry
                    const minionInfo = gameState.currentPlayer.board[battlecrySourceIndex];
                    if (minionInfo && minionInfo.keywords?.battlecry) {
                        battlecryResult = gameState.resolveBattlecry(minionInfo.keywords.battlecry, target, minionInfo);
                    }

                    // PvP 模式：同步帶目標的戰吼效果
                    if (isPvPMode && window.pvpManager) {
                        // 計算效果值（隨從戰吼不加 News Power，但仍傳遞以確保一致）
                        let resolvedEffect = null;
                        if (minionInfo?.keywords?.battlecry) {
                            const bc = minionInfo.keywords.battlecry;
                            resolvedEffect = {
                                type: bc.type,
                                value: bc.value || 0,
                                stat: bc.stat || 'ALL'
                            };
                        }

                        await window.pvpManager.syncGameAction('PLAY_CARD', {
                            cardId: minionInfo?.id,
                            handIndex: -1, // 已在場上
                            insertionIndex: battlecrySourceIndex,
                            targetType: target.type,
                            targetIndex: target.index,
                            targetSide: target.side,
                            resolvedEffect: resolvedEffect
                        });
                        syncLocalStateToFirebase(); // 同步出牌後的狀態 (Mana, HandSize)
                    }
                }

                // Check for special draw trigger (e.g. DAMAGE_AND_DRAW_IF_KILL)
                if (battlecryResult && battlecryResult.drew) {
                    render(); // Sync hand size after playing the card
                    await new Promise(r => setTimeout(r, 600));
                    gameState.currentPlayer.drawCard();
                    render();
                }

                // Log target effect after resolution
                console.log('[TARGETED BATTLECRY] Logging:', draggingMode, 'source:', sourceName, 'target:', destName);
                console.log('[TARGETED BATTLECRY] battlecrySourceType:', battlecrySourceType, 'battlecryTargetRule:', battlecryTargetRule);

                // 區分新聞牌和隨從
                const isNews = battlecrySourceType === 'NEWS';
                const bonus = isNews ? (gameState.getNewsPower(gameState.currentPlayer.side || 'PLAYER') || 0) : 0;
                const value = (battlecryTargetRule?.value || battlecryTargetRule?.bonus_value || 0) + bonus;

                console.log('[TARGETED BATTLECRY] isNews:', isNews, 'value:', value);

                if (draggingMode === 'HEAL' || effectType === 'HEAL') {
                    const eventType = isNews ? 'NEWS_HEAL' : 'BATTLECRY_HEAL';
                    MatchHistory.add(eventType, { source: sourceName, target: destName, value: value });
                } else if (draggingMode === 'DESTROY' || effectType === 'DESTROY') {
                    // 擊殺類型單獨處理
                    const eventType = isNews ? 'NEWS_DESTROY' : 'BATTLECRY_DESTROY';
                    MatchHistory.add(eventType, { source: sourceName, target: destName });
                } else if (draggingMode === 'DAMAGE' || effectType === 'DAMAGE') {
                    const eventType = isNews ? 'NEWS_DAMAGE' : 'BATTLECRY_DAMAGE';
                    MatchHistory.add(eventType, { source: sourceName, target: destName, value: value });
                }

                render();
                await resolveDeaths();

            } else {
                // Non-targeted logic (Fallback for Minions played without target if flow allows, or AOE)
                // Note: If battlecrySourceType is NEWS and target is null, we cancelled (handled in 'else' of outer block if exists, but here structure is try/catch)
                // Actually, earlier we checked 'if (target)'. If not target...
                // If it's a MINION with non-targeted battlecry (e.g. AOE), we should trigger it.

                if (battlecrySourceType === 'MINION') {
                    const minion = gameState.currentPlayer.board[battlecrySourceIndex];
                    if (minion && minion.keywords?.battlecry) {
                        gameState.resolveBattlecry(minion.keywords.battlecry, null);
                        render();
                        await resolveDeaths();

                        // Visuals for AOE
                        const bcType = minion.keywords.battlecry.type;
                        setTimeout(() => {
                            if (bcType === 'BUFF_ALL' || bcType === 'BUFF_CATEGORY') {
                                document.querySelectorAll('#player-board .minion').forEach(m => triggerCombatEffect(m, 'BUFF'));
                            } else if (bcType === 'HEAL_ALL_FRIENDLY') {
                                document.querySelectorAll('#player-board .minion').forEach(m => triggerCombatEffect(m, 'HEAL'));
                                triggerCombatEffect(document.getElementById('player-hero'), 'HEAL');
                            } else if (bcType === 'GIVE_DIVINE_SHIELD_ALL') {
                                document.querySelectorAll('#player-board .minion').forEach(m => triggerCombatEffect(m, 'BUFF'));
                            } else if (bcType === 'DAMAGE_RANDOM_FRIENDLY') {
                                document.querySelectorAll('#player-board .minion').forEach(m => triggerCombatEffect(m, 'DAMAGE'));
                            }
                        }, 100);
                    }
                }
                // If News and no target, we do nothing (cancel).
            }
        } catch (err) {
            logMessage(err.message);
            render(); // Reset UI
        }
    }
    currentInsertionIndex = -1;
}

// --- Targeting Helpers ---
function cancelBattlecryTargeting() {
    if (!isBattlecryTargeting) return;
    isBattlecryTargeting = false;
    dragLine.style.display = 'none';

    if (battlecrySourceType === 'MINION') {
        // Refund Minion: Remove from board, put back in hand
        const minion = gameState.currentPlayer.board.splice(battlecrySourceIndex, 1)[0];
        if (minion) {
            // Restore mana
            gameState.currentPlayer.mana.current += minion.cost;
            gameState.currentPlayer.hand.push(minion);
            logMessage(UI_TEXT.CANCEL_PLAY_REFUND);
        }
    } else {
        // News: Mana wasn't spent yet, just show card again
        const handCardEl = document.getElementById('player-hand').children[battlecrySourceIndex];
        if (handCardEl) handCardEl.style.opacity = '1';
        logMessage(UI_TEXT.PLAY_CANCELLED);
    }
    render();
}
function isTargetEligible(rule, targetInfo) {
    if (!rule || !targetInfo) return false;

    // Support both simple target rules and full battlecry objects
    const actualRule = rule.target || rule;
    const categoryToExclude = rule.target_category;

    // Category Exclusion check (e.g. Hsieh Chang-ting)
    if (categoryToExclude && rule.type === 'DAMAGE_NON_CATEGORY' && targetInfo.category === categoryToExclude) return false;

    // Category Inclusion check (e.g. S003 Great Recall)
    if (actualRule.target_category_includes) {
        if (!targetInfo.category || !targetInfo.category.includes(actualRule.target_category_includes)) return false;
    }

    // Cost checks (if applicable)
    if (actualRule.min_cost !== undefined && targetInfo.cost < actualRule.min_cost) return false;
    if (actualRule.max_cost !== undefined && targetInfo.cost > actualRule.max_cost) return false;

    // Attack checks for DESTROY_LOW_ATTACK and DESTROY_HIGH_ATTACK
    if (rule.type === 'DESTROY_LOW_ATTACK') {
        if (targetInfo.attack === undefined || targetInfo.attack > rule.value) return false;
    }
    if (rule.type === 'DESTROY_HIGH_ATTACK') {
        if (targetInfo.attack === undefined || targetInfo.attack < rule.value) return false;
    }

    // Damaged check for DESTROY_DAMAGED
    if (rule.type === 'DESTROY_DAMAGED') {
        if (targetInfo.currentHealth === undefined || targetInfo.health === undefined) return false;
        if (targetInfo.currentHealth >= targetInfo.health) return false; // Not damaged
    }

    // Locked check for DESTROY_LOCKED
    if (rule.type === 'DESTROY_LOCKED') {
        if (typeof isDebugMode !== 'undefined' && isDebugMode) console.log(`[APP] checking DESTROY_LOCKED: targetInfo.isLocked = ${targetInfo.isLocked}`, targetInfo);
        if (!targetInfo.isLocked) return false;
    }


    // Side check
    if (actualRule.side === 'ENEMY' && targetInfo.side !== 'OPPONENT') return false;
    if (actualRule.side === 'FRIENDLY' && targetInfo.side !== 'PLAYER') return false;
    // If side is 'ALL' or undefined, allow both sides

    // Type check
    if (!actualRule.type || actualRule.type === 'ANY' || actualRule.type === 'ALL') {
        return true;
    }

    if (actualRule.type === 'MINION' && targetInfo.type !== 'MINION') return false;
    if (actualRule.type === 'HERO' && targetInfo.type !== 'HERO') return false;

    return true;
}

function getValidTargets(rule) {
    if (!rule) return [];
    const targets = [];

    // Helper to format consistent target info for comparison
    const createTargetInfo = (unit, side, type, index) => ({
        type: type,
        side: side,
        index: index,
        category: unit.category || (type === 'HERO' ? '英雄' : ''),
        isLocked: unit.lockedTurns > 0,
        cost: unit.cost || 0,
        attack: unit.attack || 0,
        health: unit.health || unit.maxHp || 0,
        currentHealth: unit.currentHealth !== undefined ? unit.currentHealth : (unit.hp !== undefined ? unit.hp : unit.health)
    });

    // Check Players
    const p1Hero = createTargetInfo(gameState.players[0].hero, 'PLAYER', 'HERO', -1);
    const p2Hero = createTargetInfo(gameState.players[1].hero, 'OPPONENT', 'HERO', -1);

    if (isTargetEligible(rule, p1Hero)) targets.push(p1Hero);
    if (isTargetEligible(rule, p2Hero)) targets.push(p2Hero);

    // Check Player Board
    gameState.players[0].board.forEach((m, i) => {
        const info = createTargetInfo(m, 'PLAYER', 'MINION', i);
        if (isTargetEligible(rule, info)) targets.push(info);
    });

    // Check Opponent Board
    gameState.players[1].board.forEach((m, i) => {
        const info = createTargetInfo(m, 'OPPONENT', 'MINION', i);
        if (isTargetEligible(rule, info)) targets.push(info);
    });

    return targets;
}

function startBattlecryTargeting(sourceIndex, x, y, mode = 'DAMAGE', targetRule = null, sourceType = 'MINION') {
    isBattlecryTargeting = true;
    battlecrySourceIndex = sourceIndex;
    battlecrySourceType = sourceType;
    draggingMode = mode;
    battlecryTargetRule = targetRule;

    dragLine.classList.add('battlecry-line');
    if (mode === 'HEAL') dragLine.classList.add('heal-line');
    if (mode === 'BUFF') dragLine.classList.add('buff-line');
    if (mode === 'BOUNCE') dragLine.classList.add('bounce-line');
    if (mode === 'DESTROY') dragLine.classList.add('destroy-line');

    dragLine.setAttribute('x1', x);
    dragLine.setAttribute('y1', y);
    dragLine.setAttribute('x2', x);
    dragLine.setAttribute('y2', y);
    dragLine.style.display = 'block';

    const msg = sourceType === 'NEWS' ? UI_TEXT.SPELL_CHOOSE_TARGET : UI_TEXT.BATTLECRY_CHOOSE_TARGET;
    logMessage(msg);
}

/**
 * Handles visual effects for battlecries (Now handled in onDragEnd)
 */
async function handleBattlecryVisuals(sourceEl, targetEl) {
    if (sourceEl && targetEl) {
        await animateAbility(sourceEl, targetEl, '#43e97b'); // Green arrow
    }
}

/**
 * Animates a projectile from start to end.
 */
function animateAbility(fromEl, toEl, color, shouldShake = true) {
    return new Promise(resolve => {
        const rectFrom = fromEl.getBoundingClientRect();
        const rectTo = toEl.getBoundingClientRect();

        const projectile = document.createElement('div');
        projectile.className = 'ability-projectile';
        // Set dynamic color for ::after element
        if (color) projectile.style.setProperty('--projectile-color', color);
        projectile.style.left = `${rectFrom.left + rectFrom.width / 2}px`;
        projectile.style.top = `${rectFrom.top + rectFrom.height / 2}px`;

        // Calculate Angle
        const dx = (rectTo.left + rectTo.width / 2) - (rectFrom.left + rectFrom.width / 2);
        const dy = (rectTo.top + rectTo.height / 2) - (rectFrom.top + rectFrom.height / 2);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        projectile.style.transform = `rotate(${angle}deg)`;

        document.body.appendChild(projectile);

        // Transition
        setTimeout(() => {
            projectile.style.transition = 'all 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
            projectile.style.left = `${rectTo.left + rectTo.width / 2}px`;
            projectile.style.top = `${rectTo.top + rectTo.height / 2}px`;
            projectile.style.opacity = '1';
        }, 10);

        setTimeout(() => {
            // Shake Target
            if (shouldShake) {
                toEl.classList.add('shaking');
                setTimeout(() => toEl.classList.remove('shaking'), 500);
            }

            projectile.remove();
            resolve();
        }, 550);
    });
}

/**
 * Animates a card being discarded (Thanos-style disintegration).
 */
async function animateDiscard(cardEl) {
    return new Promise(resolve => {
        const rect = cardEl.getBoundingClientRect();
        const clone = cardEl.cloneNode(true);
        clone.style.position = 'fixed';
        clone.style.top = rect.top + 'px';
        clone.style.left = rect.left + 'px';
        clone.style.width = rect.width + 'px';
        clone.style.height = rect.height + 'px';
        clone.style.zIndex = '10000';
        clone.style.margin = '0';
        clone.style.transition = 'opacity 0.8s ease-in';
        clone.style.pointerEvents = 'none';
        document.body.appendChild(clone);

        // Hide original card element
        cardEl.style.visibility = 'hidden';

        // Force reflow
        clone.offsetHeight;

        // Generate Particles
        const particleCount = 80; // Increased
        const colors = ['#a335ee', '#444444', '#888888', '#ffffff'];

        for (let i = 0; i < particleCount; i++) {
            const p = document.createElement('div');
            p.className = 'disintegrate-particle';

            // Random color from set
            p.style.background = colors[Math.floor(Math.random() * colors.length)];

            // Random start pos within card
            const startX = rect.left + Math.random() * rect.width;
            const startY = rect.top + Math.random() * rect.height;

            p.style.left = startX + 'px';
            p.style.top = startY + 'px';

            // Random size (some tiny, some larger)
            const size = 1 + Math.random() * 5;
            p.style.width = size + 'px';
            p.style.height = size + 'px';

            // Random trajectory (Expanding sphere + Floating UP)
            const angle = Math.random() * Math.PI * 2;
            const dist = 50 + Math.random() * 100;
            const dx = Math.cos(angle) * dist + (Math.random() - 0.5) * 100;
            const dy = Math.sin(angle) * dist - (200 + Math.random() * 300); // Heavy UP bias
            const dr = (Math.random() - 0.5) * 720;

            p.style.setProperty('--dx', dx + 'px');
            p.style.setProperty('--dy', dy + 'px');
            p.style.setProperty('--dr', dr + 'deg');

            // Staggered delay for "crumbling" look
            p.style.animationDelay = (Math.random() * 0.6) + 's';

            document.body.appendChild(p);

            // Remove after animation
            setTimeout(() => p.remove(), 2100);
        }

        // Fade out the main card body slightly slower than animation start
        setTimeout(() => {
            clone.style.opacity = '0';
        }, 100);

        setTimeout(() => {
            clone.remove();
            resolve();
        }, 1500);
    });
}

/**
 * Animates a card flying from start element to end element and slamming.
 * @param {HTMLElement} fromEl 
 * @param {HTMLElement} toEl 
 * @param {number} damage
 */
function animateAttack(fromEl, toEl, damage = 0) {
    return new Promise(resolve => {
        const rectFrom = fromEl.getBoundingClientRect();
        const rectTo = toEl.getBoundingClientRect();

        // Create Clone
        const clone = fromEl.cloneNode(true);
        clone.classList.add('animating-attack');

        // Remove specific styles that might interfere with attack visual
        clone.classList.remove('taunt');
        clone.classList.remove('sleeping');
        clone.classList.remove('can-attack');
        clone.classList.remove('divine-shield'); // Fix: Remove shield visual during flight
        clone.style.borderRadius = '12px'; // Standard shape for attack flight

        // Remove stat-pop animation classes to keep stats stable during attack
        const statElements = clone.querySelectorAll('.stat-atk, .stat-hp');
        statElements.forEach(stat => stat.classList.remove('stat-pop'));

        // Calculate current game scale to ensure clone matches visual size
        const scaler = document.getElementById('game-content-scaler');
        // Retrieve scale from transform string "scale(0.5)" -> 0.5
        const scaleMatch = scaler && scaler.style.transform ? scaler.style.transform.match(/scale\(([^)]+)\)/) : null;
        const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;

        // Initial Position
        clone.style.top = `${rectFrom.top}px`;
        clone.style.left = `${rectFrom.left}px`;
        // Restore original (unscaled) dimensions so content inside isn't cramped/large
        clone.style.width = `${rectFrom.width / currentScale}px`;
        clone.style.height = `${rectFrom.height / currentScale}px`;
        clone.style.margin = '0'; // Clear margins

        // Apply the same scale as the game container
        clone.style.transformOrigin = 'top left';
        clone.style.transform = `scale(${currentScale})`;

        document.body.appendChild(clone);

        // Force Reflow
        void clone.offsetWidth;

        // Target Position
        // Center to Center
        const centerX = rectTo.left + rectTo.width / 2 - rectFrom.width / 2;
        const centerY = rectTo.top + rectTo.height / 2 - rectFrom.height / 2;

        clone.style.top = `${centerY}px`;
        clone.style.left = `${centerX}px`;
        // Combine scales for impact effect (Game Scale * 1.2)
        clone.style.transform = `scale(${currentScale * 1.2})`; // Bigger on impact

        // On Transition End (Impact)
        setTimeout(() => {
            // Play attack sound based on damage
            if (window.audioManager) {
                const sfxPath = damage >= 7 ? 'assets/audio/sfx/HeavyHit.mp3' : 'assets/audio/sfx/LightHit.mp3';
                audioManager.playSFX(sfxPath);
            }

            // Shake Target
            toEl.classList.add('shaking');
            setTimeout(() => toEl.classList.remove('shaking'), 500);

            // Trigger Combat Effect (Slash)
            triggerCombatEffect(toEl, 'DAMAGE');
            spawnDustEffect(toEl, 0.5); // Minor impact dust

            // Cleanup Clone
            setTimeout(() => {
                clone.remove();
                resolve();
            }, 100);
        }, 450); // Slightly longer than CSS to ensure completion
    });
}

function logMessage(msg) {
    const log = document.getElementById('message-log');
    if (log) {
        const line = document.createElement('div');
        line.innerText = msg;
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
    }

    // Also show as a visual alert if it's a known UI_TEXT or error
    if (msg) showBattleAlert(msg);
}

function showBattleAlert(text) {
    // Prevent showing duplicated AI thinking/plays in the center if we want to keep it clean
    if (text.includes(UI_TEXT.OPPONENT_THINKING) || text.includes(UI_TEXT.OPPONENT_PLAYS)) return;

    const alert = document.createElement('div');
    alert.className = 'battle-alert';
    alert.innerText = text;
    document.body.appendChild(alert);

    // Cleanup after animation
    setTimeout(() => alert.remove(), 2000);
}

/**
 * --- GOLD STANDARD DRAW ANIMATION ---
 * This function handles the "fly from deck to hand" visuals.
 * DO NOT change the timing or bezier curve without explicit request.
 * Reference for S001 (Perfect Animation).
 * @param {HTMLElement} cardEl The final destination element in hand
 */
function animateCardFromDeck(cardObj, initialCardEl) {
    const deckEl = document.getElementById('player-deck');
    if (!deckEl) return;

    // Track this card as animating
    animatingDrawCards.add(cardObj);

    // Play card draw sound effect (only for player)
    if (window.audioManager) {
        audioManager.playSFX('assets/audio/sfx/card-draw.mp3');
    }

    // Initial hide of the destination element if it exists
    if (initialCardEl) initialCardEl.style.opacity = '0';

    // Wait for two frames to ensure the element is committed to DOM and has stable coordinates
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            // Find the CURRENT element in hand for this card, as a re-render might have happened
            if (!gameState || !gameState.players[0]) return;
            const p = gameState.players[0];
            const idx = p.hand.indexOf(cardObj);
            if (idx === -1) {
                animatingDrawCards.delete(cardObj);
                return;
            }

            const handEl = document.getElementById('player-hand');
            const targetEl = handEl ? handEl.children[idx] : null;

            if (!targetEl) {
                animatingDrawCards.delete(cardObj);
                render();
                return;
            }

            const deckRect = deckEl.getBoundingClientRect();
            const cardRect = targetEl.getBoundingClientRect();

            // Safety check: if coordinates are still zero, layout fails. Skip animation.
            if (cardRect.width === 0 || (cardRect.left === 0 && cardRect.top === 0)) {
                animatingDrawCards.delete(cardObj);
                render();
                return;
            }

            const clone = targetEl.cloneNode(true);
            clone.style.position = 'fixed';
            clone.style.left = '0';
            clone.style.top = '0';
            clone.style.width = `${targetEl.offsetWidth || 100}px`;
            clone.style.height = `${targetEl.offsetHeight || 140}px`;
            clone.style.zIndex = '9999';
            clone.style.margin = '0';

            const startX = deckRect.left;
            const startY = deckRect.top;
            const endX = cardRect.left;
            const endY = cardRect.top;

            clone.style.transform = `translate(${startX}px, ${startY}px) scale(0.5)`;
            clone.style.transition = 'none';
            clone.style.pointerEvents = 'none';
            clone.style.opacity = '1';
            clone.className = targetEl.className;

            document.body.appendChild(clone);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    clone.style.transition = 'transform 0.6s cubic-bezier(0.18, 0.89, 0.32, 1.15), opacity 0.3s ease';
                    clone.style.transform = `translate(${endX}px, ${endY}px) scale(1)`;
                });
            });

            const cleanup = (e) => {
                if (e.propertyName === 'transform' || e.type === 'timeout') {
                    clone.remove();
                    animatingDrawCards.delete(cardObj);
                    // Final render to restore visibility in the current DOM
                    render();
                    clone.removeEventListener('transitionend', cleanup);
                    clearTimeout(failSafe);
                }
            };

            const failSafe = setTimeout(() => cleanup({ type: 'timeout' }), 1000);
            clone.addEventListener('transitionend', cleanup);
        });
    });
}

/**
 * Shows a large 3D preview of the card in the center before it hits the board.
 */
async function showCardPlayPreview(card, isAI = false, targetEl = null) {
    const overlay = document.getElementById('play-preview-overlay');
    overlay.innerHTML = '';
    overlay.style.display = 'flex';

    // Create a big version of the card manually to ensure perfect scaling
    const rarityClass = card.rarity ? card.rarity.toLowerCase() : 'common';
    const cardEl = document.createElement('div');
    cardEl.className = `card rarity-${rarityClass} preview-card-3d ${card.type === 'NEWS' ? 'news-card' : ''}`;

    // We override styles for the 3D preview
    cardEl.style.width = '280px';
    cardEl.style.height = '410px';
    cardEl.style.fontSize = '20px'; // Adjusted

    const base = CARD_DATA.find(c => c.id === card.id) || card;
    let statsHtml = '';
    if (card.attack !== undefined && card.health !== undefined) {
        const atkClass = card.attack > base.attack ? 'stat-buffed' : (card.attack < base.attack ? 'stat-damaged' : '');
        const hpClass = (card.currentHealth !== undefined && card.currentHealth < card.health) ? 'stat-damaged' : (card.health > base.health ? 'stat-buffed' : '');
        const hpValue = card.currentHealth !== undefined ? card.currentHealth : card.health;

        // 屬性在最下方 (Stats at bottom) - Revised padding for more description space
        statsHtml = `
        <div class="minion-stats" style="margin-top: auto; padding: 5px 15px 10px 15px; display: flex; justify-content: space-between; width: 100%;">
            <span class="stat-atk ${atkClass}" style="width: 60px; height: 60px; font-size: 28px;"><span>${card.attack}</span></span>
            <span class="stat-hp ${hpClass}" style="width: 60px; height: 60px; font-size: 28px;">${hpValue}</span>
        </div>`;
    }

    cardEl.style.padding = '8px'; // Slightly tighter padding
    cardEl.style.justifyContent = 'flex-start'; // Ensure content starts at top

    // Define Art HTML inline to ensure custom margin applies
    const customArtHtml = card.image ?
        `<div class="card-art" style="width: 100%; height: 150px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 4px; margin: 10px auto 5px auto; border: 1px solid rgba(255,255,255,0.2);"></div>` :
        `<div class="card-art" style="width: 100%; height: 100px; background: #333; margin: 10px auto 5px auto; border-radius: 4px;"></div>`;

    const bonusPreview = (gameState && (card.side || 'PLAYER')) ? gameState.getNewsPower(card.side || 'PLAYER') : 0;
    const bcTypePreview = card.keywords?.battlecry?.type || '';
    const isDamagePreview = bcTypePreview.includes('DAMAGE');
    const isHealPreview = bcTypePreview.includes('HEAL') || bcTypePreview.includes('RECOVER');
    const isExcludedPreview = bcTypePreview.includes('DRAW') || bcTypePreview.includes('COST') || bcTypePreview.includes('REDUCE');
    const effectiveBonusPreview = (card.type === 'NEWS' && (isDamagePreview || isHealPreview) && !isExcludedPreview) ? bonusPreview : 0;

    const actualCostPreview = (gameState && typeof gameState.getCardActualCost === 'function') ? gameState.getCardActualCost(card) : card.cost;
    const isReducedPreview = actualCostPreview < base.cost || card.isReduced;
    const costClassPreview = isReducedPreview ? 'cost-reduced' : '';

    cardEl.innerHTML = `
        <div style="position: relative; display: flex; align-items: center; width: 100%; margin-bottom: 5px; height: 40px;">
            <div class="card-cost ${costClassPreview}" style="position: relative; width:30px; height:30px; font-size:16px; flex-shrink: 0; z-index: 10; transform: rotate(45deg); margin-left: 5px;"><span>${actualCostPreview}</span></div>
            <div class="card-title" style="font-size:28px; position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); margin: 0; text-align: center; text-shadow: 0 0 5px black; z-index: 5;">${card.name}</div>
        </div>
        ${customArtHtml}
        <div class="card-category" style="font-size:16px; padding: 2px 10px; margin-bottom: 5px; flex-shrink: 0; text-align: center; color: #aaa;">${card.category || ""}</div>
        <div class="card-desc" style="font-size:18px; padding: 0 10px; line-height: 1.35; height: auto; flex-grow: 1; overflow: hidden; text-align: center; white-space: pre-wrap;">${formatDesc(card.description, effectiveBonusPreview, card.type === 'NEWS')}</div>
        ${statsHtml}
    `;

    overlay.appendChild(cardEl);

    // AI cards might need a slight delay to be noticed
    await new Promise(r => setTimeout(r, 800));

    // Slam phase
    cardEl.classList.add('slamming');

    // Board shake and dust - ONLY for minions
    if (card.type === 'MINION') {
        const boardId = isAI ? 'opp-board' : 'player-board';
        const boardEl = document.getElementById(boardId);
        if (boardEl) {
            setTimeout(() => {
                boardEl.classList.remove('board-slam');
                void boardEl.offsetWidth;
                boardEl.classList.add('board-slam');

                // Intensify dust for high cost cards - spawn at PREVIEW CARD or TARGET SLOT
                const intensity = card.cost >= 7 ? 2.5 : 1;
                const smokeAnchor = targetEl || boardEl || cardEl;
                spawnDustEffect(smokeAnchor, intensity);

                // Play landing sound
                if (window.audioManager) {
                    const isHighCost = card.cost >= 8;
                    const sfxPath = isHighCost
                        ? 'assets/audio/sfx/HighCostMionion.mp3'
                        : 'assets/audio/sfx/LowCostMionion.mp3';
                    audioManager.playSFX(sfxPath, isHighCost ? 1.02 : 1.0);
                }

                setTimeout(() => boardEl.classList.remove('board-slam'), 500);
            }, 300); // Wait for card to hit the board
        }
    }

    await new Promise(r => setTimeout(r, 400));

    overlay.style.display = 'none';
    overlay.innerHTML = '';
}

/**
 * Spawns dust particles on a target element (board).
 */
function spawnDustEffect(targetEl, intensity = 1) {
    const rect = targetEl.getBoundingClientRect();
    const cloud = document.createElement('div');
    cloud.className = 'dust-cloud';
    cloud.style.left = `${rect.left + rect.width / 2}px`;
    cloud.style.top = `${rect.top + rect.height * 0.8}px`; // Bottom of element
    cloud.style.zIndex = "45000"; // Below preview card
    document.body.appendChild(cloud);

    const count = Math.floor(15 * intensity);
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'dust-particle';
        const angle = Math.random() * Math.PI * 2;
        const dist = (60 + Math.random() * 100) * (intensity > 1 ? 1.8 : 1);
        p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
        p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
        const size = (15 + Math.random() * 25) * (intensity > 1 ? 1.6 : 1);
        p.style.width = p.style.height = `${size}px`;
        p.style.backgroundColor = 'rgba(200, 200, 200, 0.4)';
        cloud.appendChild(p);
    }
    setTimeout(() => cloud.remove(), 1000);
}

/**
 * Shatters a minion element into fragments.
 */
function animateShatter(el) {
    return new Promise(async resolve => {
        el.classList.add('dying');

        // Delay death sound to play after hit sound
        setTimeout(() => {
            if (window.audioManager) {
                audioManager.playSFX('assets/audio/sfx/MionionDeath.mp3');
            }
        }, 250);

        await new Promise(r => setTimeout(r, 400));

        const rect = el.getBoundingClientRect();
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = `${rect.left}px`;
        container.style.top = `${rect.top}px`;
        container.style.width = `${rect.width}px`;
        container.style.height = `${rect.height}px`;
        container.style.pointerEvents = 'none';
        container.style.zIndex = '2000';
        document.body.appendChild(container);

        el.style.visibility = 'hidden';

        const cols = 4, rows = 5;
        const fragW = rect.width / cols;
        const fragH = rect.height / rows;
        const artEl = el.querySelector('.minion-art');
        const bgImg = artEl ? artEl.style.backgroundImage : null;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const frag = document.createElement('div');
                frag.className = 'shatter-fragment';
                frag.style.width = `${fragW}px`;
                frag.style.height = `${fragH}px`;
                frag.style.left = `${c * fragW}px`;
                frag.style.top = `${r * fragH}px`;

                if (bgImg) {
                    frag.style.backgroundImage = bgImg;
                    frag.style.backgroundSize = `${rect.width}px ${rect.height}px`;
                    frag.style.backgroundPosition = `-${c * fragW}px -${r * fragH}px`;
                } else {
                    frag.style.backgroundColor = '#333';
                    frag.style.backgroundImage = 'linear-gradient(135deg, #444, #111)';
                }

                const angle = Math.random() * Math.PI * 2;
                const dist = 50 + Math.random() * 150;
                frag.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
                frag.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
                frag.style.setProperty('--dr', `${(Math.random() - 0.5) * 600}deg`);

                container.appendChild(frag);
            }
        }

        setTimeout(() => {
            container.remove();
            resolve();
        }, 800);
    });
}

/**
 * Spawns a floating combat effect on a unit.
 * @param {HTMLElement} el The target element
 * @param {string} type 'DAMAGE', 'HEAL', or 'BUFF'
 */
function triggerCombatEffect(el, type) {
    if (!el) return;
    const container = document.createElement('div');
    container.className = 'combat-effect';

    if (type === 'DAMAGE') {
        const slash = document.createElement('div');
        slash.className = 'slash-effect';
        container.appendChild(slash);
    } else if (type === 'HEAL') {
        const count = 6;
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'heal-particle';
            p.innerText = '+';
            p.style.left = `${Math.random() * 60 + 20}%`;
            p.style.top = `${Math.random() * 60 + 20}%`;
            p.style.fontSize = `${16 + Math.random() * 14}px`;
            p.style.animationDelay = `${Math.random() * 0.4}s`;
            container.appendChild(p);
        }
    } else if (type === 'BUFF') {
        const count = 5;
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'buff-particle';
            p.innerText = '↑';
            p.style.left = `${Math.random() * 60 + 20}%`;
            p.style.top = `${Math.random() * 60 + 20}%`;
            p.style.fontSize = `${18 + Math.random() * 12}px`;
            p.style.animationDelay = `${Math.random() * 0.4}s`;
            container.appendChild(p);
        }
    } else if (type === 'DESTROY') {
        // Dark destruction effect
        const count = 8;
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'buff-particle';
            p.innerText = '💀';
            p.style.color = '#000000';
            p.style.textShadow = '0 0 10px #ff0000, 0 0 20px #000000';
            p.style.left = `${Math.random() * 60 + 20}%`;
            p.style.top = `${Math.random() * 60 + 20}%`;
            p.style.fontSize = `${20 + Math.random() * 16}px`;
            p.style.animationDelay = `${Math.random() * 0.3}s`;
            container.appendChild(p);
        }
    } else if (type === 'HEAL_ARROW') {
        // Mix of arrows and pluses, colored green
        const count = 8;
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            const isArrow = i % 2 === 0;
            p.className = isArrow ? 'buff-particle' : 'heal-particle';
            p.innerText = isArrow ? '↑' : '+';
            p.style.color = '#00ff00';
            p.style.textShadow = '0 0 10px #00ff00';
            p.style.left = `${Math.random() * 60 + 20}%`;
            p.style.top = `${Math.random() * 60 + 20}%`;
            p.style.fontSize = `${18 + Math.random() * 12}px`;
            p.style.animationDelay = `${Math.random() * 0.3}s`;
            container.appendChild(p);
        }
    } else if (type === 'BOUNCE') {
        const count = 3;
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.className = 'buff-particle'; // Re-use class for basic float, but override color/text
            p.innerText = '↩';
            p.style.color = '#a335ee';
            p.style.textShadow = '0 0 5px #a335ee';
            p.style.left = `${Math.random() * 60 + 20}%`;
            p.style.top = `${Math.random() * 60 + 20}%`;
            p.style.fontSize = `${20 + Math.random() * 12}px`;
            p.style.animationDelay = `${Math.random() * 0.4}s`;
            container.appendChild(p);
        }
    }

    el.appendChild(container);
    // Ensure visibility
    container.style.display = 'flex';
    setTimeout(() => {
        container.remove();
    }, 1000);
}

// Global listeners to lock right-click menu and handle targeting cancellation
document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (isBattlecryTargeting) {
        cancelBattlecryTargeting();
    }
    return false;
});

// Start
init();

function showToast(message) {
    let toast = document.getElementById('toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

function showTurnAnnouncement(text) {
    const overlay = document.getElementById('turn-announcement-overlay');
    const textEl = overlay.querySelector('.turn-text');
    if (!textEl) return;

    textEl.innerText = text;

    overlay.style.display = 'flex';
    // Force reflow
    void overlay.offsetWidth;
    overlay.classList.add('active');

    setTimeout(() => {
        overlay.classList.remove('active');
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 300); // Match transition duration
    }, 1500); // Show for 1.5s
}

function showCustomAlert(message) {
    return new Promise(resolve => {
        const modal = document.getElementById('custom-modal');
        const msgEl = document.getElementById('custom-modal-message');
        const confirmBtn = document.getElementById('btn-custom-confirm');
        const cancelBtn = document.getElementById('btn-custom-cancel');

        msgEl.innerText = message;
        cancelBtn.style.display = 'none'; // Alert only has OK
        modal.style.display = 'flex';

        confirmBtn.onclick = () => {
            modal.style.display = 'none';
            resolve();
        };
    });
}

function showCustomConfirm(message) {
    return new Promise(resolve => {
        const modal = document.getElementById('custom-modal');
        const msgEl = document.getElementById('custom-modal-message');
        const confirmBtn = document.getElementById('btn-custom-confirm');
        const cancelBtn = document.getElementById('btn-custom-cancel');

        msgEl.innerHTML = message;
        cancelBtn.style.display = 'inline-block'; // Confirm has Cancel
        modal.style.display = 'flex';

        confirmBtn.onclick = () => {
            modal.style.display = 'none';
            resolve(true);
        };

        cancelBtn.onclick = () => {
            modal.style.display = 'none';
            resolve(false);
        };
    });
}

/**
 * Triggers a full-board healing animation.
 * @param {boolean} isPlayer Whether to heal player board or opponent board
 */
async function triggerFullBoardHealAnimation(isPlayer) {
    const boardId = isPlayer ? 'player-board' : 'opp-board';
    const boardEl = document.getElementById(boardId);
    if (!boardEl) return;

    // 1. Board Flash
    boardEl.classList.remove('board-heal-flash');
    void boardEl.offsetWidth; // Force reflow
    boardEl.classList.add('board-heal-flash');
    setTimeout(() => boardEl.classList.remove('board-heal-flash'), 1500);

    // 2. Background Particles爆炸
    const rect = boardEl.getBoundingClientRect();
    const particleCount = 20;
    for (let i = 0; i < particleCount; i++) {
        const p = document.createElement('div');
        p.className = 'bg-heal-particle';
        p.innerText = '+';

        // Random position within the board area
        const x = rect.left + Math.random() * rect.width;
        const y = rect.top + Math.random() * rect.height;

        p.style.left = `${x}px`;
        p.style.top = `${y}px`;

        // Random size and delay
        p.style.fontSize = `${20 + Math.random() * 20}px`;
        p.style.animationDelay = `${Math.random() * 0.5}s`;

        document.body.appendChild(p);
        setTimeout(() => p.remove(), 2500);
    }
}

/**
 * Triggers a full-board bounce animation (Return to hand).
 * @param {boolean} isPlayer Whether to bounce player board or opponent board
 */
async function triggerFullBoardBounceAnimation(isPlayer) {
    const boardId = isPlayer ? 'player-board' : 'opp-board';
    const boardEl = document.getElementById(boardId);
    if (!boardEl) return;

    // 1. Board Flash (Purple Neon)
    boardEl.classList.remove('board-purple-flash');
    void boardEl.offsetWidth; // Force reflow
    boardEl.classList.add('board-purple-flash');
    setTimeout(() => boardEl.classList.remove('board-purple-flash'), 1500);

    // 2. Background Particles (Rotation Arrows)
    const rect = boardEl.getBoundingClientRect();
    const particleCount = 20;
    const arrowChars = ['↻', '↺', '↩'];
    for (let i = 0; i < particleCount; i++) {
        const p = document.createElement('div');
        p.className = 'bg-bounce-particle';
        p.innerText = arrowChars[Math.floor(Math.random() * arrowChars.length)];

        // Random position within the board area
        const x = rect.left + Math.random() * rect.width;
        const y = rect.top + Math.random() * rect.height;

        p.style.left = `${x}px`;
        p.style.top = `${y}px`;

        // Random size and delay
        p.style.fontSize = `${24 + Math.random() * 24}px`;
        p.style.animationDelay = `${Math.random() * 0.6}s`;

        document.body.appendChild(p);
        setTimeout(() => p.remove(), 2500);
    }
}

/**
 * Triggers the 921 Earthquake animation.
 */
async function triggerEarthquakeAnimation() {
    const playerBoard = document.getElementById('player-board');
    const oppBoard = document.getElementById('opp-board');
    const boards = [playerBoard, oppBoard].filter(b => b);
    const gameContainer = document.getElementById('game-container');

    // 1. Screen Shake
    gameContainer.classList.add('screen-quake');
    setTimeout(() => gameContainer.classList.remove('screen-quake'), 2000);

    // 2. Board Flash & Fracture
    boards.forEach(boardEl => {
        boardEl.classList.remove('board-red-flash');
        void boardEl.offsetWidth; // Force reflow
        boardEl.classList.add('board-red-flash');
        setTimeout(() => boardEl.classList.remove('board-red-flash'), 1500);

        // Fracture Overlay
        let fracture = boardEl.querySelector('.fracture-overlay');
        if (!fracture) {
            fracture = document.createElement('div');
            fracture.className = 'fracture-overlay';
            boardEl.appendChild(fracture);
        }

        void fracture.offsetWidth;
        fracture.classList.add('active');
        setTimeout(() => fracture.classList.remove('active'), 2500);
    });

    // 3. Dust Particles
    const rect = gameContainer.getBoundingClientRect();
    const particleCount = 30;
    for (let i = 0; i < particleCount; i++) {
        const p = document.createElement('div');
        p.className = 'bg-bounce-particle'; // Reuse particle style
        p.innerText = '•'; // Dust/Debris
        p.style.color = '#555';
        p.style.textShadow = 'none';

        const x = rect.left + Math.random() * rect.width;
        const y = rect.top + Math.random() * rect.height;

        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        p.style.fontSize = `${10 + Math.random() * 20}px`;
        p.style.animation = `arrow-swirl-rise ${1 + Math.random()}s ease-in forwards`;
        p.style.animationDelay = `${Math.random() * 0.5}s`;

        document.body.appendChild(p);
        setTimeout(() => p.remove(), 2000);
    }
}

/**
 * 武漢肺炎：毒氣動畫
 */
async function triggerPoisonGasAnimation() {
    const overlay = document.createElement('div');
    overlay.className = 'poison-gas-overlay gas-active';
    document.body.appendChild(overlay);

    // Add some random gas clouds for depth
    for (let i = 0; i < 15; i++) {
        const cloud = document.createElement('div');
        cloud.className = 'gas-cloud';
        const size = 100 + Math.random() * 200;
        cloud.style.width = `${size}px`;
        cloud.style.height = `${size}px`;
        cloud.style.left = `${Math.random() * 100}%`;
        cloud.style.top = `${Math.random() * 100}%`;
        cloud.style.animation = `poison-gas-spread ${2 + Math.random()}s ease-in-out forwards`;
        overlay.appendChild(cloud);
    }

    setTimeout(() => overlay.remove(), 3000);
}

/**
 * 查水表：波紋擴散動畫
 */
async function triggerRippleDiffusionAnimation(isPlayer = true) {
    const sourceHero = isPlayer ? document.getElementById('player-hero') : document.getElementById('opp-hero');
    const targetBoard = isPlayer ? document.getElementById('opp-board') : document.getElementById('player-board');
    if (!sourceHero || !targetBoard) return;

    const sRect = sourceHero.getBoundingClientRect();
    const centerX = sRect.left + sRect.width / 2;
    const centerY = sRect.top + sRect.height / 2;

    for (let i = 0; i < 3; i++) {
        setTimeout(() => {
            const ripple = document.createElement('div');
            ripple.className = isPlayer ? 'ripple-wave ripple-active' : 'ripple-wave ripple-active-opp';
            ripple.style.left = `${centerX}px`;
            ripple.style.top = `${centerY}px`;
            ripple.style.width = '120px';
            ripple.style.height = '120px';
            document.body.appendChild(ripple);
            setTimeout(() => ripple.remove(), 1500);
        }, i * 250);
    }

    // Board slam animation after a short delay
    setTimeout(() => {
        targetBoard.classList.remove('board-slam');
        void targetBoard.offsetWidth;
        targetBoard.classList.add('board-slam');
        setTimeout(() => targetBoard.classList.remove('board-slam'), 500);
    }, 400);
}


/**
 * Show animated damage/heal number popup
 * @param {HTMLElement} targetElement - The element to show the number on
 * @param {number} value - The damage/heal value
 * @param {string} type - 'damage' or 'heal'
 */
function showDamageNumber(targetElement, value, type = 'damage') {
    console.log('[DAMAGE_NUMBER] Called with:', { targetElement, value, type });

    if (!targetElement || value === 0) {
        console.warn('[DAMAGE_NUMBER] Skipped - targetElement:', !!targetElement, 'value:', value);
        return;
    }

    const rect = targetElement.getBoundingClientRect();
    const numberEl = document.createElement('div');
    numberEl.className = `damage-number ${type}`;
    numberEl.textContent = type === 'damage' ? `-${value}` : `+${value}`;

    // Position at center of target element
    numberEl.style.left = `${rect.left + rect.width / 2}px`;
    numberEl.style.top = `${rect.top + rect.height / 2}px`;

    console.log('[DAMAGE_NUMBER] Created element:', {
        className: numberEl.className,
        text: numberEl.textContent,
        position: { left: numberEl.style.left, top: numberEl.style.top }
    });

    document.body.appendChild(numberEl);
    console.log('[DAMAGE_NUMBER] Appended to body');

    // Remove after animation completes
    setTimeout(() => {
        numberEl.remove();
        console.log('[DAMAGE_NUMBER] Removed after animation');
    }, 1200);
}

// Make function globally accessible for game_engine.js
window.showDamageNumber = showDamageNumber;

// Nuclear Power Plant Explosion Animation
async function triggerNuclearExplosion(event) {
    console.log('[NUCLEAR] Explosion triggered!', event);
    console.log('[NUCLEAR] Event details:', {
        sourceMinion: event.sourceMinion,
        effect: event.effect,
        affectedMinionsCount: event.affectedMinions?.length
    });

    const { sourceMinion, effect, affectedMinions } = event;
    const damageValue = effect.value;

    // Find nuclear plant element for explosion animation
    const boards = document.querySelectorAll('.board');
    console.log('[NUCLEAR] Found', boards.length, 'boards');

    let nuclearEl = null;
    boards.forEach(board => {
        const minions = board.querySelectorAll('.minion');
        console.log('[NUCLEAR] Board has', minions.length, 'minions');
        minions.forEach(minionEl => {
            console.log('[NUCLEAR] Checking minion:', minionEl.dataset.minionId, 'vs', sourceMinion.instanceId);
            if (minionEl.dataset.minionId === sourceMinion.instanceId) {
                nuclearEl = minionEl;
                console.log('[NUCLEAR] Found nuclear plant element!');
            }
        });
    });

    // Add explosion animation to nuclear plant if found
    if (nuclearEl) {
        console.log('[NUCLEAR] Adding explosion animation to nuclear plant');
        nuclearEl.classList.add('nuclear-exploding');
        setTimeout(() => nuclearEl.classList.remove('nuclear-exploding'), 1000);
    } else {
        console.warn('[NUCLEAR] Nuclear plant element not found - it may have already been destroyed');
    }

    // Step 1: Show damage numbers on all affected minions (before they die)
    console.log('[NUCLEAR] Step 1: Showing damage numbers on', affectedMinions?.length || 0, 'minions');

    if (!affectedMinions || affectedMinions.length === 0) {
        console.error('[NUCLEAR] No affected minions data! Event:', event);
        return;
    }

    affectedMinions.forEach(({ minion, side }, index) => {
        const boardId = side === 'PLAYER' ? 'player-board' : 'opp-board';
        const board = document.getElementById(boardId);
        if (!board) {
            console.warn('[NUCLEAR] Board not found:', boardId);
            return;
        }

        // Find the minion element by instanceId
        const minionEl = Array.from(board.querySelectorAll('.minion')).find(
            el => el.dataset.minionId === minion.instanceId
        );

        if (minionEl) {
            console.log(`[NUCLEAR] Showing damage ${damageValue} on minion ${index + 1}/${affectedMinions.length}:`, minion.name);
            showDamageNumber(minionEl, damageValue, 'damage');
        } else {
            console.warn('[NUCLEAR] Minion element not found for:', minion.name, minion.instanceId);
        }
    });

    // Step 2: Wait for damage numbers to be visible
    await new Promise(r => setTimeout(r, 600));

    // Step 3: Apply damage directly to game state (without triggering damage numbers again)
    console.log('[NUCLEAR] Step 2: Applying damage in game state');
    [gameState.players[0], gameState.players[1]].forEach(p => {
        p.board.forEach(minion => {
            // Directly modify health without calling applyDamage to avoid duplicate damage numbers
            const oldHealth = minion.currentHealth;
            minion.currentHealth = Math.max(0, oldHealth - damageValue);

            // Update enrage state if needed
            gameState.updateEnrage(minion);
        });
    });

    // Step 4: Render to update health values
    render();

    // Step 5: Wait a bit, then resolve deaths with animations
    await new Promise(r => setTimeout(r, 300));
    console.log('[NUCLEAR] Step 3: Resolving deaths with animations');
    await resolveDeaths();

    // Step 6: Final render
    render();
    console.log('[NUCLEAR] Explosion complete');
}

window.triggerNuclearExplosion = triggerNuclearExplosion;

// Check for quest completion events after render
(function () {
    const originalRender = window.render;
    if (originalRender) {
        window.render = function () {
            originalRender();

            // Check for quest completion events
            if (gameState && gameState.questCompletionEvents && gameState.questCompletionEvents.length > 0) {
                const events = [...gameState.questCompletionEvents];
                gameState.questCompletionEvents = [];

                // Process events asynchronously to not block rendering
                events.forEach(event => {
                    if (event.type === 'NUCLEAR_EXPLOSION') {
                        // Trigger explosion animation asynchronously
                        setTimeout(() => {
                            triggerNuclearExplosion(event);
                        }, 100);
                    }
                });
            }
        };
    }
})();

function renderAIBattleSetup() {
    let selectedDeck = null;
    let selectedDifficulty = null;

    // Deck name mapping
    const deckNames = {
        'dpp': '賴清德-新聞湧動',
        'dpp2': '蔡英文-無限回溯',
        'kmt': '韓國瑜-政壇輪迴',
        'kmt2': '傅崐萁-江湖棄殺',
        'tpp': '柯文哲-台大醫科'
    };

    // Deck Description mapping (Edit here)
    const deckDescriptions = {
        'dpp': '透過賴清德強力的新聞數值造成高傷害的疊加牌組',
        'dpp2': '透過沉默、回手牌使輕易使戰場扭轉局面的奇幻蔡英文牌組',
        'kmt': '以韓國瑜為核心透過不斷來回進出戰場來增加體質強度的黏濁牌組',
        'kmt2': '以傅崐萁與棄牌機制為核心，透過頻繁棄牌觸發強大增益與召喚效果的強力快攻牌組',
        'tpp': '柯文哲為核心賦予治療光盾以及強化的簡單強力牌組'
    };

    // Render deck options
    const deckContainer = document.getElementById('deck-options-container');
    deckContainer.innerHTML = '';

    const startBtnWrapper = document.getElementById('start-battle-wrapper');
    const startBtn = document.getElementById('btn-start-ai-battle');

    // Reset state
    startBtnWrapper.style.opacity = '0.5';
    startBtnWrapper.style.pointerEvents = 'none';

    // 獲取已擊敗AI列表
    const defeatedAI = AuthManager.currentUser?.defeatedAI || [];
    const difficultyRewards = {
        'NORMAL': 100,
        'HARD': 200,
        'HELL': 300
    };
    const difficultyLabels = {
        'NORMAL': '普通級',
        'HARD': '專家級',
        'HELL': '大師級'
    };

    aiThemeDecks.forEach(theme => {
        const group = document.createElement('div');
        group.className = 'deck-option-group';

        const emojis = { 'dpp': '🟢', 'kmt': '🔵', 'tpp': '🟡' };

        // 為每個難度生成狀態標記
        const difficultyHTML = Object.keys(difficultyLabels).map(diff => {
            // 使用「牌組ID-難度」組合鍵檢查是否已通關
            const challengeKey = `${theme.id}-${diff}`;
            const isDefeated = defeatedAI.includes(challengeKey);

            const label = difficultyLabels[diff];
            const reward = difficultyRewards[diff];
            const statusText = isDefeated
                ? '<span style="color: #4ade80; margin-left: 8px;">✓ 已通關</span>'
                : `<span style="display: flex; align-items: center; color: #fcd34d; margin-left: 8px;"><img src="assets/images/ui/gold_coin.webp" style="width: 20px; height: 20px; margin-right: 4px;"> ${reward}</span>`;

            return `<div class="sub-difficulty-btn" data-value="${diff}">${label}${statusText}</div>`;
        }).join('');

        group.innerHTML = `
            <div class="option-item" data-deck-id="${theme.id}" data-image="${theme.image}" data-desc="${deckDescriptions[theme.id] || '請輸入描述...'}">
                <span class="option-icon">${emojis[theme.id] || '🎴'}</span>
                <span class="option-label">${deckNames[theme.id] || theme.name}</span>
                <span class="expand-arrow">▶</span>
            </div>
            <div class="difficulty-options">
                ${difficultyHTML}
            </div>
        `;

        const header = group.querySelector('.option-item');
        header.addEventListener('click', () => {
            // Collapse others
            document.querySelectorAll('.deck-option-group').forEach(el => {
                if (el !== group) el.classList.remove('expanded');
            });

            // Toggle current
            const isExpanded = group.classList.toggle('expanded');

            const previewImg = document.getElementById('preview-image');
            const previewText = document.getElementById('preview-text');
            const illuOverlay = document.querySelector('.preview-illustration-overlay');
            const illuTitle = document.getElementById('preview-illustration-title');
            const illuSubtitle = document.getElementById('preview-illustration-subtitle');

            if (isExpanded) {
                // Reset difficulty if switching decks
                if (selectedDeck !== theme.id) {
                    selectedDifficulty = null;
                    document.querySelectorAll('.sub-difficulty-btn').forEach(btn => btn.classList.remove('selected'));
                    startBtnWrapper.style.opacity = '0.5';
                    startBtnWrapper.style.pointerEvents = 'none';
                }

                selectedDeck = theme.id;

                // Update preview
                if (theme.image) {
                    previewImg.src = theme.image;
                    previewImg.style.display = 'block';
                    if (illuOverlay) illuOverlay.style.display = 'flex';
                }

                const fullDesc = deckNames[theme.id] || theme.name;
                const [title, subtitle] = fullDesc.split('-');
                if (illuTitle) illuTitle.textContent = title || '';
                if (illuSubtitle) illuSubtitle.textContent = subtitle || '';

                previewText.textContent = header.dataset.desc;
            } else {
                selectedDeck = null;
                previewImg.style.display = 'none';
                if (illuOverlay) illuOverlay.style.display = 'none';
                previewText.textContent = '請選擇對戰牌組';
            }
        });

        // Sub-difficulty selection
        group.querySelectorAll('.sub-difficulty-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();

                // Update UI
                document.querySelectorAll('.sub-difficulty-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');

                selectedDifficulty = btn.dataset.value;

                // Enable start button
                startBtnWrapper.style.opacity = '1';
                startBtnWrapper.style.pointerEvents = 'auto';
            });
        });

        deckContainer.appendChild(group);
    });

    startBtn.onclick = async () => {
        if (!selectedDeck || !selectedDifficulty) return;

        currentDifficulty = selectedDifficulty;
        currentOpponentDeckId = selectedDeck; // 記錄對戰的AI牌組ID
        selectedThemeId = selectedDeck;
        pendingViewMode = 'BATTLE';
        showView('deck-selection');
        document.getElementById('deck-select-title').innerText = '選擇出戰牌組';
        renderDeckSelect();
    };
}

/**
 * 顯示當前牌組內容
 */
function showDeckView() {
    if (!gameState) {
        showToast('目前沒有進行中的遊戲');
        return;
    }

    const player = gameState.players[0]; // 玩家永遠是 players[0]

    // 使用初始牌組（若有），否則退回到當前剩餘牌組
    let deckIds;
    if (player.initialDeckIds) {
        deckIds = player.initialDeckIds;
    } else {
        deckIds = player.deck.map(card => card.id);
    }

    // 統計每張卡的數量
    const cardCounts = {};
    deckIds.forEach(id => {
        cardCounts[id] = (cardCounts[id] || 0) + 1;
    });

    // 取得唯一卡牌並排序（按費用、名稱）
    const uniqueCards = Object.keys(cardCounts).map(id => {
        const cardData = CARD_DATA.find(c => c.id === id);
        return {
            ...cardData,
            count: cardCounts[id]
        };
    }).sort((a, b) => {
        if (a.cost !== b.cost) return a.cost - b.cost;
        return a.name.localeCompare(b.name, 'zh-TW');
    });

    // 渲染卡牌列表
    const container = document.getElementById('deck-view-list');
    container.innerHTML = uniqueCards.map(card => `
        <div class="deck-view-card ${card.rarity}" data-card-id="${card.id}">
            <div class="deck-view-card-cost">${card.cost}</div>
            <div class="deck-view-card-info">
                <div class="deck-view-card-name">${card.name}</div>
                <div class="deck-view-card-count">x${card.count}</div>
            </div>
        </div>
    `).join('');

    // 為每張卡片添加懸停預覽
    container.querySelectorAll('.deck-view-card').forEach(cardEl => {
        const cardId = cardEl.dataset.cardId;
        const card = CARD_DATA.find(c => c.id === cardId);
        if (!card) return;

        cardEl.addEventListener('mouseenter', (e) => {
            const preview = document.getElementById('card-preview');
            if (preview) {
                const rect = cardEl.getBoundingClientRect();
                preview.style.position = 'fixed';
                preview.style.left = `${rect.right + 20}px`;
                preview.style.top = `${Math.min(rect.top, window.innerHeight - 350)}px`;
                preview.style.display = 'block';
            }
            showPreview(card);
        });
        cardEl.addEventListener('mouseleave', hidePreview);
    });

    // 顯示彈出視窗
    document.getElementById('deck-view-modal').style.display = 'flex';
}

/**
 * 取得稀有度文字
 */
function getRarityText(rarity) {
    const rarityMap = {
        'COMMON': '一般',
        'RARE': '精良',
        'EPIC': '史詩',
        'LEGENDARY': '傳說'
    };
    return rarityMap[rarity] || rarity;
}

function showToast(message) {
    let toast = document.getElementById('custom-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'custom-toast';
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.className = 'medieval-toast show';

    setTimeout(() => {
        toast.className = 'medieval-toast';
    }, 3000);
}

/**
 * 自定義確認對話框 (回傳 Promise)
 */
window.gameConfirm = function (message, title = '確認', isAlert = false) {
    return new Promise((resolve) => {
        const modal = document.getElementById('game-confirm-modal');
        const titleEl = document.getElementById('game-confirm-title');
        const msgEl = document.getElementById('game-confirm-message');
        const okBtn = document.getElementById('game-confirm-ok');
        const cancelBtn = document.getElementById('game-confirm-cancel');

        if (!modal) {
            console.error('Confirm modal not found!');
            resolve(isAlert);
            return;
        }

        titleEl.textContent = title;
        msgEl.textContent = message;
        cancelBtn.style.display = isAlert ? 'none' : 'block';
        modal.style.display = 'flex';

        const handleOk = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(true);
        };
        const handleCancel = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(false);
        };
        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
        };

        okBtn.onclick = handleOk;
        cancelBtn.onclick = handleCancel;
    });
};

/**
 * 自定義警告對話框
 */
window.gameAlert = function (message, title = '提醒') {
    return window.gameConfirm(message, title, true);
};

// Start Game
document.addEventListener('DOMContentLoaded', () => {
    init(); // Initialize listeners and engine

    // Check Auth
    const cachedUser = AuthManager.checkAuth();
    if (cachedUser && cachedUser.username && cachedUser.password) {
        // [靜默登入] 雖然有快取，但還是去背景抓一次最新資料覆蓋
        showLoadingIndicator('登入中...');
        AuthManager.login(cachedUser.username, cachedUser.password).then(result => {
            if (result.success) {
                onUserLogin(result.user);
                console.log('[Auth] 雲端同步完成');
            } else {
                // 如果密碼被改了或 API 故障，則退回登入介面
                showView('auth-view');
            }
        }).catch(err => {
            console.error('[Auth] 靜默登入出錯:', err);
            showView('auth-view');
        }).finally(() => {
            hideLoadingIndicator();
        });
    } else {
        showView('auth-view');
    }

    // 初始化玩家資訊顯示
    updatePlayerInfo();
    // 初始化玩家資訊卡片的點擊事件
    initPlayerInfoEvents();

    // 初始化等級與經驗條顯示 (確保從快取讀取後能立即顯示)
    updateLevelDisplay();

    // 稱號選擇取消按鈕
    document.getElementById('btn-title-cancel')?.addEventListener('click', () => {
        document.getElementById('title-selection-modal').style.display = 'none';
    });

    // 頭像選擇取消按鈕
    document.getElementById('btn-avatar-cancel')?.addEventListener('click', () => {
        document.getElementById('avatar-selection-modal').style.display = 'none';
    });

    // 個人頁面按鈕
    document.getElementById('btn-main-profile')?.addEventListener('click', () => {
        showProfilePage();
    });

    // 個人頁面返回按鈕
    document.getElementById('btn-profile-back')?.addEventListener('click', () => {
        showView('main-menu');
    });

    // 個人頁面 - 頭像編輯
    document.getElementById('profile-avatar')?.addEventListener('click', (e) => {
        e.stopPropagation();
        showAvatarSelectionModal();
    });

    // 個人頁面 - 稱號編輯
    document.getElementById('profile-title')?.addEventListener('click', (e) => {
        e.stopPropagation();
        showTitleSelectionModal();
    });

    // 排行榜按鈕
    document.getElementById('btn-leaderboard')?.addEventListener('click', async () => {
        const modal = document.getElementById('leaderboard-modal');
        const listContainer = document.getElementById('leaderboard-list');

        if (!modal || !listContainer) return;

        // 顯示載入中
        listContainer.innerHTML = '<div class="empty-message">載入中...</div>';
        modal.style.display = 'flex';

        // 載入排行榜資料
        await window.leaderboardManager.fetchLeaderboard('level');
        window.leaderboardManager.renderLeaderboard(listContainer);
    });

    // 排行榜關閉按鈕
    document.getElementById('btn-leaderboard-close')?.addEventListener('click', () => {
        document.getElementById('leaderboard-modal').style.display = 'none';
    });

    // 玩家資料 Modal 關閉按鈕
    document.getElementById('btn-profile-modal-close')?.addEventListener('click', () => {
        document.getElementById('player-profile-modal').style.display = 'none';
    });

    // ===== 投降功能 =====
    // 點擊設定選單中的「投降」按鈕
    document.getElementById('btn-surrender-menu')?.addEventListener('click', () => {
        console.log('[UI] 投降按鈕被點擊');
        document.getElementById('settings-menu-battle').style.display = 'none'; // 關閉設定選單
        document.getElementById('surrender-modal').style.display = 'flex'; // 顯示確認彈窗
    });

    // 確認投降
    document.getElementById('btn-surrender-confirm')?.addEventListener('click', async () => {
        console.log('[UI] 確認投降');
        document.getElementById('surrender-modal').style.display = 'none';

        if (isPvPMode && window.pvpManager) {
            // PvP 模式：調用 pvpManager.surrender()
            console.log('[UI] PvP 模式，執行 pvpManager.surrender()');
            const result = await window.pvpManager.surrender();
            if (result && result.success) {
                console.log('[UI] 投降成功，顯示敗北畫面');
                endGame('DEFEAT');
                // 延遲清理 PvP 狀態
                setTimeout(() => {
                    endPvPGame();
                }, 1000);
            } else {
                console.error('[UI] 投降失敗:', result);
                showToast('投降失敗，請稍後再試');
            }
        } else {
            // AI 模式：直接顯示失敗
            console.log('[UI] AI 模式，直接結束遊戲');
            endGame('DEFEAT');
        }
    });

    // 取消投降
    document.getElementById('btn-surrender-cancel')?.addEventListener('click', () => {
        console.log('[UI] 取消投降');
        document.getElementById('surrender-modal').style.display = 'none';
    });

    // ===== 遊戲結果畫面「繼續」按鈕 =====
    document.getElementById('btn-result-continue')?.addEventListener('click', () => {
        console.log('[UI] 點擊繼續按鈕');

        // 如果是 PvP 模式，確保狀態已清理
        if (isPvPMode || window.isPvPMode) {
            console.log('[UI] PvP 模式結束，清理狀態');
            endPvPGame();
        }

        // 重置遊戲狀態
        gameState = null;
        window.gameState = null;
        currentOpponentDeckId = null;

        // 返回主選單
        console.log('[UI] 返回主選單');
        showView('main-menu');
        updateLevelDisplay();
    });
});


// ===== Mulligan Phase Functions =====

/**
 * 顯示 Mulligan 視窗並渲染起手牌
 */
function showMulliganPhase() {
    mulliganPhase = true;
    mulliganCurrentPlayer = 0; // 從玩家開始
    selectedMulliganCards = [];

    const modal = document.getElementById('mulligan-modal');
    modal.style.display = 'flex';

    renderMulliganHand();
}

/**
 * 渲染當前玩家的起手牌
 */
function renderMulliganHand() {
    const handContainer = document.getElementById('mulligan-hand');
    if (!handContainer) return;

    handContainer.innerHTML = '';

    const player = gameState.players[mulliganCurrentPlayer];
    if (!player || !player.hand) return;

    player.hand.forEach((card, index) => {
        // 使用新的詳細卡牌創建函數
        const cardEl = createDetailedCardEl(card, index);
        cardEl.classList.add('mulligan-card');
        cardEl.dataset.index = index;
        cardEl.draggable = false;

        // 點擊事件: toggle選中狀態
        cardEl.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const idx = parseInt(cardEl.dataset.index);
            const selectedIdx = selectedMulliganCards.indexOf(idx);

            if (selectedIdx > -1) {
                // 取消選中
                selectedMulliganCards.splice(selectedIdx, 1);
                cardEl.classList.remove('selected');
                // 移除「替換」標籤
                const tag = cardEl.querySelector('.mulligan-replace-tag');
                if (tag) tag.remove();
            } else {
                // 選中
                selectedMulliganCards.push(idx);
                cardEl.classList.add('selected');
                // 新增「替換」標籤
                const tag = document.createElement('div');
                tag.className = 'mulligan-replace-tag';
                tag.textContent = '替換';
                cardEl.appendChild(tag);
            }
        });

        handContainer.appendChild(cardEl);
    });
}

/**
 * 確認 Mulligan 選擇
 */
async function confirmMulligan() {
    console.log('[DEBUG] confirmMulligan called');

    // 檢查 gameState 是否存在並且有 performMulligan 方法
    if (!gameState) {
        console.error('[ERROR] gameState 不存在!');
        gameAlert('遊戲狀態錯誤,請重新開始遊戲', '錯誤');
        return;
    }

    if (typeof gameState.performMulligan !== 'function') {
        console.error('[ERROR] gameState.performMulligan 不是一個函數!');
        gameAlert('遊戲引擎載入錯誤,請重新整理頁面 (Ctrl+Shift+R)', '載入錯誤');
        return;
    }

    // 執行 Mulligan logic
    const replaced = gameState.performMulligan(mulliganCurrentPlayer, selectedMulliganCards);
    console.log(`[Mulligan] Player ${mulliganCurrentPlayer} 替換了 ${replaced.length} 張牌`);

    // ===== PVP 模式：同步 Mulligan 狀態 =====
    if (isPvPMode && window.pvpManager) {
        console.log('[PvP] Mulligan 完成，播放動畫...');

        // 確保初始手牌已保存（以防萬一）
        const roomData = window.pvpManager.currentRoom;
        const savedHand = roomData?.gameState?.initialHands?.[pvpPlayerId];
        if (!savedHand || savedHand.length === 0) {
            console.log('[PvP] 初始手牌未保存，現在保存');
            const initialHandIds = gameState.players[0].hand.map(card => card.id);
            await window.pvpManager.saveInitialHand(initialHandIds);
        } else {
            console.log('[PvP] 初始手牌已保存:', savedHand);
        }

        // 隱藏 Modal 並顯示等待訊息
        mulliganPhase = false;
        const modal = document.getElementById('mulligan-modal');
        modal.style.display = 'none';

        // 1. 立即播放抽牌動畫 (獨立體驗)
        const player0 = gameState.players[0];
        const initialHand = [...player0.hand];
        player0.hand = [];
        render();

        for (const card of initialHand) {
            await new Promise(r => setTimeout(r, 400));
            player0.hand.push(card);
            render();
        }

        await new Promise(r => setTimeout(r, 400));

        showToast('等待對手完成換牌...');

        // 2. 動畫完成後，更新保存的手牌為換牌後的手牌（重要！）
        const finalHandIds = gameState.players[0].hand.map(card => card.id);
        console.log('[PvP] 更新換牌後的手牌到 Firebase:', finalHandIds);
        await window.pvpManager.saveInitialHand(finalHandIds);

        // 3. 同步狀態 (告訴對手我好了)
        await window.pvpManager.syncMulliganStatus(true);
        await window.pvpManager.syncGameAction('MULLIGAN_DONE', {});

        // 監聽雙方都完成後開始遊戲
        window.pvpManager.listenMulliganStatus(async () => {
            console.log('[PvP] 雙方 Mulligan 完成，開始遊戲');

            // 判斷是否為我的回合（先手）
            const isMyTurn = window.pvpManager?.isMyTurn();
            console.log('[PvP Mulligan] isMyTurn:', isMyTurn, 'currentPlayerIdx:', gameState.currentPlayerIdx);
            console.log('[PvP Mulligan] Mulligan 完成時手牌數:', gameState.players[0].hand.length);

            if (isMyTurn) {
                // 先手：呼叫 startTurn 進行抽牌和增加法力
                console.log('[PvP Mulligan] 先手執行 startTurn()');
                gameState.startTurn();
                console.log('[PvP Mulligan] startTurn() 完成，手牌數:', gameState.players[0].hand.length);
                showTurnAnnouncement('你的回合！');
                syncLocalStateToFirebase(); // 同步回合開始後的狀態 (Mana, HeadSize)
            } else {
                // 後手：等待對手行動，不呼叫 startTurn
                console.log('[PvP Mulligan] 後手等待對手');
                showTurnAnnouncement('對手回合');
            }

            render();
        });

        return;
    }

    // ===== AI 模式：原有邏輯 =====
    if (mulliganCurrentPlayer === 0) {
        // 玩家完成, 輪到AI
        mulliganCurrentPlayer = 1;
        selectedMulliganCards = []; // Clear selection

        // AI 自動處理: 隨機選擇 0-3 張換牌
        const aiPlayer = gameState.players[1];
        const numToReplace = Math.floor(Math.random() * Math.min(4, aiPlayer.hand.length + 1));
        const aiIndices = [];
        for (let i = 0; i < numToReplace; i++) {
            aiIndices.push(Math.floor(Math.random() * aiPlayer.hand.length));
        }
        const uniqueAiIndices = [...new Set(aiIndices)];
        gameState.performMulligan(1, uniqueAiIndices);
        console.log(`[Mulligan] AI 替換了 ${uniqueAiIndices.length} 張牌`);

        // 兩邊都完成, 隱藏 Modal
        mulliganPhase = false;
        const modal = document.getElementById('mulligan-modal');
        modal.style.display = 'none';

        // ===== 抽牌動畫 (Sequential Draw Animation) =====
        const player0 = gameState.players[0];
        const initialHand = [...player0.hand];
        player0.hand = []; // 暫時清空手牌數據以清空 UI

        // 渲染空手牌
        render();

        // 逐張顯示手牌
        for (const card of initialHand) {
            await new Promise(r => setTimeout(r, 400)); // 每張牌延遲 400ms
            player0.hand.push(card);
            render();
        }

        await new Promise(r => setTimeout(r, 400)); // 最後一張牌出來後稍作停頓

        // 開始第一回合 (這會觸發首回合抽牌)
        gameState.startTurn();

        // [新增] 顯示回合提示
        if (gameState.currentPlayerIdx === 0) {
            showTurnAnnouncement('你的回合！');
        } else {
            showTurnAnnouncement('對手回合');
        }

        render();

        // 如果是AI先手, 觸發AI回合
        if (gameState.currentPlayerIdx === 1) {
            setTimeout(aiTurn, 1000);
        }
    } else {
        // AI 完成 (這段理論上不會被執行到, 因為AI是自動處理)
        mulliganPhase = false;
        const modal = document.getElementById('mulligan-modal');
        modal.style.display = 'none';
        gameState.startTurn();
        render();
    }
}

/**
 * 生成卡牌內部的 HTML (用於 showPreview 和 createDetailedCardEl)
 * 確保兩者顯示完全一致
 */
function generateCardInnerHTML(card, currentGameState) {
    const base = CARD_DATA.find(c => c.id === card.id) || card;
    let statsHtml = '';

    // 生成屬性 HTML
    if (card.attack !== undefined && card.health !== undefined && card.type !== 'NEWS') {
        const effectiveBaseAttack = card.baseAttackOverride !== undefined ? card.baseAttackOverride : base.attack;
        const atkClass = card.attack > effectiveBaseAttack ? 'stat-buffed' : (card.attack < effectiveBaseAttack ? 'stat-damaged' : '');
        const hpClass = (card.currentHealth !== undefined && card.currentHealth < card.health) ? 'stat-damaged' : (card.health > base.health ? 'stat-buffed' : '');
        const hpValue = card.currentHealth !== undefined ? card.currentHealth : card.health;

        // 屬性在最下方
        statsHtml = `
        <div class="minion-stats" style="margin-top: auto; padding: 5px 20px 10px 20px; display: flex; justify-content: space-between; width: 100%;">
            <span class="stat-atk ${atkClass}" style="width: 70px; height: 70px; font-size: 32px;"><span>${card.attack}</span></span>
            <span class="stat-hp ${hpClass}" style="width: 70px; height: 70px; font-size: 32px;">${hpValue}</span>
        </div>`;
    }

    // 生成圖片 HTML
    const artHtml = card.image ?
        `<div class="card-art" style="width: 100%; height: 140px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 4px; margin: 10px auto 5px auto; border: 1px solid rgba(255,255,255,0.2);"></div>` :
        `<div class="card-art" style="width: 100%; height: 140px; background: #333; margin: 10px auto 5px auto; border-radius: 4px;"></div>`;

    // 計算費用
    let actualCost = card.cost;
    const state = currentGameState || (typeof gameState !== 'undefined' ? gameState : null);

    if (state && card.type === 'NEWS' && state.players && state.players[0]) {
        const player = state.players[0];
        player.board.forEach(minion => {
            if (minion.keywords?.ongoing?.type === 'REDUCE_NEWS_COST') {
                actualCost -= minion.keywords.ongoing.value;
            }
        });
        actualCost = Math.max(0, actualCost);
    } else if (state && typeof state.getCardActualCost === 'function') {
        actualCost = state.getCardActualCost(card);
    }

    const baseCard = CARD_DATA.find(c => c.id === card.id) || card;
    const isReduced = actualCost < baseCard.cost || card.isReduced;
    const costClass = isReduced ? 'cost-reduced' : '';

    // 計算 Bonus
    const bonus = (state && card.id) ? (state.getNewsPower(card.side || 'PLAYER') || 0) : 0;
    const isNews = card.type === 'NEWS';
    const bcType = card.keywords?.battlecry?.type || '';
    const isDamage = bcType.includes('DAMAGE');
    const isHeal = bcType.includes('HEAL') || bcType.includes('RECOVER');
    const isExcluded = bcType.includes('DRAW') || bcType.includes('COST') || bcType.includes('REDUCE');
    const effectiveBonus = (isNews && (isDamage || isHeal) && !isExcluded) ? bonus : 0;

    // 格式化描述
    const formattedDesc = (typeof formatDesc === 'function') ?
        formatDesc(card.description || "", effectiveBonus, isNews) :
        (card.description || "");

    return `
        <div style="position: relative; display: flex; align-items: center; width: 100%; margin-bottom: 4px; height: 30px;">
            <div class="card-cost ${costClass}" style="position: relative; width:24px; height:24px; font-size:13px; flex-shrink: 0; z-index: 10; transform: rotate(45deg); margin-left: 4px;"><span>${actualCost ?? 0}</span></div>
            <div class="card-title" style="font-size:20px; position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); margin: 0; text-align: center; text-shadow: 0 0 5px black; z-index: 5;">${card.name || "未知卡片"}</div>
        </div>
        
        ${artHtml}
        
        <div class="card-category" style="font-size:12px; padding: 1px 4px; margin-bottom: 4px; text-align:center; color:#aaa;">${card.category || ""}</div>
        
        <div class="card-desc" style="font-size:13px; padding: 0 8px; line-height: 1.3; height: auto; flex-grow: 1; overflow: hidden; text-align: center; white-space: pre-wrap;">${formattedDesc}</div>
        
        ${statsHtml ? statsHtml.replace(/margin-top: auto;/, 'margin-top: auto; display: flex;').replace(/width: 70px; height: 70px; font-size: 32px;/g, 'width: 50px; height: 50px; font-size: 24px;') : ''}
    `;
}

/**
 * 創建詳細卡牌元素 (用於 Mulligan 顯示) - 完整還原預覽樣式
 */
function createDetailedCardEl(card, index) {
    const el = document.createElement('div');
    const rarityClass = card.rarity ? card.rarity.toLowerCase() : 'common';

    // 使用詳細卡牌樣式
    el.className = `card detailed-card rarity-${rarityClass} ${card.type === 'NEWS' ? 'news-card' : ''}`;
    el.dataset.index = index;
    el.draggable = false;

    // 與 showPreview 使用相同的樣式設定
    el.style.width = '240px';
    el.style.height = '350px';
    el.style.transform = 'none !important';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.justifyContent = 'flex-start';
    el.style.padding = '8px';
    el.style.flexShrink = '0';

    // 直接調用共用函數生成內容
    // 注意: 在 Mulligan 階段, gameState 可能尚未完全初始化, 但我們盡量使用
    el.innerHTML = generateCardInnerHTML(card, typeof gameState !== 'undefined' ? gameState : null);

    return el;
}

// ===== 離開頁面保護 =====
window.addEventListener('beforeunload', (e) => {
    if (window.AuthManager && AuthManager.isSaving) {
        // 標準做法：設定 returnValue 以觸發瀏覽器對話框
        e.preventDefault();
        e.returnValue = '資料正在儲存中，確定要離開嗎？';
        return e.returnValue;
    }
});

/**
 * PVP 重新連接檢測與處理
 */
async function checkPvPReconnection() {
    console.log('[PVP 重連] 開始檢查...');

    if (!window.pvpManager || !window.pvpManager.isReady()) {
        console.log('[PVP 重連] pvpManager 未準備好，跳過');
        return;
    }

    const reconnectInfo = await window.pvpManager.tryReconnect();

    if (!reconnectInfo) {
        console.log('[PVP 重連] 沒有未完成的對戰');
        return;
    }

    console.log('[PVP 重連] 發現未完成對戰:', reconnectInfo);

    // 確保在主選單才顯示
    const currentView = document.querySelector('.view:not([style*="display: none"])');
    if (!currentView || currentView.id !== 'main-menu') {
        console.warn('[PVP 重連] 當前不在主選單，延後檢查');
        return;
    }

    // 顯示重連 modal
    const modal = document.getElementById('pvp-reconnect-modal');
    const detailsDiv = document.getElementById('reconnect-details');

    // 顯示對戰資訊
    const room = reconnectInfo.room;
    const opponentId = reconnectInfo.playerId === 'player1' ? 'player2' : 'player1';
    const opponentInfo = room.playerInfo?.[opponentId];

    detailsDiv.innerHTML = `
        <p><strong>對手：</strong>${opponentInfo?.username || '未知玩家'}</p>
        <p><strong>回合數：</strong>${room.gameState?.turnNumber || 1}</p>
    `;

    modal.style.display = 'flex';

    // 重新連接按鈕
    document.getElementById('btn-reconnect-confirm').onclick = async () => {
        modal.style.display = 'none';
        showToast('正在重新連接...');

        try {
            await window.pvpManager.reconnect(reconnectInfo.roomId, reconnectInfo.playerId);

            // 進入 PVP 對戰畫面
            const deckCards = userDecks[0]?.cards || [];
            startPvPGame(reconnectInfo.roomId, reconnectInfo.playerId, deckCards, reconnectInfo.room);

        } catch (error) {
            console.error('[PVP 重連] 重連失敗:', error);
            showToast('重新連接失敗');
        }
    };

    // 放棄對戰按鈕
    document.getElementById('btn-reconnect-abandon').onclick = async () => {
        const confirmed = await showCustomConfirm('確定要放棄這場對戰嗎？對手將會獲勝。');
        if (!confirmed) {
            modal.style.display = 'flex';
            return;
        }

        modal.style.display = 'none';

        // 使用 abandonReconnection 而非 surrender,因為此時還未加入房間
        if (window.pvpManager) {
            await window.pvpManager.abandonReconnection();
        }

        showToast('已放棄對戰');
    };
}

// [Tutorial] Initialize check on load for persistence
window.addEventListener('load', () => {
    setTimeout(() => {
        const user = AuthManager.checkAuth();

        // Ensure Main Menu is actually visible before starting tutorial
        // This prevents tutorial from overlaying on Login screen if auth check passed but view didn't switch
        const mainMenu = document.getElementById('main-menu');
        const authView = document.getElementById('auth-view');

        const isMainMenuVisible = mainMenu && window.getComputedStyle(mainMenu).display !== 'none';
        const isAuthVisible = authView && window.getComputedStyle(authView).display !== 'none';

        // Critical: If auth view is visible (Login/Register), NEVER show tutorial
        if (isAuthVisible) {
            console.log('[Tutorial] Skipping check: Auth View is active');
            return;
        }

        if (user && window.tutorialManager && isMainMenuVisible) {
            window.tutorialManager.checkTutorialStatus(user);
        }
    }, 1500);
});
