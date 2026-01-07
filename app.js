let gameEngine;
let gameState;
// Embedded Card Data to avoid CORS issues
const CARD_DATA = [
    { "id": "TW001", "name": "窮酸大學生", "category": "學生", "cost": 1, "attack": 1, "health": 2, "type": "MINION", "rarity": "COMMON", "description": "一個窮學生。", "image": "img/c001.png" },
    { "id": "TW002", "name": "小草大學生", "category": "學生", "cost": 1, "attack": 1, "health": 1, "type": "MINION", "rarity": "COMMON", "keywords": { "battlecry": { "type": "DAMAGE", "value": 1, "target": "ANY" } }, "description": "戰吼：隨機 1 點傷害。", "image": "img/c004.png" },
    { "id": "TW003", "name": "大樓保全", "category": "勞工", "cost": 2, "attack": 1, "health": 2, "type": "MINION", "rarity": "COMMON", "keywords": { "taunt": true }, "description": "嘲諷。", "image": "img/c002.png" },
    { "id": "TW004", "name": "條碼師", "category": "勞工", "cost": 2, "attack": 1, "health": 4, "type": "MINION", "rarity": "COMMON", "description": "五杯大冰拿", "image": "img/tw008.png" },
    { "id": "TW005", "name": "水電徒弟", "category": "勞工", "cost": 2, "attack": 2, "health": 3, "type": "MINION", "rarity": "COMMON", "description": "", "image": "img/tw010.png" },
    { "id": "TW006", "name": "廟口管委", "category": "勞工", "cost": 3, "attack": 3, "health": 2, "type": "MINION", "rarity": "COMMON", "description": "維持不需要維持的秩序。", "image": "img/c013.png" },
    { "id": "TW007", "name": "外送師", "category": "勞工", "cost": 3, "attack": 3, "health": 1, "type": "MINION", "rarity": "COMMON", "keywords": { "charge": true }, "description": "戰吼:可以直接攻擊 大喊我是外送師", "image": "img/tw007.png" },
    { "id": "TW008", "name": "手搖員工", "category": "勞工", "cost": 3, "attack": 2, "health": 2, "type": "MINION", "rarity": "RARE", "keywords": { "battlecry": { "type": "HEAL", "value": 2, "target": "ANY" } }, "description": "戰吼: 回復一個單位2點血量", "image": "img/tw014.png" },
    { "id": "TW009", "name": "台積電工程師", "category": "勞工", "cost": 3, "attack": 2, "health": 2, "type": "MINION", "rarity": "RARE", "keywords": { "enrage": { "type": "BUFF_STAT", "stat": "ATTACK", "value": 3 } }, "description": "激怒: 增加3點攻擊 極度耐操", "image": "img/tw015.png" },
    { "id": "TW010", "name": "謝長廷", "category": "民進黨政治人物", "cost": 3, "attack": 3, "health": 3, "type": "MINION", "rarity": "EPIC", "description": "戰吼: 對一個非民進黨政治人物造成3點傷害", "keywords": { "battlecry": { "type": "DAMAGE_NON_CATEGORY", "value": 3, "target": "ANY", "target_category": "民進黨政治人物" } }, "image": "img/tw011.jpg" },
    { "id": "TW011", "name": "柯文哲", "category": "民眾黨政治人物", "cost": 4, "attack": 3, "health": 3, "type": "MINION", "rarity": "LEGENDARY", "keywords": { "battlecry": { "type": "HEAL_ALL_FRIENDLY" } }, "description": "戰吼：將自己戰場上的卡牌血量全部回復。", "image": "img/tw001.png" },
    { "id": "TW012", "name": "四叉貓", "category": "公眾人物", "cost": 4, "attack": 1, "health": 1, "type": "MINION", "rarity": "RARE", "keywords": { "battlecry": { "type": "BUFF_ALL", "value": 1, "stat": "HEALTH" } }, "description": "戰吼：深綠能量！賦予所有友方隨從 +1 生命值。", "image": "img/tw003.jpg" },
    { "id": "TW013", "name": "水電師傅", "category": "勞工", "cost": 4, "attack": 3, "health": 4, "type": "MINION", "rarity": "COMMON", "keywords": { "taunt": true }, "description": "嘲諷", "image": "img/tw009.png" },
    { "id": "TW014", "name": "黃瀞瑩", "category": "民眾黨政治人物", "cost": 4, "attack": 3, "health": 2, "type": "MINION", "rarity": "EPIC", "keywords": { "battlecry": { "type": "HEAL", "value": 3, "target": "ANY" } }, "description": "戰吼：回復一個單位3點血量。", "image": "img/tw019.png" },
    { "id": "TW015", "name": "高虹安", "category": "民眾黨政治人物", "cost": 4, "attack": 3, "health": 3, "type": "MINION", "rarity": "EPIC", "keywords": { "battlecry": { "type": "GIVE_DIVINE_SHIELD", "target": "ANY" } }, "description": "戰吼：賦予一個單位「光盾」。", "image": "img/tw020.png" },
    { "id": "TW016", "name": "吳敦義", "category": "國民黨政治人物", "cost": 5, "attack": 1, "health": 3, "type": "MINION", "rarity": "EPIC", "keywords": { "battlecry": { "type": "BUFF_ALL", "value": 1, "stat": "ATTACK" } }, "description": "戰吼：深藍能量！賦予所有友方隨從 +1 攻擊力。", "image": "img/tw002.png" },
    { "id": "TW017", "name": "勞工局", "category": "政府機關", "cost": 5, "attack": 0, "health": 5, "type": "MINION", "rarity": "EPIC", "keywords": { "battlecry": { "type": "BUFF_CATEGORY", "value": 2, "stat": "HEALTH", "target_category": "勞工" } }, "description": "戰吼: 賦予所有\"勞工\"血量上限+2", "image": "img/tw013.png" },
    { "id": "TW018", "name": "台積電", "category": "企業", "cost": 5, "attack": 0, "health": 10, "type": "MINION", "rarity": "EPIC", "keywords": { "taunt": true, "battlecry": { "type": "DAMAGE_RANDOM_FRIENDLY", "value": 2 } }, "description": "嘲諷+戰吼: 造成\"我方\"隨機一個單位2點傷害", "image": "img/tw016.png" },
    { "id": "TW019", "name": "陳珮琪", "category": "民眾黨政治人物", "cost": 5, "attack": 4, "health": 3, "type": "MINION", "rarity": "RARE", "keywords": { "divineShield": true }, "description": "光盾。司法不公！！！", "image": "img/tw021.png" },
    { "id": "TW020", "name": "蔡英文", "category": "民進黨政治人物", "cost": 6, "attack": 4, "health": 4, "type": "MINION", "rarity": "LEGENDARY", "keywords": { "battlecry": { "type": "BOUNCE_ALL_ENEMY" } }, "description": "戰吼:將對手場上卡牌全部放回手牌", "image": "img/tw006.png" },
    { "id": "TW021", "name": "黃國昌", "category": "民眾黨政治人物", "cost": 7, "attack": 4, "health": 5, "type": "MINION", "rarity": "EPIC", "keywords": { "charge": true, "enrage": { "type": "BUFF_STAT", "stat": "ATTACK", "value": 3 } }, "description": "衝鋒。激怒：+3攻擊。你在大聲甚麼！！！", "image": "img/tw018.png" },
    { "id": "TW022", "name": "老草中年", "category": "勞工", "cost": 2, "attack": 2, "health": 2, "type": "MINION", "rarity": "COMMON", "keywords": { "divineShield": true }, "description": "光盾", "image": "img/TW022.png" },
    { "id": "TW026", "name": "黃珊珊", "category": "民眾黨政治人物", "cost": 2, "attack": 1, "health": 1, "type": "MINION", "rarity": "RARE", "keywords": { "divineShield": true, "taunt": true }, "description": "光盾。嘲諷。珊言良語", "image": "img/TW026.png" },
    { "id": "TW023", "name": "陳玉珍", "category": "國民黨政治人物", "cost": 7, "attack": 3, "health": 8, "type": "MINION", "rarity": "EPIC", "keywords": { "taunt": true }, "description": "嘲諷。金門坦克。", "image": "img/tw017.png" },
    { "id": "TW025", "name": "民眾黨黨部", "category": "民眾黨機關", "cost": 8, "attack": 0, "health": 4, "type": "MINION", "rarity": "EPIC", "keywords": { "battlecry": { "type": "GIVE_DIVINE_SHIELD_ALL" } }, "description": "戰吼：賦予所有友方角色「光盾」。", "image": "img/TW025.png" },
    { "id": "TW024", "name": "馬英九", "category": "國民黨政治人物", "cost": 9, "attack": 3, "health": 4, "type": "MINION", "rarity": "LEGENDARY", "keywords": { "battlecry": { "type": "DESTROY", "target": "ANY" } }, "description": "戰吼: 直接擊殺一個單位", "image": "img/tw012.png" },
    { "id": "TW027", "name": "館長", "category": "公眾人物", "cost": 10, "attack": 3, "health": 8, "type": "MINION", "rarity": "RARE", "keywords": { "enrage": { "type": "BUFF_STAT", "stat": "ATTACK", "value": 5 } }, "description": "激怒：+5攻擊。要頭腦有肌肉", "image": "img/TW027.png" },
    { "id": "S001", "name": "發票中獎", "category": "法術", "cost": 2, "type": "SPELL", "rarity": "COMMON", "description": "抽 2 張牌。", "image": "img/tw004.png" },
    { "id": "S002", "name": "彈劾賴皇", "category": "法術", "cost": 10, "type": "SPELL", "rarity": "EPIC", "description": "造成 10 點傷害。", "image": "img/tw005.png" }
];

