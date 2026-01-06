let gameEngine;
let gameState;
// Embedded Card Data to avoid CORS issues
const CARD_DATA = [
    {
        "id": "c001",
        "name": "村長",
        "title": "村長",
        "cost": 1,
        "attack": 1,
        "health": 2,
        "type": "MINION",
        "rarity": "COMMON",
        "description": "普通的村長。"
    },
    {
        "id": "c002",
        "name": "忠誠護衛",
        "title": "忠誠護衛",
        "cost": 2,
        "attack": 2,
        "health": 3,
        "type": "MINION",
        "rarity": "COMMON",
        "keywords": {
            "taunt": true
        },
        "description": "嘲諷"
    },
    {
        "id": "tw001",
        "name": "白袍外科醫",
        "title": "柯P",
        "cost": 4,
        "attack": 3,
        "health": 5,
        "type": "MINION",
        "rarity": "LEGENDARY",
        "keywords": {
            "taunt": true
        },
        "description": "牆頭草 (Fence-sitter): 嘲諷。他總是卡在其餘兩個勢力中間。"
    },
    {
        "id": "tw002",
        "name": "賣菜郎",
        "title": "韓總",
        "cost": 5,
        "attack": 5,
        "health": 4,
        "type": "MINION",
        "rarity": "EPIC",
        "keywords": {
            "battlecry": {
                "type": "BUFF_ALL",
                "value": 1,
                "stat": "ATTACK"
            }
        },
        "description": "戰吼：深藍能量！賦予所有友方隨從 +1 攻擊力。"
    },
    {
        "id": "tw003",
        "name": "戰貓",
        "title": "小英戰貓",
        "cost": 3,
        "attack": 2,
        "health": 4,
        "type": "MINION",
        "rarity": "RARE",
        "keywords": {
            "battlecry": {
                "type": "BUFF_ALL",
                "value": 1,
                "stat": "HEALTH"
            }
        },
        "description": "戰吼：深綠能量！賦予所有友方隨從 +1 生命值。"
    },
    {
        "id": "tw004",
        "name": "發財支票",
        "title": "發財支票",
        "cost": 2,
        "type": "SPELL",
        "rarity": "COMMON",
        "description": "選舉支票 (Electoral Promise): 下回合開始時，抽 2 張牌。"
    },
    {
        "id": "tw005",
        "name": "用愛發電",
        "title": "用愛發電",
        "cost": 10,
        "type": "SPELL",
        "rarity": "EPIC",
        "description": "造成 10 點傷害，隨機分配給所有敵人。如果你的牌堆沒有牌，改為造成 20 點。"
    },
    {
        "id": "c004",
        "name": "演說家",
        "cost": 3,
        "attack": 2,
        "health": 2,
        "type": "MINION",
        "rarity": "RARE",
        "keywords": {
            "battlecry": {
                "type": "DAMAGE",
                "value": 1,
                "target": "ANY"
            }
        },
        "description": "戰吼：造成 1 點傷害。"
    }
];

let cardDB = [];

// Load cards manually (modified for local file access)
// Game state for deck builder
let userDecks = JSON.parse(localStorage.getItem('userDecks')) || [
    { name: "預設牌組 1", cards: [] },
    { name: "預設牌組 2", cards: [] },
    { name: "預設牌組 3", cards: [] }
];
let selectedDeckIdx = parseInt(localStorage.getItem('selectedDeckIdx')) || 0;
let editingDeckIdx = 0;

function init() {
    gameEngine = new GameEngine(CARD_DATA);

    // UI Event Listeners
    document.getElementById('btn-deck-builder-main')?.addEventListener('click', () => {
        editingDeckIdx = selectedDeckIdx;
        showView('deck-builder');
        renderDeckBuilder();
    });

    document.getElementById('btn-back-to-menu').addEventListener('click', () => {
        showView('main-menu');
        renderDeckSlots();
    });

    document.getElementById('btn-save-deck').addEventListener('click', () => {
        const nameInput = document.getElementById('deck-name-input');
        userDecks[editingDeckIdx].name = nameInput.value || `牌組 ${editingDeckIdx + 1}`;
        localStorage.setItem('userDecks', JSON.stringify(userDecks));
        alert("存檔成功！");
        renderDeckBuilder();
    });

    document.getElementById('end-turn-btn').addEventListener('click', () => {
        try {
            gameState.endTurn();
            render();
            if (gameState.currentPlayerIdx === 1) {
                setTimeout(aiTurn, 1000);
            }
        } catch (e) { logMessage(e.message); }
    });

    // Global drag events
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    // Initial view
    showView('main-menu');
    renderDeckSlots();
}

