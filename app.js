let gameEngine;
let gameState;
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

let aiThemeDecks = JSON.parse(localStorage.getItem('aiThemeDecks')) || [
    { id: 'dpp', name: '民進黨牌組', image: 'img/lai_illustration.png', cards: DEFAULT_THEME_DECKS.dpp },
    { id: 'dpp2', name: '民進黨牌組2', image: 'img/tsai_illustration.png', cards: DEFAULT_THEME_DECKS.dpp2 },
    { id: 'kmt', name: '國民黨牌組', image: 'img/han_illustration.png', cards: DEFAULT_THEME_DECKS.kmt },
    { id: 'kmt2', name: '國民黨牌組2', image: 'img/fu_kun_chi.png', cards: DEFAULT_THEME_DECKS.kmt2 },
    { id: 'tpp', name: '民眾黨牌組', image: 'img/ko_illustration.png', cards: DEFAULT_THEME_DECKS.tpp }
];
let editingThemeIdx = -1; // -1 means not editing theme



// Ensure valid Slot 2 if empty or broken (for testing convenience)
if (userDecks[1].cards.length === 0) {
    const defaultDeck = [];
    const allIds = CARD_DATA.map(c => c.id);
    for (let i = 0; i < 30; i++) {
        defaultDeck.push(allIds[i % allIds.length]);
    }
    userDecks[1].cards = defaultDeck;
}
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
    dragLine = document.getElementById('drag-line');

    gameEngine = new GameEngine(CARD_DATA);

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

document.getElementById('btn-surrender').addEventListener('click', () => {
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
                preview.style.zIndex = '20002';

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

// Global drag events
document.addEventListener('mousemove', onDragMove);
document.addEventListener('mouseup', onDragEnd);

// Initial view
showView('main-menu');


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

function endGame(result) {
    const resultView = document.getElementById('game-result-view');
    const resultText = document.getElementById('result-status-text');

    resultText.innerText = result === 'VICTORY' ? '勝利' : '敗北';
    resultText.className = `result-text ${result === 'VICTORY' ? 'victory-text' : 'defeat-text'}`;

    showView('game-result-view');
    document.getElementById('game-result-view').style.display = 'flex'; // Ensure flex
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

                    // 2. Render to show the minion LANDING on the board
                    render();

                    // 3. Trigger Dust at newly played minion (Capture from fresh DOM)
                    const boardEl = document.getElementById('player-board');
                    const newMinionEl = boardEl.children[currentInsertionIndex];
                    if (newMinionEl && playedCard.type === 'MINION') {
                        spawnDustEffect(newMinionEl, playedCard.cost >= 7 ? 2 : 1);
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
            const index = parseInt(targetData.dataset.index);

            if (type === 'HERO' && targetData.id === 'opp-hero'
                || type === 'MINION' && targetEl.closest('#opp-board')) {

                try {
                    const sourceEl = document.getElementById('player-board').children[attackerIndex];
                    if (sourceEl && targetData) {
                        await animateAttack(sourceEl, targetData);
                    }

                    // 取得攻擊者和目標名稱
                    const attacker = gameState.currentPlayer.board[attackerIndex];
                    const attackerName = getUnitName('PLAYER', attackerIndex, 'MINION');
                    const targetName = getUnitName(targetData.id === 'opp-hero' ? 'OPPONENT' : 'OPPONENT', index, type);
                    const damage = attacker ? attacker.attack : 0;

                    // 記錄普通攻擊
                    MatchHistory.add('NORMAL_ATTACK', {
                        attacker: attackerName,
                        target: targetName,
                        damage: damage
                    });

                    gameState.attack(attackerIndex, { type, index });
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
                if (battlecrySourceType === 'NEWS') {
                    // For News: Now we play it
                    const card = gameState.currentPlayer.hand[battlecrySourceIndex];
                    MatchHistory.add('PLAY', {
                        player: "你",
                        card: card.name
                    });
                    gameState.playCard(battlecrySourceIndex, target);
                } else {
                    // For Minion: It's already pending on board, just resolve battlecry
                    const minionInfo = gameState.currentPlayer.board[battlecrySourceIndex];
                    if (minionInfo && minionInfo.keywords?.battlecry) {
                        gameState.resolveBattlecry(minionInfo.keywords.battlecry, target, minionInfo);
                    }
                }

                // Log target effect after resolution
                console.log('[TARGETED BATTLECRY] Logging:', draggingMode, 'source:', sourceName, 'target:', destName);
                console.log('[TARGETED BATTLECRY] battlecrySourceType:', battlecrySourceType, 'battlecryTargetRule:', battlecryTargetRule);

                // 區分新聞牌和隨從
                const isNews = battlecrySourceType === 'NEWS';
                const value = battlecryTargetRule?.value || battlecryTargetRule?.bonus_value || 0;

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
 */
function animateAttack(fromEl, toEl) {
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

        // Initial Position
        clone.style.top = `${rectFrom.top}px`;
        clone.style.left = `${rectFrom.left}px`;
        clone.style.width = `${rectFrom.width}px`;
        clone.style.height = `${rectFrom.height}px`;
        clone.style.margin = '0'; // Clear margins

        document.body.appendChild(clone);

        // Force Reflow
        void clone.offsetWidth;

        // Target Position
        // Center to Center
        const centerX = rectTo.left + rectTo.width / 2 - rectFrom.width / 2;
        const centerY = rectTo.top + rectTo.height / 2 - rectFrom.height / 2;

        clone.style.top = `${centerY}px`;
        clone.style.left = `${centerX}px`;
        clone.style.transform = "scale(1.2)"; // Bigger on impact

        // On Transition End (Impact)
        setTimeout(() => {
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
            ripple.className = 'ripple-wave ripple-active';
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
        'kmt2': '傅崑萁-江湖棄殺',
        'tpp': '柯文哲-台大醫科'
    };

    // Deck Description mapping (Edit here)
    const deckDescriptions = {
        'dpp': '透過賴清德強力的新聞數值造成高傷害的疊加牌組',
        'dpp2': '透過沉默、回手牌使輕易使戰場扭轉局面的奇幻蔡英文牌組',
        'kmt': '以韓國瑜為核心透過不斷來回進出戰場來增加體質強度的黏濁牌組',
        'kmt2': '以傅崑萁與棄牌機制為核心，透過頻繁棄牌觸發強大增益與召喚效果的強力快攻牌組',
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
