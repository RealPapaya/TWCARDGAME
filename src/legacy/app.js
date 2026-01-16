// Imports from new UI layer
import {
    initDragManager, onDragStart, onDragMove, onDragEnd,
    startBattlecryTargeting, cancelBattlecryTargeting, isTargetEligible, getValidTargets
} from '../ui/DragManager.js';
import {
    formatDesc, animateAbility, animateDiscard, animateAttack, spawnDustEffect, animateShatter, triggerCombatEffect,
    showCardPlayPreview, animateCardFromDeck, showDamageNumber,
    triggerFullBoardHealAnimation, triggerFullBoardBounceAnimation, triggerEarthquakeAnimation,
    triggerPoisonGasAnimation, triggerRippleDiffusionAnimation
} from '../ui/VisualEffects.js';
import { GameEngine } from '../logic/GameEngine.js';
// MatchHistory removed from import as it is defined locally


// ===== Responsive Scaling System =====
// Design base: 1920x1080 (adjusted for battle view)
function updateGameScale() {
    const container = document.getElementById('game-container-16-9');
    const scaler = document.getElementById('game-content-scaler');

    if (!container || !scaler) return;

    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight;

    // Design base dimensions (adjusted to accommodate battle view)
    const baseWidth = 1920;
    const baseHeight = 1080;

    // Calculate scale factor (use the smaller scale to fit)
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
// Expose to window for DragManager and other modules
window.gameEngine = null; // Will be set in init
window.gameState = null; // Will be set in init
// Expose to window for DragManager and other modules
window.gameEngine = null; // Will be set in init
window.gameState = null; // Will be set in init
// Card data is now loaded from card_data.js
// CARD_DATA is available globally via window.CARD_DATA

let cardDB = [];

// Load cards manually (modified for local file access)
// Game state for deck builder
let userDecks = JSON.parse(localStorage.getItem('userDecks')) || [
    { name: "預設牌組 1", cards: [] },
    { name: "預設牌組 2", cards: [] },
    { name: "預設牌組 3", cards: [] }
];
let tempDeck = null; // Temporary deck for editing

// AI Theme Decks - loaded from default_decks.js
// DEFAULT_THEME_DECKS is available globally via window.DEFAULT_THEME_DECKS

function generateDefaultDeck() {
    const allIds = CARD_DATA.map(c => c.id);
    const deck = [];
    while (deck.length < 30) deck.push(allIds[Math.floor(Math.random() * allIds.length)]);
    return deck;
}

const defaultAIThemes = [
    { id: 'dpp', name: '賴清德-新聞湧動', image: 'img/lai_illustration.png', cards: DEFAULT_THEME_DECKS.dpp },
    { id: 'dpp2', name: '蔡英文-無限回溯', image: 'img/tsai_illustration.png', cards: DEFAULT_THEME_DECKS.dpp2 },
    { id: 'kmt', name: '韓國瑜-政壇輪迴', image: 'img/han_illustration.png', cards: DEFAULT_THEME_DECKS.kmt },
    { id: 'kmt2', name: '傅崑萁-江湖棄殺', image: 'img/fu_kun_chi.png', cards: DEFAULT_THEME_DECKS.kmt2 },
    { id: 'tpp', name: '柯文哲-台大醫科', image: 'img/ko_illustration.png', cards: DEFAULT_THEME_DECKS.tpp }
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
let editingDeckIdx = 0;
let pendingViewMode = 'BATTLE'; // 'BATTLE', 'BUILDER', or 'DEBUG'
let isDebugMode = false;
let currentDifficulty = 'NORMAL';
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

// Expose to window for DragManager
window.MatchHistory = MatchHistory;



/**
 * 獲取單位名稱用於紀錄
 */
function getUnitName(side, index, type) {
    if (type === 'HERO') {
        return side === 'PLAYER' ? "你" : "對手";
    }

    // 確保 side 正確對應到 gameState 的 player
    const unitSide = side === 'PLAYER' ? gameState.currentPlayer : gameState.opponent;

    if (!unitSide || !unitSide.board) {
        console.warn(`[getUnitName] Invalid unitSide:`, side, unitSide);
        return "未知隨從";
    }

    const minion = unitSide.board[index];

    if (!minion) {
        console.warn(`[getUnitName] Minion not found at index ${index} for side ${side}`);
        return "未知隨從";
    }

    return minion.name;
}

function init() {
    // Initialize drag line element
    initDragManager();

    gameEngine = new GameEngine(CARD_DATA);
    window.gameEngine = gameEngine; // Global exposure

    // --- Main Menu Listeners ---
    document.getElementById('btn-main-battle').addEventListener('click', () => {
        isDebugMode = false;
        showView('mode-selection');
    });

    document.getElementById('btn-main-builder').addEventListener('click', () => {
        isDebugMode = false;
        pendingViewMode = 'BUILDER';
        showView('deck-selection');
        document.getElementById('deck-select-title').innerText = '選擇要編修的牌組';
        renderDeckSelect();
    });

    document.getElementById('btn-main-test').addEventListener('click', () => {
        isDebugMode = true;
        pendingViewMode = 'DEBUG';
        showView('test-mode-selection');
    });

    // --- Mode Selection Listeners ---
    document.getElementById('btn-mode-ai').addEventListener('click', () => {
        showView('ai-battle-setup');
        renderAIBattleSetup();
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
                // Check if we're in test mode or builder mode
                const title = document.getElementById('deck-select-title').innerText;
                if (title.includes('測試')) {
                    showView('test-mode-selection');
                } else if (pendingViewMode === 'BUILDER') {
                    showView('main-menu');
                } else {
                    showView('ai-battle-setup');
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
                // Editing player deck
                const original = userDecks[editingDeckIdx];
                const tempStr = JSON.stringify({ name: tempDeck.name, cards: tempDeck.cards });
                const origStr = JSON.stringify({ name: original.name, cards: original.cards });

                if (tempStr !== origStr) {
                    const confirmed = await showCustomConfirm("您有未保存的修改，確定要放棄並離開嗎？");
                    if (!confirmed) return;
                }
                tempDeck = null;
                showView('deck-selection');
                renderDeckSelect();
            }
        } else {
            showView('deck-selection');
            renderDeckSelect();
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
            localStorage.setItem('userDecks', JSON.stringify(userDecks));
            showToast("保存成功！");

            // 同步至雲端
            if (AuthManager.currentUser) {
                AuthManager.currentUser.deck_data = userDecks;
                AuthManager.saveData();
            }
        }
        renderDeckBuilder();
    });

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
    document.getElementById('btn-create-custom')?.addEventListener('click', () => {
        document.getElementById('deck-creation-modal').style.display = 'none';
        addNewPlayerDeck(null); // Create empty deck
    });

    document.getElementById('btn-create-theme')?.addEventListener('click', () => {
        document.getElementById('deck-creation-modal').style.display = 'none';
        showPlayerThemeSelection();
    });

    document.getElementById('btn-create-cancel')?.addEventListener('click', () => {
        document.getElementById('deck-creation-modal').style.display = 'none';
    });

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
        gameState.endTurn();
        render();
        await resolveDeaths();
        if (gameState.currentPlayerIdx === 1) {
            setTimeout(aiTurn, 1000);
        }
    } catch (e) { logMessage(e.message); }
});

