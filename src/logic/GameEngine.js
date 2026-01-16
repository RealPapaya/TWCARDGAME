
/**
 * GameEngine.js
 * 
 * 用途: 遊戲的核心進入點，負責驗證牌組、與建立全新的遊戲局 (GameState)。
 * 提供牌組檢查規則與初始設置邏輯。
 * 
 * 會被誰應用:
 * - src/legacy/app.js (遊戲啟動時建立引擎實例)
 * 
 * 又會用到誰:
 * - src/logic/GameState.js (產生的遊戲狀態實例)
 * - src/logic/Player.js (建立玩家物件)
 * - src/logic/AIEngine.js (建立 AI 對手)
 */
import { Player } from './Player.js';
import { GameState } from './GameState.js';
import { AIEngine } from './AIEngine.js';

export class GameEngine {
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
