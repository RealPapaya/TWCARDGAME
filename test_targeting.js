const GameEngine = require('./game_engine.js').GameEngine;

// Mock CARD_DATA directly
const MOCK_CARD_DATA = [
    { "id": "tw011", "name": "謝長廷", "category": "民進黨政治人物", "cost": 3, "attack": 3, "health": 3, "type": "MINION", "rarity": "EPIC", "keywords": { "battlecry": { "type": "DAMAGE_NON_CATEGORY", "value": 3, "target_category": "民進黨政治人物" } } },
    { "id": "tw002", "name": "賣菜郎", "category": "國民黨政治人物", "cost": 5, "attack": 5, "health": 4, "type": "MINION", "rarity": "EPIC", "keywords": { "battlecry": { "type": "BUFF_STAT_TARGET", "value": 1, "stat": "ATTACK" } } },
    { "id": "tw003", "name": "四叉貓", "category": "民進黨政治人物", "cost": 3, "attack": 2, "health": 4, "type": "MINION", "rarity": "RARE", "keywords": { "battlecry": { "type": "BUFF_STAT_TARGET", "value": 1, "stat": "HEALTH" } } },
    { "id": "mock_target", "name": "Target Dummy", "category": "None", "cost": 1, "attack": 1, "health": 1, "type": "MINION", "rarity": "COMMON" }
];

function testTargeting() {
    console.log("Starting Self-Verification: Targeted Battlecries");
    const engine = new GameEngine(MOCK_CARD_DATA);

    // Create a real game state
    const deck1 = ["tw002", "tw003"];
    const deck2 = ["mock_target"];
    const state = engine.createGame(deck1, deck2);

    // Force set players
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

    // We are Player 1. Target is on Player 2 board.
    const targetInfo = { type: 'MINION', index: 0, side: 'OPPONENT' };
    const battlecryHan = MOCK_CARD_DATA.find(c => c.id === 'tw002').keywords.battlecry;

    state.resolveBattlecry(battlecryHan, targetInfo);

    if (targetMinion.attack === 2) {
        console.log("PASS: Minion attack increased from 1 to 2.");
    } else {
        console.error(`FAIL: Expected attack 2, got ${targetMinion.attack}`);
    }

    // Test 2: Cat (Buff Health +1)
    console.log("Test 2: Cat (Buff Health +1)");
    const battlecryCat = MOCK_CARD_DATA.find(c => c.id === 'tw003').keywords.battlecry;

    state.resolveBattlecry(battlecryCat, targetInfo);

    if (targetMinion.health === 2 && targetMinion.currentHealth === 2) {
        console.log("PASS: Minion health increased from 1 to 2.");
    } else {
        console.error(`FAIL: Expected health 2, got ${targetMinion.health}`);
    }

    // Test 3: Hsieh (Damage Non-DPP)
    console.log("Test 3: Hsieh (Damage Non-DPP 3)");
    const battlecryHsieh = MOCK_CARD_DATA.find(c => c.id === 'tw011').keywords.battlecry;

    // Case A: Target Non-DPP (Han - KMT) -> Valid
    const hanMinion = { id: "tw002", category: "國民黨政治人物", health: 4, currentHealth: 4, type: 'MINION', name: 'Han' };
    player2.board.push(hanMinion); // Index 1
    const targetHan = { type: 'MINION', index: 1, side: 'OPPONENT' };

    state.resolveBattlecry(battlecryHsieh, targetHan);

    if (hanMinion.currentHealth === 1) { // 4 - 3 = 1
        console.log("PASS: Han (Non-DPP) took 3 damage.");
    } else {
        console.error(`FAIL: Han expected 1 HP, got ${hanMinion.currentHealth}`);
    }

    // Case B: Target DPP (Cat - DPP) -> Invalid (Should take NO damage)
    const catMinion = { id: "tw003", category: "民進黨政治人物", health: 4, currentHealth: 4, type: 'MINION', name: 'Cat' };
    player2.board.push(catMinion); // Index 2
    const targetCat = { type: 'MINION', index: 2, side: 'OPPONENT' };

    state.resolveBattlecry(battlecryHsieh, targetCat);

    if (catMinion.currentHealth === 4) {
        console.log("PASS: Cat (DPP) took NO damage.");
    } else {
        console.error(`FAIL: Cat expected 4 HP, got ${catMinion.currentHealth}`);
    }
}

testTargeting();
