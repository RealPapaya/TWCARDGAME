/**
 * Automated Verification Script for Card Mechanics
 * Usage: Paste this entire script into the browser console while the game is running.
 * Or call window.verifyMechanics() if loaded via updates.js
 */
window.verifyMechanics = function () {
    console.log("=== STARTING BROWSER-BASED VERIFICATION ===\n");
    const game = window.gameState;
    if (!game) {
        console.error("GameState not found! Ensure game is initialized.");
        return;
    }

    let passed = 0;
    let failed = 0;
    const player = game.currentPlayer;

    // Backup State
    const originalBoard = [...player.board];
    const originalHand = [...player.hand];
    const originalMana = { ...player.mana };

    try {
        // --- Scenario 1: Basic Cost Reduction ---
        console.log("TEST 1: Ongoing Cost Reduction (Chen Chien-jen vs Wuhan Pneumonia)");

        // 1. Setup Board with Chen Chien-jen
        const chenCard = window.CARD_DATA.find(c => c.id === 'TW050');
        if (!chenCard) throw new Error("Card TW050 (Chen Chien-jen) not found in data!");

        // Manually create minion to bypass play checks
        const chenMinion = {
            ...chenCard,
            instanceId: Date.now() + '_test_chen',
            side: player.side,
            canAttack: false,
            sleeping: true,
            keywords: JSON.parse(JSON.stringify(chenCard.keywords || {}))
        };
        player.board = [chenMinion];
        console.log("Placed Chen on board:", chenMinion);

        // 2. Setup Hand with Wuhan Pneumonia
        const spellCard = window.CARD_DATA.find(c => c.id === 'S015');
        if (!spellCard) throw new Error("Card S015 not found!");

        const testSpell = { ...spellCard, instanceId: Date.now() + '_test_spell' };
        // Ensure keywords are fresh
        testSpell.keywords = JSON.parse(JSON.stringify(spellCard.keywords || {}));
        player.hand = [testSpell];

        // 3. Verify Cost
        const actualCost = game.getCardActualCost(testSpell);
        const expectedCost = 2; // 5 - 3 = 2

        if (actualCost === expectedCost) {
            console.log(`%c[PASS] Cost Reduced Correctly: ${spellCard.cost} -> ${actualCost}`, "color: green");
            passed++;
        } else {
            console.error(`[FAIL] Cost Mismatch! Expected ${expectedCost}, got ${actualCost}`);
            failed++;
        }

        // 4. Verify Playability (Mock Mana)
        player.mana.current = 3;
        const canPlay = game.canPlayCard(0);
        if (canPlay) {
            console.log(`%c[PASS] Card is Playable with 3 Mana`, "color: green");
            passed++;
        } else {
            console.error(`[FAIL] Card should be playable! Mana: ${player.mana.current}, Cost: ${actualCost}`);
            failed++;
        }

    } catch (e) {
        console.error("Test Error:", e);
        failed++;
    } finally {
        // Restore State
        player.board = originalBoard;
        player.hand = originalHand;
        player.mana = originalMana;
        console.log("=== VERIFICATION COMPLETE: State Restored ===");
    }
};
