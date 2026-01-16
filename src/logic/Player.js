
/**
 * Player.js
 * 
 * 用途: 定義單一玩家的資料結構，包含牌庫、手牌、法力值與英雄狀態。
 * 處理基礎的抽牌邏輯與牌庫洗牌。
 * 
 * 會被誰應用:
 * - src/logic/GameEngine.js (建立對戰雙方)
 * - src/logic/GameState.js (管理玩家回合與資源)
 * 
 * 又會用到誰:
 * - Card Data (傳入的牌組資料)
 */
export class Player {
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
                const card = JSON.parse(JSON.stringify(cardDef));
                card.side = this.side;
                deck.push(card);
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