let cardDB = [];

// Load cards manually (modified for local file access)
// Game state for deck builder
let userDecks = JSON.parse(localStorage.getItem('userDecks')) || [
    { name: "預設牌組 1", cards: [] },
    { name: "預設牌組 2", cards: [] },
    { name: "預設牌組 3", cards: [] }
];

function migrateDecks() {
    // Migration Map to translate old IDs to new ones
    const map = {
        'c001': 'TW001', 'c004': 'TW002', 'c002': 'TW003', 'tw008': 'TW004',
        'tw010': 'TW005', 'c013': 'TW006', 'tw007': 'TW007', 'tw014': 'TW008',
        'tw015': 'TW009', 'tw011': 'TW010', 'tw001': 'TW011', 'tw003': 'TW012',
        'tw009': 'TW013', 'tw019': 'TW014', 'tw020': 'TW015', 'tw002': 'TW016',
        'tw013': 'TW017', 'tw016': 'TW018', 'tw021': 'TW019', 'tw006': 'TW020',
        'tw018': 'TW021', 'tw017': 'TW023', 'tw012': 'TW024',
        'tw004': 'S001', 'tw005': 'S002'
    };

    let needsUpdate = false;
    userDecks.forEach(deck => {
        if (!deck.cards) deck.cards = [];
        const originalLength = deck.cards.length;
        deck.cards = deck.cards.map(id => {
            if (map[id]) {
                needsUpdate = true;
                return map[id];
            }
            return id;
        }).filter(id => {
            const cardExists = CARD_DATA.some(c => c.id === id);
            if (!cardExists) needsUpdate = true;
            return cardExists;
        });

        if (deck.cards.length !== originalLength) needsUpdate = true;
    });

    if (needsUpdate) {
        localStorage.setItem('userDecks', JSON.stringify(userDecks));
        console.log("Decks migrated and cleaned up.");
    }
}

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
let editingDeckIdx = 0;
// editingDeckIdx was duplicate
let pendingViewMode = 'BATTLE'; // 'BATTLE' or 'BUILDER'
let currentSort = { field: 'cost', direction: 'asc' }; // 'cost', 'category', 'rarity'

