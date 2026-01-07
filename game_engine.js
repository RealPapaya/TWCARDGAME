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
    createGame(deck1Ids, deck2Ids, debugMode = false) {
        // Validate decks first
        if (!this.validateDeck(deck1Ids).valid || !this.validateDeck(deck2Ids).valid) {
            throw new Error("Invalid decks");
        }

        const p1 = new Player(deck1Ids, this.collection);
        const p2 = new Player(deck2Ids, this.collection);

        // Randomly choose starting player
        const startingIndex = Math.random() < 0.5 ? 0 : 1;

        const state = new GameState([p1, p2], startingIndex, debugMode);

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
    constructor(players, startingIndex, debugMode = false) {
        this.gameId = Date.now().toString();
        this.turnCount = 0;
        this.players = players;
        this.currentPlayerIdx = startingIndex;
        this.gameOver = false;
        this.winner = null;
        this.debugMode = debugMode;

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
    }

    /**
     * End current turn and switch player.
     */
    endTurn() {
        this.currentPlayerIdx = this.currentPlayerIdx === 0 ? 1 : 0;
        this.startTurn();
    }

    /**
     * Play a card from hand.
     * @param {number} cardIndex Index in hand
     * @param {Object} target Target info { type: 'HERO'|'MINION', index: number } (Optional)
     * @param {number} insertionIndex Preferred index on board (Optional)
     */
    playCard(cardIndex, target = null, insertionIndex = -1) {
        const player = this.currentPlayer;
        const card = player.hand[cardIndex];

        if (!card) throw new Error("Card not found in hand");
        if (player.mana.current < card.cost) throw new Error("Not enough mana");
        if (player.board.length >= 7 && card.type === 'MINION') throw new Error("Board full (Max 7)");

        // Pay Mana
        player.mana.current -= card.cost;

        // Remove from hand
        player.hand.splice(cardIndex, 1);

        if (card.type === 'MINION') {
            const minion = { ...card, sleeping: true, canAttack: false, currentHealth: card.health };
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
            if (minion.keywords && minion.keywords.battlecry) {
                this.resolveBattlecry(minion.keywords.battlecry, target);
            }
        } else if (card.type === 'SPELL') {
            // Trigger Spell Effect (Battlecry logic reused for simplicity)
            if (card.keywords && card.keywords.battlecry) {
                this.resolveBattlecry(card.keywords.battlecry, target);
            } else if (card.id === 'S001') { // Invoice Win: Draw 2 (Handled via app.js for timing)
                // Logic moved to app.js to allow visual delay
            } else if (card.id === 'S002') { // Impeach: Damage split
                const damage = player.deck.length === 0 ? 20 : 10;
                const enemies = [this.opponent.hero, ...this.opponent.board];

                for (let i = 0; i < damage; i++) {
                    const target = enemies[Math.floor(Math.random() * enemies.length)];
                    this.applyDamage(target, 1);
                    // Filter out dead minions after each hit? 
                    // Actually, Hearthstone "Randomly split" usually can hit already dead (at 0 HP) things in some cases, 
                    // but better to filter. 
                    if (target.type === 'MINION' && target.currentHealth <= 0) {
                        const idx = enemies.indexOf(target);
                        if (idx > -1) enemies.splice(idx, 1);
                    }
                    if (enemies.length === 0) break;
                }
            }
        }
    }

    resolveBattlecry(battlecry, target) {
        console.log("Resolving Battlecry:", battlecry.type, "Target:", target);
        if (target === 'PENDING') return;

        if (battlecry.type === 'DAMAGE') {
            const targetUnit = this.getTargetUnit(target) || this.opponent.hero;
            console.log("Applying Damage to:", targetUnit?.name || 'Hero');
            this.applyDamage(targetUnit, battlecry.value);
        } else if (battlecry.type === 'HEAL_ALL_FRIENDLY') {
            this.currentPlayer.board.forEach(m => {
                m.currentHealth = m.health;
                this.updateEnrage(m);
            });
        } else if (battlecry.type === 'BOUNCE_ALL_ENEMY') {
            const opp = this.opponent;
            const collection = this.players[0].collection || []; // Fallback
            while (opp.board.length > 0) {
                const m = opp.board.shift();
                // Find original card data to put back in hand
                const originalCard = (this.collection || []).find(c => c.id === m.id) || m;
                if (opp.hand.length < 10) opp.hand.push(JSON.parse(JSON.stringify(originalCard)));
            }
        } else if (battlecry.type === 'DAMAGE_NON_CATEGORY') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit && targetUnit.type === 'MINION' && targetUnit.category !== battlecry.target_category) {
                this.applyDamage(targetUnit, battlecry.value);
            }
        } else if (battlecry.type === 'HEAL') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit) {
                // Handle both Minion (health/currentHealth) and Hero (hp/maxHp)
                const max = targetUnit.type === 'HERO' ? targetUnit.maxHp : targetUnit.health;
                const current = targetUnit.type === 'HERO' ? targetUnit.hp : targetUnit.currentHealth;

                if (typeof max === 'number' && typeof current === 'number') {
                    const newHp = Math.min(max, current + battlecry.value);
                    if (targetUnit.type === 'HERO') {
                        targetUnit.hp = newHp;
                    } else {
                        targetUnit.currentHealth = newHp;
                        this.updateEnrage(targetUnit);
                    }
                }
            }
        } else if (battlecry.type === 'BUFF_STAT_TARGET') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit && targetUnit.type === 'MINION') {
                if (battlecry.stat === 'ATTACK') {
                    targetUnit.attack += battlecry.value;
                } else if (battlecry.stat === 'HEALTH') {
                    targetUnit.health += battlecry.value;
                    targetUnit.currentHealth += battlecry.value;
                    this.updateEnrage(targetUnit);
                }
            }
        } else if (battlecry.type === 'GIVE_DIVINE_SHIELD') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit && targetUnit.type === 'MINION') {
                if (!targetUnit.keywords) targetUnit.keywords = {};
                targetUnit.keywords.divineShield = true;
            }
        } else if (battlecry.type === 'GIVE_DIVINE_SHIELD_ALL') {
            this.currentPlayer.board.forEach(m => {
                if (!m.keywords) m.keywords = {};
                m.keywords.divineShield = true;
            });
        }
        else if (battlecry.type === 'DESTROY') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit) {
                this.applyDamage(targetUnit, 999);
            }
        } else if (battlecry.type === 'BUFF_CATEGORY') {
            this.currentPlayer.board.forEach(m => {
                if (m.category === battlecry.target_category) {
                    m.health += battlecry.value;
                    m.currentHealth += battlecry.value;
                }
            });
        } else if (battlecry.type === 'BUFF_ALL') {
            this.currentPlayer.board.forEach(m => {
                if (battlecry.stat === 'ATTACK') {
                    m.attack += battlecry.value;
                } else if (battlecry.stat === 'HEALTH') {
                    m.health += battlecry.value;
                    m.currentHealth += battlecry.value;
                }
            });
        } else if (battlecry.type === 'DAMAGE_RANDOM_FRIENDLY') {
            const friendlyBoard = this.currentPlayer.board;
            if (friendlyBoard.length > 0) {
                const randomIdx = Math.floor(Math.random() * friendlyBoard.length);
                this.applyDamage(friendlyBoard[randomIdx], battlecry.value);
            } else {
                this.applyDamage(this.currentPlayer.hero, battlecry.value);
            }
        }
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

        // Divine Shield (光盾) Check
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
        this.resolveDeaths();
    }

    updateEnrage(unit) {
        if (!unit || unit.type !== 'MINION' || !unit.keywords || !unit.keywords.enrage) return;

        const isDamaged = unit.currentHealth < unit.health;

        if (isDamaged && !unit.isEnraged) {
            unit.isEnraged = true;
            if (unit.keywords.enrage.type === 'BUFF_STAT') {
                if (unit.keywords.enrage.stat === 'ATTACK') {
                    unit.attack += unit.keywords.enrage.value;
                }
            }
        } else if (!isDamaged && unit.isEnraged) {
            unit.isEnraged = false;
            if (unit.keywords.enrage.type === 'BUFF_STAT') {
                if (unit.keywords.enrage.stat === 'ATTACK') {
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

        // check deaths
        this.resolveDeaths();
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
                        this.resolveDeathrattle(p, deadMinion.keywords.deathrattle);
                    }
                }
            }
        });
    }

    resolveDeathrattle(player, deathrattle) {
        if (deathrattle.type === 'SUMMON') {
            if (player.board.length < 5) {
                // Needs access to Card DB to fetch token, for now mock
                const token = { name: "Ghost", attack: 1, health: 1, currentHealth: 1, sleeping: true, canAttack: false };
                player.board.push(token);
            }
        }
    }
}

