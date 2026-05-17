import { ArraySchema, defineTypes, Schema } from "@colyseus/schema";
import type { PublicGameState, PublicMinion, PublicPlayer } from "@twcardgame/shared";

export class HeroSchema extends Schema {
  hp = 30;
  maxHp = 30;
}
defineTypes(HeroSchema, { hp: "number", maxHp: "number" });

export class ManaSchema extends Schema {
  current = 0;
  max = 0;
}
defineTypes(ManaSchema, { current: "number", max: "number" });

export class TurnSchema extends Schema {
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
  actionSeq: "number"
});

export class PublicMinionSchema extends Schema {
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
  temporaryUntilTurn: "number"
});

export class PublicPlayerSchema extends Schema {
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
  board: [PublicMinionSchema]
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
  resultReason: "string"
});

export function syncSchemaFromPublic(schema: GameStateSchema, state: PublicGameState): void {
  schema.matchId = state.matchId;
  schema.schemaVersion = state.schemaVersion;
  schema.cardCatalogVersion = state.cardCatalogVersion;
  schema.status = state.status;
  schema.turn.activeSeat = state.turn.activeSeat;
  schema.turn.number = state.turn.number;
  schema.turn.startedAtMs = state.turn.startedAtMs;
  schema.turn.deadlineAtMs = state.turn.deadlineAtMs;
  schema.turn.actionSeq = state.turn.actionSeq;
  syncPlayer(schema.player1, state.players.player1);
  syncPlayer(schema.player2, state.players.player2);
  schema.pendingPromptId = state.pendingPrompt?.promptId ?? "";
  schema.pendingPromptSeat = state.pendingPrompt?.seat ?? "";
  schema.pendingPromptKind = state.pendingPrompt?.kind ?? "";
  schema.resultWinnerSeat = state.result?.winnerSeat ?? "";
  schema.resultReason = state.result?.reason ?? "";
}

function syncPlayer(target: PublicPlayerSchema, player: PublicPlayer): void {
  target.userId = player.userId;
  target.displayName = player.displayName;
  target.connected = player.connected;
  target.reconnectUntilMs = player.reconnectUntilMs ?? -1;
  target.hero.hp = player.hero.hp;
  target.hero.maxHp = player.hero.maxHp;
  target.mana.current = player.mana.current;
  target.mana.max = player.mana.max;
  target.handCount = player.handCount;
  target.deckCount = player.deckCount;
  target.graveyardCount = player.graveyardCount;
  target.mulliganReady = player.mulliganReady;
  // Reconcile board in-place: update existing slots, then push or pop to match length.
  // Colyseus ArraySchema#splice forbids insertCount > deleteCount, so we never use
  // splice for growth — we push new items one-by-one instead.
  const incoming = player.board.map(toMinionSchema);
  for (let i = 0; i < incoming.length; i++) {
    if (i < target.board.length) {
      copyMinionSchema(target.board[i], incoming[i]);
    } else {
      target.board.push(incoming[i]);
    }
  }
  while (target.board.length > incoming.length) {
    target.board.splice(target.board.length - 1, 1);
  }
}

function toMinionSchema(minion: PublicMinion): PublicMinionSchema {
  const schema = new PublicMinionSchema();
  copyMinionSchema(schema, minion);
  return schema;
}

function copyMinionSchema(target: PublicMinionSchema, minion: PublicMinion): void {
  target.instanceId = minion.instanceId;
  target.cardId = minion.cardId;
  target.ownerSeat = minion.ownerSeat;
  target.attack = minion.attack;
  target.baseAttack = minion.baseAttack;
  target.health = minion.health;
  target.currentHealth = minion.currentHealth;
  target.taunt = minion.taunt;
  target.charge = minion.charge;
  target.divineShield = minion.divineShield;
  target.lockedTurns = minion.lockedTurns;
  target.deathTimer = minion.deathTimer ?? -1;
  target.sleeping = minion.sleeping;
  target.canAttack = minion.canAttack;
  target.isEnraged = minion.isEnraged;
  target.questTurns = minion.questTurns ?? -1;
  target.temporaryUntilTurn = minion.temporaryUntilTurn ?? -1;
}
