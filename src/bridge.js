import { GameEngine, GameState } from 'logic/GameEngine.js';

// Bridge: Expose Modular Classes to Global Scope for Legacy App Support
window.GameEngine = GameEngine;
window.GameState = GameState;

console.log("[Bridge] Modular GameEngine & GameState loaded and exposed to global scope.");
