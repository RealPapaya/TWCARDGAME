// GameEngine - Shared Logic (Node & Browser)

class GameEngine {
    constructor(cardDB) {
        this.collection = cardDB;
        this.ai = new AIEngine();
    }

    /**
     * Get all available cards.
     */
    getCollection() {
        return this.collection.filter(c => c.collectible !== false);
    }

    /**
     * Validate a deck.
     * Rules:
     * 1. 30 Cards total.
     * 2. Max 2 copies of same card (based on ID).
     * @param {Array<string>} deckIds Array of card IDs.
     * @returns {Object} { valid: boolean, message: string }
     */
    validateDeck(deckIds) {
        if (!Array.isArray(deckIds)) {
            return { valid: false, message: "Deck must be an array of card IDs." };
        }

        // Relaxed Rules for Testing/Fun
        if (deckIds.length < 1) {
            return { valid: false, message: "Deck cannot be empty." };
        }
        // Removed 30 card strict limit check -> Allow small decks

        const counts = {};
        let totalLegendaries = 0;
        for (const id of deckIds) {
            const card = this.collection.find(c => c.id === id);
            if (!card) {
                return { valid: false, message: `Invalid card ID: ${id}` };
            }

            // Removed collectible check

            if (card.rarity === 'LEGENDARY') {
                totalLegendaries++;
            }

            counts[id] = (counts[id] || 0) + 1;
            // Removed max 2 copies check for fun
        }

        // Removed legendary limit

        return { valid: true, message: "Deck is valid." };
    }
    /**
     * Initialize a new game.
     * @param {Array<string>} deck1Ids
     * @param {Array<string>} deck2Ids
     * @returns {GameState}
     */
    createGame(deck1Ids, deck2Ids, debugMode = false, difficulty = 'NORMAL') {
        // Validate decks first
        if (!this.validateDeck(deck1Ids).valid || !this.validateDeck(deck2Ids).valid) {
            throw new Error("Invalid decks");
        }

        const p1 = new Player(deck1Ids, this.collection, 'PLAYER');
        const p2 = new Player(deck2Ids, this.collection, 'OPPONENT');

        // Randomly choose starting player
        const startingIndex = Math.random() < 0.5 ? 0 : 1;

        const state = new GameState([p1, p2], startingIndex, debugMode, difficulty, this.collection);

        // Initial Draw: Both players get 3 cards as per user request
        const p1Draws = 3;
        const p2Draws = 3;

        for (let i = 0; i < p1Draws; i++) p1.drawCard();
        for (let i = 0; i < p2Draws; i++) p2.drawCard();

        state.startTurn();
        return state;
    }
}

class GameState {
    constructor(players, startingIndex, debugMode = false, difficulty = 'NORMAL', collection = []) {
        this.gameId = Date.now().toString();
        this.turnCount = 0;
        this.players = players;
        this.currentPlayerIdx = startingIndex;
        this.gameOver = false;
        this.winner = null;
        this.debugMode = debugMode;
        this.difficulty = difficulty;
        this.collection = collection;

        // Apply Difficulty Modifiers to Opponent (AI)
        const opponent = this.players.find(p => p.side === 'OPPONENT');
        if (opponent) {
            if (difficulty === 'HARD') {
                opponent.hero.hp = 40;
                opponent.hero.maxHp = 40;
                opponent.mana.max = 2;
                opponent.mana.current = 2;
            } else if (difficulty === 'HELL') {
                opponent.hero.hp = 50;
                opponent.hero.maxHp = 50;
                opponent.mana.max = 3;
                opponent.mana.current = 3;
            }
        }

        if (this.debugMode) {
            this.players.forEach(p => {
                p.hero.hp = 100;
                p.hero.maxHp = 100;
                p.mana.max = 10;
                p.mana.current = 10;
            });
        }
    }

    get currentPlayer() {
        return this.players[this.currentPlayerIdx];
    }

    get opponent() {
        return this.players[this.currentPlayerIdx === 0 ? 1 : 0];
    }

    /**
     * Start a new turn.
     */
    startTurn() {
        this.turnCount++;
        const player = this.currentPlayer;

        // Execute Turn Start Effects
        if (player.onTurnStart && player.onTurnStart.length > 0) {
            const effects = [...player.onTurnStart];
            player.onTurnStart = [];
            effects.forEach(effect => {
                if (effect.type === 'DRAW') {
                    for (let i = 0; i < effect.count; i++) player.drawCard();
                }
            });
        }

        // Increase Mana
        if (player.mana.max < 10) {
            player.mana.max++;
        }
        player.mana.current = player.mana.max;

        // Draw a card (Always draw at start of turn)
        player.drawCard();

        // Wake up minions (summoning sickness wears off)
        player.board.forEach(minion => minion.canAttack = true);

        // Sleeping minions from last turn wake up (simplified: all board minions can attack unless just summoned)
        // Actually, logic is: Minions summoned LAST turn can attack THIS turn.
        // So we set sleeping = false for all.
        player.board.forEach(m => m.sleeping = false);

        this.updateAuras();
    }

    /**
     * End current turn and switch player.
     */
    endTurn() {
        // Cleanup Temporary Buffs for current player
        this.currentPlayer.board.forEach(m => {
            if (m.tempBuffs && m.tempBuffs.length > 0) {
                m.tempBuffs.forEach(buff => {
                    m.attack -= buff.attack;
                    m.health -= buff.health;
                    if (m.currentHealth > m.health) m.currentHealth = m.health;
                });
                m.tempBuffs = [];
            }
        });

        this.currentPlayerIdx = this.currentPlayerIdx === 0 ? 1 : 0;
        this.startTurn();
    }

