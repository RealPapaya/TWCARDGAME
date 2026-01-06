const { GameEngine } = require('./game_engine.js');

// Mock Data
const TEST_CARDS = [
    { "id": "tw006", "name": "蔡英文", "category": "民進黨政治人物", "cost": 6, "attack": 4, "health": 4, "type": "MINION", "rarity": "LEGENDARY", "keywords": { "battlecry": { "type": "BOUNCE_ALL_ENEMY" } } },
    { "id": "tw012", "name": "馬英九", "category": "國民黨政治人物", "cost": 9, "attack": 3, "health": 4, "type": "MINION", "rarity": "LEGENDARY", "keywords": { "battlecry": { "type": "DESTROY", "target": "ANY" } } },
    { "id": "tw015", "name": "台積電工程師", "category": "勞工", "cost": 3, "attack": 2, "health": 2, "type": "MINION", "rarity": "RARE", "keywords": { "enrage": { "type": "BUFF_STAT", "stat": "ATTACK", "value": 3 } } },
    { "id": "tw016", "name": "台積電", "category": "企業", "cost": 5, "attack": 0, "health": 10, "type": "MINION", "rarity": "EPIC", "keywords": { "taunt": true, "battlecry": { "type": "DAMAGE_RANDOM_FRIENDLY", "value": 2 } } },
    { "id": "tw014", "name": "手搖員工", "category": "勞工", "cost": 3, "attack": 2, "health": 2, "type": "MINION", "rarity": "RARE", "keywords": { "battlecry": { "type": "HEAL", "value": 2, "target": "ANY" } } }
];

const engine = new GameEngine(TEST_CARDS);

function logResult(testName, success, msg) {
    console.log(`[${success ? 'PASS' : 'FAIL'}] ${testName}: ${msg || ''}`);
}

// Bypass deck validation for testing
engine.validateDeck = () => ({ valid: true });

// --- Test 1: TSMC Combo (Enrage) ---
try {
    const p1Stats = { deck: ['tw015', 'tw016'], hand: [] };
    const p2Stats = { deck: [], hand: [] };
    const state = engine.createGame(p1Stats.deck, p2Stats.deck);
    state.currentPlayerIdx = 0; // Force Player 1 turn
    state.players[0].mana.current = 10;

    // Force specific hand
    state.players[0].hand = [JSON.parse(JSON.stringify(TEST_CARDS.find(c => c.id == 'tw015'))), JSON.parse(JSON.stringify(TEST_CARDS.find(c => c.id == 'tw016')))];

    // Play Engineer
    state.playCard(0);
    const eng = state.players[0].board[0];

    // Play TSMC (Random damage might hit Hero or Engineer, we need to ensure hits Engineer to test Enrage)
    // We will cheat and manually damage Engineer to verify Enrage logic ONLY (skipping RNG test)
    state.applyDamage(eng, 1);

    logResult('Enrage Logic', eng.attack === 5, `Engineer Attack is ${eng.attack} (Expected 5)`);
    logResult('Health Update', eng.currentHealth === 1, `Engineer HP is ${eng.currentHealth}`);
} catch (e) { logResult('Enrage Test', false, e.message); }

// --- Test 2: Ma Ying-jeou (Destroy) ---
try {
    const state = engine.createGame(['tw012'], []);
    state.currentPlayerIdx = 0;
    state.players[0].mana.current = 10;
    state.players[0].hand = [JSON.parse(JSON.stringify(TEST_CARDS.find(c => c.id == 'tw012')))];

    // Spawn Enemy
    state.players[1].board.push({ id: 'dummy', name: 'Dummy', attack: 1, health: 10, currentHealth: 10, type: 'MINION' });

    // Play Ma targeting index 0 of opponent board
    state.playCard(0, { type: 'MINION', index: 0, side: 'OPPONENT' });

    logResult('Ma Destroy', state.players[1].board.length === 0, `Enemy board count: ${state.players[1].board.length}`);
} catch (e) { logResult('Ma Test', false, e.message); }

