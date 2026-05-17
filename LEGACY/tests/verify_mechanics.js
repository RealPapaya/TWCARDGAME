const fs = require('fs');
const path = require('path');

// Mock DOM environment for game_engine.js
global.document = {
    getElementById: () => ({
        children: [],
        classList: { add: () => { }, remove: () => { } }
    })
};
global.window = {};

// Load GameEngine
const gameEnginePath = path.join(__dirname, '../game_engine.js');
const gameEngineCode = fs.readFileSync(gameEnginePath, 'utf8');

// Wrap in a factory to extract the class
// Assuming game_engine.js defines 'class GameState { ... }' or 'var GameState = ...' 
// and doesn't export it. We'll append an export.
const evalCode = gameEngineCode + "; return GameState;";
const GameState = new Function(evalCode)();

// Test Suite
console.log("=== STARTING AUTOMATED CARD MECHANICS VERIFICATION ===\n");

function runTests() {
    let passed = 0;
    let failed = 0;

    // --- Scenario 1: Basic Cost Reduction (Chen Chien-jen) ---
    console.log("TEST 1: Ongoing Cost Reduction (Chen Chien-jen vs Wuhan Pneumonia)");

    // Mock State
    const mockGame = new GameState();
    mockGame.currentPlayer = {
        mana: { current: 3, max: 10 },
        hand: [],
        board: []
    };

    // Setup Board: Add Chen Chien-jen
    const reducerMinion = {
        id: 'TW050',
        name: '陳建仁',
        type: 'MINION',
        keywords: {
            ongoing: { type: 'REDUCE_NEWS_COST', value: 3 }
        }
    };
    mockGame.currentPlayer.board.push(reducerMinion);

    // Setup Hand: Add Wuhan Pneumonia (Cost 5)
    // IMPORTANT: Providing the keywords structure as the engine expects
    const spellCard = {
        id: 'S015',
        name: '武漢肺炎',
        type: 'NEWS',
        cost: 5,
        keywords: {}
    };
    mockGame.currentPlayer.hand.push(spellCard);

    // Verify Cost Calculation
    const actualCost = mockGame.getCardActualCost(spellCard);
    const expectedCost = 2; // 5 - 3 = 2

    if (actualCost === expectedCost) {
        console.log(`[PASS] Cost Reduced Correctly: ${spellCard.cost} -> ${actualCost}`);
        passed++;
    } else {
        console.error(`[FAIL] Cost Mismatch! Expected ${expectedCost}, got ${actualCost}`);
        failed++;
    }

    // Verify Playability
    const canPlay = mockGame.canPlayCard(0); // Index 0
    if (canPlay) {
        console.log(`[PASS] Card is Playable with 3 Mana (Cost ${actualCost})`);
        passed++;
    } else {
        console.error(`[FAIL] Card should be playable! Mana: ${mockGame.currentPlayer.mana.current}, Cost: ${actualCost}`);
        failed++;
    }

    // --- Scenario 2: Keyword Structure Only (Generic Reducer) ---
    console.log("\nTEST 2: Generic Keyword Reducer (Future Proofing)");
    const genericReducer = {
        id: 'GEN001',
        name: 'Generic Reducer',
        type: 'MINION',
        keywords: {
            ongoing: { type: 'REDUCE_NEWS_COST', value: 1 }
        }
    };
    // Clear board and add new reducer
    mockGame.currentPlayer.board = [genericReducer];

    const tokenSpell = {
        id: 'TOKEN',
        name: 'Test Spell',
        type: 'NEWS',
        cost: 1,
        keywords: {}
    };
    mockGame.currentPlayer.hand = [tokenSpell];

    const tokenCost = mockGame.getCardActualCost(tokenSpell);
    if (tokenCost === 0) {
        console.log(`[PASS] Generic Reducer Works: 1 -> ${tokenCost}`);
        passed++;
    } else {
        console.error(`[FAIL] Generic Reducer Failed! Expected 0, got ${tokenCost}`);
        failed++;
    }

    // --- Scenario 3: Minimum Cost Check ---
    console.log("\nTEST 3: Minimum Cost Floor (0)");
    const hugeReducer = {
        id: 'GEN002',
        name: 'Huge Reducer',
        type: 'MINION',
        keywords: {
            ongoing: { type: 'REDUCE_NEWS_COST', value: 99 }
        }
    };
    mockGame.currentPlayer.board = [hugeReducer];
    const zeroCost = mockGame.getCardActualCost(tokenSpell);
    if (zeroCost === 0) {
        console.log(`[PASS] Cost Floor Correct (0)`);
        passed++;
    } else {
        console.error(`[FAIL] Cost went below zero or wrong: ${zeroCost}`);
        failed++;
    }

    console.log(`\n=== VERIFICATION COMPLETE: ${passed} Passed, ${failed} Failed ===`);
    if (failed > 0) process.exit(1);
}

try {
    runTests();
} catch (e) {
    console.error("Test Harness Error:", e);
}