function renderDeckSlots() {
    const container = document.getElementById('deck-slots');
    container.innerHTML = '';

    userDecks.forEach((deck, idx) => {
        const slot = document.createElement('div');
        slot.className = `deck-slot ${idx === selectedDeckIdx ? 'selected' : ''}`;
        slot.innerHTML = `
            <h3>${deck.name}</h3>
            <div class="slot-info">${deck.cards.length} / 30 張卡</div>
            <div class="deck-slot-actions">
                <button class="neon-button edit-btn">編輯</button>
                <button class="neon-button battle-btn">戰鬥</button>
            </div>
        `;

        slot.querySelector('.edit-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            editingDeckIdx = idx;
            showView('deck-builder');
            renderDeckBuilder();
        });

        slot.querySelector('.battle-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            selectedDeckIdx = idx;
            localStorage.setItem('selectedDeckIdx', selectedDeckIdx);

            if (deck.cards.length === 30) {
                startBattle(deck.cards);
            } else {
                alert(`「${deck.name}」目前有 ${deck.cards.length} 張卡，需要剛好 30 張才能戰鬥！`);
                editingDeckIdx = idx;
                showView('deck-builder');
                renderDeckBuilder();
            }
        });

        slot.addEventListener('click', () => {
            selectedDeckIdx = idx;
            localStorage.setItem('selectedDeckIdx', selectedDeckIdx);
            renderDeckSlots();
        });

        container.appendChild(slot);
    });
}

function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    const view = document.getElementById(viewId);
    if (view) view.style.display = 'flex';
}

