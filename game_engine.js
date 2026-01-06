// GameEngine - Shared Logic (Node & Browser)

class GameEngine {
    constructor(cardDB) {
        this.collection = cardDB;
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
    createGame(deck1Ids, deck2Ids) {
        // Validate decks first
        if (!this.validateDeck(deck1Ids).valid || !this.validateDeck(deck2Ids).valid) {
            throw new Error("Invalid decks");
        }

        const p1 = new Player(deck1Ids, this.collection);
        const p2 = new Player(deck2Ids, this.collection);

        // Randomly choose starting player
        const startingIndex = Math.random() < 0.5 ? 0 : 1;

        const state = new GameState([p1, p2], startingIndex);

        // Initial Draw
        // Player 1 draws 3, Player 2 draws 4 (Coin logic could be added here, simplified for now)
        const p1Draws = state.currentPlayer === 0 ? 3 : 4;
        const p2Draws = state.currentPlayer === 0 ? 4 : 3;

        for (let i = 0; i < p1Draws; i++) p1.drawCard();
        for (let i = 0; i < p2Draws; i++) p2.drawCard();

        state.startTurn();
        return state;
    }
}

class GameState {
    constructor(players, startingIndex) {
        this.gameId = Date.now().toString();
        this.turnCount = 0;
        this.players = players;
        this.currentPlayerIdx = startingIndex;
        this.gameOver = false;
        this.winner = null;
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

        // Increase Mana
        if (player.mana.max < 10) {
            player.mana.max++;
        }
        player.mana.current = player.mana.max;

        // Draw a card
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
     */
    playCard(cardIndex, target = null) {
        const player = this.currentPlayer;
        const card = player.hand[cardIndex];

        if (!card) throw new Error("Card not found in hand");
        if (player.mana.current < card.cost) throw new Error("Not enough mana");
        if (player.board.length >= 5 && card.type === 'MINION') throw new Error("Board full (Max 5)");

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
            player.board.push(minion);

            // Trigger Battlecry
            if (minion.keywords && minion.keywords.battlecry) {
                this.resolveBattlecry(minion.keywords.battlecry, target);
            }
        }
    }

    resolveBattlecry(battlecry, target) {
        if (target === 'PENDING') return;

        if (battlecry.type === 'DAMAGE') {
            const targetUnit = this.getTargetUnit(target) || this.opponent.hero;
            this.applyDamage(targetUnit, battlecry.value);
        } else if (battlecry.type === 'HEAL_ALL_FRIENDLY') {
            this.currentPlayer.board.forEach(m => {
                m.currentHealth = m.health;
            });
        } else if (battlecry.type === 'BOUNCE_ALL_ENEMY') {
            const opp = this.opponent;
            while (opp.board.length > 0) {
                const m = opp.board.shift();
                const originalCard = this.players[0].buildDeck([m.id], [m])[0];
                if (opp.hand.length < 10) opp.hand.push(originalCard);
            }
        } else if (battlecry.type === 'DAMAGE_NON_CATEGORY') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit && targetUnit.category !== battlecry.target_category) {
                this.applyDamage(targetUnit, battlecry.value);
            }
        } else if (battlecry.type === 'HEAL') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit) {
                // Allow triggering even if full HP, just clamp result
                // The visual is handled by app.js, this just updates state
                const max = targetUnit.maxHp || targetUnit.health || 30; // fallback max
                targetUnit.currentHealth = Math.min(max, (targetUnit.currentHealth || targetUnit.hp) + battlecry.value);
                if (target.type === 'HERO') targetUnit.hp = targetUnit.currentHealth;
            }
        } else if (battlecry.type === 'BUFF_STAT_TARGET') {
            const targetUnit = this.getTargetUnit(target);
            if (targetUnit && targetUnit.type === 'MINION') {
                if (battlecry.stat === 'ATTACK') {
                    targetUnit.attack += battlecry.value;
                } else if (battlecry.stat === 'HEALTH') {
                    targetUnit.health += battlecry.value;
                    targetUnit.currentHealth += battlecry.value;
                }
            }
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
        if (!target) return null;

        let sidePlayers = this.players;
        // In GameState, we might not know who is "PLAYER" or "OPPONENT" relative to the command unless we map it.
        // Assuming 'PLAYER' means currentPlayer and 'OPPONENT' means opponent
        // OR better: rely on the side string matching how we store players?
        // Actually, simpler:
        // side 'PLAYER' -> currentPlayer
        // side 'OPPONENT' -> opponent

        let targetPlayer = null;
        if (target.side === 'PLAYER') targetPlayer = this.currentPlayer;
        else if (target.side === 'OPPONENT') targetPlayer = this.opponent;
        else {
            // Fallback for AI or legacy: try to guess or use old logic (risky)
            // Old logic check:
            if (target.type === 'HERO') return (target.index === 0 ? this.players[0].hero : this.players[1].hero); // Legacy index check
            // Fallback for minions is hard. Let's assume correct side provided now.
            return null;
        }

        if (target.type === 'HERO') return targetPlayer.hero;
        if (target.type === 'MINION') return targetPlayer.board[target.index];
        return null;
    }

    applyDamage(unit, amount) {
        if (!unit) return;
        const oldHealth = unit.currentHealth !== undefined ? unit.currentHealth : unit.hp;
        unit.currentHealth = oldHealth - amount;
        if (unit.hp !== undefined) unit.hp = unit.currentHealth;

        // Enrage (激將) Check
        if (unit.type === 'MINION' && unit.keywords && unit.keywords.enrage) {
            const isDamaged = unit.currentHealth < unit.health;
            if (isDamaged && !unit.isEnraged) {
                unit.isEnraged = true;
                if (unit.keywords.enrage.type === 'BUFF_STAT') {
                    if (unit.keywords.enrage.stat === 'ATTACK') {
                        unit.attack += unit.keywords.enrage.value;
                    }
                }
            } else if (!isDamaged && unit.isEnraged) {
                // If healed back to full
                unit.isEnraged = false;
                if (unit.keywords.enrage.type === 'BUFF_STAT') {
                    if (unit.keywords.enrage.stat === 'ATTACK') {
                        unit.attack -= unit.keywords.enrage.value;
                    }
                }
            }
        }
        this.resolveDeaths();
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
// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameEngine };
}

// Export for Browser
if (typeof window !== 'undefined') {
    window.GameEngine = GameEngine;
}
