let gameEngine;
let gameState;
// Embedded Card Data to avoid CORS issues
const CARD_DATA = [
    { "id": "c001", "name": "窮酸大學生", "category": "學生", "cost": 1, "attack": 1, "health": 2, "type": "MINION", "rarity": "COMMON", "description": "一個窮學生。", "image": "img/c001.png" },
    { "id": "c002", "name": "大樓保全", "category": "勞工", "cost": 2, "attack": 1, "health": 2, "type": "MINION", "rarity": "COMMON", "keywords": { "taunt": true }, "description": "嘲諷。無。", "image": "img/c002.png" },
    { "id": "tw001", "name": "柯文哲", "category": "民眾黨政治人物", "cost": 4, "attack": 3, "health": 3, "type": "MINION", "rarity": "LEGENDARY", "keywords": { "battlecry": { "type": "HEAL_ALL_FRIENDLY" } }, "description": "戰吼：將自己戰場上的卡牌血量全部回復。", "image": "img/tw001.png" },
    { "id": "tw002", "name": "吳敦義", "category": "國民黨政治人物", "cost": 5, "attack": 5, "health": 4, "type": "MINION", "rarity": "EPIC", "keywords": { "battlecry": { "type": "BUFF_ALL", "value": 1, "stat": "ATTACK" } }, "description": "戰吼：深藍能量！賦予所有友方隨從 +1 攻擊力。", "image": "img/tw002.png" },
    { "id": "tw003", "name": "四叉貓", "category": "民進黨政治人物", "cost": 3, "attack": 2, "health": 4, "type": "MINION", "rarity": "RARE", "keywords": { "battlecry": { "type": "BUFF_ALL", "value": 1, "stat": "HEALTH" } }, "description": "戰吼：深綠能量！賦予所有友方隨從 +1 生命值。", "image": "img/tw003.jpg" },
    { "id": "tw004", "name": "發票中講", "category": "法術", "cost": 2, "type": "SPELL", "rarity": "COMMON", "description": "下回合開始時，抽 2 張牌。", "image": "img/tw004.png" },
    { "id": "tw005", "name": "彈劾賴皇", "category": "法術", "cost": 10, "type": "SPELL", "rarity": "EPIC", "description": "造成 10 點傷害。", "image": "img/tw005.png" },
    { "id": "c004", "name": "小草大學生", "category": "學生", "cost": 1, "attack": 1, "health": 1, "type": "MINION", "rarity": "COMMON", "keywords": { "battlecry": { "type": "DAMAGE", "value": 1, "target": "ANY" } }, "description": "戰吼：造成 1 點傷害。", "image": "img/c004.png" },
    { "id": "c013", "name": "廟口管委", "category": "勞工", "cost": 3, "attack": 3, "health": 4, "type": "MINION", "rarity": "COMMON", "description": "維持不需要維持的秩序。", "image": "img/c013.png" },
    { "id": "tw006", "name": "蔡英文", "category": "民進黨政治人物", "cost": 6, "attack": 4, "health": 4, "type": "MINION", "rarity": "LEGENDARY", "keywords": { "battlecry": { "type": "BOUNCE_ALL_ENEMY" } }, "description": "戰吼:將對手場上卡牌全部放回手牌", "image": "img/tw006.png" },
    { "id": "tw007", "name": "外送師", "category": "勞工", "cost": 3, "attack": 3, "health": 3, "type": "MINION", "rarity": "COMMON", "keywords": { "charge": true }, "description": "戰吼:可以直接攻擊 大喊我是外送師", "image": "img/tw007.png" },
    { "id": "tw008", "name": "條碼師", "category": "勞工", "cost": 2, "attack": 1, "health": 4, "type": "MINION", "rarity": "COMMON", "description": "耐操", "image": "img/tw008.png" },
    { "id": "tw009", "name": "水電師傅", "category": "勞工", "cost": 4, "attack": 3, "health": 4, "type": "MINION", "rarity": "COMMON", "keywords": { "taunt": true }, "description": "嘲諷", "image": "img/tw009.png" },
    { "id": "tw010", "name": "水電徒弟", "category": "勞工", "cost": 2, "attack": 2, "health": 3, "type": "MINION", "rarity": "COMMON", "description": "總有一天會變師傅", "image": "img/tw010.png" },
    { "id": "tw011", "name": "謝長廷", "category": "民進黨政治人物", "cost": 3, "attack": 3, "health": 3, "type": "MINION", "rarity": "EPIC", "description": "戰吼: 對一個非民進黨政治人物造成3點傷害", "keywords": { "battlecry": { "type": "DAMAGE_NON_CATEGORY", "value": 3, "target_category": "民進黨政治人物" } }, "image": "img/tw011.jpg" },
    { "id": "tw012", "name": "馬英九", "category": "國民黨政治人物", "cost": 9, "attack": 3, "health": 4, "type": "MINION", "rarity": "LEGENDARY", "keywords": { "battlecry": { "type": "DESTROY", "target": "ANY" } }, "description": "戰吼: 直接擊殺一個單位", "image": "img/tw012.png" },
    { "id": "tw013", "name": "勞工局", "category": "政府機關", "cost": 5, "attack": 0, "health": 5, "type": "MINION", "rarity": "EPIC", "keywords": { "battlecry": { "type": "BUFF_CATEGORY", "value": 2, "stat": "HEALTH", "target_category": "勞工" } }, "description": "戰吼: 賦予所有\"勞工\"血量上限+2", "image": "img/tw013.png" },
    { "id": "tw014", "name": "手搖員工", "category": "勞工", "cost": 3, "attack": 2, "health": 2, "type": "MINION", "rarity": "RARE", "keywords": { "battlecry": { "type": "HEAL", "value": 2, "target": "ANY" } }, "description": "戰吼: 回復一個單位2點血量", "image": "img/tw014.png" },
    { "id": "tw015", "name": "台積電工程師", "category": "勞工", "cost": 3, "attack": 2, "health": 2, "type": "MINION", "rarity": "RARE", "keywords": { "enrage": { "type": "BUFF_STAT", "stat": "ATTACK", "value": 3 } }, "description": "激將: 增加3點攻擊", "image": "img/tw015.png" },
    { "id": "tw016", "name": "台積電", "category": "企業", "cost": 5, "attack": 0, "health": 10, "type": "MINION", "rarity": "EPIC", "keywords": { "taunt": true, "battlecry": { "type": "DAMAGE_RANDOM_FRIENDLY", "value": 2 } }, "description": "嘲諷+戰吼: 造成\"我方\"隨機一個單位2點傷害", "image": "img/tw016.png" }
];

