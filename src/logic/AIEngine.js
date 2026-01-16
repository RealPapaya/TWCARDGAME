
/**
 * AIEngine.js
 * 
 * 用途: 負責電腦對手 (AI) 的決策邏輯。
 * 分析當前 GameState，計算最佳攻擊目標或出牌順序。
 * 
 * 會被誰應用:
 * - src/logic/GameEngine.js (初始化時建立)
 * - src/legacy/app.js (回合結束時呼叫 AI 思考)
 * 
 * 又會用到誰:
 * - src/logic/GameState.js (讀取局勢資訊)
 */
export class AIEngine {
    decideTurn(gameState) {
        const actions = [];
        const aiPlayer = gameState.currentPlayer;
        const opponent = gameState.opponent;

        // 1. Lethal Check
        const totalDamage = this.calculateTotalDamage(aiPlayer);
        if (totalDamage >= opponent.hero.hp) {
            console.log("AI: Lethal spotted!");
            // Queue all attacks to face
            aiPlayer.board.forEach((minion, index) => {
                if (minion.canAttack) {
                    actions.push({ type: 'ATTACK', attackerIndex: index, target: { type: 'HERO' } });
                }
            });
        } else {
            // 2. Play Cycle (Board Control & Mana Efficiency)
            let mana = aiPlayer.mana.current;
            let playedSomething = true;

            const tempHand = [...aiPlayer.hand];
            let boardSpace = 5 - aiPlayer.board.length;

            // Simple Greedy: Find most expensive card we can play
            while (mana > 0 && playedSomething) {
                playedSomething = false;
                // Filter playable cards
                const playableIndices = tempHand.map((c, i) => ({ c, i })).filter(item => item.c && item.c.cost <= mana);

                if (playableIndices.length > 0) {
                    // Sort by cost desc
                    playableIndices.sort((a, b) => b.c.cost - a.c.cost);

                    const bestPlay = playableIndices[0];
                    const card = bestPlay.c;

                    if (card.type === 'MINION' && boardSpace > 0) {
                        let target = null;
                        if (card.keywords && card.keywords.battlecry) {
                            target = this.getBattlecryTarget(card.keywords.battlecry, gameState, aiPlayer, opponent);
                        }
                    }
                }
            }
        }
        return actions;
    }

    /**
     * Returns the single best next action based on current state.
     */
    getNextMove(gameState) {
        const aiPlayer = gameState.currentPlayer;
        const opponent = gameState.opponent;
        const difficulty = gameState.difficulty;

        // 1. Lethal Check (Force Face if possible)
        const totalDamage = this.calculateTotalDamage(aiPlayer);
        if (totalDamage >= opponent.hero.hp) {
            const attackerIdx = aiPlayer.board.findIndex(m => m.canAttack && !m.sleeping);
            if (attackerIdx !== -1) {
                return { type: 'ATTACK', attackerIndex: attackerIdx, target: { type: 'HERO' } };
            }
        }

        // 2. Play Card Logic
        const playableCards = aiPlayer.hand
            .map((c, i) => ({ ...c, originalIndex: i }))
            .filter((c, i) => gameState.canPlayCard(i));

        if (playableCards.length > 0) {
            // Categorize and prioritize
            const minions = playableCards.filter(c => c.type === 'MINION');
            const newss = playableCards.filter(c => c.type === 'NEWS');

            // Find valid minions to play
            if (minions.length > 0 && aiPlayer.board.length < 7) {
                // Determine category of minion
                const isBuffAll = (c) => c.keywords?.battlecry?.type?.includes('_ALL') || c.keywords?.battlecry?.type?.includes('CATEGORY');
                const isBuffAdjacent = (c) => c.keywords?.battlecry?.type?.includes('ADJACENT') || c.keywords?.ongoing?.type?.includes('ADJACENT');

                const standardMinions = minions.filter(m => !isBuffAll(m) && !isBuffAdjacent(m));
                const buffMinions = minions.filter(m => isBuffAll(m) || isBuffAdjacent(m));

                // Sort minions by cost (descending)
                standardMinions.sort((a, b) => b.cost - a.cost);
                buffMinions.sort((a, b) => b.cost - a.cost);

                const finalMinionList = [...standardMinions, ...buffMinions];

                for (const choice of finalMinionList) {
                    let target = null;
                    if (choice.keywords?.battlecry?.target) {
                        target = this.getBattlecryTarget(choice.keywords.battlecry, gameState, aiPlayer, opponent);
                        const type = choice.keywords.battlecry.type;
                        const isHardTarget = ['DESTROY', 'DAMAGE', 'HEAL', 'BUFF_STAT_TARGET', 'GIVE_DIVINE_SHIELD', 'DAMAGE_NON_CATEGORY', 'EAT_FRIENDLY'].includes(type);
                        if (isHardTarget && !target) continue;
                    }

                    // Best placement for adjacent buffs
                    let insertionIndex = -1;
                    if (isBuffAdjacent(choice) && aiPlayer.board.length >= 2) {
                        // Find a spot between two minions
                        insertionIndex = 1; // Default to first available gap
                    }

                    return { type: 'PLAY_CARD', index: choice.originalIndex, target: target, insertionIndex: insertionIndex };
                }
            }

            // Play newss
            if (newss.length > 0) {
                for (const choice of newss) {
                    let target = null;
                    if (choice.keywords?.battlecry?.target) {
                        target = this.getBattlecryTarget(choice.keywords.battlecry, gameState, aiPlayer, opponent);
                        if (!target) continue; // News MUST have targets if they have a target rule
                    }
                    return { type: 'PLAY_CARD', index: choice.originalIndex, target: target };
                }
            }
        }

        // 3. Trade / Attack
        const attackers = aiPlayer.board
            .map((m, i) => ({ ...m, index: i }))
            .filter(m => m.canAttack && !m.sleeping);

        if (attackers.length > 0) {
            const attacker = attackers[0];
            const validTargets = opponent.board.map((m, i) => ({ ...m, index: i }));

            // Taunt filter
            const taunts = validTargets.filter(m => m.keywords && m.keywords.taunt);
            const actualTargets = taunts.length > 0 ? taunts : validTargets;

            if (difficulty !== 'NORMAL') {
                actualTargets.sort((a, b) => b.attack - a.attack);
                for (const t of actualTargets) {
                    if (attacker.attack >= t.currentHealth && attacker.currentHealth > t.attack) {
                        return { type: 'ATTACK', attackerIndex: attacker.index, target: { type: 'MINION', index: t.index } };
                    }
                }
                for (const t of actualTargets) {
                    if (attacker.attack >= t.currentHealth && (t.attack >= 3 || t.cost > attacker.cost)) {
                        return { type: 'ATTACK', attackerIndex: attacker.index, target: { type: 'MINION', index: t.index } };
                    }
                }
            } else {
                for (const t of actualTargets) {
                    if (attacker.attack >= t.currentHealth && attacker.currentHealth > t.attack) {
                        return { type: 'ATTACK', attackerIndex: attacker.index, target: { type: 'MINION', index: t.index } };
                    }
                }
            }

            if (taunts.length > 0) {
                return { type: 'ATTACK', attackerIndex: attacker.index, target: { type: 'MINION', index: taunts[0].index } };
            } else {
                return { type: 'ATTACK', attackerIndex: attacker.index, target: { type: 'HERO' } };
            }
        }

        return null;
    }