    /**
     * Play a card from hand.
     * @param {number} cardIndex Index in hand
     * @param {Object} target Target info { type: 'HERO'|'MINION', index: number } (Optional)
     * @param {number} insertionIndex Preferred index on board (Optional)
     */
    canPlayCard(cardIndex) {
        const player = this.currentPlayer;
        const card = player.hand[cardIndex];
        if (!card) return false;
        if (player.mana.current < card.cost) return false;
        if (player.board.length >= 7 && card.type === 'MINION') return false;

        // Discard Play Restriction
        if (card.keywords && card.keywords.battlecry && card.keywords.battlecry.type === 'DISCARD_RANDOM') {
            const count = card.keywords.battlecry.value || 1;
            if (player.hand.length <= count) return false;
        }

        return true;
    }

    playCard(cardIndex, target = null, insertionIndex = -1, skipBattlecry = false) {
        const player = this.currentPlayer;
        const card = player.hand[cardIndex];

        if (!this.canPlayCard(cardIndex)) {
            // Re-throw specific errors if needed, or generic
            if (player.mana.current < card.cost) throw new Error("能量不足！");
            if (player.board.length >= 7 && card.type === 'MINION') throw new Error("戰場已滿！");
            if (card.keywords?.battlecry?.type === 'DISCARD_RANDOM') {
                const count = card.keywords.battlecry.value || 1;
                if (player.hand.length <= count) {
                    throw new Error(`至少需要 ${count} 張手牌可以丟棄，無法打出此卡！`);
                }
            }
            throw new Error("無法打出此卡！");
        }

        // Pay Mana
        player.mana.current -= card.cost;

        // Remove from hand
        player.hand.splice(cardIndex, 1);

        let battlecryResult = null;

        if (card.type === 'MINION') {
            const minion = this.createMinion(card, player.side);
            if (minion.keywords && minion.keywords.charge) {
                minion.sleeping = false;
                minion.canAttack = true;
            }

            if (insertionIndex === -1) {
                player.board.push(minion);
            } else {
                // Ensure insertionIndex is within bounds
                const actualIndex = Math.min(Math.max(0, insertionIndex), player.board.length);
                player.board.splice(actualIndex, 0, minion);
            }

            // Trigger Battlecry
            if (minion.keywords && minion.keywords.battlecry && !skipBattlecry) {
                battlecryResult = this.resolveBattlecry(minion.keywords.battlecry, target, minion);
            }
        } else if (card.type === 'NEWS') {
            // Trigger News Effect (Battlecry logic reused for simplicity)
            if (card.keywords && card.keywords.battlecry && !skipBattlecry) {
                battlecryResult = this.resolveBattlecry(card.keywords.battlecry, target);

            } else if (card.id === 'S002') { // Impeach: Damage split
                const damage = player.deck.length === 0 ? 20 : 10;
                const enemies = [this.opponent.hero, ...this.opponent.board];
                const hits = [];

                for (let i = 0; i < damage; i++) {
                    const target = enemies[Math.floor(Math.random() * enemies.length)];
                    this.applyDamage(target, 1);
                    hits.push({ target: JSON.parse(JSON.stringify(target)), value: 1 });
                    // Filter out dead minions after each hit? 
                    // Actually, Hearthstone "Randomly split" usually can hit already dead (at 0 HP) things in some cases, 
                    // but better to filter. 
                    if (target.type === 'MINION' && target.currentHealth <= 0) {
                        const idx = enemies.indexOf(target);
                        if (idx > -1) enemies.splice(idx, 1);
                    }
                    if (enemies.length === 0) break;
                }
                battlecryResult = { type: 'MULTI_DAMAGE', hits };
            }
        }

        this.updateAuras();
        return { card, battlecryResult };
    }

    updateAuras() {
        this.players.forEach(player => {
            // 1. Calculate Desired Buffs for all minions
            const desiredBuffs = new Map(); // minion -> { attack: 0, health: 0 }

            // Iterate sources
            player.board.forEach((m, i) => {
                // Initialize entry for every minion to ensure we check everyone
                if (!desiredBuffs.has(m)) desiredBuffs.set(m, { attack: 0, health: 0 });

                if (m.keywords && m.keywords.ongoing) {
                    const aura = m.keywords.ongoing;
                    if (aura.type === 'ADJACENT_BUFF_STATS') {
                        const val = aura.value || 1;
                        // Neighbors
                        [i - 1, i + 1].forEach(nid => {
                            if (nid >= 0 && nid < player.board.length) {
                                const neighbor = player.board[nid];
                                if (!desiredBuffs.has(neighbor)) desiredBuffs.set(neighbor, { attack: 0, health: 0 });
                                const buffs = desiredBuffs.get(neighbor);
                                buffs.attack += val;
                                buffs.health += val;
                            }
                        });
                    }
                }
            });

            // 2. Apply Diffs
            player.board.forEach(m => {
                const current = m.ongoingStats || { attack: 0, health: 0 };
                const target = desiredBuffs.get(m) || { attack: 0, health: 0 };

                const atkDiff = target.attack - current.attack;
                const hpDiff = target.health - current.health;

                if (atkDiff !== 0 || hpDiff !== 0) {
                    m.attack += atkDiff;
                    m.health += hpDiff;

                    if (hpDiff > 0) {
                        // Gaining buff: Heal current HP
                        m.currentHealth += hpDiff;
                    } else if (hpDiff < 0) {
                        // Losing buff: Cap current HP
                        if (m.currentHealth > m.health) {
                            m.currentHealth = m.health;
                        }
                    }

                    // Check enrage state since health threshold might have shifted OR max HP changed
                    this.updateEnrage(m);

                    // Update state
                    if (target.attack === 0 && target.health === 0) {
                        m.ongoingStats = null;
                    } else {
                        m.ongoingStats = { ...target };
                    }
                }

                // Legacy Divine Shield cleanup (if any left over)
                if (m.ongoingDivineShield) {
                    m.keywords.divineShield = false;
                    m.ongoingDivineShield = false;
                }
            });
        });
    }