function init() {
    migrateDecks();
    gameEngine = new GameEngine(CARD_DATA);

    // --- Main Menu Listeners ---
    document.getElementById('btn-main-battle').addEventListener('click', () => {
        showView('mode-selection');
    });

    document.getElementById('btn-main-builder').addEventListener('click', () => {
        pendingViewMode = 'BUILDER';
        showView('deck-selection');
        document.getElementById('deck-select-title').innerText = '選擇要編修的牌組';
        renderDeckSelect();
    });

    // --- Mode Selection Listeners ---
    document.getElementById('btn-mode-ai').addEventListener('click', () => {
        pendingViewMode = 'BATTLE';
        showView('deck-selection');
        document.getElementById('deck-select-title').innerText = '選擇出戰牌組';
        renderDeckSelect();
    });

    // --- Back Buttons ---
    document.querySelectorAll('.btn-back').forEach(btn => {
        btn.addEventListener('click', () => {
            if (document.getElementById('mode-selection').style.display === 'flex') {
                showView('main-menu');
            } else if (document.getElementById('deck-selection').style.display === 'flex') {
                if (pendingViewMode === 'BATTLE') showView('mode-selection');
                else showView('main-menu');
            }
        });
    });

    document.getElementById('btn-builder-back').addEventListener('click', () => {
        showView('deck-selection');
        renderDeckSelect();
    });

    // --- Deck Builder Listeners ---
    document.getElementById('btn-save-deck').addEventListener('click', () => {
        const nameInput = document.getElementById('deck-name-input');
        userDecks[editingDeckIdx].name = nameInput.value || `牌組 ${editingDeckIdx + 1}`;
        localStorage.setItem('userDecks', JSON.stringify(userDecks));
        showToast("保存成功！");
        renderDeckBuilder();
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
document.getElementById('end-turn-btn').addEventListener('click', () => {
    try {
        gameState.endTurn();
        render();
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

// --- Result View Listeners ---
document.getElementById('btn-result-continue').addEventListener('click', () => {
    showView('main-menu');
});

// Global drag events
document.addEventListener('mousemove', onDragMove);
document.addEventListener('mouseup', onDragEnd);

// Initial view
showView('main-menu');


function renderDeckSelect() {
    const container = document.getElementById('deck-select-slots');
    container.innerHTML = '';

    const startBtn = document.getElementById('btn-start-battle');
    if (startBtn) {
        startBtn.style.display = pendingViewMode === 'BATTLE' ? 'block' : 'none';
        startBtn.onclick = () => {
            const deck = userDecks[selectedDeckIdx];
            if (deck.cards.length === 30) {
                startBattle(deck.cards);
            } else {
                alert(`「${deck.name}」目前有 ${deck.cards.length} 張卡，需要剛好 30 張才能戰鬥！`);
            }
        };
    }

    userDecks.forEach((deck, idx) => {
        const slot = document.createElement('div');
        slot.className = `deck-slot ${idx === selectedDeckIdx ? 'selected' : ''}`;
        slot.innerHTML = `
            <h3>${deck.name}</h3>
            <div class="slot-info">${deck.cards.length} / 30 張卡</div>
            <div class="deck-slot-actions">
                <button class="neon-button action-btn">${pendingViewMode === 'BATTLE' ? '選擇' : '編輯'}</button>
            </div>
        `;

        slot.querySelector('.action-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (pendingViewMode === 'BUILDER') {
                editingDeckIdx = idx;
                showView('deck-builder');
                renderDeckBuilder();
            } else {
                selectedDeckIdx = idx;
                localStorage.setItem('selectedDeckIdx', selectedDeckIdx);
                renderDeckSelect(); // Refresh for selection
            }
        });

        slot.addEventListener('click', () => {
            selectedDeckIdx = idx;
            localStorage.setItem('selectedDeckIdx', selectedDeckIdx);
            renderDeckSelect();
        });

        container.appendChild(slot);
    });
}


function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const view = document.getElementById(viewId);
    if (view) view.style.display = 'flex';

    // Toggle message log visibility
    const log = document.getElementById('message-log');
    if (log) {
        log.style.display = (viewId === 'battle-view') ? 'flex' : 'none';
    }
}

let previousPlayerHandSize = 0;

async function startBattle(deckIds) {
    // Fill opponent deck with random cards
    const allIds = CARD_DATA.map(c => c.id);
    const oppDeck = [];
    while (oppDeck.length < 30) oppDeck.push(allIds[Math.floor(Math.random() * allIds.length)]);

    gameState = gameEngine.createGame(deckIds, oppDeck);

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
    const deck = userDecks[editingDeckIdx];
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

        cardEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (deck.cards.length < 30) {
                // Check legendary limit
                if (card.rarity === 'LEGENDARY') {
                    const legendCount = deck.cards.filter(id => {
                        const c = CARD_DATA.find(x => x.id === id);
                        return c?.rarity === 'LEGENDARY';
                    }).length;
                    if (legendCount >= 2) {
                        alert("傳說卡牌在牌組中最多只能放 2 張！");
                        return;
                    }
                }

                // Normal 2 copies limit
                const count = deck.cards.filter(id => id === card.id).length;
                if (count >= 2) {
                    alert("每種卡牌最多只能放 2 張！");
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

    document.getElementById('deck-count-indicator').innerText = `已選擇: ${deck.cards.length} / 30`;
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
    logMessage("Opponent is thinking...");
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

                logMessage(`Opponent plays ${card.name}`);

                await showCardPlayPreview(card, true);

                gameState.playCard(action.index, action.target);
                render();
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
                        if (type === 'HEAL') { color = '#43e97b'; effectType = 'HEAL'; }
                        else if (type === 'BUFF_STAT_TARGET') { color = '#ffa500'; effectType = 'BUFF'; }

                        await animateAbility(sourceEl, destEl, color);
                        triggerCombatEffect(destEl, effectType);
                    }
                } else if (card.keywords?.battlecry) {
                    const type = card.keywords.battlecry.type;
                    setTimeout(() => {
                        if (type === 'BUFF_ALL' || type === 'BUFF_CATEGORY') {
                            document.querySelectorAll('#opp-board .minion').forEach(m => triggerCombatEffect(m, 'BUFF'));
                        } else if (type === 'HEAL_ALL_FRIENDLY') {
                            document.querySelectorAll('#opp-board .minion').forEach(m => triggerCombatEffect(m, 'HEAL'));
                            triggerCombatEffect(document.getElementById('opp-hero'), 'HEAL');
                        }
                    }, 100);
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

                gameState.attack(attackerIdx, action.target);
                render();
                await resolveDeaths();
                await new Promise(r => setTimeout(r, 600));
            }

            moves++;
        }

        gameState.endTurn();
        render();
        showTurnAnnouncement("你的回合");
    } catch (e) {
        logMessage("AI Error: " + e.message);
        console.error(e);
        gameState.endTurn();
        render();
        showTurnAnnouncement("你的回合"); // Ensure turn passes back even on error
    }
}

function render() {
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

    const p1 = gameState.players[0];
    const p2 = gameState.players[1];

    renderMana('player-mana-container', p1.mana);
    renderMana('opp-mana-container', p2.mana);

    document.getElementById('player-hp').innerText = p1.hero.hp;
    document.getElementById('opp-hp').innerText = p2.hero.hp;

    const handEl = document.getElementById('player-hand');
    handEl.innerHTML = '';
    p1.hand.forEach((card, idx) => {
        handEl.appendChild(createCardEl(card, idx));
    });

    // Detect and animate new cards
    if (p1.hand.length > previousPlayerHandSize) {
        const newCount = p1.hand.length - previousPlayerHandSize;
        const children = handEl.children;
        // Only animate if it looks like a draw event (not a full reload from 0 to 30)
        // Ensure we don't crash if children count mismatch
        if (newCount > 0 && newCount < 15) {
            for (let i = Math.max(0, children.length - newCount); i < children.length; i++) {
                if (children[i]) animateCardFromDeck(children[i]);
            }
        }
    }
    previousPlayerHandSize = p1.hand.length;

    const oppHandEl = document.getElementById('opp-hand');
    oppHandEl.innerHTML = '';
    p2.hand.forEach(() => {
        const back = document.createElement('div');
        back.className = 'card';
        oppHandEl.appendChild(back);
    });

    // Apply Hearthstone-like Arc Logic
    [handEl, oppHandEl].forEach((container, cIdx) => {
        const cards = Array.from(container.children);
        const total = cards.length;
        const center = (total - 1) / 2;

        // Curvature parameters
        const degPerCard = 6;
        const yPerCard = 12; // Stronger curve

        cards.forEach((card, i) => {
            const delta = i - center;
            const rot = delta * degPerCard;
            // Parabolic Curve: y = x^2 * factor roughly
            const y = Math.abs(delta) * Math.abs(delta) * 2 + Math.abs(delta) * 5;

            card.style.setProperty('--rot', `${rot}deg`);
            card.style.setProperty('--y', `${y}px`);
        });
    });

    const boardEl = document.getElementById('player-board');
    boardEl.innerHTML = '';
    p1.board.forEach((minion, idx) => {
        boardEl.appendChild(createMinionEl(minion, idx, true));
    });

    const oppBoardEl = document.getElementById('opp-board');
    oppBoardEl.innerHTML = '';
    p2.board.forEach((minion, idx) => {
        oppBoardEl.appendChild(createMinionEl(minion, idx, false));
    });

    document.querySelector('#player-deck .count-badge').innerText = p1.deck.length;
    // document.querySelector('#player-discard .count-badge').innerText = p1.graveyard?.length || 0;
    document.querySelector('#opp-deck .count-badge').innerText = p2.deck.length;
    // document.querySelector('#opp-discard .count-badge').innerText = p2.graveyard?.length || 0;

    if (gameState.lastAction === 'attack') {
        // Implement visual shake if hit
    }

    // Check for Win/Loss
    if (gameState.winner !== null) {
        setTimeout(() => {
            endGame(gameState.winner === 0 ? 'VICTORY' : 'DEFEAT');
        }, 1000);
    }
}

async function resolveDeaths() {
    const dead = gameState.checkDeaths ? gameState.checkDeaths() : [];
    if (dead.length > 0) {
        // Animate deaths
        const boards = [document.getElementById('player-board'), document.getElementById('opp-board')];
        for (const death of dead) {
            const board = (death.side === 'PLAYER') ? boards[0] : boards[1];
            if (board && board.children[death.index]) {
                const el = board.children[death.index];
                await animateShatter(el);
            }
        }
        gameState.resolveDeaths();
        render();
    }
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
    if (card.attack !== undefined && card.health !== undefined) {
        const atkClass = card.attack > base.attack ? 'stat-buffed' : (card.attack < base.attack ? 'stat-damaged' : '');
        const hpClass = (card.currentHealth !== undefined && card.currentHealth < card.health) ? 'stat-damaged' : (card.health > base.health ? 'stat-buffed' : '');
        const hpValue = card.currentHealth !== undefined ? card.currentHealth : card.health;

        statsHtml = `
        <div class="minion-stats" style="margin-top: auto; padding: 20px;">
            <span class="stat-atk ${atkClass}" style="width: 70px; height: 70px; font-size: 32px;"><span>${card.attack}</span></span>
            <span class="stat-hp ${hpClass}" style="width: 70px; height: 70px; font-size: 32px;">${hpValue}</span>
        </div>`;
    }

    const artHtml = card.image ?
        `<div class="card-art" style="width: 90%; height: 220px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 8px; margin: 10px auto; border: 2px solid rgba(255,255,255,0.1);"></div>` :
        `<div class="card-art" style="width: 90%; height: 100px; background: #333; margin: 10px auto; border-radius: 8px;"></div>`;

    preview.innerHTML = `
        <div class="card rarity-${rarityClass} ${card.type === 'SPELL' ? 'spell-card' : ''}" style="width:280px; height:410px; transform:none !important; display: flex; flex-direction: column; justify-content: flex-start; padding-bottom: 0;">
            <div class="card-cost" style="width:60px; height:60px; font-size:32px; top: -5px; left: -5px;"><span>${card.cost}</span></div>
            
            <div class="card-title" style="font-size:24px; margin-top:80px; flex-shrink: 0;">${card.name}</div>
            
            ${artHtml.replace('height: 220px', 'height: 160px')}
            
            <div class="card-category" style="font-size:16px; padding: 2px 10px; margin-bottom: 5px; flex-shrink: 0;">${card.category || ""}</div>
            
            <div class="card-desc" style="font-size:16px; padding: 5px 15px; line-height: 1.3; flex-grow: 1; display: flex; align-items: flex-start; justify-content: center; height: auto; overflow: visible;">${card.description || ""}</div>
            
            ${statsHtml.replace(/70px/g, '65px').replace('32px', '30px')}
        </div>
    `;
    preview.style.display = 'block';
}

function hidePreview() {
    document.getElementById('card-preview').style.display = 'none';
}

function createCardEl(card, index) {
    const el = document.createElement('div');
    const rarityClass = card.rarity ? card.rarity.toLowerCase() : 'common';
    el.className = `card rarity-${rarityClass} ${card.type === 'SPELL' ? 'spell-card' : ''}`;

    const base = CARD_DATA.find(c => c.id === card.id) || card;
    let statsHtml = '';
    if (card.attack !== undefined && card.health !== undefined) {
        const atkClass = card.attack > base.attack ? 'stat-buffed' : (card.attack < base.attack ? 'stat-damaged' : '');
        const hpClass = (card.currentHealth !== undefined && card.currentHealth < card.health) ? 'stat-damaged' : (card.health > base.health ? 'stat-buffed' : '');
        const hpValue = card.currentHealth !== undefined ? card.currentHealth : card.health;

        statsHtml = `
        <div class="minion-stats">
            <span class="stat-atk ${atkClass}"><span>${card.attack}</span></span>
            <span class="stat-hp ${hpClass}">${hpValue}</span>
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

    el.innerHTML = `
        <div class="card-cost"><span>${card.cost}</span></div>
        
        <!-- Header spacer for Cost bubble -->
        <div style="width: 100%; height: 10px;"></div>
        
        <div class="card-title" style="margin: 2px 0; font-size: 10px; z-index: 5; text-shadow: 0 1px 2px #000;">${card.name}</div>
        
        ${artHtml}
        
        <div class="card-category" style="margin: 2px 0; font-size: 7px;">${card.category || ""}</div>
        
        <div class="card-desc" style="font-size: 8px; line-height: 1.1; overflow: hidden; padding: 2px; flex-grow: 1; display:flex; align-items:flex-start; justify-content:center;">${card.description || ""}</div>
        
        <!-- Stats are absolute positioned in CSS usually, but let's check -->
        ${statsHtml}
    `;

    // Preview Interaction
    el.addEventListener('mouseenter', (e) => {
        const preview = document.getElementById('card-preview');
        const builderView = document.getElementById('deck-builder');

        if (builderView && builderView.style.display === 'flex') {
            // Builder Mode: Avoid overlap
            const screenWidth = window.innerWidth;
            if (e.clientX < screenWidth / 2) {
                // Cursor Left -> Show Right
                preview.style.left = 'auto';
                preview.style.right = '40px';
                preview.style.top = '50%';
                preview.style.transform = 'translateY(-50%)';
            } else {
                // Cursor Right -> Show Left
                preview.style.right = 'auto';
                preview.style.left = '40px';
                preview.style.top = '50%';
                preview.style.transform = 'translateY(-50%)';
            }
        } else {
            // Battle Mode (Hand): Fixed Left Top
            preview.style.top = '20%';
            preview.style.left = '20px';
            preview.style.right = 'auto';
            preview.style.bottom = 'auto';
            preview.style.transform = 'none';
        }
        showPreview(card);
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
    el.className = `minion ${minion.keywords?.taunt ? 'taunt' : ''} ${minion.sleeping ? 'sleeping' : ''} ${minion.canAttack && isPlayer ? 'can-attack' : ''}${dsClass}`;
    const imageStyle = minion.image ? `background: url('${minion.image}') no-repeat center; background-size: cover;` : '';
    const base = CARD_DATA.find(c => c.id === minion.id) || minion;
    const atkClass = minion.attack > base.attack ? 'stat-buffed' : (minion.attack < base.attack ? 'stat-damaged' : '');
    const hpClass = minion.currentHealth < minion.health ? 'stat-damaged' : (minion.health > base.health ? 'stat-buffed' : '');

    el.innerHTML = `
        <div class="minion-art" style="${imageStyle}"></div>
        <div class="card-title">${minion.name}</div>
        <div class="minion-stats">
            <span class="stat-atk ${atkClass}"><span>${minion.attack}</span></span>
            <span class="stat-hp ${hpClass}">${minion.currentHealth}</span>
        </div>
    `;

    // Preview Interaction
    el.addEventListener('mouseenter', () => showPreview(minion));
    el.addEventListener('mouseleave', hidePreview);

    // Attack Drag Start
    if (isPlayer && minion.canAttack && gameState.currentPlayerIdx === 0) {
        el.addEventListener('mousedown', (e) => onDragStart(e, index));
    }

    // Target Drop Data (Needed for both enemy attacks AND friendly buffs)
    el.dataset.type = 'MINION';
    el.dataset.index = index;

    return el;
}

let dragging = false;
let attackerIndex = null;
let draggingFromHand = false;
let draggedEl = null;
let isBattlecryTargeting = false;
let battlecrySourceIndex = null;
let draggingMode = 'DAMAGE'; // 'DAMAGE' or 'HEAL'
let currentInsertionIndex = -1;

const dragLine = document.getElementById('drag-line');

function onDragStart(e, index, fromHand = false) {
    if (gameState.currentPlayerIdx !== 0) return;
    if (isBattlecryTargeting) return; // Finish targeting first

    const card = gameState.currentPlayer.hand[index];
    if (fromHand && card && gameState.currentPlayer.mana.current < card.cost) {
        shakeManaContainer(true);
    }

    dragging = true;
    attackerIndex = index;
    draggingFromHand = fromHand;
    draggingMode = 'DAMAGE'; // Reset to default

    dragLine.classList.remove('battlecry-line', 'heal-line', 'buff-line');
    dragLine.setAttribute('x1', e.clientX);
    dragLine.setAttribute('y1', e.clientY);
    dragLine.setAttribute('x2', e.clientX);
    dragLine.setAttribute('y2', e.clientY);
    dragLine.style.display = 'block';

    if (fromHand) {
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
    }
}

function updateDraggedElPosition(x, y) {
    if (!draggedEl) return;
    draggedEl.style.left = `${x - 60}px`;
    draggedEl.style.top = `${y - 85}px`;
}

function onDragMove(e) {
    if (!dragging && !isBattlecryTargeting) return;

    if (dragging) {
        dragLine.setAttribute('x2', e.clientX);
        dragLine.setAttribute('y2', e.clientY);

        if (draggingFromHand) {
            updateDraggedElPosition(e.clientX, e.clientY);

            // Highlight board and calculate insertion index if hovering
            const targetEl = document.elementFromPoint(e.clientX, e.clientY);
            const board = document.getElementById('player-board');
            const isPlayerArea = targetEl?.closest('.player-area.player') || targetEl?.id === 'player-board';

            if (isPlayerArea) {
                board.classList.add('drop-highlight');

                // Calculate insertion index
                const minions = Array.from(board.children);
                if (minions.length === 0) {
                    currentInsertionIndex = 0;
                } else {
                    let found = false;
                    for (let i = 0; i < minions.length; i++) {
                        const rect = minions[i].getBoundingClientRect();
                        const centerX = rect.left + rect.width / 2;
                        if (e.clientX < centerX) {
                            currentInsertionIndex = i;
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        currentInsertionIndex = minions.length;
                    }
                }
            } else {
                board.classList.remove('drop-highlight');
                currentInsertionIndex = -1;
            }
        }
    } else if (isBattlecryTargeting) {
        // Redraw green line from the "pending" card to mouse
        dragLine.setAttribute('x2', e.clientX);
        dragLine.setAttribute('y2', e.clientY);
    }
}

async function onDragEnd(e) {
    if (!dragging && !isBattlecryTargeting) return;

    const board = document.getElementById('player-board');
    board.classList.remove('drop-highlight');

    if (dragging) {
        dragging = false;
        dragLine.style.display = 'none'; // Ensure hide when dragging ends
        dragLine.setAttribute('x1', 0); // Reset coords
        dragLine.setAttribute('y1', 0);

        if (draggingFromHand) {
            // Cleanup visual ghost
            if (draggedEl) {
                draggedEl.remove();
                draggedEl = null;
            }
            const originalEl = document.getElementById('player-hand').children[attackerIndex];
            if (originalEl) originalEl.style.opacity = '1';

            // Temporarily hide ghost to see what's underneath
            if (draggedEl) draggedEl.style.display = 'none';
            const targetEl = document.elementFromPoint(e.clientX, e.clientY);
            if (draggedEl) draggedEl.style.display = 'block';

            const isPlayerArea = targetEl?.closest('.player-area.player') || targetEl?.id === 'player-board';

            if (isPlayerArea) {
                const card = gameState.currentPlayer.hand[attackerIndex];

                if (gameState.currentPlayer.mana.current < card.cost) {
                    shakeManaContainer(true);
                    logMessage("Not enough mana!");
                    // Handled cleanup above
                    return;
                }

                if (card.type === 'MINION' && gameState.currentPlayer.board.length >= 7) {
                    logMessage("Board full!");
                    return;
                }

                // Show Preview before playing
                await showCardPlayPreview(card);

                // Targeted Battlecry check
                const type = card.keywords?.battlecry?.type;
                const isTargeted =
                    (type === 'DAMAGE' && card.keywords.battlecry.target === 'ANY') ||
                    (type === 'HEAL' && card.keywords.battlecry.target === 'ANY') ||
                    (type === 'DAMAGE_NON_CATEGORY') ||
                    (type === 'BUFF_STAT_TARGET') ||
                    (type === 'GIVE_DIVINE_SHIELD') ||
                    (type === 'DESTROY' && card.keywords.battlecry.target === 'ANY');

                if (isTargeted) {
                    try {
                        let mode = 'DAMAGE';
                        if (type === 'HEAL') {
                            mode = 'HEAL';
                        } else if (type === 'BUFF_STAT_TARGET' || type === 'GIVE_DIVINE_SHIELD') {
                            mode = 'BUFF';
                        } else if (type === 'DAMAGE_NON_CATEGORY') {
                            mode = 'DAMAGE'; // Explicitly set DAMAGE for Hsieh
                        }

                        if (card.type === 'SPELL') {
                            battlecrySourceType = 'SPELL';
                            // Hide the card in hand to simulate it "becoming" the arrow
                            const handCardEl = document.getElementById('player-hand').children[attackerIndex];
                            if (handCardEl) handCardEl.style.opacity = '0';

                            // For spells, we don't play pending. We just start targeting from Hand.
                            startBattlecryTargeting(attackerIndex, e.clientX, e.clientY, mode);
                        } else { // Minion with Battlecry
                            gameState.playCard(attackerIndex, 'PENDING', currentInsertionIndex);
                            render();
                            battlecrySourceType = 'MINION';

                            // The minion might be highlighted on board at its actual position
                            const boardEl = document.getElementById('player-board');
                            // We need to find the correct index in gameState.board
                            // Since it was 'PENDING', it's inserted at currentInsertionIndex
                            const minionEl = boardEl.children[currentInsertionIndex];

                            let startX = e.clientX;
                            let startY = e.clientY;

                            if (minionEl) {
                                const rect = minionEl.getBoundingClientRect();
                                startX = rect.left + rect.width / 2;
                                startY = rect.top + rect.height / 2;
                            }
                            startBattlecryTargeting(currentInsertionIndex, startX, startY, mode);
                        }
                    } catch (err) {
                        logMessage(err.message);
                        render();
                    }
                    return;
                }

                try {
                    // Pre-play preview already shown above at line 1124.
                    gameState.playCard(attackerIndex, null, currentInsertionIndex);
                    render();

                    // Trigger Dust at newly played minion
                    const boardEl = document.getElementById('player-board');
                    const newMinionEl = boardEl.children[currentInsertionIndex];
                    if (newMinionEl) spawnDustEffect(newMinionEl, card.cost >= 7 ? 2 : 1);

                    await resolveDeaths();

                    if (card && card.keywords?.battlecry) {
                        const bcType = card.keywords.battlecry.type;
                        setTimeout(() => {
                            if (bcType === 'BUFF_ALL' || bcType === 'BUFF_CATEGORY') {
                                document.querySelectorAll('#player-board .minion').forEach(m => triggerCombatEffect(m, 'BUFF'));
                            } else if (bcType === 'HEAL_ALL_FRIENDLY') {
                                document.querySelectorAll('#player-board .minion').forEach(m => triggerCombatEffect(m, 'HEAL'));
                                triggerCombatEffect(document.getElementById('player-hero'), 'HEAL');
                            }
                        }, 100);
                    }
                } catch (err) {
                    logMessage(err.message);
                    render();
                }
            } else {
                // Return to hand visuals (already handled by cleaning up ghost)
                logMessage("Play cancelled");
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
                    gameState.attack(attackerIndex, { type, index });
                    render();
                    await resolveDeaths();
                } catch (err) {
                    logMessage(err.message);
                }
            }
        }
    } else if (isBattlecryTargeting) {
        // Finishing targeted battlecry
        isBattlecryTargeting = false;
        dragLine.style.display = 'none'; // Critical: Hide line

        const targetEl = document.elementFromPoint(e.clientX, e.clientY);
        const targetData = targetEl?.closest('[data-type]');

        let target = null;
        if (targetData) {
            const type = targetData.dataset.type;
            const index = parseInt(targetData.dataset.index);
            if (type === 'HERO' && (targetData.id === 'opp-hero' || targetData.id === 'player-hero')) {
                // Determine side based on ID
                target = { type, index, side: targetData.id === 'opp-hero' ? 'OPPONENT' : 'PLAYER' };
            } else if (type === 'MINION') {
                if (targetEl.closest('#opp-board')) {
                    target = { type, index, side: 'OPPONENT' };
                } else if (targetEl.closest('#player-board')) {
                    target = { type, index, side: 'PLAYER' };
                }
            }
        }

        try {
            if (target) {
                // 1. Identify Source & Dest for Animation
                let sourceEl;
                if (battlecrySourceType === 'SPELL') {
                    // Source is Hand Card (it's hidden but element exists until render)
                    sourceEl = document.getElementById('player-hand').children[battlecrySourceIndex];
                } else {
                    // Source is Minion on Board (already placed)
                    sourceEl = document.getElementById('player-board').children[battlecrySourceIndex];
                }

                const destEl = target.type === 'HERO' ?
                    (targetData.id === 'opp-hero' ? document.getElementById('opp-hero') : document.getElementById('player-hero')) :
                    (targetEl.closest('#opp-board') ? document.getElementById('opp-board').children[target.index] : document.getElementById('player-board').children[target.index]);

                // 2. Animate BEFORE applying logic (so target is still alive)
                if (sourceEl && destEl) {
                    let color = '#ff0000'; // Default Damage Red
                    let effectType = 'DAMAGE';

                    // Determine color based on card/mode
                    if (draggingMode === 'HEAL') { color = '#43e97b'; effectType = 'HEAL'; }
                    else if (draggingMode === 'BUFF') { color = '#ffa500'; effectType = 'BUFF'; }

                    await animateAbility(sourceEl, destEl, color, draggingMode !== 'HEAL');
                    triggerCombatEffect(destEl, effectType);

                    // Small delay for impact feel
                    await new Promise(r => setTimeout(r, 200));
                }

                // 3. Execute Game Logic (Phase 2)
                if (battlecrySourceType === 'SPELL') {
                    // For Spell: Now we play it
                    const card = gameState.currentPlayer.hand[battlecrySourceIndex];
                    if (card) showCardPlayPreview(card); // Post-animation preview
                    gameState.playCard(battlecrySourceIndex, target);
                } else {
                    // For Minion: It's already pending on board, just resolve battlecry
                    const minionInfo = gameState.currentPlayer.board[battlecrySourceIndex];
                    if (minionInfo && minionInfo.keywords?.battlecry) {
                        gameState.resolveBattlecry(minionInfo.keywords.battlecry, target);
                    }
                }

                render();
                await resolveDeaths();

            } else {
                // Non-targeted logic (Fallback for Minions played without target if flow allows, or AOE)
                // Note: If battlecrySourceType is SPELL and target is null, we cancelled (handled in 'else' of outer block if exists, but here structure is try/catch)
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
                            }
                        }, 100);
                    }
                }
                // If Spell and no target, we do nothing (cancel).
            }
        } catch (err) {
            logMessage(err.message);
            render(); // Reset UI
        }
    }
    currentInsertionIndex = -1;
}

function startBattlecryTargeting(handIndex, x, y, mode = 'DAMAGE') {
    isBattlecryTargeting = true;
    battlecrySourceIndex = handIndex;
    draggingMode = mode;

    dragLine.classList.add('battlecry-line');
    if (mode === 'HEAL') {
        dragLine.classList.add('heal-line');
        dragLine.classList.remove('buff-line');
    } else if (mode === 'BUFF') {
        dragLine.classList.remove('heal-line');
        dragLine.classList.add('buff-line');
    } else {
        dragLine.classList.remove('heal-line');
        dragLine.classList.remove('buff-line');
    }

    dragLine.setAttribute('x1', x);
    dragLine.setAttribute('y1', y);
    dragLine.setAttribute('x2', x);
    dragLine.setAttribute('y2', y);
    dragLine.style.display = 'block';

    logMessage("Choose a target for Battlecry!");
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
        }, 510);
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
    const line = document.createElement('div');
    line.innerText = msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

/**
 * Animation for drawing a card from deck to hand.
 * @param {HTMLElement} cardEl The final destination element in hand
 */
function animateCardFromDeck(cardEl) {
    const deckEl = document.getElementById('player-deck');
    if (!deckEl || !cardEl) return;

    cardEl.style.opacity = '0';

    requestAnimationFrame(() => {
        const deckRect = deckEl.getBoundingClientRect();
        const cardRect = cardEl.getBoundingClientRect();

        const clone = cardEl.cloneNode(true);
        clone.style.position = 'fixed';
        clone.style.left = '0';
        clone.style.top = '0';
        clone.style.width = `${cardEl.offsetWidth || 100}px`;
        clone.style.height = `${cardEl.offsetHeight || 140}px`;
        clone.style.zIndex = '9999';
        clone.style.margin = '0';

        // Use transform for hardware acceleration
        const startX = deckRect.left;
        const startY = deckRect.top;
        const endX = cardRect.left;
        const endY = cardRect.top;

        clone.style.transform = `translate(${startX}px, ${startY}px) scale(0.5)`;
        clone.style.transition = 'none'; // Initial position without transition
        clone.style.pointerEvents = 'none';
        clone.style.opacity = '1';
        clone.className = cardEl.className;

        document.body.appendChild(clone);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                clone.style.transition = 'transform 0.6s cubic-bezier(0.18, 0.89, 0.32, 1.15), opacity 0.3s ease';
                clone.style.transform = `translate(${endX}px, ${endY}px) scale(1)`;
            });
        });

        clone.addEventListener('transitionend', (e) => {
            if (e.propertyName === 'transform') {
                clone.remove();
                cardEl.style.opacity = '1';
            }
        });
    });
}

/**
 * Shows a large 3D preview of the card in the center before it hits the board.
 */
async function showCardPlayPreview(card, isAI = false) {
    const overlay = document.getElementById('play-preview-overlay');
    overlay.innerHTML = '';
    overlay.style.display = 'flex';

    // Create a big version of the card manually to ensure perfect scaling
    const rarityClass = card.rarity ? card.rarity.toLowerCase() : 'common';
    const cardEl = document.createElement('div');
    cardEl.className = `card rarity-${rarityClass} preview-card-3d ${card.type === 'SPELL' ? 'spell-card' : ''}`;

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

        statsHtml = `
        <div class="minion-stats" style="margin-top: auto; padding: 15px;">
            <span class="stat-atk ${atkClass}" style="width: 60px; height: 60px; font-size: 28px;"><span>${card.attack}</span></span>
            <span class="stat-hp ${hpClass}" style="width: 60px; height: 60px; font-size: 28px;">${hpValue}</span>
        </div>`;
    }

    const artHtml = card.image ?
        `<div class="card-art" style="width: 90%; height: 180px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 8px; margin: 10px auto; border: 2px solid rgba(255,255,255,0.1);"></div>` :
        `<div class="card-art" style="width: 90%; height: 80px; background: #333; margin: 10px auto; border-radius: 8px;"></div>`;

    cardEl.innerHTML = `
        <div class="card-cost" style="width:60px; height:60px; font-size:32px; top: -5px; left: -5px;"><span>${card.cost}</span></div>
        <div class="card-title" style="font-size:24px; margin-top:80px; flex-shrink: 0;">${card.name}</div>
        ${artHtml}
        <div class="card-category" style="font-size:16px; padding: 2px 10px; margin-bottom: 5px; flex-shrink: 0;">${card.category || ""}</div>
        <div class="card-desc" style="font-size:16px; padding: 8px 15px; line-height: 1.3; height: auto; flex-grow: 1;">${card.description || ""}</div>
        ${statsHtml}
    `;

    overlay.appendChild(cardEl);

    // AI cards might need a slight delay to be noticed
    await new Promise(r => setTimeout(r, 800));

    // Slam phase
    cardEl.classList.add('slamming');

    // Board shake and dust
    const boardId = isAI ? 'opp-board' : 'player-board';
    const boardEl = document.getElementById(boardId);
    if (boardEl) {
        setTimeout(() => {
            boardEl.classList.remove('board-slam');
            void boardEl.offsetWidth;
            boardEl.classList.add('board-slam');

            // Intensify dust for high cost cards
            const intensity = card.cost >= 7 ? 2.5 : 1;
            spawnDustEffect(boardEl, intensity);
            setTimeout(() => boardEl.classList.remove('board-slam'), 500);
        }, 300); // Wait for card to hit the board
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
    cloud.style.zIndex = "60000";
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
        p.style.backgroundColor = intensity > 1 ? 'rgba(255, 238, 0, 0.6)' : 'rgba(200, 200, 200, 0.4)';
        cloud.appendChild(p);
    }
    setTimeout(() => cloud.remove(), 1000);
}

/**
 * Shatters a minion element into fragments.
 */
function animateShatter(el) {
    return new Promise(resolve => {
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

        // Hide original
        el.style.visibility = 'hidden';

        const cols = 4; // More fragments
        const rows = 5;
        const fragW = rect.width / cols;
        const fragH = rect.height / rows;

        // Get original image if any
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
    }

    el.appendChild(container);
    // Ensure visibility
    container.style.display = 'flex';
    setTimeout(() => {
        container.remove();
    }, 1500);
}

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
