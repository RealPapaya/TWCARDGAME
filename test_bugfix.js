const { GameEngine } = require('./game_engine.js');

// Mock Data inc. Vegetable Vendor (Han)
const MOCK_DB = [
    { id: 'c1', name: 'Student', cost: 1, attack: 1, health: 1, type: 'MINION' },
    { "id": "tw002", "name": "賣菜郎", "category": "國民黨政治人物", "cost": 5, "attack": 5, "health": 4, "type": "MINION", "rarity": "EPIC", "keywords": { "battlecry": { "type": "BUFF_STAT_TARGET", "value": 1, "stat": "ATTACK" } } }
];

function testHanBuff() {
    console.log("=== Testing Han Buff Logic ===");
    const engine = new GameEngine(MOCK_DB);
    const state = engine.createGame(['c1'], ['c1']); // Both players have Student

    const p1 = state.players[0];

    // Setup: P1 has a Student on board
    p1.board.push({ id: 'c1', name: 'Student', attack: 1, health: 1, currentHealth: 1, type: 'MINION' });

    // Play Han from Hand (Index 0 in hand, we cheat and push him to hand)
    // Note: createGame draws cards. Let's force add.
    p1.hand = [{ id: 'tw002', name: '賣菜郎', cost: 5, type: 'MINION', keywords: { battlecry: { type: 'BUFF_STAT_TARGET', value: 1, stat: 'ATTACK' } } }];
    p1.mana.current = 10;

    // Target: The Student (Index 0). Side: PLAYER (Self)
    // IMPORTANT: game_engine.js `getTargetUnit` expects `{ type: 'MINION', index: 0, side: 'PLAYER' }`
    // Let's verify if ENGINE handles this correctly.

    const target = { type: 'MINION', index: 0, side: 'PLAYER' };

    // FORCE PLAYER 1 TURN
    state.currentPlayerIdx = 0;

    console.log("Initial Attack:", p1.board[0].attack);

    try {
        state.playCard(0, target);
        console.log("Played Han.");
    } catch (e) {
        console.error("Play Error:", e.message);
    }

    // Check Student Attack (Should be 1 + 1 = 2)
    const afterAtk = p1.board[0].attack;
    if (afterAtk === 2) {
        console.log("PASS: Student Attack is 2.");
    } else {
        console.error(`FAIL: Student Attack is ${afterAtk}, expected 2.`);
    }
}

testHanBuff();