    resolveBattlecry(battlecry, target, sourceMinion = null) {
        console.log("Resolving Battlecry:", battlecry.type, "Target:", target);
        if (target === 'PENDING') return null;

        if (battlecry.type === 'DAMAGE') {
            const targetUnit = this.getTargetUnit(target) || this.opponent.hero;
            console.log("Applying Damage to:", targetUnit?.name || 'Hero');
            this.applyDamage(targetUnit, battlecry.value);
            return { type: 'DAMAGE', target: targetUnit, value: battlecry.value };
        } else if (battlecry.type === 'DAMAGE_SELF') {
            if (sourceMinion) {
                console.log("Applying Self Damage to:", sourceMinion.name);
                this.applyDamage(sourceMinion, battlecry.value);
                return { type: 'DAMAGE', target: sourceMinion, value: battlecry.value };
            }
        } else if (battlecry.type === 'HEAL_ALL_FRIENDLY') {
            const affected = [];
            this.currentPlayer.board.forEach((m, i) => {
                const old = m.currentHealth;
                m.currentHealth = m.health;
                affected.push({ unit: { ...m, index: i }, healed: m.health - old });
                this.updateEnrage(m);
            });
            return { type: 'HEAL_ALL', affected };
        } else if (battlecry.type === 'BOUNCE_ALL_ENEMY') {
            const opp = this.opponent;
            const collection = this.collection || [];
            const bounced = [];
            while (opp.board.length > 0) {
                const m = opp.board.shift();
                bounced.push(m);
                // Find original card data to put back in hand
                const originalCard = collection.find(c => c.id === m.id) || m;
                let cardToHand = JSON.parse(JSON.stringify(originalCard));

                // Han Kuo-yu (TW032): Permanent stackable +2/+2 on bounce
                if (m.hanBounceBonus) cardToHand.hanBounceBonus = m.hanBounceBonus;
                if (m.id === 'TW032') {
                    cardToHand.hanBounceBonus = (cardToHand.hanBounceBonus || 0) + 2;
                    cardToHand.attack += cardToHand.hanBounceBonus;
                    cardToHand.health += cardToHand.hanBounceBonus;
                }

                // Clean up board-specific state for hand display
                delete cardToHand.currentHealth;
                delete cardToHand.sleeping;
                delete cardToHand.canAttack;
                delete cardToHand.isEnraged;

                if (opp.hand.length < 10) opp.hand.push(cardToHand);
            }
            return { type: 'BOUNCE_ALL', bounced };
        } else if (battlecry.type === 'DAMAGE_NON_CATEGORY') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit && targetUnit.type === 'MINION' && targetUnit.category !== battlecry.target_category) {
                this.applyDamage(targetUnit, battlecry.value);
                return { type: 'DAMAGE', target: { ...targetUnit, index: target.index }, value: battlecry.value };
            }
        } else if (battlecry.type === 'HEAL') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit) {
                const max = targetUnit.type === 'HERO' ? targetUnit.maxHp : targetUnit.health;
                const current = targetUnit.type === 'HERO' ? targetUnit.hp : targetUnit.currentHealth;

                if (typeof max === 'number' && typeof current === 'number') {
                    const healValue = Math.min(max - current, battlecry.value);
                    const newHp = current + healValue;
                    if (targetUnit.type === 'HERO') targetUnit.hp = newHp;
                    else {
                        targetUnit.currentHealth = newHp;
                        this.updateEnrage(targetUnit);
                    }
                    return { type: 'HEAL', target: { ...targetUnit, index: target.index }, value: healValue };
                }
            }
        } else if (battlecry.type === 'FULL_HEAL') {
            const targetUnit = this.getTargetUnit(target);
            // Limit to MINIONS only based on user request "將一個隨從生命回復全滿"
            // But usually healers can heal heroes too. Let's allowing targeting to decide.
            if (targetUnit) {
                const max = targetUnit.type === 'HERO' ? targetUnit.maxHp : targetUnit.health;
                const current = targetUnit.type === 'HERO' ? targetUnit.hp : targetUnit.currentHealth;

                if (typeof max === 'number' && typeof current === 'number') {
                    const healValue = max - current;
                    const newHp = max;

                    if (targetUnit.type === 'HERO') targetUnit.hp = newHp;
                    else {
                        targetUnit.currentHealth = newHp;
                        this.updateEnrage(targetUnit);
                    }
                    return { type: 'HEAL', target: targetUnit, value: healValue };
                }
            }
        } else if (battlecry.type === 'BUFF_STAT_TARGET') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit && targetUnit.type === 'MINION') {
                if (battlecry.stat === 'ATTACK') targetUnit.attack += battlecry.value;
                else if (battlecry.stat === 'HEALTH') {
                    targetUnit.health += battlecry.value;
                    targetUnit.currentHealth += battlecry.value;
                    this.updateEnrage(targetUnit);
                }
                return { type: 'BUFF', target: { ...targetUnit, index: target.index }, stat: battlecry.stat, value: battlecry.value };
            }
        } else if (battlecry.type === 'BUFF_STAT_TARGET_TEMP') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit && targetUnit.type === 'MINION') {
                const buff = { attack: 0, health: 0 };
                if (battlecry.stat === 'ALL' || !battlecry.stat) {
                    buff.attack = battlecry.value;
                    buff.health = battlecry.value;
                } else if (battlecry.stat === 'ATTACK') {
                    buff.attack = battlecry.value;
                } else if (battlecry.stat === 'HEALTH') {
                    buff.health = battlecry.value;
                }

                targetUnit.attack += buff.attack;
                targetUnit.health += buff.health;
                targetUnit.currentHealth += buff.health;

                if (!targetUnit.tempBuffs) targetUnit.tempBuffs = [];
                targetUnit.tempBuffs.push(buff);

                this.updateEnrage(targetUnit);
                return { type: 'BUFF', target: { ...targetUnit, index: target.index }, stat: 'ALL', value: battlecry.value };
            }
        } else if (battlecry.type === 'GIVE_DIVINE_SHIELD') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit && targetUnit.type === 'MINION') {
                if (!targetUnit.keywords) targetUnit.keywords = {};
                targetUnit.keywords.divineShield = true;
                return { type: 'BUFF', target: { ...targetUnit, index: target.index }, shield: true };
            }
        } else if (battlecry.type === 'GIVE_DIVINE_SHIELD_CATEGORY') {
            const affected = [];
            this.currentPlayer.board.forEach((m, i) => {
                if (m.category === battlecry.target_category) {
                    if (!m.keywords) m.keywords = {};
                    m.keywords.divineShield = true;
                    affected.push({ unit: { ...m, index: i }, type: 'BUFF' });
                }
            });
            return { type: 'BUFF_ALL', affected };
        } else if (battlecry.type === 'GIVE_DIVINE_SHIELD_ALL') {
            const affected = [];
            this.currentPlayer.board.forEach((m, i) => {
                if (!m.keywords) m.keywords = {};
                m.keywords.divineShield = true;
                affected.push({ unit: { ...m, index: i }, type: 'BUFF' });
            });
            return { type: 'BUFF_ALL', affected };
        } else if (battlecry.type === 'DESTROY') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit) {
                targetUnit.currentHealth = 0; // Direct kill, ignore Divine Shield
                // this.resolveDeaths(); // Let app.js handle with animation
                return { type: 'DAMAGE', target: { ...targetUnit, index: target.index }, value: 999 };
            }
        } else if (battlecry.type === 'BUFF_CATEGORY') {
            const affected = [];
            this.currentPlayer.board.forEach((m, i) => {
                if (m.category === battlecry.target_category) {
                    m.health += battlecry.value;
                    m.currentHealth += battlecry.value;
                    affected.push({ unit: { ...m, index: i }, type: 'BUFF' });
                }
            });
            return { type: 'BUFF_ALL', affected };
        } else if (battlecry.type === 'BUFF_ALL') {
            const affected = [];
            this.currentPlayer.board.forEach((m, i) => {
                if (battlecry.stat === 'ATTACK') m.attack += battlecry.value;
                else if (battlecry.stat === 'HEALTH') {
                    m.health += battlecry.value;
                    m.currentHealth += battlecry.value;
                }
                affected.push({ unit: { ...m, index: i }, type: 'BUFF' });
            });
            return { type: 'BUFF_ALL', affected };
        } else if (battlecry.type === 'DAMAGE_RANDOM_FRIENDLY') {
            const friendlyBoard = this.currentPlayer.board;
            if (friendlyBoard.length > 0) {
                const randomIdx = Math.floor(Math.random() * friendlyBoard.length);
                const targetUnit = friendlyBoard[randomIdx];
                this.applyDamage(targetUnit, battlecry.value);
                return { type: 'DAMAGE', target: { ...targetUnit, index: randomIdx }, value: battlecry.value };
            } else {
                this.applyDamage(this.currentPlayer.hero, battlecry.value);
                return { type: 'DAMAGE', target: { ...this.currentPlayer.hero, index: -1 }, value: battlecry.value };
            }
        } else if (battlecry.type === 'BUFF_ADJACENT') {
            const affected = [];
            if (sourceMinion) {
                const idx = this.currentPlayer.board.indexOf(sourceMinion);
                if (idx !== -1) {
                    [idx - 1, idx + 1].forEach(nid => {
                        if (nid >= 0 && nid < this.currentPlayer.board.length) {
                            const neighbor = this.currentPlayer.board[nid];
                            const val = battlecry.value || 1;
                            neighbor.attack += val;
                            neighbor.health += val;
                            neighbor.currentHealth += val;
                            this.updateEnrage(neighbor);
                            affected.push({ unit: { ...neighbor, index: nid }, type: 'BUFF' });
                        }
                    });
                }
            }
            return { type: 'BUFF_ALL', affected };
        } else if (battlecry.type === 'GIVE_KEYWORD_ADJACENT') {
            const affected = [];
            if (sourceMinion) {
                const idx = this.currentPlayer.board.indexOf(sourceMinion);
                if (idx !== -1) {
                    [idx - 1, idx + 1].forEach(nid => {
                        if (nid >= 0 && nid < this.currentPlayer.board.length) {
                            const neighbor = this.currentPlayer.board[nid];
                            if (!neighbor.keywords) neighbor.keywords = {};
                            neighbor.keywords[battlecry.keyword] = true;
                            affected.push({ unit: { ...neighbor, index: nid }, type: 'BUFF' });
                        }
                    });
                }
            }
            return { type: 'BUFF_ALL', affected };
        } else if (battlecry.type === 'BOUNCE_TARGET') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit && targetUnit.type === 'MINION') {
                const owner = target.side === 'PLAYER' ? this.currentPlayer : this.opponent;
                const idx = owner.board.indexOf(targetUnit);
                if (idx !== -1) {
                    owner.board.splice(idx, 1);
                    const collection = this.collection || [];
                    const originalCard = collection.find(c => c.id === targetUnit.id) || targetUnit;
                    let cardToHand = JSON.parse(JSON.stringify(originalCard));

                    // Han Kuo-yu (TW032): Permanent stackable +2/+2 on bounce
                    if (targetUnit.hanBounceBonus) cardToHand.hanBounceBonus = targetUnit.hanBounceBonus;
                    if (targetUnit.id === 'TW032') {
                        cardToHand.hanBounceBonus = (cardToHand.hanBounceBonus || 0) + 2;
                        cardToHand.attack += cardToHand.hanBounceBonus;
                        cardToHand.health += cardToHand.hanBounceBonus;
                    }
                    if (targetUnit.id === 'TW033') {
                        cardToHand.hanBounceBonus = (cardToHand.hanBounceBonus || 0) + 1;
                        cardToHand.attack += cardToHand.hanBounceBonus;
                        cardToHand.health += cardToHand.hanBounceBonus;
                    }

                    // Clean up board-specific state for hand display
                    delete cardToHand.currentHealth;
                    delete cardToHand.sleeping;
                    delete cardToHand.canAttack;
                    delete cardToHand.isEnraged;

                    if (owner.hand.length < 10) {
                        owner.hand.push(cardToHand);
                    }
                    return { type: 'BOUNCE', target: { ...targetUnit, index: idx } };
                }
            }
        } else if (battlecry.type === 'EAT_FRIENDLY') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit && targetUnit.type === 'MINION') {
                const eatAtk = targetUnit.attack;
                const eatHp = targetUnit.health; // Using max health or current? Usually stat "values" imply current attack and current health? But "Body" implies max. Let's use max health for "Stats". Or Hearthstone uses current. Let's use ATTACK and HEALTH (Max).

                // Add to self
                // But wait, self isn't passed clearly here except in insertion?
                // `resolveBattlecry` has `sourceMinion`.
                if (sourceMinion) {
                    sourceMinion.attack += eatAtk;
                    sourceMinion.health += eatHp;
                    sourceMinion.currentHealth += eatHp;

                    // Kill target
                    targetUnit.currentHealth = 0;
                    // this.resolveDeaths(); // Let app.js handle with animation
                    return { type: 'EAT', target: target, value: { attack: eatAtk, health: eatHp } };
                }
            }
        } else if (battlecry.type === 'BOUNCE_CATEGORY') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit && targetUnit.type === 'MINION') {
                if (battlecry.target_category_includes && (!targetUnit.category || !targetUnit.category.includes(battlecry.target_category_includes))) {
                    console.warn("Target category mismatch for bounce");
                    return null;
                }

                const owner = target.side === 'PLAYER' ? this.currentPlayer : this.opponent;
                const idx = owner.board.indexOf(targetUnit);
                if (idx !== -1) {
                    owner.board.splice(idx, 1);
                    const collection = this.collection || [];
                    const originalCard = collection.find(c => c.id === targetUnit.id) || targetUnit;
                    let cardToHand = JSON.parse(JSON.stringify(originalCard));

                    // Clean up board-specific state
                    // Han Kuo-yu (TW032): Permanent stackable +2/+2 on bounce
                    if (targetUnit.hanBounceBonus) cardToHand.hanBounceBonus = targetUnit.hanBounceBonus;
                    if (targetUnit.id === 'TW032') {
                        cardToHand.hanBounceBonus = (cardToHand.hanBounceBonus || 0) + 2;
                        cardToHand.attack += cardToHand.hanBounceBonus;
                        cardToHand.health += cardToHand.hanBounceBonus;
                    }

                    // Hau Lung-bin (TW033): Permanent stackable +1/+1 on bounce
                    if (targetUnit.id === 'TW033') {
                        cardToHand.hanBounceBonus = (cardToHand.hanBounceBonus || 0) + 1;
                        cardToHand.attack += cardToHand.hanBounceBonus;
                        cardToHand.health += cardToHand.hanBounceBonus;
                    }

                    // Clean up board-specific state
                    delete cardToHand.currentHealth;
                    delete cardToHand.sleeping;
                    delete cardToHand.canAttack;
                    delete cardToHand.isEnraged;

                    if (owner.hand.length < 10) owner.hand.push(cardToHand);
                    return { type: 'BOUNCE', target: { ...targetUnit, index: idx } };
                }
            }
        } else if (battlecry.type === 'BOUNCE_ALL_CATEGORY') {
            const bounced = [];
            [this.currentPlayer, this.opponent].forEach(player => {
                // Must iterate simply since we are modifying the array with splice?
                // Actually splice changes indices. Safe way: reverse loop or while loop.
                for (let i = player.board.length - 1; i >= 0; i--) {
                    const m = player.board[i];
                    if (m.category && m.category.includes(battlecry.target_category_includes)) {
                        // Bounce it
                        player.board.splice(i, 1);
                        bounced.push(m);

                        const collection = this.collection || [];
                        const originalCard = collection.find(c => c.id === m.id) || m;
                        let cardToHand = JSON.parse(JSON.stringify(originalCard));

                        // Han Kuo-yu (TW032): Permanent stackable +2/+2 on bounce
                        if (m.hanBounceBonus) cardToHand.hanBounceBonus = m.hanBounceBonus;
                        if (m.id === 'TW032') {
                            cardToHand.hanBounceBonus = (cardToHand.hanBounceBonus || 0) + 2;
                            cardToHand.attack += cardToHand.hanBounceBonus;
                            cardToHand.health += cardToHand.hanBounceBonus;
                        }

                        // Hau Lung-bin (TW033): Permanent stackable +1/+1 on bounce
                        if (m.id === 'TW033') {
                            cardToHand.hanBounceBonus = (cardToHand.hanBounceBonus || 0) + 1;
                            cardToHand.attack += cardToHand.hanBounceBonus;
                            cardToHand.health += cardToHand.hanBounceBonus;
                        }

                        // Clean up
                        delete cardToHand.currentHealth;
                        delete cardToHand.sleeping;
                        delete cardToHand.canAttack;
                        delete cardToHand.isEnraged;
                        delete cardToHand.tempBuffs;

                        if (player.hand.length < 10) {
                            player.hand.push(cardToHand);
                        }
                    }
                }
            });
            return { type: 'BOUNCE_ALL', bounced };
        } else if (battlecry.type === 'REDUCE_COST_ALL_HAND') {
            const affected = [];
            this.currentPlayer.hand.forEach(card => {
                if (card.cost > 0) {
                    const reduce = Math.min(card.cost, battlecry.value);
                    card.cost -= reduce;
                    card.isReduced = true;
                    affected.push(card);
                }
            });
            return { type: 'BUFF_HAND', affected };
        } else if (battlecry.type === 'DRAW') {
            return { type: 'DRAW', value: battlecry.value };
        } else if (battlecry.type === 'DRAW_MINION_REDUCE_COST') {
            const player = this.currentPlayer;
            const minionIdx = player.deck.findIndex(c => c.type === 'MINION');
            if (minionIdx !== -1) {
                player.drawCard(minionIdx, battlecry.value);
            }
            return { type: 'DRAW' };
        } else if (battlecry.type === 'DISCARD_DRAW') {
            const player = this.currentPlayer;
            const res = this.resolveBattlecry({ type: 'DISCARD_RANDOM', value: battlecry.discardCount || 1 });
            return { ...res, type: 'DISCARD_DRAW', drawCount: battlecry.drawCount || 1 };
        } else if (battlecry.type === 'DISCARD_RANDOM') {
            const player = this.currentPlayer;
            const count = battlecry.value || 1;

            // Collect original indices to discard
            const availableIndices = Array.from({ length: player.hand.length }, (_, i) => i);
            const discardedIndices = [];
            for (let i = 0; i < count && availableIndices.length > 0; i++) {
                const randPos = Math.floor(Math.random() * availableIndices.length);
                discardedIndices.push(availableIndices.splice(randPos, 1)[0]);
            }

            const discardedCards = [];
            // Sort descending to splice safely
            [...discardedIndices].sort((a, b) => b - a).forEach(idx => {
                const card = player.hand.splice(idx, 1)[0];
                discardedCards.push(card);
                this.handleDiscard(player, card);
            });

            return { type: 'DISCARD', count, indices: discardedIndices, cards: discardedCards };
        } else if (battlecry.type === 'DESTROY_ALL_MINIONS') {
            const affected = [];
            [this.players[0], this.players[1]].forEach(p => {
                const board = p.board;
                for (let i = board.length - 1; i >= 0; i--) {
                    const m = board[i];
                    affected.push({ unit: { ...m, index: i, side: p.side } });
                    m.currentHealth = 0; // Bypass Divine Shield
                }
            });
            // this.resolveDeaths(); // Let app.js handle with animation
            return { type: 'DESTROY_ALL', affected };
        }
    }

    handleDiscard(player, discardedCard = null) {
        // Triggered effects on board
        player.board.forEach(m => {
            if (m.keywords && m.keywords.triggered && m.keywords.triggered.type === 'ON_DISCARD') {
                const val = m.keywords.triggered.value || 2;
                m.attack += val;
                m.health += val;
                m.currentHealth += val;
                this.updateEnrage(m);
            }
        });

        // Triggered effects on the card itself (e.g. summon when discarded)
        if (discardedCard && discardedCard.keywords && discardedCard.keywords.onDiscard === 'SUMMON') {
            if (player.board.length < 7) {
                const minion = this.createMinion(discardedCard, player.side);
                player.board.push(minion);
                this.updateAuras();
            }
        }
    }

    createMinion(cardData, side) {
        return {
            ...cardData,
            currentHealth: cardData.health,
            side: side,
            sleeping: true,
            canAttack: false
        };
    }

    getTargetUnit(target) {
        if (!target || typeof target !== 'object') {
            console.warn("Invalid target object in getTargetUnit:", target);
            return null;
        }

        let targetPlayer = null;
        if (target.side === 'PLAYER') targetPlayer = this.currentPlayer;
        else if (target.side === 'OPPONENT') targetPlayer = this.opponent;

        // Final fallback if side mapping fails
        if (!targetPlayer) {
            if (target.type === 'HERO') return (target.side === 'OPPONENT' ? this.opponent.hero : this.currentPlayer.hero);
            return null;
        }

        if (target.type === 'HERO') return targetPlayer.hero;
        if (target.type === 'MINION') {
            const unit = targetPlayer.board[target.index];
            return unit || null;
        }
        return null;
    }

    applyDamage(unit, amount) {
        if (!unit) return;
        const oldHealth = unit.currentHealth !== undefined ? unit.currentHealth : unit.hp;

        if (unit.type === 'MINION' && unit.keywords && unit.keywords.divineShield) {
            if (amount > 0) {
                unit.keywords.divineShield = false; // Pop shield
                return; // No damage taken
            }
        }

        const newHealth = oldHealth - amount;

        // Update currentHealth (minions)
        if (unit.currentHealth !== undefined) unit.currentHealth = newHealth;
        // Update hp (heroes)
        if (unit.hp !== undefined) unit.hp = newHealth;

        this.updateEnrage(unit);
        // Don't resolve deaths here - let app.js handle it with animation
        // this.resolveDeaths();
    }

    updateEnrage(unit) {
        if (!unit || unit.type !== 'MINION' || !unit.keywords || !unit.keywords.enrage) return;

        const isDamaged = unit.currentHealth < unit.health;

        if (isDamaged && !unit.isEnraged) {
            unit.isEnraged = true;
            if (unit.keywords.enrage.type === 'BUFF_STAT') {
                const stat = unit.keywords.enrage.stat;
                if (stat === 'ATTACK' || stat === '攻擊') {
                    unit.attack += unit.keywords.enrage.value;
                }
            }
        } else if (!isDamaged && unit.isEnraged) {
            unit.isEnraged = false;
            if (unit.keywords.enrage.type === 'BUFF_STAT') {
                const stat = unit.keywords.enrage.stat;
                if (stat === 'ATTACK' || stat === '攻擊') {
                    unit.attack -= unit.keywords.enrage.value;
                }
            }
        }
    }

    /**
     * Attack with a minion.
     * @param {number} minionIndex Attacker index on board
     * @param {Object} target Target { type: 'HERO'|'MINION', index: number }
     */
    attack(minionIndex, target) {
        const attacker = this.currentPlayer.board[minionIndex];
        if (!attacker) throw new Error("Attacker not found");
        if (attacker.sleeping || !attacker.canAttack) throw new Error("Minion cannot attack");
        if (attacker.allowAttackCount <= 0 && attacker.keywords?.windfury !== true) {
            // Basic check, refined later
        }

        // Taunt Check
        const opponentTaunts = this.opponent.board.filter(m => m.keywords && m.keywords.taunt);
        if (opponentTaunts.length > 0) {
            const isTargetTaunt = (target.type === 'MINION' && this.opponent.board[target.index]?.keywords?.taunt);
            if (!isTargetTaunt) throw new Error("Must attack Taunt minion");
        }

        // Execute Attack
        let targetUnit = null;
        if (target.type === 'HERO') {
            targetUnit = this.opponent.hero;
        } else if (target.type === 'MINION') {
            targetUnit = this.opponent.board[target.index];
        }

        if (!targetUnit) throw new Error("Invalid target");

        // Use applyDamage for proper enrage/death triggers
        const attackerAtk = attacker.attack;
        const targetAtk = targetUnit.attack || 0;

        this.applyDamage(targetUnit, attackerAtk);
        if (target.type === 'MINION') {
            this.applyDamage(attacker, targetAtk);
        }

        attacker.canAttack = false;
        attacker.allowAttackCount = (attacker.allowAttackCount || 1) - 1;

        // Don't resolve deaths here - let app.js handle it with animation
        // this.resolveDeaths();
    }

    /**
     * Check for dead minions without removing them.
     * Returns array of { side: 'PLAYER'|'OPPONENT', index: number }
     */
    checkDeaths() {
        const dead = [];
        [this.players[0], this.players[1]].forEach(p => {
            for (let i = 0; i < p.board.length; i++) {
                if (p.board[i].currentHealth <= 0) {
                    dead.push({ side: p.side, index: i });
                }
            }
        });
        return dead;
    }

    resolveDeaths() {
        [this.players[0], this.players[1]].forEach(p => {
            // Hero Death
            if (p.hero.hp <= 0) {
                this.gameOver = true;
                this.winner = (p === this.players[0] ? 1 : 0);
            }

            // Minion Death
            for (let i = p.board.length - 1; i >= 0; i--) {
                if (p.board[i].currentHealth <= 0) {
                    const deadMinion = p.board[i];
                    p.board.splice(i, 1);
                    // Trigger Deathrattle
                    if (deadMinion.keywords && deadMinion.keywords.deathrattle) {
                        this.resolveDeathrattle(p, deadMinion.keywords.deathrattle, deadMinion);
                    }
                }
            }
        });

        this.updateAuras();
    }

    resolveDeathrattle(player, deathrattle, deadMinion) {
        if (deathrattle.type === 'SUMMON') {
            if (player.board.length < 7) {
                const token = { name: "Ghost", attack: 1, health: 1, currentHealth: 1, sleeping: true, canAttack: false };
                player.board.push(token);
            }
        } else if (deathrattle.type === 'BOUNCE_SELF') {
            const collection = this.collection || [];
            const originalCard = collection.find(c => c.id === deadMinion.id) || deadMinion;
            let cardToHand = JSON.parse(JSON.stringify(originalCard));

            // Han / Hau bonuses persist if already on the cardToHand (usually they are applied TO the hand version)
            // But if it's a deathrattle bounce, we just put it back.

            if (player.hand.length < 10) {
                player.hand.push(cardToHand);
            }
        } else if (deathrattle.type === 'DRAW') {
            for (let i = 0; i < (deathrattle.value || 1); i++) {
                player.drawCard();
            }
        }
    }
}