// Settings Menu Toggle
document.getElementById('settings-button').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('settings-menu');
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
    document.getElementById('settings-menu').style.display = 'none';
});

document.getElementById('btn-deck-view-close')?.addEventListener('click', () => {
    document.getElementById('deck-view-modal').style.display = 'none';
});

// Surrender button in settings menu
document.getElementById('btn-surrender-menu').addEventListener('click', () => {
    document.getElementById('settings-menu').style.display = 'none';
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

// --- Result View Listeners ---
document.getElementById('btn-result-continue').addEventListener('click', () => {
    showView('main-menu');
});

// --- Settings & Logout ---
const settingsBtn = document.getElementById('btn-settings');
const logoutBtn = document.getElementById('btn-logout');
const settingsMenu = document.getElementById('settings-menu');

if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (settingsMenu.style.display === 'none' || !settingsMenu.style.display) {
            settingsMenu.style.display = 'flex'; // Use flex for layout
        } else {
            settingsMenu.style.display = 'none';
        }
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await showCustomConfirm('確定要登出嗎？');
        if (confirmed) {
            AuthManager.logout();
        }
        if (settingsMenu) settingsMenu.style.display = 'none';
    });
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    if (settingsMenu && settingsBtn && !settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) {
        settingsMenu.style.display = 'none';
    }
});

