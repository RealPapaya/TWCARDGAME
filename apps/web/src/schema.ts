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
  hasOngoing = false;
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
  hasOngoing: "boolean",
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
  amplificationId = "";
  amplificationName = "";
  amplificationTier = "";
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
  amplificationId: "string",
  amplificationName: "string",
  amplificationTier: "string",
});

class VoteEventSchema extends Schema {
  id = "";
  name = "";
  option0 = "";
  option1 = "";
  option2 = "";
}
defineTypes(VoteEventSchema, {
  id: "string",
  name: "string",
  option0: "string",
  option1: "string",
  option2: "string",
});

class SpecialPhaseSchema extends Schema {
  phaseDeadlineAtMs = 0;
  ampSelectedP1 = false;
  ampSelectedP2 = false;
  ampRerollUsedP1 = false;
  ampRerollUsedP2 = false;
  ampRerollRemainingP1 = 0;
  ampRerollRemainingP2 = 0;
  voteSubmittedP1 = false;
  voteSubmittedP2 = false;
  voteWeightP1 = 0;
  voteWeightP2 = 0;
  voteEvents = new ArraySchema<VoteEventSchema>();
}
defineTypes(SpecialPhaseSchema, {
  phaseDeadlineAtMs: "number",
  ampSelectedP1: "boolean",
  ampSelectedP2: "boolean",
  ampRerollUsedP1: "boolean",
  ampRerollUsedP2: "boolean",
  ampRerollRemainingP1: "number",
  ampRerollRemainingP2: "number",
  voteSubmittedP1: "boolean",
  voteSubmittedP2: "boolean",
  voteWeightP1: "number",
  voteWeightP2: "number",
  voteEvents: [VoteEventSchema],
});

export class GameStateSchema extends Schema {
  matchId = "";
  schemaVersion = 1;
  cardCatalogVersion = "";
  status = "mulligan";
  phase = "NORMAL_PLAY";
  turn = new TurnSchema();
  player1 = new PublicPlayerSchema();
  player2 = new PublicPlayerSchema();
  pendingPromptId = "";
  pendingPromptSeat = "";
  pendingPromptKind = "";
  specialPhase = new SpecialPhaseSchema();
  resultWinnerSeat = "";
  resultReason = "";
  boardLimit = 7;
}
defineTypes(GameStateSchema, {
  matchId: "string",
  schemaVersion: "number",
  cardCatalogVersion: "string",
  status: "string",
  phase: "string",
  turn: TurnSchema,
  player1: PublicPlayerSchema,
  player2: PublicPlayerSchema,
  pendingPromptId: "string",
  pendingPromptSeat: "string",
  pendingPromptKind: "string",
  specialPhase: SpecialPhaseSchema,
  resultWinnerSeat: "string",
  resultReason: "string",
  boardLimit: "number",
});
