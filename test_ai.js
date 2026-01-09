const { GameEngine } = require('./game_engine.js');

// Mock Data
const MOCK_DB = [
    { id: 'c1', name: 'Student', cost: 1, attack: 2, health: 1, type: 'MINION' },
    { id: 'c2', name: 'Guard', cost: 2, attack: 2, health: 3, type: 'MINION', keywords: { taunt: true } },
    { id: 'c5', name: 'BigGuy', cost: 5, attack: 5, health: 5, type: 'MINION' },
    { id: 's1', name: 'Burn', cost: 2, type: 'NEWS', keywords: { battlecry: { type: 'DAMAGE', value: 3, target: 'ANY' } } }
];

function runTests() {
    console.log("=== AI Unit Tests ===");
    const engine = new GameEngine(MOCK_DB);

    testLethal(engine);
    testValueTrade(engine);
    testManaCurve(engine);
}

function testLethal(engine) {
    console.log("\n[Test] Lethal Check");
    // Setup: AI (P2) has 2 minions (3+3 dmg), Opponent (P1) has 5 HP. Total Dmg 6 > 5.
    const p1c = ['c1'];
    const p2c = ['c1'];
    const state = engine.createGame(p1c, p2c);

    // Force turn to AI (Player 1, index 1? No, logic is random start. Let's force.)
    state.currentPlayerIdx = 1;
    const ai = state.players[1];
    const player = state.players[0];

    // Set HP
    player.hero.hp = 5;

    // Give AI board
    ai.board = [
        { id: 'c1', attack: 3, currentHealth: 1, canAttack: true, sleeping: false },
        { id: 'c1', attack: 3, currentHealth: 1, canAttack: true, sleeping: false }
    ];

    // Opponent has a Taunt? To make it tricky? 
    // If Taunt exists, Lethal might fail if not calculated correctly (Taunt blocks face).
    // Our Logic: Total Damage calculation currently IGNORES Taunt. 
    // "reduce((sum, m) => sum + m.attack, 0)"
    // And logic says: if total > hp, "Queue all attacks to face". 
    // But if Taunt exists, "attack face" action will FAIL execution or logic?
    // Let's check `getNextMove`:
    // "attackerIdx = ... findIndex... if != -1 return ATTACK FACE"
    // `gameState.attack` checks Taunt. So if Taunt exists, attack throws Error or we must target Taunt.
    // Our AI Simplistic Lethal check MIGHT FAIL if Taunt exists.
    // Let's test BASIC lethal first (No Taunt).

    const action = engine.ai.getNextMove(state);

    if (action && action.type === 'ATTACK' && action.target.type === 'HERO') {
        console.log("PASS: AI spotted lethal and attacked Face.");
    } else {
        console.error("FAIL: AI missed lethal or invalid move.", action);
    }
}

function testValueTrade(engine) {
    console.log("\n[Test] Value Trade");
    // AI has 2/2. Opponent has 2/1.
    // AI should attack Minion (2/2 survives, 2/1 dies) instead of Face.
    const state = engine.createGame(['c1'], ['c1']);
    state.currentPlayerIdx = 1;
    const ai = state.players[1];
    const opp = state.players[0];

    opp.hero.hp = 30;

    ai.board = [{ id: 'm1', attack: 2, currentHealth: 3, canAttack: true, sleeping: false }];
    opp.board = [{ id: 'm2', attack: 2, currentHealth: 1, type: 'MINION' }];

    const action = engine.ai.getNextMove(state);

    if (action && action.type === 'ATTACK' && action.target.type === 'MINION') {
        console.log("PASS: AI chose Value Trade (2/2 kills 2/1).");
    } else {
        console.error("FAIL: AI did not trade.", action);
    }
}

function testManaCurve(engine) {
    console.log("\n[Test] Mana Efficiency");
    // AI has 5 Mana. Hand: Cost 5, Cost 1.
    // Should play Cost 5.
    const state = engine.createGame(['c1'], ['c1']);
    state.currentPlayerIdx = 1;
    const ai = state.players[1];

    ai.mana.current = 5;
    ai.hand = [
        { id: 'c1', cost: 1, type: 'MINION' },
        { id: 'c5', cost: 5, type: 'MINION' }
    ];
    ai.board = []; // Empty board

    const action = engine.ai.getNextMove(state);

    // We expect it to play index 1 (Cost 5)
    // Note: getNextMove returns `Play Card index: originalIndex`

    // Logic sorts descending cost.
    if (action && action.type === 'PLAY_CARD' && action.index === 1) {
        console.log("PASS: AI played 5-cost card with 5 mana.");
    } else {
        console.error("FAIL: AI played wrong card.", action);
    }
}

runTests();
