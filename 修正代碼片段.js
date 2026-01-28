// ============================================================
// PVP 攻擊同步修正 - 代碼片段
// ============================================================
// 使用方法：複製對應的代碼片段，替換 app.js 中的相應部分
// ============================================================

// ===== 修正片段 1: onDragEnd 攻擊邏輯（約 6286-6365 行）=====
// 搜尋 "// Standard Attack" 找到位置

/* 替換以下整個 if 區塊（從 "// Standard Attack" 到該區塊結束）*/

// Standard Attack
const targetEl = document.elementFromPoint(e.clientX, e.clientY);
const targetData = targetEl?.closest('[data-type]');
if (targetData) {
    const type = targetData.dataset.type;
    const index = targetData.dataset.index ? parseInt(targetData.dataset.index) : null;
    const targetInstanceIdBefore = targetData.dataset.minionId || null;

    if (type === 'HERO' && targetData.id === 'opp-hero'
        || type === 'MINION' && targetEl.closest('#opp-board')) {

        try {
            // Pre-validation: Check if attack is legal before animating
            gameState.validateAttack(attackerIndex, { type, index, side: 'OPPONENT' });

            const sourceEl = document.getElementById('player-board').children[attackerIndex];
            const attacker = gameState.currentPlayer.board[attackerIndex];
            const damage = attacker ? attacker.attack : 0;

            // ✅ 修正 1: 先播放動畫
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

            // ✅ 修正 2: PVP 模式下先發送動作（在執行本地邏輯前）
            if (isPvPMode && window.pvpManager) {
                let targetInstanceId = targetInstanceIdBefore;
                
                if (!targetInstanceId && type === 'MINION' && index !== null) {
                    const targetMinion = gameState.players[1].board[index];
                    if (targetMinion) {
                        targetInstanceId = targetMinion.instanceId;
                    }
                }

                // 先發送攻擊動作到對手
                await window.pvpManager.syncGameAction('ATTACK', {
                    attackerIndex: attackerIndex,
                    targetType: type,
                    targetIndex: index,
                    targetInstanceId: targetInstanceId,
                    resolvedDamage: {
                        attackerAttack: attacker ? attacker.attack : 0,
                        attackerHealth: attacker ? attacker.currentHealth : 0,
                        damage: damage
                    }
                });
                
                console.log('[PVP] 攻擊動作已發送，準備執行本地邏輯');
            }

            // ✅ 修正 3: 然後執行本地攻擊邏輯
            gameState.attack(attackerIndex, { type, index, side: 'OPPONENT' });
            
            // ✅ 修正 4: 先處理死亡，不立即渲染
            await resolveDeaths();
            
            // ✅ 修正 5: 死亡處理後才渲染
            render();
            
            // ✅ 修正 6: 最後同步最終狀態（在 PVP 模式）
            if (isPvPMode && window.pvpManager) {
                syncLocalStateToFirebase();
            }
            
        } catch (err) {
            logMessage(err.message);
            render(); // 錯誤時才渲染
        }
    }
}

// ===== 修正片段 2: syncLocalStateToFirebase 函數（約 3522-3563 行）=====
// 搜尋 "const stateUpdate = {" 找到位置

/* 替換 stateUpdate 對象的定義 */

// [新增] 為英雄血量生成 hash
const heroHash = `${player.hero.hp}/${player.hero.maxHp}`;

// ✅ [修正] 為不同類型的狀態添加獨立時間戳，防止粗粒度覆蓋
const now = Date.now();

const stateUpdate = {
    hp: player.hero.hp ?? 30,
    maxHp: player.hero.maxHp ?? 30,
    heroHash: heroHash,
    heroTimestamp: now, // ✅ 英雄狀態專用時間戳
    mana: player.mana?.current ?? 0,
    maxMana: player.mana?.max ?? 0,
    handSize: player.hand?.length ?? 0,
    deckSize: player.deck?.length ?? 0,
    // [新增] 場面雜湊用於 desync 偵測
    boardHash: calcBoardHash(player.board),
    boardTimestamp: now, // ✅ 場面狀態專用時間戳
    // 同步當前手牌（保存 ID）
    hand: player.hand?.map(card => card.id) ?? [],
    // 同步場面上的所有隨從
    board: player.board?.map(minion => {
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
            side: minion.side,
            instanceId: minion.instanceId // ✅ 用於精確匹配
        });
    }) ?? [],
    timestamp: now // 保留全局時間戳作為備用
};

