
/**
 * DragManager.js
 * 
 * 用途: 處理使用者與戰場的所有互動，包括拖曳出牌、攻擊指向、戰吼目標選取與法力檢查。
 * 
 * 會被誰應用:
 * - src/legacy/app.js (初始化並掛載事件)
 * 
 * 又會用到誰:
 * - src/ui/VisualEffects.js (觸發拖曳過程中的視覺回饋與攻擊特效)
 * - src/data/translations.js (錯誤訊息顯示)
 * - window.gameEngine / window.gameState (全域遊戲狀態存取)
 */

import { UI_TEXT } from '../data/translations.js';
import {
    animateAbility,
    triggerCombatEffect,
    spawnDustEffect,
    animateDiscard,
    triggerFullBoardHealAnimation,
    triggerPoisonGasAnimation,
    triggerRippleDiffusionAnimation,
    triggerFullBoardBounceAnimation,
    triggerEarthquakeAnimation
} from './VisualEffects.js';

// Global State Variables for Dragging
export let dragging = null;
export let attackerIndex = -1;
export let draggingFromHand = false;
export let dragLine = null;
export let draggedEl = null;

// Battlecry Targeting State
export let isBattlecryTargeting = false;
export let battlecrySourceIndex = -1;
export let battlecrySourceType = null; // 'MINION' or 'NEWS'
export let draggingMode = 'DAMAGE'; // 'DAMAGE', 'HEAL', 'BUFF', 'DESTROY', 'BOUNCE'
export let battlecryTargetRule = null;
export let currentInsertionIndex = -1;

// Drag Threshold
const DRAG_THRESHOLD = 5;
let startX = 0;
let startY = 0;
let initialMouseX = 0;
let initialMouseY = 0;

export function initDragManager() {
    // Initialize drag line element
    dragLine = document.getElementById('drag-line');
    if (!dragLine) {
        // Create if not exists (though it should be in HTML)
        dragLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        dragLine.id = "drag-line";
        const svg = document.querySelector('svg') || document.createElementNS("http://www.w3.org/2000/svg", "svg");
        if (!document.querySelector('svg')) {
            svg.style.position = 'fixed';
            svg.style.top = '0';
            svg.style.left = '0';
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.pointerEvents = 'none';
            svg.style.zIndex = '9999';
            document.body.appendChild(svg);
        }
        svg.appendChild(dragLine);
    }
}

export function onDragStart(e, index, fromHand = false) {
    if (window.gameState.blockInput) return;
    // Check if it's opponent's turn
    if (window.gameState.turnOwner === 'OPPONENT') {
        const msg = fromHand ? UI_TEXT.OPP_TURN_CARD : UI_TEXT.OPP_TURN_ATTACK;
        window.logMessage(msg);
        return;
    }

    if (e.button !== 0) return; // Only left click

    dragging = true;
    attackerIndex = index;
    draggingFromHand = fromHand;
    startX = e.clientX;
    startY = e.clientY;
    initialMouseX = e.clientX;
    initialMouseY = e.clientY;

    if (fromHand) {
        // Dragging Card from Hand
        const card = window.gameState.currentPlayer.hand[index];
        if (!card) return;

        // Mana Check
        const cost = (window.gameState.getCardActualCost) ? window.gameState.getCardActualCost(card) : card.cost;
        if (window.gameState.currentPlayer.mana.current < cost) {
            window.logMessage(UI_TEXT.NO_MANA);
            dragging = false;
            return;
        }

        // Prepare Ghost Element
        const handEl = document.getElementById('player-hand');
        const sourceEl = handEl.children[index];
        if (sourceEl) {
            draggedEl = sourceEl.cloneNode(true);
            draggedEl.classList.add('dragging-ghost'); // Add class, don't overwrite
            // Ensure we remove any 'hover' effects or specific state classes we don't want
            draggedEl.classList.remove('in-deck-animation');
            // Reset transforms
            draggedEl.style.transform = 'none';
            draggedEl.style.position = 'fixed';
            draggedEl.style.zIndex = '10000';
            draggedEl.style.pointerEvents = 'none'; // Critical for elementFromPoint
            draggedEl.style.left = `${e.clientX - 60}px`; // Center offset
            draggedEl.style.top = `${e.clientY - 85}px`;

            // Fade out original
            sourceEl.style.opacity = '0.3';

            document.body.appendChild(draggedEl);
        }

    } else {
        // Dragging Minion on Board (Attack)
        const minion = window.gameState.currentPlayer.board[index];
        if (!minion) return;

        // Attack Eligibility Checks
        if (minion.sleeping) {
            window.logMessage(UI_TEXT.MINION_SLEEPING);
            dragging = false;
            return;
        }
        if (minion.attackCount >= 1 && !minion.keywords.windfury) {
            window.logMessage(UI_TEXT.MINION_ATTACKED);
            dragging = false;
            return;
        }
        if (minion.attackCount >= 2 && minion.keywords.windfury) {
            window.logMessage(UI_TEXT.MINION_ATTACKED);
            dragging = false;
            return;
        }
        if (minion.attack <= 0) {
            window.logMessage(UI_TEXT.MINION_NO_ATTACK);
            dragging = false;
            return;
        }
        if (minion.keywords.frozen) { // Assuming frozen check exists
            window.logMessage(UI_TEXT.MINION_FROZEN);
            dragging = false;
            return;
        }

        // Show Drag Line
        dragLine.setAttribute('x1', startX);
        dragLine.setAttribute('y1', startY);
        dragLine.setAttribute('x2', startX);
        dragLine.setAttribute('y2', startY);
        dragLine.style.display = 'block';
    }
}