// Global drag events
document.addEventListener('mousemove', onDragMove);
document.addEventListener('mouseup', onDragEnd);

// Expose globally for AuthManager/AuthUI
window.App = {
    showView: showView,
    onUserLogin: onUserLogin
};

function onUserLogin(user) {
    // Load deck data from cloud if available
    if (user.deck_data && user.deck_data.length > 0) {
        userDecks = user.deck_data;
    } else {
        // New user - start with empty array (no default decks)
        userDecks = [];
    }
    localStorage.setItem('userDecks', JSON.stringify(userDecks));

    // Update other stats if we add level/gold UI later
    showView('main-menu');
    showToast(`歡迎回來，${user.username}！`);
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
    const visibleDecks = userDecks.map((d, i) => ({ ...d, originalIdx: i }))
        .filter(d => isDebugMode ? d.isTest : !d.isTest);

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
                localStorage.setItem('userDecks', JSON.stringify(userDecks));

                // 同步至雲端
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
            showDeckCreationOptions();
        };
        container.appendChild(addSlot);
    }
}

function showDeckCreationOptions() {
    document.getElementById('deck-creation-modal').style.display = 'flex';
}

function addNewPlayerDeck(cardIds = null, themeName = null) {
    const newDeck = {
        name: themeName || (isDebugMode ? '測試牌組 ' : '自定義牌組 ') + (userDecks.length + 1),
        cards: cardIds ? [...cardIds] : []
    };
    if (isDebugMode) newDeck.isTest = true;
    userDecks.push(newDeck);
    localStorage.setItem('userDecks', JSON.stringify(userDecks));

    // 同步至雲端
    if (AuthManager.currentUser) {
        AuthManager.currentUser.deck_data = userDecks;
        AuthManager.saveData();
    }

    selectedDeckIdx = userDecks.length - 1;
    renderDeckSelect();
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
        card.onclick = () => {
            document.getElementById('player-theme-selection-modal').style.display = 'none';
            addNewPlayerDeck(theme.cards, theme.name);
            showToast(`已匯入${theme.name}`);
        };
        container.appendChild(card);
    });
}