// --- Test 3: Tsai Ing-wen (Bounce) ---
try {
    const state = engine.createGame(['tw006'], []);
    state.currentPlayerIdx = 0;
    state.players[0].mana.current = 10;
    state.players[0].hand = [JSON.parse(JSON.stringify(TEST_CARDS.find(c => c.id == 'tw006')))];

    // Spawn 2 Enemies
    state.players[1].board.push({ id: 'd1', name: 'D1', attack: 1, health: 1, currentHealth: 1, type: 'MINION' });
    state.players[1].board.push({ id: 'd2', name: 'D2', attack: 1, health: 1, currentHealth: 1, type: 'MINION' });

    state.playCard(0); // Tsai

    logResult('Tsai Bounce', state.players[1].board.length === 0, `Enemy board empty. Hand size: ${state.players[1].hand.length} (Expected 2)`);
} catch (e) { logResult('Tsai Test', false, e.message); }

// --- Test 4: Bubble Tea (Heal) ---
try {
    const state = engine.createGame(['tw014'], []);
    state.currentPlayerIdx = 0;
    state.players[0].mana.current = 10;
    state.players[0].hand = [JSON.parse(JSON.stringify(TEST_CARDS.find(c => c.id == 'tw014')))];

    // Injure Hero
    state.players[0].hero.currentHealth = 20;
    state.players[0].hero.hp = 20;

    state.playCard(0, { type: 'HERO', index: 0, side: 'PLAYER' });

    logResult('Heal Hero', state.players[0].hero.currentHealth === 22, `Hero HP: ${state.players[0].hero.currentHealth} (Expected 22)`);
} catch (e) { logResult('Heal Test', false, e.message); }

// --- Test 5: Hsieh (Damage Non-DPP) ---
try {
    const state = engine.createGame(['tw011'], []);
    state.currentPlayerIdx = 0;
    state.players[0].mana.current = 10;
    const hsiehCard = TEST_CARDS.find(c => c.id === 'tw011') || {
        "id": "tw011", "name": "謝長廷", "category": "民進黨政治人物", "cost": 3, "attack": 3, "health": 3, "type": "MINION", "rarity": "EPIC",
        "keywords": { "battlecry": { "type": "DAMAGE_NON_CATEGORY", "value": 3, "target_category": "民進黨政治人物" } }
    };
    state.players[0].hand = [JSON.parse(JSON.stringify(hsiehCard))];

    // Spawn 1 KMT (Valid Target) and 1 DPP (Invalid Target) for Opponent
    state.players[1].board.push({ id: 'kmt', category: '國民黨政治人物', health: 5, currentHealth: 5, type: 'MINION' });
    state.players[1].board.push({ id: 'dpp', category: '民進黨政治人物', health: 5, currentHealth: 5, type: 'MINION' });

    // Try to hit KMT (Index 0)
    state.playCard(0, { type: 'MINION', index: 0, side: 'OPPONENT' });

    const kmt = state.players[1].board[0];
    const dpp = state.players[1].board[1];

    logResult('Hsieh Valid Target (KMT)', kmt.currentHealth === 2, `KMT HP: ${kmt.currentHealth} (Expected 2)`);

    // Reset Hand and try to hit DPP (Index 1) - Should fail
    state.players[0].hand = [JSON.parse(JSON.stringify(hsiehCard))];
    state.players[0].mana.current = 10; // refill mana

    // Note: KMT is at 0, DPP at 1. Wait, playCard puts Hsieh on board.
    // So player0 board has 1 Hsieh.
    // Opponent board has KMT (hurt), DPP.
    // We play another Hsieh.

    state.playCard(0, { type: 'MINION', index: 1, side: 'OPPONENT' });

    logResult('Hsieh Invalid Target (DPP)', dpp.currentHealth === 5, `DPP HP: ${dpp.currentHealth} (Expected 5)`);

} catch (e) { logResult('Hsieh Test', false, e.message); }
