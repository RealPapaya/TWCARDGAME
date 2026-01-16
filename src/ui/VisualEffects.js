
/**
 * VisualEffects.js
 * 
 * 用途: 集中管理遊戲內的所有視覺動畫特效，包含粒子效果、撞擊動畫、傷害數字與全螢幕特效。
 * 
 * 會被誰應用:
 * - src/legacy/app.js (戰鬥流程中的動畫觸發)
 * - src/ui/DragManager.js (拖曳操作時的視覺回饋)
 * 
 * 又會用到誰:
 * - src/data/translations.js (用於描述格式化)
 * - DOM 元素 (直接操作 document body 產生特效層)
 */

// State for animating cards
export const animatingDrawCards = new Set();

/**
 * Helper to format card descriptions with highlighting
 */
export function formatDesc(text, newsBonus = 0, isNews = false) {
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

/**
 * Animates a projectile from start to end.
 */
export function animateAbility(fromEl, toEl, color, shouldShake = true) {
    return new Promise(resolve => {
        if (!fromEl || !toEl) {
            resolve();
            return;
        }
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
export async function animateDiscard(cardEl) {
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
        const particleCount = 80;
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
 */
export function animateAttack(fromEl, toEl) {
    return new Promise(resolve => {
        if (!fromEl || !toEl) {
            resolve();
            return;
        }
        const rectFrom = fromEl.getBoundingClientRect();
        const rectTo = toEl.getBoundingClientRect();

        // Create Clone
        const clone = fromEl.cloneNode(true);
        clone.classList.add('animating-attack');

        // Remove specific styles that might interfere with attack visual
        clone.classList.remove('taunt');
        clone.classList.remove('sleeping');
        clone.classList.remove('can-attack');
        clone.classList.remove('divine-shield');
        clone.style.borderRadius = '12px';

        // Initial Position
        clone.style.top = `${rectFrom.top}px`;
        clone.style.left = `${rectFrom.left}px`;
        clone.style.width = `${rectFrom.width}px`;
        clone.style.height = `${rectFrom.height}px`;
        clone.style.margin = '0';

        document.body.appendChild(clone);
        void clone.offsetWidth; // Force Reflow

        // Target Position (Center to Center)
        const centerX = rectTo.left + rectTo.width / 2 - rectFrom.width / 2;
        const centerY = rectTo.top + rectTo.height / 2 - rectFrom.height / 2;

        clone.style.top = `${centerY}px`;
        clone.style.left = `${centerX}px`;
        clone.style.transform = "scale(1.2)";

        // On Transition End (Impact)
        setTimeout(() => {
            // Shake Target
            toEl.classList.add('shaking');
            setTimeout(() => toEl.classList.remove('shaking'), 500);

            // Trigger Combat Effect (Slash)
            triggerCombatEffect(toEl, 'DAMAGE');
            spawnDustEffect(toEl, 0.5);

            // Cleanup Clone
            setTimeout(() => {
                clone.remove();
                resolve();
            }, 100);
        }, 450);
    });
}

/**
 * Spawns dust particles on a target element (board).
 */
export function spawnDustEffect(targetEl, intensity = 1) {
    if (!targetEl) return;
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
export function animateShatter(el) {
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
 */
export function triggerCombatEffect(el, type) {
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
            p.className = 'buff-particle';
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
    container.style.display = 'flex';
    setTimeout(() => {
        container.remove();
    }, 1000);
}

/**
 * Show animated damage/heal number popup
 */
export function showDamageNumber(targetElement, value, type = 'damage') {
    if (!targetElement || value === 0) return;

    const rect = targetElement.getBoundingClientRect();
    const numberEl = document.createElement('div');
    numberEl.className = `damage-number ${type}`;
    numberEl.textContent = type === 'damage' ? `-${value}` : `+${value}`;

    // Position at center of target element
    numberEl.style.left = `${rect.left + rect.width / 2}px`;
    numberEl.style.top = `${rect.top + rect.height / 2}px`;

    document.body.appendChild(numberEl);

    setTimeout(() => {
        numberEl.remove();
    }, 1200);
}

// --- Major Animation Triggers ---

export async function triggerFullBoardHealAnimation(isPlayer) {
    const boardId = isPlayer ? 'player-board' : 'opp-board';
    const boardEl = document.getElementById(boardId);
    if (!boardEl) return;

    boardEl.classList.remove('board-heal-flash');
    void boardEl.offsetWidth;
    boardEl.classList.add('board-heal-flash');
    setTimeout(() => boardEl.classList.remove('board-heal-flash'), 1500);

    const rect = boardEl.getBoundingClientRect();
    for (let i = 0; i < 20; i++) {
        const p = document.createElement('div');
        p.className = 'bg-heal-particle';
        p.innerText = '+';
        const x = rect.left + Math.random() * rect.width;
        const y = rect.top + Math.random() * rect.height;
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        p.style.fontSize = `${20 + Math.random() * 20}px`;
        p.style.animationDelay = `${Math.random() * 0.5}s`;
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 2500);
    }
}

export async function triggerFullBoardBounceAnimation(isPlayer) {
    const boardId = isPlayer ? 'player-board' : 'opp-board';
    const boardEl = document.getElementById(boardId);
    if (!boardEl) return;

    boardEl.classList.remove('board-purple-flash');
    void boardEl.offsetWidth;
    boardEl.classList.add('board-purple-flash');
    setTimeout(() => boardEl.classList.remove('board-purple-flash'), 1500);

    const rect = boardEl.getBoundingClientRect();
    const arrowChars = ['↻', '↺', '↩'];
    for (let i = 0; i < 20; i++) {
        const p = document.createElement('div');
        p.className = 'bg-bounce-particle';
        p.innerText = arrowChars[Math.floor(Math.random() * arrowChars.length)];
        const x = rect.left + Math.random() * rect.width;
        const y = rect.top + Math.random() * rect.height;
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        p.style.fontSize = `${24 + Math.random() * 24}px`;
        p.style.animationDelay = `${Math.random() * 0.6}s`;
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 2500);
    }
}

export async function triggerEarthquakeAnimation() {
    const gameContainer = document.getElementById('game-container');
    const playerBoard = document.getElementById('player-board');
    const oppBoard = document.getElementById('opp-board');
    if (!gameContainer) return;

    gameContainer.classList.add('screen-quake');
    setTimeout(() => gameContainer.classList.remove('screen-quake'), 2000);

    [playerBoard, oppBoard].filter(b => b).forEach(boardEl => {
        boardEl.classList.remove('board-red-flash');
        void boardEl.offsetWidth;
        boardEl.classList.add('board-red-flash');
        setTimeout(() => boardEl.classList.remove('board-red-flash'), 1500);

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

    const rect = gameContainer.getBoundingClientRect();
    for (let i = 0; i < 30; i++) {
        const p = document.createElement('div');
        p.className = 'bg-bounce-particle';
        p.innerText = '•';
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

export async function triggerPoisonGasAnimation() {
    const overlay = document.createElement('div');
    overlay.className = 'poison-gas-overlay gas-active';
    document.body.appendChild(overlay);

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

export async function triggerRippleDiffusionAnimation(isPlayer = true) {
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

    setTimeout(() => {
        targetBoard.classList.remove('board-slam');
        void targetBoard.offsetWidth;
        targetBoard.classList.add('board-slam');
        setTimeout(() => targetBoard.classList.remove('board-slam'), 500);
    }, 400);
}

// NOTE: showCardPlayPreview and animateCardFromDeck depend on CARD_DATA keys etc.
// In current context `card` argument is the object.

/**
 * Shows a large 3D preview of the card in the center before it hits the board.
 */
export async function showCardPlayPreview(card, isAI = false, targetEl = null, gameState = null) {
    const overlay = document.getElementById('play-preview-overlay');
    if (!overlay) return;
    overlay.innerHTML = '';
    overlay.style.display = 'flex';

    // Ensure we have card data
    const base = (window.CARD_DATA || []).find(c => c.id === card.id) || card;

    const rarityClass = card.rarity ? card.rarity.toLowerCase() : 'common';
    const cardEl = document.createElement('div');
    cardEl.className = `card rarity-${rarityClass} preview-card-3d ${card.type === 'NEWS' ? 'news-card' : ''}`;

    cardEl.style.width = '280px';
    cardEl.style.height = '410px';
    cardEl.style.fontSize = '20px';

    let statsHtml = '';
    if (card.attack !== undefined && card.health !== undefined) {
        const hpValue = card.currentHealth !== undefined ? card.currentHealth : card.health;
        // Simplified Logic for preview stats
        statsHtml = `
        <div class="minion-stats" style="margin-top: auto; padding: 5px 15px 10px 15px; display: flex; justify-content: space-between; width: 100%;">
            <span class="stat-atk" style="width: 60px; height: 60px; font-size: 28px;"><span>${card.attack}</span></span>
            <span class="stat-hp" style="width: 60px; height: 60px; font-size: 28px;">${hpValue}</span>
        </div>`;
    }

    cardEl.style.padding = '8px';
    cardEl.style.justifyContent = 'flex-start';

    const customArtHtml = card.image ?
        `<div class="card-art" style="width: 100%; height: 150px; background: url('${card.image}') no-repeat center; background-size: cover; border-radius: 4px; margin: 10px auto 5px auto; border: 1px solid rgba(255,255,255,0.2);"></div>` :
        `<div class="card-art" style="width: 100%; height: 100px; background: #333; margin: 10px auto 5px auto; border-radius: 4px;"></div>`;

    let effectiveBonusPreview = 0;
    // Attempt to calculate bonus if gameState provided
    if (gameState) {
        const bonus = gameState.getNewsPower(card.side || 'PLAYER');
        // Simplified logic for bonus
        const bcType = card.keywords?.battlecry?.type || '';
        if (card.type === 'NEWS' && (bcType.includes('DAMAGE') || bcType.includes('HEAL'))) {
            effectiveBonusPreview = bonus;
        }
    }

    const actualCostPreview = card.cost; // Simplified for preview

    cardEl.innerHTML = `
        <div style="position: relative; display: flex; align-items: center; width: 100%; margin-bottom: 5px; height: 40px;">
            <div class="card-cost" style="position: relative; width:30px; height:30px; font-size:16px; flex-shrink: 0; z-index: 10; transform: rotate(45deg); margin-left: 5px;"><span>${actualCostPreview}</span></div>
            <div class="card-title" style="font-size:28px; position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); margin: 0; text-align: center; text-shadow: 0 0 5px black; z-index: 5;">${card.name}</div>
        </div>
        ${customArtHtml}
        <div class="card-category" style="font-size:16px; padding: 2px 10px; margin-bottom: 5px; flex-shrink: 0; text-align: center; color: #aaa;">${card.category || ""}</div>
        <div class="card-desc" style="font-size:18px; padding: 0 10px; line-height: 1.35; height: auto; flex-grow: 1; overflow: hidden; text-align: center; white-space: pre-wrap;">${formatDesc(card.description, effectiveBonusPreview, card.type === 'NEWS')}</div>
        ${statsHtml}
    `;

    overlay.appendChild(cardEl);
    await new Promise(r => setTimeout(r, 800));
    cardEl.classList.add('slamming');

    if (card.type === 'MINION') {
        const boardId = isAI ? 'opp-board' : 'player-board';
        const boardEl = document.getElementById(boardId);
        if (boardEl) {
            setTimeout(() => {
                boardEl.classList.remove('board-slam');
                void boardEl.offsetWidth;
                boardEl.classList.add('board-slam');
                const intensity = card.cost >= 7 ? 2.5 : 1;
                spawnDustEffect(targetEl || boardEl || cardEl, intensity);
                setTimeout(() => boardEl.classList.remove('board-slam'), 500);
            }, 300);
        }
    }
    await new Promise(r => setTimeout(r, 400));
    overlay.style.display = 'none';
    overlay.innerHTML = '';
}

export function animateCardFromDeck(cardObj, initialCardEl, gameState, renderCallback) {
    console.log(`[FX] animateCardFromDeck called for ${cardObj.name}`);
    const deckEl = document.getElementById('player-deck');
    if (!deckEl) {
        console.warn("[ANIM_FAIL] No deck element found (player-deck)");
        return;
    }

    // Check visibility/layout of deck
    const dr = deckEl.getBoundingClientRect();
    if (dr.width === 0) console.warn("[FX] Deck element has width 0! Is it visible?");

    animatingDrawCards.add(cardObj);
    if (initialCardEl) initialCardEl.style.opacity = '0';

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (!gameState || !gameState.players[0]) return;
            const idx = gameState.players[0].hand.indexOf(cardObj);
            if (idx === -1) {
                console.warn("[ANIM_FAIL] Card not found in hand index");
                animatingDrawCards.delete(cardObj);
                return;
            }

            const handEl = document.getElementById('player-hand');
            const targetEl = handEl ? handEl.children[idx] : null;

            if (!targetEl) {
                console.warn("[ANIM_FAIL] Target DOM element missing for index " + idx);
                animatingDrawCards.delete(cardObj);
                if (renderCallback) renderCallback();
                return;
            }

            const deckRect = deckEl.getBoundingClientRect();
            const cardRect = targetEl.getBoundingClientRect();
            console.log(`[FX] Coords: Deck(${deckRect.left}, ${deckRect.top}), Card(${cardRect.left}, ${cardRect.top})`);


            if (cardRect.width === 0) {
                console.warn("[ANIM_FAIL] Card width is 0. Visible?", targetEl.offsetParent !== null);
                animatingDrawCards.delete(cardObj);
                if (renderCallback) renderCallback();
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
                    if (renderCallback) renderCallback();
                    clone.removeEventListener('transitionend', cleanup);
                    clearTimeout(failSafe);
                }
            };

            const failSafe = setTimeout(() => cleanup({ type: 'timeout' }), 1000);
            clone.addEventListener('transitionend', cleanup);
        });
    });
}