    calculateTotalDamage(player) {
        return player.board
            .filter(m => m.canAttack && !m.sleeping)
            .reduce((sum, m) => sum + m.attack, 0);
    }

    getBattlecryTarget(battlecry, gameState, ai, opponent) {
        const rule = battlecry.target;
        if (!rule || typeof rule !== 'object') return null;

        const results = [];

        // Collect all possible targets
        const potentialMinions = [];
        if (rule.side === 'ALL' || rule.side === 'FRIENDLY') {
            ai.board.forEach((m, i) => potentialMinions.push({ unit: m, index: i, side: 'PLAYER' }));
        }
        if (rule.side === 'ALL' || rule.side === 'ENEMY' || rule.side === 'OPPONENT') {
            opponent.board.forEach((m, i) => potentialMinions.push({ unit: m, index: i, side: 'OPPONENT' }));
        }

        const potentialHeroes = [];
        if (rule.type !== 'MINION') {
            if (rule.side === 'ALL' || rule.side === 'FRIENDLY') potentialHeroes.push({ type: 'HERO', side: 'PLAYER' });
            if (rule.side === 'ALL' || rule.side === 'ENEMY' || rule.side === 'OPPONENT') potentialHeroes.push({ type: 'HERO', side: 'OPPONENT' });
        }

        // Filtering
        let filteredMinions = potentialMinions;
        if (rule.type === 'MINION') filteredMinions = potentialMinions.filter(p => p.unit.type === 'MINION');

        // Category check
        if (battlecry.target_category) {
            if (battlecry.type === 'DAMAGE_NON_CATEGORY') {
                filteredMinions = filteredMinions.filter(p => !p.unit.category || !p.unit.category.includes(battlecry.target_category));
            } else {
                filteredMinions = filteredMinions.filter(p => p.unit.category && p.unit.category.includes(battlecry.target_category));
            }
        }

        // Preference Logic
        if (battlecry.type === 'HEAL' || battlecry.type?.includes('BUFF') || battlecry.type === 'GIVE_DIVINE_SHIELD') {
            // Prefer friends, then injured, then high attack
            const friendly = filteredMinions.filter(p => p.side === 'PLAYER');
            if (friendly.length > 0) {
                if (battlecry.type === 'HEAL') {
                    friendly.sort((a, b) => (a.unit.health - a.unit.currentHealth) - (b.unit.health - b.unit.currentHealth));
                    if (friendly[0].unit.currentHealth < friendly[0].unit.health) return { type: 'MINION', index: friendly[0].index, side: 'PLAYER' };
                }
                return { type: 'MINION', index: friendly[0].index, side: 'PLAYER' };
            }
            if (potentialHeroes.some(h => h.side === 'PLAYER')) return { type: 'HERO', side: 'PLAYER' };
        } else if (battlecry.type === 'DAMAGE' || battlecry.type === 'DESTROY' || battlecry.type === 'BOUNCE_TARGET') {
            // Prefer enemies, then high threat
            const enemies = filteredMinions.filter(p => p.side === 'OPPONENT');
            if (enemies.length > 0) {
                enemies.sort((a, b) => b.unit.attack - a.unit.attack);
                return { type: 'MINION', index: enemies[0].index, side: 'OPPONENT' };
            }
            if (potentialHeroes.some(h => h.side === 'OPPONENT')) return { type: 'HERO', side: 'OPPONENT' };
        }

        return null;
    }
}