let cardDB = [];

// Load cards manually (modified for local file access)
// Game state for deck builder
let userDecks = JSON.parse(localStorage.getItem('userDecks')) || [
    { name: "預設牌組 1", cards: [] },
    { name: "預設牌組 2", cards: [] },
    { name: "預設牌組 3", cards: [] }
];

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
let pendingViewMode = 'BATTLE'; // 'BATTLE' or 'BUILDER'

function init() {
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
}

function renderDeckSelect() {
    const container = document.getElementById('deck-select-slots');
    container.innerHTML = '';

    userDecks.forEach((deck, idx) => {
        const slot = document.createElement('div');
        slot.className = `deck-slot ${idx === selectedDeckIdx ? 'selected' : ''}`;
        slot.innerHTML = `
            <h3>${deck.name}</h3>
            <div class="slot-info">${deck.cards.length} / 30 張卡</div>
            <div class="deck-slot-actions">
                <button class="neon-button action-btn">${pendingViewMode === 'BATTLE' ? '出戰' : '編輯'}</button>
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
                if (deck.cards.length === 30) {
                    startBattle(deck.cards);
                } else {
                    alert(`「${deck.name}」目前有 ${deck.cards.length} 張卡，需要剛好 30 張才能戰鬥！`);
                }
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
    const searchInput = document.getElementById('card-search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";

    CARD_DATA.filter(card => card.name.toLowerCase().includes(searchTerm) || (card.description && card.description.toLowerCase().includes(searchTerm))).forEach(card => {
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
                        destEl = (action.target.side === 'OPPONENT') ? document.getElementById('opp-hero') : document.getElementById('player-hero');
                        // Note: AI perspective 'OPPONENT' is AI's opponent (Player).
                        // Wait, getBattlecryTarget returns 'OPPONENT' meaning AI's enemy (Player).
                        // Let's verify side logic in getBattlecryTarget:
                        // "return { type: 'HERO', side: 'OPPONENT' }"
                        // In GameState.getTargetUnit: target.side === 'OPPONENT' -> this.opponent (Player).
                        // So destEl should be Player Hero.
                        // BUT `document.getElementById('player-hero')` is correct.
                    } else if (action.target.type === 'MINION') {
                        // side 'OPPONENT' -> Player Board
                        // side 'PLAYER' -> Opp Board
                        const isPlayerSide = (action.target.side === 'OPPONENT');
                        const targetBoardId = isPlayerSide ? 'player-board' : 'opp-board';
                        destEl = document.getElementById(targetBoardId).children[action.target.index];
                    }

                    if (sourceEl && destEl) {
                        let color = '#ff0000';
                        const type = card.keywords?.battlecry?.type;
                        if (type === 'HEAL' || type === 'HEAL_ALL_FRIENDLY') color = '#43e97b';
                        else if (type === 'BUFF_STAT_TARGET') color = '#ffa500';

                        await animateAbility(sourceEl, destEl, color);
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

                gameState.attack(attackerIdx, action.target);
                render();
                await resolveDeaths();
                await new Promise(r => setTimeout(r, 600));
            }

            moves++;
        }

        gameState.endTurn();
        render();
    } catch (e) {
        logMessage("AI Error: " + e.message);
        console.error(e);
        gameState.endTurn();
        render();
    }
}

function render() {
    document.getElementById('turn-indicator').innerText = `Turn: ${gameState.turnCount} (${gameState.currentPlayerIdx === 0 ? "You" : "Opponent"})`;

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
    document.querySelector('#player-discard .count-badge').innerText = p1.graveyard?.length || 0;
    document.querySelector('#opp-deck .count-badge').innerText = p2.deck.length;
    document.querySelector('#opp-discard .count-badge').innerText = p2.graveyard?.length || 0;

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
    const crystals = container.children;
    for (let i = 0; i < 10; i++) {
        const crystal = crystals[i];
        crystal.className = 'mana-crystal';
        if (i < mana.current) {
            crystal.classList.add('active');
        } else if (i < mana.max) {
            crystal.classList.add('spent');
        } else {
            crystal.classList.add('locked');
        }
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
            <span class="stat-atk ${atkClass}" style="width: 70px; height: 70px; font-size: 32px;"><span style="transform: rotate(-45deg); display: inline-block;">${card.attack}</span></span>
            <span class="stat-hp ${hpClass}" style="width: 70px; height: 70px; font-size: 32px;">${hpValue}</span>
        </div>`;
    }

    const artHtml = card.image ?
        `<div class="card-art" style="width: 90%; height: 220px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 8px; margin: 10px auto; border: 2px solid rgba(255,255,255,0.1);"></div>` :
        `<div class="card-art" style="width: 90%; height: 100px; background: #333; margin: 10px auto; border-radius: 8px;"></div>`;

    preview.innerHTML = `
        <div class="card rarity-${rarityClass} ${card.type === 'SPELL' ? 'spell-card' : ''}" style="width:340px; height:500px; transform:none !important; display: flex; flex-direction: column; justify-content: flex-start; padding-bottom: 0;">
            <div class="card-cost" style="width:70px; height:70px; font-size:36px; top:-25px; left:-25px;">${card.cost}</div>
            
            <div class="card-title" style="font-size:28px; margin-top:30px; flex-shrink: 0;">${card.name}</div>
            
            ${artHtml}
            
            <div class="card-category" style="font-size:18px; padding: 4px 12px; margin-bottom: 10px; flex-shrink: 0;">${card.category || ""}</div>
            
            <div class="card-desc" style="font-size:20px; padding: 10px 20px; line-height: 1.4; flex-grow: 1; display: flex; align-items: flex-start; justify-content: center; height: auto; overflow: visible;">${card.description || ""}</div>
            
            ${statsHtml}
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
        <div class="card-cost" style="position: absolute; top: -5px; left: -5px; z-index: 10;">${card.cost}</div>
        
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
    el.className = `minion ${minion.keywords?.taunt ? 'taunt' : ''} ${minion.sleeping ? 'sleeping' : ''} ${minion.canAttack && isPlayer ? 'can-attack' : ''}`;
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

    dragLine.classList.remove('battlecry-line');
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

            // Highlight board if hovering
            const targetEl = document.elementFromPoint(e.clientX, e.clientY);
            const board = document.getElementById('player-board');
            if (targetEl?.closest('.player-area.player')) {
                board.classList.add('drop-highlight');
            } else {
                board.classList.remove('drop-highlight');
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

            const isPlayerArea = targetEl?.closest('.player-area.player');

            if (isPlayerArea || targetEl?.id === 'player-board') {
                const card = gameState.currentPlayer.hand[attackerIndex];

                if (gameState.currentPlayer.mana.current < card.cost) {
                    shakeManaContainer(true);
                    logMessage("Not enough mana!");
                    // Cleanup visual ghost
                    if (draggedEl) {
                        draggedEl.remove();
                        draggedEl = null;
                    }
                    const originalEl = document.getElementById('player-hand').children[attackerIndex];
                    if (originalEl) originalEl.style.opacity = '1';
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
                    (type === 'DESTROY' && card.keywords.battlecry.target === 'ANY');

                if (isTargeted) {
                    try {
                        gameState.playCard(attackerIndex, 'PENDING');
                        render();

                        // Determine visual mode (Damage=Red, Heal=Green, Buff=Orange)
                        let mode = 'DAMAGE';
                        if (type === 'HEAL') {
                            mode = 'HEAL';
                        } else if (type === 'BUFF_STAT_TARGET') {
                            mode = 'BUFF';
                        } else if (type === 'DAMAGE_NON_CATEGORY') {
                            mode = 'DAMAGE'; // Explicitly set DAMAGE for Hsieh
                        }

                        // Get the DOM element of the newly played minion to snap arrows
                        const boardEl = document.getElementById('player-board');
                        const newMinionIndex = gameState.currentPlayer.board.length - 1;
                        const minionEl = boardEl.children[newMinionIndex];

                        let startX = e.clientX;
                        let startY = e.clientY;

                        if (minionEl) {
                            const rect = minionEl.getBoundingClientRect();
                            startX = rect.left + rect.width / 2;
                            startY = rect.top + rect.height / 2;
                        }

                        startBattlecryTargeting(newMinionIndex, startX, startY, mode);
                    } catch (err) {
                        logMessage(err.message);
                    }
                    return;
                }

                try {
                    gameState.playCard(attackerIndex);
                    render();
                    await resolveDeaths();
                } catch (err) {
                    logMessage(err.message);
                }
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
            // Note: In the new flow, the card is already on the board.
            // We just need to trigger the battlecry effect manually.
            const minionIndex = battlecrySourceIndex;
            const minion = gameState.currentPlayer.board[minionIndex];

            if (minion && minion.keywords?.battlecry) {
                // Manually trigger the effect in the engine since it was 'PENDING' before
                gameState.resolveBattlecry(minion.keywords.battlecry, target);
                render();
                await resolveDeaths();
            }

            if (target) {
                // Animate green arrow from the already played minion to target
                const board = document.getElementById('player-board');
                const sourceEl = board.children[minionIndex];
                const destEl = target.type === 'HERO' ? (targetData.id === 'opp-hero' ? document.getElementById('opp-hero') : document.getElementById('player-hero')) : (targetEl.closest('#opp-board') ? document.getElementById('opp-board').children[target.index] : document.getElementById('player-board').children[target.index]);

                if (sourceEl && destEl) {
                    let color = '#ff0000'; // Default Damage Red
                    if (draggingMode === 'HEAL') color = '#43e97b'; // Green
                    else if (draggingMode === 'BUFF') color = '#ffa500'; // Orange

                    await animateAbility(sourceEl, destEl, color);
                }
            }
        } catch (err) {
            logMessage(err.message);
            render(); // Reset UI
        }
    }
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
 * Animates a projectile (Green Arrow) from start to end.
 */
function animateAbility(fromEl, toEl, color) {
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
            toEl.classList.add('shaking');
            setTimeout(() => toEl.classList.remove('shaking'), 500);

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

            // Create Impact Flare (Optional, simple flash)
            const flash = document.createElement('div');
            flash.style.position = 'absolute';
            flash.style.left = `${rectTo.left}px`;
            flash.style.top = `${rectTo.top}px`;
            flash.style.width = `${rectTo.width}px`;
            flash.style.height = `${rectTo.height}px`;
            flash.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
            flash.style.zIndex = '10000';
            flash.style.pointerEvents = 'none';
            flash.style.mixBlendMode = 'overlay';
            flash.style.transition = 'opacity 0.2s';
            document.body.appendChild(flash);

            setTimeout(() => {
                flash.style.opacity = '0';
                setTimeout(() => flash.remove(), 200);
            }, 50);

            // Cleanup Clone
            clone.remove();
            resolve();
        }, 400); // Match CSS duration
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

    // Temporarily hide the real card
    cardEl.style.opacity = '0';

    requestAnimationFrame(() => {
        const deckRect = deckEl.getBoundingClientRect();
        const cardRect = cardEl.getBoundingClientRect();

        const clone = cardEl.cloneNode(true);
        // Ensure clone clean style
        clone.style.position = 'fixed';
        clone.style.left = `${deckRect.left}px`;
        clone.style.top = `${deckRect.top}px`;
        clone.style.width = `${cardEl.offsetWidth || 100}px`;
        clone.style.height = `${cardEl.offsetHeight || 140}px`;
        clone.style.zIndex = '9999';
        clone.style.margin = '0';
        clone.style.transform = 'scale(0.5)';
        clone.style.transition = 'all 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)';
        clone.style.pointerEvents = 'none';
        clone.style.opacity = '1';

        // Remove hover effects/listeners (cloneNode copies attributes, listeners gone)
        clone.className = cardEl.className;

        document.body.appendChild(clone);

        // Allow browser to paint initial state
        requestAnimationFrame(() => {
            clone.style.left = `${cardRect.left}px`;
            clone.style.top = `${cardRect.top}px`;
            clone.style.transform = 'scale(1)';
        });

        // Cleanup
        clone.addEventListener('transitionend', () => {
            clone.remove();
            cardEl.style.opacity = '1';
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
    cardEl.style.width = '340px';
    cardEl.style.height = '500px';
    cardEl.style.fontSize = '24px'; // Base size for EM units if used

    const base = CARD_DATA.find(c => c.id === card.id) || card;
    let statsHtml = '';
    if (card.attack !== undefined && card.health !== undefined) {
        const atkClass = card.attack > base.attack ? 'stat-buffed' : (card.attack < base.attack ? 'stat-damaged' : '');
        const hpClass = (card.currentHealth !== undefined && card.currentHealth < card.health) ? 'stat-damaged' : (card.health > base.health ? 'stat-buffed' : '');
        const hpValue = card.currentHealth !== undefined ? card.currentHealth : card.health;

        statsHtml = `
        <div class="minion-stats" style="margin-top: auto; padding: 20px;">
            <span class="stat-atk ${atkClass}" style="width: 70px; height: 70px; font-size: 32px;"><span style="transform: rotate(-45deg); display: inline-block;">${card.attack}</span></span>
            <span class="stat-hp ${hpClass}" style="width: 70px; height: 70px; font-size: 32px;">${hpValue}</span>
        </div>`;
    }

    const artHtml = card.image ?
        `<div class="card-art" style="width: 90%; height: 220px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 8px; margin: 10px auto; border: 2px solid rgba(255,255,255,0.1);"></div>` :
        `<div class="card-art" style="width: 90%; height: 100px; background: #333; margin: 10px auto; border-radius: 8px;"></div>`;

    cardEl.innerHTML = `
        <div class="card-cost" style="width:70px; height:70px; font-size:36px; top:-25px; left:-25px;">${card.cost}</div>
        <div class="card-title" style="font-size:28px; margin-top:30px;">${card.name}</div>
        ${artHtml}
        <div class="card-category" style="font-size:18px; padding: 4px 12px;">${card.category || ""}</div>
        <div class="card-desc" style="font-size:20px; padding: 10px 20px; line-height: 1.4; height: auto; flex-grow: 1;">${card.description || ""}</div>
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
        boardEl.classList.remove('board-slam');
        void boardEl.offsetWidth;
        boardEl.classList.add('board-slam');
        spawnDustEffect(boardEl);
        setTimeout(() => boardEl.classList.remove('board-slam'), 500);
    }

    await new Promise(r => setTimeout(r, 400));

    overlay.style.display = 'none';
    overlay.innerHTML = '';
}

/**
 * Spawns dust particles on a target element (board).
 */
function spawnDustEffect(targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const cloud = document.createElement('div');
    cloud.className = 'dust-cloud';
    cloud.style.left = `${rect.left + rect.width / 2}px`;
    cloud.style.top = `${rect.top + rect.height / 2}px`;
    document.body.appendChild(cloud);

    for (let i = 0; i < 12; i++) {
        const p = document.createElement('div');
        p.className = 'dust-particle';
        const angle = Math.random() * Math.PI * 2;
        const dist = 50 + Math.random() * 80;
        p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
        p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
        p.style.width = p.style.height = `${10 + Math.random() * 20}px`;
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