// ===== 修正片段 3: onGameStateUpdate 對手狀態同步（約 3220-3297 行）=====
// 搜尋 "if (oppState && gameState.players[1])" 找到位置

/* 替換整個 if (oppState && gameState.players[1]) 區塊的內容 */

if (oppState && gameState.players[1]) {
    const opponent = gameState.players[1];
    
    // ✅ [新增] 時間戳檢查 - 英雄狀態
    const localHeroTimestamp = opponent._lastHeroTimestamp || 0;
    const remoteHeroTimestamp = oppState.heroTimestamp || oppState.timestamp || 0;
    
    // 只在遠端時間戳更新時才更新英雄狀態
    if (remoteHeroTimestamp > localHeroTimestamp) {
        if (oppState.hp !== undefined) {
            opponent.hero.hp = oppState.hp;
            opponent.hero.maxHp = oppState.maxHp || 30;
            console.log('[PVP] 對手血量已更新:', oppState.hp, '/', oppState.maxHp);
        }
        opponent._lastHeroTimestamp = remoteHeroTimestamp;
    } else {
        console.log('[PVP] 跳過舊的英雄狀態更新 (timestamp check)');
    }
    
    if (oppState.mana !== undefined) {
        opponent.mana.current = oppState.mana;
        opponent.mana.max = oppState.maxMana;
    }

    // 同步手牌數（對手手牌不顯示具體內容，但數量需要同步）
    if (oppState.handSize !== undefined) {
        const currentHandSize = opponent.hand.length;
        const targetHandSize = oppState.handSize;

        if (targetHandSize > currentHandSize) {
            for (let i = currentHandSize; i < targetHandSize; i++) {
                opponent.hand.push({ id: 'HIDDEN', name: '?', cost: 0, type: 'HIDDEN' });
            }
        } else if (targetHandSize < currentHandSize) {
            opponent.hand.splice(targetHandSize);
        }
    }

    // 同步牌組數量
    if (oppState.deckSize !== undefined) {
        opponent._syncedDeckSize = oppState.deckSize;
    }

    // ✅ [修正] 場面同步 - 增加時間戳檢查
    const localBoardTimestamp = opponent._lastBoardTimestamp || 0;
    const remoteBoardTimestamp = oppState.boardTimestamp || oppState.timestamp || 0;
    
    if (remoteBoardTimestamp > localBoardTimestamp) {
        // [強化] Desync 偵測與強制同步
        if (oppState.boardHash !== undefined) {
            // 計算本地對手場面雜湊
            const localBoardHash = opponent.board && opponent.board.length > 0
                ? opponent.board.map(m => `${m.id}:${m.attack}:${m.currentHealth}`).join('|')
                : 'empty';

            if (localBoardHash !== oppState.boardHash) {
                console.warn('[PVP Desync 偵測] 對手場面雜湊不一致！');
                console.warn('[PVP] 本地:', localBoardHash);
                console.warn('[PVP] 遠端:', oppState.boardHash);

                // 強制使用遠端狀態覆蓋本地
                if (oppState.board && Array.isArray(oppState.board)) {
                    console.log('[PVP] 強制同步對手場面...');
                    opponent.board = oppState.board.map(remoteMinion => {
                        const minion = JSON.parse(JSON.stringify(remoteMinion));
                        minion.side = 'OPPONENT';
                        return minion;
                    });
                    console.log('[PVP] 強制同步完成，新場面:', opponent.board.length, '個隨從');
                }
            } else {
                // ✅ [修正] 雜湊一致時，只更新關鍵屬性，避免完全覆蓋
                console.log('[PVP] 場面雜湊一致，執行增量更新');
                if (oppState.board && Array.isArray(oppState.board)) {
                    oppState.board.forEach((remoteMinion, idx) => {
                        const localMinion = opponent.board[idx];
                        if (localMinion && localMinion.id === remoteMinion.id) {
                            // 只更新可能變化的屬性
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
            }
        }
        
        opponent._lastBoardTimestamp = remoteBoardTimestamp;
    } else {
        console.log('[PVP] 跳過舊的場面狀態更新 (timestamp check)');
    }

    // Render to show updated stats
    render();
}

// ===== 修正片段 4: executeOpponentAction ATTACK case（約 3826-3930 行）=====
// 搜尋 "case 'ATTACK':" 找到位置

/* 確保 ATTACK case 的最後是這樣的順序 */

case 'ATTACK': {
    const { attackerIndex, targetType, targetIndex, resolvedDamage } = action.data;

    const attacker = opponent.board[attackerIndex];
    if (!attacker) {
        console.warn('[PVP] 找不到對手攻擊者:', attackerIndex);
        return;
    }

    // [修正] 強制使用遠端的攻擊者數值，避免 desync
    if (resolvedDamage) {
        console.log('[PVP] 攻擊前強制同步攻擊者數值:', resolvedDamage);
        attacker.attack = resolvedDamage.attackerAttack;
        attacker.currentHealth = resolvedDamage.attackerHealth;
    }

    // 取得 DOM 元素進行動畫
    const sourceEl = document.getElementById('opp-board').children[attackerIndex];
    let targetEl;

    if (targetType === 'HERO') {
        targetEl = document.getElementById('player-hero');
    } else {
        targetEl = document.getElementById('player-board').children[targetIndex];
    }

    if (sourceEl && targetEl) {
        const damage = attacker.attack;
        await animateAttack(sourceEl, targetEl, damage);
    }

    try {
        const { targetInstanceId } = action.data;

        // 強制設置攻擊者為可攻擊狀態
        attacker.canAttack = true;
        attacker.sleeping = false;

        // 手動執行攻擊邏輯
        let targetUnit = null;

        if (targetType === 'HERO') {
            targetUnit = gameState.players[0].hero;
        } else if (targetType === 'MINION') {
            // 優先使用 instanceId 查找目標
            if (targetInstanceId) {
                targetUnit = gameState.players[0].board.find(m => m.instanceId === targetInstanceId);
                if (!targetUnit) {
                    console.warn(`[PVP] 無法通過 instanceId 找到目標: ${targetInstanceId}，嘗試回退到 index`);
                }
            }

            // 回退到 index
            if (!targetUnit && targetIndex !== null && targetIndex !== undefined) {
                targetUnit = gameState.players[0].board[targetIndex];
            }
        }

        if (targetUnit) {
            // 使用遠端確定的傷害值
            const attackerAtk = (resolvedDamage && resolvedDamage.damage !== undefined)
                ? resolvedDamage.damage
                : attacker.attack;

            const targetAtk = (targetType === 'MINION' && targetUnit) ? (targetUnit.attack || 0) : 0;

            console.log(`[PVP] 執行傷害應用: 攻擊者=${attackerAtk}, 目標反擊=${targetAtk}`);

            // 對目標造成傷害
            gameState.applyDamage(targetUnit, attackerAtk);

            // 隨從反擊
            if (targetType === 'MINION' && targetAtk > 0) {
                gameState.applyDamage(attacker, targetAtk);
            }

            // 標記已攻擊
            attacker.canAttack = false;
            attacker.attacksThisTurn = (attacker.attacksThisTurn || 0) + 1;
        } else {
            console.warn('[PVP] 攻擊目標丟失!', action.data);
        }

        // ✅ [修正] 先處理死亡
        await resolveDeaths();
        
        // ✅ [Validation] 驗證沒有殭屍隨從
        const player = gameState.players[0];
        const deadMinions = player.board.filter(m => m.currentHealth <= 0);
        if (deadMinions.length > 0) {
            console.error('[PVP Opponent Attack] Found dead minions not cleaned up:', deadMinions);
            player.board = player.board.filter(m => m.currentHealth > 0);
        }

        // ✅ [修正] 死亡處理後才渲染
        render();
        
        // ✅ [修正] 只同步一次最終狀態
        syncLocalStateToFirebase();

    } catch (e) {
        console.error('[PVP] 執行對手攻擊失敗:', e);
    }
    break;
}

// ============================================================
// 修正完成確認清單
// ============================================================
// [ ] 修正片段 1 已應用 (onDragEnd 攻擊邏輯)
// [ ] 修正片段 2 已應用 (syncLocalStateToFirebase)
// [ ] 修正片段 3 已應用 (onGameStateUpdate)
// [ ] 修正片段 4 已應用 (executeOpponentAction ATTACK)
// [ ] 已清除瀏覽器緩存
// [ ] 已測試基本攻擊
// [ ] 已測試連續攻擊
// [ ] 已測試攻擊致死
// [ ] 檢查控制台無錯誤訊息
// ============================================================
