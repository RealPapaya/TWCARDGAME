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
async function init() {
    try {
        // Use embedded data instead of fetch
        cardDB = CARD_DATA;
        gameEngine = new GameEngine(cardDB);

        // Setup simple decks
        const deck1 = Array(15).fill('c001').concat(Array(15).fill('c004'));
        const deck2 = Array(15).fill('c002').concat(Array(15).fill('tw001')); // Taunt heavy

        gameState = gameEngine.createGame(deck1, deck2);

        setupUI();
        render();
    } catch (e) {
        console.error("Init failed", e);
        logMessage("Init failed: " + e.message);
    }
}

function setupUI() {
    document.getElementById('end-turn-btn').addEventListener('click', () => {
        try {
            gameState.endTurn();
            // Simple Opponent AI
            if (gameState.currentPlayerIdx === 1) {
                // Determine AI Speed
                setTimeout(() => opponentAIParams(), 500);
            }
            render();
        } catch (e) { logMessage(e.message); }
    });

    // Global Mouse Listener for Drag Line
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    // Init Mana Containers
    initManaContainers('player-mana-container');
    initManaContainers('opp-mana-container');
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

async function opponentAIParams() {
    logMessage("Opponent is thinking...");
    // 1. Play random card
    try {
        if (gameState.currentPlayer.hand.length > 0) {
            // Find playable
            const idx = gameState.currentPlayer.hand.findIndex(c => c.cost <= gameState.currentPlayer.mana.current);
            if (idx !== -1) {
                gameState.playCard(idx);
                logMessage("Opponent played " + gameState.currentPlayer.board[gameState.currentPlayer.board.length - 1].name);
                render();
                await new Promise(r => setTimeout(r, 800)); // Wait for play animation/perception
            }
        }

        // 2. Attack logic (Face)
        // Need to loop with await, so standard forEach won't work easily
        const oppBoard = gameState.currentPlayer.board;
        const playerBoard = gameState.opponent.board;

        for (let idx = 0; idx < oppBoard.length; idx++) {
            const m = oppBoard[idx];
            if (m.canAttack) {
                // Simplified: Attack Face or Taunt
                let targetType = 'HERO';
                let targetIndex = null;

                // Taunt check
                const tauntIdx = playerBoard.findIndex(t => t.keywords?.taunt);
                if (tauntIdx !== -1) {
                    targetType = 'MINION';
                    targetIndex = tauntIdx;
                }

                // AI Targeting Visuals matches DOM
                // Opponent minions are in #opp-board
                const attackerEl = document.getElementById('opp-board').children[idx];

                let targetEl;
                if (targetType === 'HERO') {
                    targetEl = document.getElementById('player-hero');
                } else {
                    targetEl = document.getElementById('player-board').children[targetIndex];
                }

                if (attackerEl && targetEl) {
                    await animateAttack(attackerEl, targetEl);
                }

                if (targetType === 'HERO') {
                    gameState.attack(idx, { type: 'HERO' });
                } else {
                    gameState.attack(idx, { type: 'MINION', index: targetIndex });
                }
                render();
                await new Promise(r => setTimeout(r, 500)); // Pause between attacks
            }
        }

        // End turn
        gameState.endTurn();
        render();
    } catch (e) {
        console.error("AI Error", e);
        gameState.endTurn(); // Force end
        render();
    }
}

function render() {
    // Update Turn
    document.getElementById('turn-indicator').innerText = `Turn: ${gameState.turnCount} (${gameState.currentPlayerIdx === 0 ? "You" : "Opponent"})`;

    // Render Players
    const p1 = gameState.players[0]; // You
    const p2 = gameState.players[1]; // Opponent

    // Update Player Stats
    renderMana('player-mana-container', p1.mana);
    renderMana('opp-mana-container', p2.mana);

    document.getElementById('player-hp').innerText = p1.hero.hp;
    document.getElementById('opp-hp').innerText = p2.hero.hp;

    // Render Hand
    const handEl = document.getElementById('player-hand');
    handEl.innerHTML = '';
    p1.hand.forEach((card, idx) => {
        const cardEl = createCardEl(card, idx);
        handEl.appendChild(cardEl);
    });

    const oppHandEl = document.getElementById('opp-hand');
    oppHandEl.innerHTML = '';
    p2.hand.forEach(() => {
        const back = document.createElement('div');
        back.className = 'card';
        oppHandEl.appendChild(back);
    });

    // Render Board
    const boardEl = document.getElementById('player-board');
    boardEl.innerHTML = '';
    p1.board.forEach((minion, idx) => {
        const minionEl = createMinionEl(minion, idx, true);
        boardEl.appendChild(minionEl);
    });

    const oppBoardEl = document.getElementById('opp-board');
    oppBoardEl.innerHTML = '';
    p2.board.forEach((minion, idx) => {
        const minionEl = createMinionEl(minion, idx, false);
        oppBoardEl.appendChild(minionEl);
    });

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
    el.addEventListener('mousedown', (e) => onDragStart(e, index, true));

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
const dragLine = document.getElementById('drag-line');

function onDragStart(e, index, fromHand = false) {
    if (gameState.currentPlayerIdx !== 0) return;
    dragging = true;
    attackerIndex = index;
    draggingFromHand = fromHand;

    // If from hand, we don't necessarily want a red line from the hand position immediately,
    // but the original logic uses clientX/Y which is fine.
    dragLine.setAttribute('x1', e.clientX);
    dragLine.setAttribute('y1', e.clientY);
    dragLine.style.display = 'block';

    if (fromHand) hidePreview();
}

function onDragMove(e) {
    if (!dragging) return;
    dragLine.setAttribute('x2', e.clientX);
    dragLine.setAttribute('y2', e.clientY);
}

async function onDragEnd(e) {
    if (!dragging) return;
    dragging = false;
    dragLine.style.display = 'none';

    // Find drop target
    const targetEl = document.elementFromPoint(e.clientX, e.clientY);

    if (draggingFromHand) {
        // Drop on Board to Play
        const isBoard = targetEl?.closest('#player-board');
        if (isBoard) {
            try {
                const card = gameState.currentPlayer.hand[attackerIndex];
                // Check if card needs target (e.g. battlecry damage)
                // For simplicity, we just play it if it's on board
                gameState.playCard(attackerIndex);
                render();

                // If it was the damage dealer "演說家", we need to handle target for its battlecry
                // Note: The baseline engine might handle target automatically if it's coded there,
                // but if not, we need to trigger the green arrow logic.
                // Assuming keywords.battlecry.type === 'DAMAGE' needs special handling.
                if (card.keywords?.battlecry?.type === 'DAMAGE') {
                    // This version needs manual target for battlecry after play
                    // but the requirement says "造成一點傷害是不用本身去攻擊 是無條件造成一點傷害"
                    // and "用綠色箭頭表示".
                    // Let's check for any battlecry that triggered damage and animate it to random enemy or first enemy.
                    handleBattlecryVisuals();
                }
            } catch (err) {
                logMessage(err.message);
            }
        }
        return;
    }

    const targetData = targetEl?.closest('[data-type]');
    if (targetData) {
        const type = targetData.dataset.type;
        const index = parseInt(targetData.dataset.index); // NaN for HERO

        if (type === 'HERO' && targetData.id === 'opp-hero'
            || type === 'MINION' && targetEl.closest('#opp-board')) {

            try {
                // Visual Animation First
                const sourceEl = document.getElementById('player-board').children[attackerIndex];
                const destEl = targetData; // The hero or minion element

                if (sourceEl && destEl) {
                    await animateAttack(sourceEl, destEl);
                }

                gameState.attack(attackerIndex, { type, index });
                render();
            } catch (err) {
                logMessage(err.message);
            }
        }
    }
}

/**
 * Handles visual effects for battlecries (like the green arrow for damage).
 */
async function handleBattlecryVisuals() {
    // Detect if a damage event just happened (this requires state knowledge)
    // For now, let's find the most recently played minion with damage battlecry
    // and animate to a simple target (e.g. enemy Hero or random enemy minion)
    // In a real HS clone, you'd pick a target, but here it might be "Random ANY"

    // Simple mock: Animate from the last board unit of player to the enemy hero
    const playerBoard = document.getElementById('player-board');
    if (playerBoard.children.length === 0) return;

    const sourceEl = playerBoard.lastElementChild;
    const targetEl = document.getElementById('opp-hero');

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
