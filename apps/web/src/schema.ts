// Client-side schema registration for Colyseus 4.x.
// Colyseus 4.x reflection-based state decoding doesn't populate field values
// unless the client has a concrete schema instance registered via joinOrCreate.
// This file mirrors the server-side GameStateSchema so the client can decode
// state patches correctly.

import { ArraySchema, Schema, defineTypes } from "@colyseus/schema";

class HeroSchema extends Schema {
  hp = 30;
  maxHp = 30;
}
defineTypes(HeroSchema, { hp: "number", maxHp: "number" });

class ManaSchema extends Schema {
  current = 0;
  max = 0;
}
defineTypes(ManaSchema, { current: "number", max: "number" });

class TurnSchema extends Schema {
  activeSeat = "player1";
  number = 0;
  startedAtMs = 0;
  deadlineAtMs = 0;
  actionSeq = 0;
}
defineTypes(TurnSchema, {
  activeSeat: "string",
  number: "number",
  startedAtMs: "number",
  deadlineAtMs: "number",
  actionSeq: "number",
});

class PublicMinionSchema extends Schema {
  instanceId = "";
  cardId = "";
  ownerSeat = "";
  attack = 0;
  baseAttack = 0;
  health = 0;
  currentHealth = 0;
  taunt = false;
  charge = false;
  divineShield = false;
  lockedTurns = 0;
  deathTimer = -1;
  sleeping = false;
  canAttack = false;
  isEnraged = false;
  questTurns = -1;
  temporaryUntilTurn = -1;
}
defineTypes(PublicMinionSchema, {
  instanceId: "string",
  cardId: "string",
  ownerSeat: "string",
  attack: "number",
  baseAttack: "number",
  health: "number",
  currentHealth: "number",
  taunt: "boolean",
  charge: "boolean",
  divineShield: "boolean",
  lockedTurns: "number",
  deathTimer: "number",
  sleeping: "boolean",
  canAttack: "boolean",
  isEnraged: "boolean",
  questTurns: "number",
  temporaryUntilTurn: "number",
});

class PublicPlayerSchema extends Schema {
  userId = "";
  displayName = "";
  connected = true;
  reconnectUntilMs = -1;
  hero = new HeroSchema();
  mana = new ManaSchema();
  handCount = 0;
  deckCount = 0;
  graveyardCount = 0;
  mulliganReady = false;
  board = new ArraySchema<PublicMinionSchema>();
}
defineTypes(PublicPlayerSchema, {
  userId: "string",
  displayName: "string",
  connected: "boolean",
  reconnectUntilMs: "number",
  hero: HeroSchema,
  mana: ManaSchema,
  handCount: "number",
  deckCount: "number",
  graveyardCount: "number",
  mulliganReady: "boolean",
  board: [PublicMinionSchema],
});

export class GameStateSchema extends Schema {
  matchId = "";
  schemaVersion = 1;
  cardCatalogVersion = "";
  status = "mulligan";
  turn = new TurnSchema();
  player1 = new PublicPlayerSchema();
  player2 = new PublicPlayerSchema();
  pendingPromptId = "";
  pendingPromptSeat = "";
  pendingPromptKind = "";
  resultWinnerSeat = "";
  resultReason = "";
}
defineTypes(GameStateSchema, {
  matchId: "string",
  schemaVersion: "number",
  cardCatalogVersion: "string",
  status: "string",
  turn: TurnSchema,
  player1: PublicPlayerSchema,
  player2: PublicPlayerSchema,
  pendingPromptId: "string",
  pendingPromptSeat: "string",
  pendingPromptKind: "string",
  resultWinnerSeat: "string",
  resultReason: "string",
});