function showView(viewId) {
    const nextView = document.getElementById(viewId);
    if (!nextView) return;

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
    }, 1600);

    // --- Original Logic for UI Elements ---
    const log = document.getElementById('message-log');
    if (log) {
        log.style.display = (viewId === 'battle-view') ? 'flex' : 'none';
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
        window.gameEngine = gameEngine; // Global exposure
        window.gameState = gameState; // Global exposure
        showView('battle-view');
    } catch (e) {
        logMessage(e.message);
        return;
    }

    // Initial Draw Sequence Logic
    const initialHand = [...gameState.players[0].hand];
    gameState.players[0].hand = [];
    previousPlayerHandSize = 0;

    // Init Mana Containers for the new game view
    initManaContainers('player-mana-container');
    initManaContainers('opp-mana-container');

    showView('battle-view');
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
        setTimeout(aiTurn, 1000);
    } else {
        // Player starts
        setTimeout(() => showTurnAnnouncement("你的回合"), 500);
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

function renderDeckBuilder() {
    // Use tempDeck for rendering during edit
    const deck = tempDeck || userDecks[editingDeckIdx];
    document.getElementById('deck-name-input').value = deck.name;

    const gridEl = document.getElementById('all-cards-grid');
    gridEl.innerHTML = '';

    // Search Functionality
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

    CARD_DATA.filter(card => {
        const matchSearch = card.name.toLowerCase().includes(searchTerm) || (card.description && card.description.toLowerCase().includes(searchTerm));
        const matchCat = catFilter === 'ALL' || (card.category || '一般') === catFilter;
        const matchRarity = rarFilter === 'ALL' || (card.rarity || 'COMMON') === rarFilter; // Default rarity if missing?

        let matchCost = true;
        if (costFilter !== 'ALL') {
            if (costFilter === '7+') matchCost = card.cost >= 7;
            else matchCost = card.cost === parseInt(costFilter);
        }

        return matchSearch && matchCat && matchRarity && matchCost;
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
            badge.style.background = 'var(--neon-yellow)';
            badge.style.color = '#000';
            badge.style.fontWeight = 'bold';
            badge.style.fontSize = '12px';
            badge.style.padding = '2px 6px';
            badge.style.borderRadius = '10px';
            badge.style.zIndex = '20';
            badge.style.boxShadow = '0 0 5px rgba(0,0,0,0.8)';
            badge.style.border = '1px solid #000';
            cardEl.appendChild(badge);

            // Visual feedback for max copies
            // Legendary: max 1 (but logic says global limit 2? Wait logic says "legendCount >= 2" is global limit, but usually deck limit is 1 per unique legendary. 
            // In Hearthstone: 1 per legendary, 2 per non-legendary.
            // My code handles global legendary limit of 2? "傳說卡牌在牌組中最多只能放 2 張！" -> This sounds like total legendaries in deck <= 2. 
            // But let's look at "count >= 2" check below (lines 236-237). It applies to everything. 
            // So currently duplicate limit is 2 for ALL cards.
            // Let's stick to simple dimming if count >= 2.

            if (countInDeck >= 2) {
                cardEl.style.opacity = '0.5';
                cardEl.style.filter = 'grayscale(0.5)';
            }
        }

        cardEl.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (deck.cards.length < 30 || isDebugMode) {
                // Check legendary limit
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

                // Normal 2 copies limit
                const count = deck.cards.filter(id => id === card.id).length;
                if (!isDebugMode && count >= 2) {
                    await showCustomAlert("每種卡牌最多只能放 2 張！");
                    return;
                }

                deck.cards.push(card.id);
                renderDeckBuilder();
            }
        });
        gridEl.appendChild(cardEl);
    });

    const listEl = document.getElementById('my-deck-list');
    listEl.innerHTML = '';

    // Sort cards by cost then name
    const sortedCards = [...deck.cards].sort((a, b) => {
        const cardA = CARD_DATA.find(c => c.id === a);
        const cardB = CARD_DATA.find(c => c.id === b);

        // Handle missing cards gracefully
        if (!cardA || !cardB) {
            console.warn('[SORT] Missing card data:', { a, cardA, b, cardB });
            return 0; // Keep original order if either card is missing
        }

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
                    // Newest minion is at the end
                    const sourceEl = board.children[board.children.length - 1];

                    let destEl = null;
                    if (action.target.type === 'HERO') {
                        // AI perspective side: 'OPPONENT' is Player, 'PLAYER' is AI.
                        destEl = (action.target.side === 'OPPONENT') ? document.getElementById('player-hero') : document.getElementById('opp-hero');
                    } else if (action.target.type === 'MINION') {
                        const targetBoardId = (action.target.side === 'OPPONENT') ? 'player-board' : 'opp-board';
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
                        else if (type === 'DAMAGE_NON_CATEGORY') {
                            color = '#ff0000';
                            effectType = 'DAMAGE';
                        }

                        await animateAbility(sourceEl, destEl, color);
                        triggerCombatEffect(destEl, effectType);

                        // Log AI Battlecry history
                        const sourceName = card.name;
                        const destSide = action.target.side === 'OPPONENT' ? 'PLAYER' : 'OPPONENT';
                        const destName = getUnitName(destSide, action.target.index, action.target.type);

                        const isAiNews = card.type === 'NEWS';
                        const aiValue = card.keywords?.battlecry?.value || card.keywords?.battlecry?.bonus_value || 0;

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
                const attackerEl = document.getElementById('opp-board').children[attackerIdx];
                const targetEl = targetType === 'HERO' ? document.getElementById('player-hero') : document.getElementById('player-board').children[targetIndex];

                if (attackerEl && targetEl) {
                    await animateAttack(attackerEl, targetEl);
                }

                // 取得攻擊者和傷害數值
                const attacker = gameState.opponent.board[attackerIdx];
                const attackerName = getUnitName('OPPONENT', attackerIdx, 'MINION');
                const tSide = action.target.side === 'OPPONENT' ? 'OPPONENT' : 'PLAYER';
                const targetName = getUnitName(tSide, targetIndex, targetType);
                const damage = attacker ? attacker.attack : 0;

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
    const isPlayerTurn = gameState.currentPlayerIdx === 0;
    const playerInd = document.getElementById('indicator-player');
    const oppInd = document.getElementById('indicator-opp');
    const endBtn = document.getElementById('end-turn-btn');

    if (playerInd && oppInd) {
        if (isPlayerTurn) {
            playerInd.classList.add('active');
            oppInd.classList.remove('active');
            if (endBtn) endBtn.disabled = false;
        } else {
            playerInd.classList.remove('active');
            oppInd.classList.add('active');
            if (endBtn) endBtn.disabled = true;
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

    document.querySelector('#player-deck .count-badge').innerText = p1.deck.length;
    document.querySelector('#opp-deck .count-badge').innerText = p2.deck.length;

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
    // Expose for external calls
    window.render = render;

    // Safety check just in case
    if (!gameState) return;
    const p1 = gameState.players[0];
    const p2 = gameState.players[1];

    renderGameUI(p1, p2);
    renderHands(p1, p2);
    renderBoards(p1, p2);
}


async function resolveDeaths() {
    // window.resolveDeaths assignment moved to end of function or outside
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

function endGame(result) {
    const resultView = document.getElementById('game-result-view');
    const resultText = document.getElementById('result-status-text');

    resultText.innerText = result === 'VICTORY' ? '勝利' : '敗北';
    resultText.className = `result-text ${result === 'VICTORY' ? 'victory-text' : 'defeat-text'}`;

    showView('game-result-view');
    document.getElementById('game-result-view').style.display = 'flex'; // Ensure flex
}


function renderMana(containerId, mana) {
    const container = document.getElementById(containerId);
    const textEl = document.getElementById(containerId === 'player-mana-container' ? 'player-mana-text' : 'opp-mana-text');

    container.innerHTML = '';

    for (let i = 0; i < 10; i++) {
        const crystal = document.createElement('div');
        crystal.className = 'mana-crystal';
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

    const base = CARD_DATA.find(c => c.id === card.id) || card;
    let statsHtml = '';
    if (card.attack !== undefined && card.health !== undefined && card.type !== 'NEWS') {
        const effectiveBaseAttack = card.baseAttackOverride !== undefined ? card.baseAttackOverride : base.attack;
        const atkClass = card.attack > effectiveBaseAttack ? 'stat-buffed' : (card.attack < effectiveBaseAttack ? 'stat-damaged' : '');
        const hpClass = (card.currentHealth !== undefined && card.currentHealth < card.health) ? 'stat-damaged' : (card.health > base.health ? 'stat-buffed' : '');
        const hpValue = card.currentHealth !== undefined ? card.currentHealth : card.health;

        // 屬性在最下方 (Stats at bottom) - Revised padding for more description space
        statsHtml = `
        <div class="minion-stats" style="margin-top: auto; padding: 5px 20px 10px 20px; display: flex; justify-content: space-between; width: 100%;">
            <span class="stat-atk ${atkClass}" style="width: 70px; height: 70px; font-size: 32px;"><span>${card.attack}</span></span>
            <span class="stat-hp ${hpClass}" style="width: 70px; height: 70px; font-size: 32px;">${hpValue}</span>
        </div>`;
    }
    // height: 140px; 圖片高度
    const artHtml = card.image ?
        `<div class="card-art" style="width: 100%; height: 140px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 4px; margin: 10px auto 5px auto; border: 1px solid rgba(255,255,255,0.2);"></div>` :
        `<div class="card-art" style="width: 100%; height: 140px; background: #333; margin: 10px auto 5px auto; border-radius: 4px;"></div>`;

    const baseCard = CARD_DATA.find(c => c.id === card.id) || card;

    // Calculate actual cost for preview
    let actualCost = card.cost;
    if (gameState && card.type === 'NEWS' && gameState.players && gameState.players[0]) {
        // Use the same logic as createCardEl for consistency
        const player = gameState.players[0];
        player.board.forEach(minion => {
            if (minion.keywords?.ongoing?.type === 'REDUCE_NEWS_COST') {
                actualCost -= minion.keywords.ongoing.value;
            }
        });
        actualCost = Math.max(0, actualCost);
    } else if (gameState && typeof gameState.getCardActualCost === 'function') {
        actualCost = gameState.getCardActualCost(card);
    }

    const isReduced = actualCost < baseCard.cost || card.isReduced;
    const costClass = isReduced ? 'cost-reduced' : '';

    const bonus = (gameState && card.id) ? (gameState.getNewsPower(card.side || 'PLAYER') || 0) : 0;
    const isNews = card.type === 'NEWS';
    const bcType = card.keywords?.battlecry?.type || '';

    // Strict rules: Only DAMAGE and HEAL related effects get bonus
    const isDamage = bcType.includes('DAMAGE');
    const isHeal = bcType.includes('HEAL') || bcType.includes('RECOVER');
    const isExcluded = bcType.includes('DRAW') || bcType.includes('COST') || bcType.includes('REDUCE');
    const effectiveBonus = (isNews && (isDamage || isHeal) && !isExcluded) ? bonus : 0;

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
                <div style="position: relative; display: flex; align-items: center; width: 100%; margin-bottom: 4px; height: 30px;">
                    <div class="card-cost ${costClass}" style="position: relative; width:24px; height:24px; font-size:13px; flex-shrink: 0; z-index: 10; transform: rotate(45deg); margin-left: 4px;"><span>${actualCost ?? 0}</span></div>
                    <div class="card-title" style="font-size:20px; position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); margin: 0; text-align: center; text-shadow: 0 0 5px black; z-index: 5;">${card.name || "未知卡片"}</div>
                </div>
                
                ${artHtml}
                
                <div class="card-category" style="font-size:12px; padding: 1px 4px; margin-bottom: 4px; text-align:center; color:#aaa;">${card.category || ""}</div>
                
                <div class="card-desc" style="font-size:13px; padding: 0 8px; line-height: 1.3; height: auto; flex-grow: 1; overflow: hidden; text-align: center; white-space: pre-wrap;">${formatDesc(card.description || "", effectiveBonus, isNews)}</div>
                
                ${statsHtml ? statsHtml.replace(/margin-top: auto;/, 'margin-top: auto; display: flex;').replace(/width: 70px; height: 70px; font-size: 32px;/g, 'width: 50px; height: 50px; font-size: 24px;') : ''}
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
        el.addEventListener('mousedown', (e) => onDragStart(e, index, true));
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
    el.className = `minion ${minion.keywords?.taunt ? 'taunt' : ''} ${minion.sleeping ? 'sleeping' : ''} ${showCanAttack ? 'can-attack' : ''}${dsClass}${enrageClass}${lockedClass}${unlockClass}${summonClass}`;
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
        el.addEventListener('mousedown', (e) => onDragStart(e, index));
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

        msgEl.innerText = message;
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

    aiThemeDecks.forEach(theme => {
        const group = document.createElement('div');
        group.className = 'deck-option-group';

        const emojis = { 'dpp': '🟢', 'kmt': '🔵', 'tpp': '🟡' };
        group.innerHTML = `
            <div class="option-item" data-deck-id="${theme.id}" data-image="${theme.image}" data-desc="${deckDescriptions[theme.id] || '請輸入描述...'}">
                <span class="option-icon">${emojis[theme.id] || '🎴'}</span>
                <span class="option-label">${deckNames[theme.id] || theme.name}</span>
                <span class="expand-arrow">▶</span>
            </div>
            <div class="difficulty-options">
                <div class="sub-difficulty-btn" data-value="NORMAL">普通級</div>
                <div class="sub-difficulty-btn" data-value="HARD">專家級</div>
                <div class="sub-difficulty-btn" data-value="HELL">大師級</div>
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
    const deckIds = player.deck.map(card => card.id);

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

// Start Game
document.addEventListener('DOMContentLoaded', () => {
    init(); // Initialize listeners and engine

    // Check Auth
    const user = AuthManager.checkAuth();
    if (user) {
        onUserLogin(user);
    } else {
        showView('auth-view');
    }
});

function logMessage(msg) {
    const logEl = document.getElementById('message-log');
    if (logEl) {
        logEl.innerText = msg;
        logEl.style.opacity = '1';

        // Cancel previous timer if exists
        if (logEl.timeout) clearTimeout(logEl.timeout);

        logEl.timeout = setTimeout(() => {
            logEl.style.opacity = '0';
        }, 2000);
    }
    // Also log to console for debugging
    console.log(`[GAME] ${msg}`);
}
// Final global exposures
window.resolveDeaths = resolveDeaths;
window.animateAttack = animateAttack; // Expose for any legacy calls or specific logic expects it globally
window.logMessage = logMessage;