class Player {
    constructor(deckIds, collection) {
        this.hero = { hp: 30, maxHp: 30 };
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

    drawCard() {
        if (this.deck.length > 0) {
            const card = this.deck.shift();
            if (this.hand.length < 10) { // Max hand size 10
                this.hand.push(card);
            } else {
                console.log("Hand full! Burned:", card.name);
            }
        } else {
            // Fatigue damage? Simplified: do nothing
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
            // Queue damage spells from hand? (Simplified: Hand logic separate)
            // For now, if board lethal, just attack.
            // If hand lethal needed, that logic is more complex.
        } else {
            // 2. Play Cycle (Board Control & Mana Efficiency)

            // A. Play Minions/Spells
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

        // 1. Lethal Check (Force Face if possible)
        const totalDamage = this.calculateTotalDamage(aiPlayer);
        if (totalDamage >= opponent.hero.hp) {
            // Find an attacker that hasn't attacked
            const attackerIdx = aiPlayer.board.findIndex(m => m.canAttack && !m.sleeping);
            if (attackerIdx !== -1) {
                return { type: 'ATTACK', attackerIndex: attackerIdx, target: { type: 'HERO' } };
            }
            // If all minions attacked, maybe play damage spell? (TODO)
        }

        // 2. Play Card (Prioritize Board & Mana)
        // Check if board not full
        if (aiPlayer.board.length < 7) {
            // Find playable minion with highest cost
            const playableMinions = aiPlayer.hand
                .map((c, i) => ({ ...c, originalIndex: i }))
                .filter(c => c.type === 'MINION' && c.cost <= aiPlayer.mana.current)
                .sort((a, b) => b.cost - a.cost);

            if (playableMinions.length > 0) {
                const choice = playableMinions[0];
                let target = null;
                if (choice.keywords && choice.keywords.battlecry) {
                    // Smart Target
                    target = this.getBattlecryTarget(choice.keywords.battlecry, gameState, aiPlayer, opponent);
                }
                return { type: 'PLAY_CARD', index: choice.originalIndex, target: target };
            }
        }

        // 3. Play Spell (Simple: High Cost first)
        const playableSpells = aiPlayer.hand
            .map((c, i) => ({ ...c, originalIndex: i }))
            .filter(c => c.type === 'SPELL' && c.cost <= aiPlayer.mana.current)
            .sort((a, b) => b.cost - a.cost);

        if (playableSpells.length > 0) {
            const choice = playableSpells[0];
            // Simple spell targeting? (Mock for now, random or face)
            let target = null;
            // Logic for spells can be added here
            return { type: 'PLAY_CARD', index: choice.originalIndex, target: { type: 'HERO' } };
        }

        // 4. Trade / Attack
        // Find attacker
        const attackers = aiPlayer.board
            .map((m, i) => ({ ...m, index: i }))
            .filter(m => m.canAttack && !m.sleeping);

        if (attackers.length > 0) {
            const attacker = attackers[0];

            // A. Check for Free Kill (Value Trade): My Attack >= Enemy HP AND My HP > Enemy Attack
            const validTargets = opponent.board.map((m, i) => ({ ...m, index: i }));

            // Taunt filter
            const taunts = validTargets.filter(m => m.keywords && m.keywords.taunt);
            const actualTargets = taunts.length > 0 ? taunts : validTargets;

            for (const t of actualTargets) {
                // Value trade?
                if (attacker.attack >= t.currentHealth && attacker.currentHealth > t.attack) {
                    return { type: 'ATTACK', attackerIndex: attacker.index, target: { type: 'MINION', index: t.index } };
                }
            }

            // B. If no value trade, just go Face (or random trade if Taunt blocks)
            if (taunts.length > 0) {
                // Must attack taunt
                return { type: 'ATTACK', attackerIndex: attacker.index, target: { type: 'MINION', index: taunts[0].index } };
            } else {
                return { type: 'ATTACK', attackerIndex: attacker.index, target: { type: 'HERO' } };
            }
        }

        return null; // No more moves
    }

    calculateTotalDamage(player) {
        return player.board
            .filter(m => m.canAttack && !m.sleeping)
            .reduce((sum, m) => sum + m.attack, 0);
    }

    getBattlecryTarget(battlecry, gameState, ai, opponent) {
        const rule = battlecry.target;
        if (!rule || typeof rule !== 'object') return null;

        // Simple Heuristic for Battlecries
        if (battlecry.type === 'DAMAGE' || battlecry.type === 'DAMAGE_NON_CATEGORY' || battlecry.type === 'DESTROY') {
            // Target: Enemies preferred
            if (rule.side !== 'FRIENDLY') {
                if (rule.type !== 'HERO' && opponent.board.length > 0) {
                    return { type: 'MINION', index: 0, side: 'OPPONENT' };
                }
                if (rule.type !== 'MINION') {
                    return { type: 'HERO', side: 'OPPONENT' };
                }
            }
        }
        else if (battlecry.type === 'HEAL' || battlecry.type === 'BUFF_STAT_TARGET' || battlecry.type === 'GIVE_DIVINE_SHIELD') {
            // Target: Friendly preferred
            if (rule.side !== 'ENEMY') {
                if (rule.type !== 'HERO' && ai.board.length > 0) {
                    return { type: 'MINION', index: 0, side: 'PLAYER' };
                }
                if (rule.type !== 'MINION') {
                    return { type: 'HERO', side: 'PLAYER' };
                }
            }
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
