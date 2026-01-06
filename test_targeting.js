const GameEngine = require('./game_engine.js').GameEngine;

// Mock CARD_DATA directly
const MOCK_CARD_DATA = [
    { "id": "tw002", "name": "賣菜郎", "category": "國民黨政治人物", "cost": 5, "attack": 5, "health": 4, "type": "MINION", "rarity": "EPIC", "keywords": { "battlecry": { "type": "BUFF_STAT_TARGET", "value": 1, "stat": "ATTACK" } } },
    { "id": "tw003", "name": "四叉貓", "category": "民進黨政治人物", "cost": 3, "attack": 2, "health": 4, "type": "MINION", "rarity": "RARE", "keywords": { "battlecry": { "type": "BUFF_STAT_TARGET", "value": 1, "stat": "HEALTH" } } },
    { "id": "mock_target", "name": "Target Dummy", "category": "None", "cost": 1, "attack": 1, "health": 1, "type": "MINION", "rarity": "COMMON" }
];

function testTargeting() {
    console.log("Starting Self-Verification: Targeted Battlecries");
    const engine = new GameEngine(MOCK_CARD_DATA);

    // Create a real game state
    // We need 30 chars/ids theoretically but logic was relaxed.
    const deck1 = ["tw002", "tw003"];
    const deck2 = ["mock_target"];
    const state = engine.createGame(deck1, deck2);

    // Force set players for convenience if needed, or just use state.
    const player1 = state.players[0];
    const player2 = state.players[1];

    // Ensure player 0 is current
    state.currentPlayerIdx = 0;

    // Test 1: Han (Buff Attack)
    console.log("Test 1: Han (Buff Attack +1)");
    // Place Han on Player 1 board
    const hanCard = { id: "tw002", attack: 5, health: 4, type: 'MINION', name: 'Han' };
    player1.board.push(hanCard);

    // Place Target on Player 2 board
    const targetMinion = { id: "mock_target", attack: 1, health: 1, currentHealth: 1, type: 'MINION', name: 'Target' };
    player2.board.push(targetMinion);

    // Target is player2 board index 0 (which is targetMinion)
    // Note: createGame might have drawn cards, so board might be empty initially. We pushed manually.

    // We are Player 1 (currentPlayer). Target is on Player 2 board.
    const targetInfo = { type: 'MINION', index: 0, side: 'OPPONENT' };
    const battlecryHan = MOCK_CARD_DATA[0].keywords.battlecry;

    // resolveBattlecry is on state instance
    state.resolveBattlecry(battlecryHan, targetInfo);

    if (targetMinion.attack === 2) {
        console.log("PASS: Minion attack increased from 1 to 2.");
    } else {
        console.error(`FAIL: Expected attack 2, got ${targetMinion.attack}`);
    }

    // Test 2: 4X Cat (Buff Health +1)
    console.log("Test 2: 4X Cat (Buff Health +1)");
    const battlecryCat = MOCK_CARD_DATA[1].keywords.battlecry;

    state.resolveBattlecry(battlecryCat, targetInfo);

    if (targetMinion.health === 2 && targetMinion.currentHealth === 2) {
        console.log("PASS: Minion health increased from 1 to 2.");
    } else {
        console.error(`FAIL: Expected health 2, got ${targetMinion.health}`);
    }
}

testTargeting();