export function onDragMove(e) {
    if (isBattlecryTargeting) {
        // Battlecry Targeting Line logic
        dragLine.setAttribute('x2', e.clientX);
        dragLine.setAttribute('y2', e.clientY);
        return;
    }

    if (!dragging) return;

    if (draggingFromHand) {
        // Move Ghost Element
        if (draggedEl) {
            draggedEl.style.left = `${e.clientX - draggedEl.offsetWidth / 2}px`;
            draggedEl.style.top = `${e.clientY - draggedEl.offsetHeight / 2}px`;
        }

        // Insertion Preview Logic
        const boardEl = document.getElementById('player-board');
        const boardRect = boardEl.getBoundingClientRect();

        // Only show preview if hovering over board area
        if (e.clientY > boardRect.top - 50 && e.clientY < boardRect.bottom + 50 &&
            e.clientX > boardRect.left - 50 && e.clientX < boardRect.right + 50) {

            const minions = Array.from(boardEl.children).filter(el => el.classList.contains('minion'));

            // Calculate insertion index
            // Simple logic: find first minion whose center is to the right of cursor
            let insertIdx = minions.length;
            for (let i = 0; i < minions.length; i++) {
                const rect = minions[i].getBoundingClientRect();
                const center = rect.left + rect.width / 2;
                if (e.clientX < center) {
                    insertIdx = i;
                    break;
                }
            }

            if (insertIdx !== currentInsertionIndex) {
                currentInsertionIndex = insertIdx;
                // Add GAP Visual
                // Remove existing gaps
                document.querySelectorAll('.placement-indicator').forEach(el => el.remove());


                const gap = document.createElement('div');
                gap.className = 'placement-indicator';

                // Insert gap
                if (insertIdx >= minions.length) {
                    boardEl.appendChild(gap);
                } else {
                    boardEl.insertBefore(gap, minions[insertIdx]);
                }
            }

        } else {
            // Remove gap if outside board
            document.querySelectorAll('.placement-indicator').forEach(el => el.remove());

            currentInsertionIndex = -1;
        }

    } else {
        // Update Attack Line
        dragLine.setAttribute('x2', e.clientX);
        dragLine.setAttribute('y2', e.clientY);
    }
}