function startBattle(deckIds) {
    // Fill opponent deck with random cards
    const allIds = CARD_DATA.map(c => c.id);
    const oppDeck = [];
    while (oppDeck.length < 30) oppDeck.push(allIds[Math.floor(Math.random() * allIds.length)]);

    gameState = gameEngine.createGame(deckIds, oppDeck);

    // Init Mana Containers for the new game view
    initManaContainers('player-mana-container');
    initManaContainers('opp-mana-container');

    showView('battle-view');
    render();
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

    CARD_DATA.forEach(card => {
        const cardEl = createCardEl(card, -1);
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

    deck.cards.forEach((id, idx) => {
        const card = CARD_DATA.find(c => c.id === id);
        const item = document.createElement('div');
        item.className = 'deck-item';
        item.innerHTML = `<span>${card.name}</span><span>${card.cost}</span>`;
        item.addEventListener('click', () => {
            deck.cards.splice(idx, 1);
            renderDeckBuilder();
        });
        listEl.appendChild(item);
    });

    document.getElementById('deck-count-indicator').innerText = `已選擇: ${deck.cards.length} / 30`;
}

async function aiTurn() {
    logMessage("Opponent is thinking...");
    try {
        // 1. Play random card
        if (gameState.currentPlayer.hand.length > 0) {
            const idx = gameState.currentPlayer.hand.findIndex(c => c.cost <= gameState.currentPlayer.mana.current);
            if (idx !== -1) {
                const card = gameState.currentPlayer.hand[idx];
                let target = null;

                // Simple AI Targeting for Battlecry
                if (card.keywords?.battlecry?.type === 'DAMAGE') {
                    // Decide target: random minion or hero
                    if (gameState.opponent.board.length > 0 && Math.random() < 0.7) {
                        target = { type: 'MINION', index: Math.floor(Math.random() * gameState.opponent.board.length) };
                    } else {
                        target = { type: 'HERO', index: null };
                    }
                }

                gameState.playCard(idx, target);
                logMessage(`Opponent played ${card.name}`);
                render();

                // Show Battlecry Visuals for AI
                if (target) {
                    const board = document.getElementById('opp-board');
                    const sourceEl = board.children[board.children.length - 1]; // Newest minion
                    const destEl = target.type === 'HERO' ? document.getElementById('player-hero') : document.getElementById('player-board').children[target.index];
                    if (sourceEl && destEl) {
                        await animateAbility(sourceEl, destEl, '#43e97b');
                    }
                }

                await new Promise(r => setTimeout(r, 800));
            }
        }

        // 2. Attack logic
        const oppBoard = gameState.currentPlayer.board;
        const playerBoard = gameState.opponent.board;

        for (let idx = 0; idx < oppBoard.length; idx++) {
            const m = oppBoard[idx];
            if (m.canAttack) {
                let targetType = 'HERO';
                let targetIndex = null;

                const tauntIdx = playerBoard.findIndex(t => t.keywords?.taunt);
                if (tauntIdx !== -1) {
                    targetType = 'MINION';
                    targetIndex = tauntIdx;
                }

                const attackerEl = document.getElementById('opp-board').children[idx];
                const targetEl = targetType === 'HERO' ? document.getElementById('player-hero') : document.getElementById('player-board').children[targetIndex];

                if (attackerEl && targetEl) {
                    await animateAttack(attackerEl, targetEl);
                }

                gameState.attack(idx, { type: targetType, index: targetIndex });
                render();
                await new Promise(r => setTimeout(r, 500));
            }
        }

        gameState.endTurn();
        render();
    } catch (e) {
        logMessage(e.message);
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

    let statsHtml = '';
    if (card.attack !== undefined && card.health !== undefined) {
        statsHtml = `
        <div class="minion-stats">
            <span class="stat-atk">${card.attack}</span>
            <span class="stat-hp">${card.health}</span>
        </div>`;
    }

    preview.innerHTML = `
        <div class="card rarity-${rarityClass} ${card.type === 'SPELL' ? 'spell-card' : ''}" style="width:100%; height:100%; transform:none !important;">
            <div class="card-cost">${card.cost}</div>
            <div class="card-title">${card.name}</div>
            <div class="card-desc">${card.description || ""}</div>
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

    let statsHtml = '';
    if (card.attack !== undefined && card.health !== undefined) {
        statsHtml = `
        <div class="minion-stats">
            <span class="stat-atk">${card.attack}</span>
            <span class="stat-hp">${card.health}</span>
        </div>`;
    }

    el.innerHTML = `
        <div class="card-cost">${card.cost}</div>
        <div class="card-title">${card.name}</div>
        <div class="card-desc">${card.description || ""}</div>
        ${statsHtml}
    `;

    // Preview Interaction
    el.addEventListener('mouseenter', () => showPreview(card));
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
    el.innerHTML = `
        <div class="minion-art"></div>
        <div class="card-title">${minion.name}</div>
        <div class="minion-stats">
            <span class="stat-atk">${minion.attack}</span>
            <span class="stat-hp">${minion.currentHealth}</span>
        </div>
    `;

    // Preview Interaction
    el.addEventListener('mouseenter', () => showPreview(minion));
    el.addEventListener('mouseleave', hidePreview);

    // Attack Drag Start
    if (isPlayer && minion.canAttack && gameState.currentPlayerIdx === 0) {
        el.addEventListener('mousedown', (e) => onDragStart(e, index));
    }

    // Attack Target Drop
    if (!isPlayer) {
        el.dataset.type = 'MINION';
        el.dataset.index = index;
    }

    return el;
}

let dragging = false;
let attackerIndex = null;
let draggingFromHand = false;
let draggedEl = null;
let isBattlecryTargeting = false;
let battlecrySourceIndex = null;

const dragLine = document.getElementById('drag-line');

function onDragStart(e, index, fromHand = false) {
    if (gameState.currentPlayerIdx !== 0) return;
    if (isBattlecryTargeting) return; // Finish targeting first

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
        dragLine.style.display = 'none';

        if (draggingFromHand) {
            // Cleanup visual ghost
            if (draggedEl) {
                draggedEl.remove();
                draggedEl = null;
            }
            const originalEl = document.getElementById('player-hand').children[attackerIndex];
            if (originalEl) originalEl.style.opacity = '1';

            // Find drop target
            const targetEl = document.elementFromPoint(e.clientX, e.clientY);
            const isPlayerArea = targetEl?.closest('.player-area.player');

            if (isPlayerArea) {
                const card = gameState.currentPlayer.hand[attackerIndex];

                // Targeted Battlecry check
                if (card.keywords?.battlecry?.type === 'DAMAGE' && card.keywords.battlecry.target === 'ANY') {
                    try {
                        // 1. Play card with 'PENDING' target first
                        const dragX = e.clientX;
                        const dragY = e.clientY;
                        gameState.playCard(attackerIndex, 'PENDING');
                        render();

                        // 2. Start targeting from the newly placed minion
                        startBattlecryTargeting(gameState.currentPlayer.board.length - 1, dragX, dragY);
                    } catch (err) {
                        logMessage(err.message);
                    }
                    return;
                }

                try {
                    gameState.playCard(attackerIndex);
                    render();
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
                } catch (err) {
                    logMessage(err.message);
                }
            }
        }
    } else if (isBattlecryTargeting) {
        // Finishing targeted battlecry
        isBattlecryTargeting = false;
        dragLine.style.display = 'none';

        const targetEl = document.elementFromPoint(e.clientX, e.clientY);
        const targetData = targetEl?.closest('[data-type]');

        let target = null;
        if (targetData) {
            const type = targetData.dataset.type;
            const index = parseInt(targetData.dataset.index);
            if (type === 'HERO' && targetData.id === 'opp-hero'
                || type === 'MINION' && targetEl.closest('#opp-board')) {
                target = { type, index };
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
            }

            if (target) {
                // Animate green arrow from the already played minion to target
                const board = document.getElementById('player-board');
                const sourceEl = board.children[minionIndex];
                const destEl = target.type === 'HERO' ? document.getElementById('opp-hero') : document.getElementById('opp-board').children[target.index];
                if (sourceEl && destEl) {
                    await animateAbility(sourceEl, destEl, '#43e97b');
                }
            }
        } catch (err) {
            logMessage(err.message);
            render(); // Reset UI
        }
    }
}

function startBattlecryTargeting(handIndex, x, y) {
    isBattlecryTargeting = true;
    battlecrySourceIndex = handIndex;

    dragLine.classList.add('battlecry-line');
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

// Start
init();
