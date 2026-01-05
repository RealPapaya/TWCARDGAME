const { GameEngine } = require('./game_engine');
const fs = require('fs');

let CARD_DB = [];
try {
    const data = fs.readFileSync('cards.json', 'utf8');
    CARD_DB = JSON.parse(data);
} catch (err) {
    console.error("Error loading cards.json", err);
}

const engine = new GameEngine(CARD_DB);
const deck1 = Array(30).fill('c001'); // 30 Village Chiefs
const deck2 = Array(15).fill('c002').concat(Array(15).fill('c004')); // 15 Taunts, 15 Battlecries

console.log("=== Starting Game Test ===");

try {
    const game = engine.createGame(deck1, deck2);
    console.log(`Game Created! Player ${game.currentPlayerIdx + 1} starts.`);
    console.log(`P1 Hand: ${game.players[0].hand.length}, P2 Hand: ${game.players[1].hand.length}`);
    console.log(`P1 Mana: ${game.players[0].mana.current}/${game.players[0].mana.max}`);

    // --- TURN 1 ---
    console.log("\n--- Turn 1 ---");
    // Attempt play card (Cost 1)
    try {
        // Find a 1-cost card
        const cardIdx = game.currentPlayer.hand.findIndex(c => c.cost <= game.currentPlayer.mana.current);
        if (cardIdx !== -1) {
            const cardName = game.currentPlayer.hand[cardIdx].name;
            console.log(`Playing ${cardName}...`);
            game.playCard(cardIdx);
            console.log("Card played successfully.");
            console.log(`Board: ${game.currentPlayer.board.length} minions.`);
        } else {
            console.log("No playable cards.");
        }
    } catch (e) {
        console.error("Error playing card:", e.message);
    }

    // Attempt Attack (Should fail due to summoning sickness)
    if (game.currentPlayer.board.length > 0) {
        try {
            console.log("Attempting attack with Summoned Minion...");
            game.attack(0, { type: 'HERO' });
        } catch (e) {
            console.log("Attack prevented (Expected):", e.message);
        }
    }

    game.endTurn();

    // --- TURN 2 ---
    console.log("\n--- Turn 2 (Opponent) ---");
    console.log(`Current Player: P${game.currentPlayerIdx + 1}`);
    console.log(`Mana: ${game.currentPlayer.mana.current}/${game.currentPlayer.mana.max}`);

    // Play check
    const oppCardIdx = game.currentPlayer.hand.findIndex(c => c.cost <= game.currentPlayer.mana.current);
    if (oppCardIdx !== -1) {
        game.playCard(oppCardIdx);
        console.log("Opponent played a minion.");
    }
    game.endTurn();

    // --- TURN 3 ---
    console.log("\n--- Turn 3 ---");
    // Minion from Turn 1 should be able to attack
    if (game.currentPlayer.board.length > 0) {
        console.log("Attempting attack with Turn 1 Minion...");
        const target = game.opponent.board.length > 0 ? { type: 'MINION', index: 0 } : { type: 'HERO' };

        const initialHp = target.type === 'HERO' ? game.opponent.hero.hp : game.opponent.board[0].currentHealth;
        console.log(`Target HP before: ${initialHp}`);

        game.attack(0, target);

        const finalHp = target.type === 'HERO' ? game.opponent.hero.hp : (game.opponent.board[0] ? game.opponent.board[0].currentHealth : 'Dead');
        console.log(`Attack success! Target HP after: ${finalHp}`);
    }

    console.log("\n=== Test Complete ===");

} catch (e) {
    console.error("Test Failed:", e);
}