export async function onDragEnd(e) {
    // 1. Battlecry Targeting
    if (isBattlecryTargeting) {
        // Logic copied from original app.js simplified for clarity
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
                window.logMessage(UI_TEXT.INVALID_TARGET);
                return; // Keep targeting
            }
        } else {
            // Cancel if clicked empty space
            cancelBattlecryTargeting();
            return;
        }

        // Execute Targeted Battlecry
        isBattlecryTargeting = false;
        dragLine.style.display = 'none';

        try {
            if (target) {
                // Determine Source Element
                let sourceEl;
                if (battlecrySourceType === 'NEWS') {
                    // For News, card is in hand (but visually hidden/ghosted?)
                    // Indices in hand might shift, but we use battlecrySourceIndex
                    const handEl = document.getElementById('player-hand');
                    if (handEl) sourceEl = handEl.children[battlecrySourceIndex];
                } else {
                    // Minion
                    const boardEl = document.getElementById('player-board');
                    if (boardEl) sourceEl = boardEl.children[battlecrySourceIndex];
                }

                const destEl = unitEl; // We already found it

                // Animations
                let effectType = 'DAMAGE';
                let color = '#ff0000';
                if (draggingMode === 'HEAL') { color = '#43e97b'; effectType = 'HEAL'; }
                else if (draggingMode === 'BUFF') { color = '#ffa500'; effectType = 'BUFF'; }
                else if (draggingMode === 'BOUNCE') { color = '#a335ee'; effectType = 'BOUNCE'; }
                else if (draggingMode === 'DESTROY') { color = '#000000'; effectType = 'DESTROY'; }

                await animateAbility(sourceEl, destEl, color, effectType !== 'HEAL');
                triggerCombatEffect(destEl, effectType);
                await new Promise(r => setTimeout(r, 400));

                // Resolve Logic
                if (battlecrySourceType === 'NEWS') {
                    const card = window.gameState.currentPlayer.hand[battlecrySourceIndex];
                    window.MatchHistory.add('PLAY', { player: "你", card: card.name });
                    window.gameState.playCard(battlecrySourceIndex, target);
                } else {
                    const minionInfo = window.gameState.currentPlayer.board[battlecrySourceIndex];
                    if (minionInfo && minionInfo.keywords?.battlecry) {
                        window.gameState.resolveBattlecry(minionInfo.keywords.battlecry, target, minionInfo);
                    }
                }

                window.render();
                await window.resolveDeaths();

            }
        } catch (err) {
            console.error(err);
            window.logMessage(err.message);
            window.render();
        }
        return;
    }

    if (!dragging) return;
    dragging = false;

    // Cleanup drag visuals
    dragLine.style.display = 'none';
    if (draggedEl) {
        draggedEl.remove();
        draggedEl = null;
    }
    document.querySelectorAll('.board-gap').forEach(el => el.remove());

    // Restore opacity of dragged card source
    if (draggingFromHand) {
        const handEl = document.getElementById('player-hand');
        if (handEl && handEl.children[attackerIndex]) {
            handEl.children[attackerIndex].style.opacity = '1';
        }
    }

    // Drag Distance Check (Click vs Drag)
    const dist = Math.sqrt(Math.pow(e.clientX - initialMouseX, 2) + Math.pow(e.clientY - initialMouseY, 2));
    if (dist < DRAG_THRESHOLD && !draggingFromHand) {
        // Clicked minion (logic not implemented yet, maybe select?)
        return;
    }

    if (draggingFromHand) {
        // DROP CARD
        const boardEl = document.getElementById('player-board');
        const boardRect = boardEl.getBoundingClientRect();

        // Check if dropped on board
        if (e.clientY > boardRect.top - 50 && e.clientY < boardRect.bottom + 50 &&
            e.clientX > boardRect.left - 50 && e.clientX < boardRect.right + 50) {

            // Limit Check
            if (window.gameState.currentPlayer.board.length >= 7) {
                window.logMessage(UI_TEXT.BOARD_FULL);
                return;
            }

            const card = window.gameState.currentPlayer.hand[attackerIndex];
            if (!card) return;

            // Targeted Card Check (Targeted Battlecry or News)
            const needsTarget = (card.type === 'NEWS') ||
                (card.keywords && card.keywords.battlecry && card.keywords.battlecry.target);

            // If needs target, switch to targeting mode
            if (needsTarget) {
                let rule = null;
                let mode = 'DAMAGE';

                if (card.type === 'NEWS') {
                    // News Targeting
                    // Assume news always hits something if it has getValidTargets logic elsewhere
                    // We need rule from card logic? 
                    // Wait, `gameState.playCard` usually handles targeting request internally if we just call it?
                    // No, `playCard` expects target if needed.
                    // We must determine rule here.
                    // Simplified: News cards define target in `effect`?
                    // Legacy code checked `card.target` or `card.effect.target`.
                    // We will rely on `card.target` property if it exists for News.
                    // Actually, legacy used `startBattlecryTargeting` directly.
                    // IMPORTANT: We need to know the rule. 
                    // I will assume `card.target` object exists on the card data.
                    rule = card.target || (card.effect && card.effect.target);
                    // Determine mode
                    if (card.id === 'S015') mode = 'DAMAGE'; // 武漢肺炎
                    if (card.id === 'S019') mode = 'DAMAGE'; // 查水表
                    // Hacky detection based on description or ID?
                    // Better: define mode in card data.
                    // Fallback to DAMAGE.
                } else {
                    // Battlecry
                    rule = card.keywords.battlecry;
                    mode = rule.type.includes('HEAL') ? 'HEAL' : (rule.type.includes('BUFF') ? 'BUFF' : 'DAMAGE');
                }

                if (rule) {
                    startBattlecryTargeting(attackerIndex, e.clientX, e.clientY, mode, rule, card.type === 'NEWS' ? 'NEWS' : 'MINION');

                    // Hide the card in hand visually (it's being targeted)
                    const handEl = document.getElementById('player-hand');
                    if (handEl && handEl.children[attackerIndex]) {
                        handEl.children[attackerIndex].style.opacity = '0';
                    }
                    return; // Don't play yet
                }
            }

            // No Target Keyed Play (Summon Minion / AOE Spell)
            try {
                // If it's a minion, we need placement index
                if (card.type === 'MINION') {
                    window.MatchHistory.add('PLAY', { player: "你", card: card.name });
                    window.gameState.playMinion(attackerIndex, currentInsertionIndex);
                } else {
                    // Non-targeted News (AOE)
                    // Check if valid?
                    window.MatchHistory.add('PLAY', { player: "你", card: card.name });
                    window.gameState.playCard(attackerIndex, null); // No target
                }

                window.render();
                await window.resolveDeaths();

                // Trigger Post-Play Visuals (Slam & Dust)
                const boardEl = document.getElementById('player-board');
                if (boardEl) {
                    boardEl.classList.remove('board-slam');
                    void boardEl.offsetWidth; // Force Reflow
                    boardEl.classList.add('board-slam');

                    // Spawn dust at the insertion point (approximated center of board for now, or use last mouse pos?)
                    // Better: find the new element in DOM? 
                    // Since render() happened, the new minion is in DOM.
                    // We can find it by index. 
                    const newMinionIndex = (typeof currentInsertionIndex !== 'undefined' && currentInsertionIndex !== -1) ? currentInsertionIndex : boardEl.children.length - 1;
                    const newMinionEl = boardEl.children[newMinionIndex];
                    if (newMinionEl) {
                        // Add Card Slam Animation
                        newMinionEl.classList.add('slamming');
                        spawnDustEffect(newMinionEl, 1.5);
                        setTimeout(() => newMinionEl.classList.remove('slamming'), 500);
                    } else {
                        spawnDustEffect(boardEl, 1);
                    }
                    setTimeout(() => boardEl.classList.remove('board-slam'), 500);
                }

                // This logic was in app.js `onDragEnd`... "Phase 2"
                // If it was a minion with non-targeted battlecry:
                // Handled in `resolveBattlecry` usually.
                // Visuals were manual.
                if (card.keywords?.battlecry) {
                    const bcType = card.keywords.battlecry.type;
                    if (bcType.includes('ALL')) {
                        // Trigger AOE Visuals
                        if (bcType === 'HEAL_ALL_FRIENDLY') triggerFullBoardHealAnimation(true);
                        // etc.
                    }
                }

            } catch (err) {
                console.error(err);
                window.logMessage(err.message);
                window.render();
            }

        }

    } else {
        // ATTACK DROP
        const targetEl = document.elementFromPoint(e.clientX, e.clientY);
        const targetData = targetEl?.closest('[data-type]');

        if (targetData) {
            const type = targetData.dataset.type;
            const index = parseInt(targetData.dataset.index);

            // Valid Attack Target?
            if ((type === 'HERO' && targetData.id === 'opp-hero') ||
                (type === 'MINION' && targetEl.closest('#opp-board'))) {

                try {
                    const sourceEl = document.getElementById('player-board').children[attackerIndex];
                    if (sourceEl) await animateAbility(sourceEl, targetData, '#ff0000'); // Attack projectile? 
                    // Actually `animateAttack` does the slam.
                    // Wait, `onDragEnd` used `animateAttack`.
                    // My export says `animateAttack`.

                    // Re-read app.js logic:
                    // It called `animateAttack(sourceEl, targetData)`.
                    // Let's use that.
                    if (sourceEl) await animateAttack(sourceEl, targetData); // Use imported function

                    const attacker = window.gameState.currentPlayer.board[attackerIndex];
                    const damage = attacker ? attacker.attack : 0;
                    const destName = (type === 'HERO') ? "對方英雄" : (window.gameState.players[1].board[index]?.name || "隨從");

                    window.MatchHistory.add('NORMAL_ATTACK', {
                        attacker: attacker.name,
                        target: destName,
                        damage: damage
                    });

                    window.gameState.attack(attackerIndex, { type, index });
                    window.render();
                    await window.resolveDeaths();

                } catch (err) {
                    window.logMessage(err.message);
                    window.render();
                }
            }
        }
    }
}