class Player {
    constructor(deckIds, collection, side) {
        this.side = side;
        this.hero = { type: 'HERO', hp: 30, maxHp: 30, side: side };
        this.mana = { current: 0, max: 0 };
        this.deck = this.buildDeck(deckIds, collection);
        this.hand = [];
        this.board = [];
        this.graveyard = [];
        this.onTurnStart = []; // Queued effects for start of turn
    }

    buildDeck(ids, collection) {
        const deck = [];
        for (const id of ids) {
            const cardDef = collection.find(c => c.id === id);
            if (cardDef) {
                // Deep copy to ensure independence
                deck.push(JSON.parse(JSON.stringify(cardDef)));
            }
        }
        // Shuffle
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    /**
     * Draw a card from deck.
     * @param {number} index Specific index in deck (Optional)
     * @param {number} reduction Cost reduction amount (Optional)
     */
    drawCard(index = -1, reduction = 0) {
        if (this.deck.length > 0) {
            const card = (index === -1) ? this.deck.shift() : this.deck.splice(index, 1)[0];
            if (this.hand.length < 10) { // Max hand size 10
                if (reduction > 0) {
                    card.cost = Math.max(0, card.cost - reduction);
                    card.isReduced = true;
                }
                this.hand.push(card);
            } else {
                console.log("Hand full! Burned:", card.name);
            }
        } else {
            console.log("Out of cards!");
        }
    }
}

class AIEngine {
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
            // Queue damage newss from hand? (Simplified: Hand logic separate)
            // For now, if board lethal, just attack.
            // If hand lethal needed, that logic is more complex.
        } else {
            // 2. Play Cycle (Board Control & Mana Efficiency)

            // A. Play Minions/News
            // Sort hand by cost high->low to use mana efficiently, or check keywords?
            // Simple heuristic: Try to spend max mana.

            // Loop until no more cards can be played or board full
            let mana = aiPlayer.mana.current;
            let playedSomething = true;

            // We simulate hand indices. Since playing a card shifts indices, we need to be careful.
            // Better strategy: Calculate best card to play, push action, assume implementation handles it.
            // BUT: result of play changes state (mana). We assume "decideTurn" returns a sequence based on initial state?
            // NO, `app.js` will execute one by one. But `decideTurn` needs to know subsequent mana.
            // Let's make `decideTurn` simpler: Return ONE action at a time?
            // Or return a list based on "snapshot".
            // If we return list, we must simulate mana consumption.

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

                        // We need original index, but `tempHand` indices might differ if we removed cards?
                        // `actions` logic in `app.js` needs to handle "play card at index X".
                        // If we play card at index 0, next card becomes index 0.
                        // So we should probably do: "Find card ID" or just be careful.
                        // EASIER: `app.js` calls `decideTurn` repeatedly? No.
                        // Let's use `id` or just trust that if we account for shift.
                        // Actually, if we return `play id xxx`, `app.js` finds it?
                        // `gameEngine.playCard` takes Index.

                        // Let's fallback to: Just play ONE card per turn? No, AI sucks then.
                        // Correct approach: `actions` contains "Play card at current index X".
                        // Wait, if I play index 2, then index 3 becomes 2.
                        // So I should verify carefully. 
                        // Let's just output the actions and let the executor handle re-indexing?
                        // No, executor blindly follows index.

                        // Let's just track `offset`.
                        // Or better: `decideTurn` returns *Batch 1* of plays.
                        // Actually, let's keep it robust:
                        // Just use `card.id` to identify? Engine `playCard` only takes index.

                        // Workaround: AI logic runs, calculates actions based on current snapshot.
                        // If 2 cards played:
                        // Action 1: Play index 2.
                        // Action 2: Play index 1 (which was index 0?).
                        // This is error prone.

                        // Alternative AI Loop in `app.js`:
                        // while(true) { const action = ai.getNextMove(state); if(!action) break; execute(action); }
                        // This is much better.
                        // So I will implement `getNextMove(state)` instead of `decideTurn`.
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
            // Sequence Priority: 
            // 1. Standard Minions (no board-wide buff or target required if no targets)
            // 2. Buff/Heal Minions (triggered after minions are on board)
            // 3. News (only if targets exist or beneficial)

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
                        // User requirement: If target is required but missing, don't play (or skip if optional? Usually cards in this game need target)
                        // If card is a direct "Destroy" or high damage, let's skip playing if no target.
                        const type = choice.keywords.battlecry.type;
                        const isHardTarget = ['DESTROY', 'DAMAGE', 'HEAL', 'BUFF_STAT_TARGET', 'GIVE_DIVINE_SHIELD'].includes(type);
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
        if (battlecry.target_category) filteredMinions = filteredMinions.filter(p => p.unit.category === battlecry.target_category);

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
// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameEngine };
}

// Export for Browser
if (typeof window !== 'undefined') {
    window.GameEngine = GameEngine;
}
