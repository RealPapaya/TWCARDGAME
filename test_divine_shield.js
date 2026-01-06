const { GameEngine } = require('./game_engine.js');

const mockCardDB = [
    { id: 'shield_guy', name: 'Shield Guy', cost: 1, attack: 1, health: 1, type: 'MINION', keywords: { divineShield: true } },
    { id: 'target_guy', name: 'Target Guy', cost: 1, attack: 1, health: 5, type: 'MINION' },
    { id: 'gao', name: 'Gao', cost: 4, attack: 3, health: 3, type: 'MINION', keywords: { battlecry: { type: 'GIVE_DIVINE_SHIELD', target: 'ANY' } } }
];

const engine = new GameEngine(mockCardDB);
const state = engine.createGame(
    ['shield_guy', 'target_guy', 'gao', 'target_guy', 'target_guy'],
    ['target_guy', 'target_guy', 'target_guy']
);

console.log("--- Testing Divine Shield Damage Immunity ---");
const p1 = state.players[0];
const p2 = state.players[1];

// Play shield guy
state.playCard(0);
const shieldGuy = p1.board[0];
console.log(`P1 plays ${shieldGuy.name}. Divine Shield: ${shieldGuy.keywords.divineShield}`);

// Apply damage
console.log("Applying 5 damage to shield guy...");
state.applyDamage(shieldGuy, 5);
console.log(`Shield Guy HP: ${shieldGuy.currentHealth}/${shieldGuy.health}, Shield: ${shieldGuy.keywords.divineShield}`);

if (shieldGuy.currentHealth === 1 && !shieldGuy.keywords.divineShield) {
    console.log("PASSED: Damage blocked and shield popped.");
} else {
    console.error("FAILED: Damage not blocked correctly.");
}

console.log("\n--- Testing Divine Shield Dissipation on Attack ---");
// Refresh shield manually for test
shieldGuy.keywords.divineShield = true;
shieldGuy.canAttack = true;
shieldGuy.sleeping = false;

// Play target for opponent
state.currentPlayerIdx = 1;
state.playCard(0);
const target = p2.board[0];
state.currentPlayerIdx = 0;

console.log(`Shield Guy attacks Target Guy. Shield before: ${shieldGuy.keywords.divineShield}`);
state.attack(0, { type: 'MINION', index: 0 });
console.log(`Shield Guy HP: ${shieldGuy.currentHealth}, Shield after: ${shieldGuy.keywords.divineShield}`);

if (!shieldGuy.keywords.divineShield) {
    console.log("PASSED: Shield dissipated after attack.");
} else {
    console.error("FAILED: Shield remained after attack.");
}

console.log("\n--- Testing Battlecry GIVE_DIVINE_SHIELD ---");
state.playCard(1); // Play Gao
state.resolveBattlecry(p1.board[1].keywords.battlecry, { side: 'PLAYER', type: 'MINION', index: 0 });
console.log(`Targeting Shield Guy with Gao's battlecry... Shield: ${shieldGuy.keywords.divineShield}`);

if (shieldGuy.keywords.divineShield) {
    console.log("PASSED: Battlecry granted shield.");
} else {
    console.error("FAILED: Battlecry did not grant shield.");
}
