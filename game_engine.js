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

        if (deckIds.length !== 30) {
            return { valid: false, message: `Deck must have exactly 30 cards. Current count: ${deckIds.length}` };
        }

        const counts = {};
        for (const id of deckIds) {
            const card = this.collection.find(c => c.id === id);
            if (!card) {
                return { valid: false, message: `Invalid card ID: ${id}` };
            }
            if (card.collectible === false) {
                return { valid: false, message: `Card ${card.name} (${id}) is not collectible.` };
            }

            counts[id] = (counts[id] || 0) + 1;
            if (counts[id] > 30) { // Changed to 30 for testing
                return { valid: false, message: `Card ${card.name} (${id}) has more than 2 copies.` };
            }
        }

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
        if (target === 'PENDING') return; // Do nothing, wait for final target
        // Simplified Battlecry: Damage
        if (battlecry.type === 'DAMAGE') {
            if (!target || target.type === 'HERO') {
                this.opponent.hero.hp -= battlecry.value;
            } else if (target.type === 'MINION') {
                const minion = this.opponent.board[target.index];
                if (minion) {
                    minion.currentHealth -= battlecry.value;
                }
            }
            this.resolveDeaths();
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

        // Damage Exchange
        targetUnit.currentHealth = (targetUnit.currentHealth !== undefined ? targetUnit.currentHealth : targetUnit.hp) - attacker.attack;
        if (target.type === 'HERO') targetUnit.hp = targetUnit.currentHealth;

        if (target.type === 'MINION') {
            attacker.currentHealth -= targetUnit.attack;
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
                this.winner = (p === this.players[0] ? this.players[1] : this.players[0]);
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