// --- Helper Functions ---

export function startBattlecryTargeting(sourceIndex, x, y, mode = 'DAMAGE', targetRule = null, sourceType = 'MINION') {
    isBattlecryTargeting = true;
    battlecrySourceIndex = sourceIndex;
    battlecrySourceType = sourceType;
    draggingMode = mode;
    battlecryTargetRule = targetRule;

    if (!dragLine) initDragManager();

    dragLine.classList.remove('heal-line', 'buff-line', 'bounce-line', 'destroy-line');
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
    window.logMessage(msg);
}

export function cancelBattlecryTargeting() {
    if (!isBattlecryTargeting) return;
    isBattlecryTargeting = false;
    dragLine.style.display = 'none';

    if (battlecrySourceType === 'MINION') {
        // This logic is tricky. 
        // In app.js: "Refund Minion: Remove from board, put back in hand"
        // But wait, MINION battlecry happens AFTER play?
        // In app.js flow:
        // 1. Drag Minion to board
        // 2. Drop.
        // 3. If battlecry needs target -> `startBattlecryTargeting`.
        // BUT THE MINION IS NOT ON BOARD YET in `gameState`.
        // Ah, legacy app.js put it on board??
        // Re-read app.js:
        // `gameState.playMinion` is called later.
        // Wait, checking `onDragEnd` (lines 2800+).
        // If `needsTarget` (line 2806): `startBattlecryTargeting`. Return.
        // It does NOT call `playMinion`.
        // So the minion is still in HAND.
        // So `cancelBattlecryTargeting` just resets the visual.
        // BUT `app.js` `cancelBattlecryTargeting` (3088) says:
        // "Refund Minion: Remove from board, put back in hand"
        // This implies it WAS on board?
        // Maybe `playMinion` was called tentatively?
        // No, `onDragEnd` returns early.

        // Let's re-examine app.js `cancelBattlecryTargeting` (3093):
        // `const minion = gameState.currentPlayer.board.splice(battlecrySourceIndex, 1)[0];`
        // It assumes it IS on board.
        // Why?
        // Maybe `onDragEnd` called `playMinion` before targeting?
        // Line 2840 (approx): `if (needsTarget) ... return;`
        // So it didn't play.
        // Unless `startBattlecryTargeting` is called *after* play?

        // Ah, in `app.js`, `onDragEnd` handled "Targeted Play" by:
        // 1. Setting state.
        // 2. Hiding hand card.
        // 3. Returning.
        // It did NOT put it on board.
        // Then why `cancelBattlecryTargeting` refunded it?
        // Maybe I misread the `cancel` function.
        // Line 3093: `if (battlecrySourceType === 'MINION')`
        // It splices from board.
        // This implies `app.js` logic was: Put on board -> Trigger Battlecry -> If cancel, remove.
        // BUT `onDragEnd` (2500ish) says `if (minion.keywords.battlecry.target) ... startBattlecryTargeting ... return`.
        // It doesn't look like it played it.

        // Wait, there are TWO ways to enter targeting.
        // 1. From Hand (Drag Card).
        // 2. From Board (Trigger Effect? No).

        // If I drag from hand, it stays in hand.
        // If I cancel, I just show it again.

        // Maybe `battlecrySourceIndex` is index in HAND.
        // Let's assume standard behavior: modify `cancel` to just restore hand visibility.

        const handEl = document.getElementById('player-hand');
        if (handEl && handEl.children[battlecrySourceIndex]) {
            handEl.children[battlecrySourceIndex].style.opacity = '1';
        }
        window.logMessage(UI_TEXT.PLAY_CANCELLED);

    } else {
        // News (Hand)
        const handEl = document.getElementById('player-hand');
        if (handEl && handEl.children[battlecrySourceIndex]) {
            handEl.children[battlecrySourceIndex].style.opacity = '1';
        }
        window.logMessage(UI_TEXT.PLAY_CANCELLED);
    }
    window.render();
}

export function isTargetEligible(rule, targetInfo) {
    if (!rule || !targetInfo) return false;
    const actualRule = rule.target || rule; // Handle wrapped rules

    // Side Check
    if (actualRule.side === 'ENEMY' && targetInfo.side !== 'OPPONENT') return false;
    if (actualRule.side === 'FRIENDLY' && targetInfo.side !== 'PLAYER') return false;

    // Type Check
    if (actualRule.type && actualRule.type !== 'ANY' && actualRule.type !== 'ALL') {
        if (actualRule.type === 'MINION' && targetInfo.type !== 'MINION') return false;
        if (actualRule.type === 'HERO' && targetInfo.type !== 'HERO') return false;
    }

    return true;
}

export function getValidTargets(rule) {
    // Basic implementation needed for AI or hints
    return [];
}
