import { ArraySchema, defineTypes, Schema } from "@colyseus/schema";
import type { PublicGameState, PublicMinion, PublicPlayer, SpecialPhaseView, VoteEvent } from "@twcardgame/shared";

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
  hasOngoing: "boolean"
});

export class AugmentSchema extends Schema {
  id = "";
  name = "";
  tier = "";
}
defineTypes(AugmentSchema, {
  id: "string",
  name: "string",
  tier: "string"
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
  // Most-recently bound amplification (flattened for the single avatar badge); "" when none.
  amplificationId = "";
  amplificationName = "";
  amplificationTier = "";
  // All bound amplifications (0..2), in phase order — drives the avatar indicators.
  augments = new ArraySchema<AugmentSchema>();
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
  augments: [AugmentSchema]
});

export class VoteEventSchema extends Schema {
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
  option2: "string"
});

export class SpecialPhaseSchema extends Schema {
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
  voteEvents: [VoteEventSchema]
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
  activeEnvironmentId = "";
  activeEnvironmentName = "";
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
  activeEnvironmentId: "string",
  activeEnvironmentName: "string"
});

export function syncSchemaFromPublic(schema: GameStateSchema, state: PublicGameState): void {
  schema.matchId = state.matchId;
  schema.schemaVersion = state.schemaVersion;
  schema.cardCatalogVersion = state.cardCatalogVersion;
  schema.status = state.status;
  schema.phase = state.phase;
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
  syncSpecialPhase(schema.specialPhase, state.specialPhase);
  schema.resultWinnerSeat = state.result?.winnerSeat ?? "";
  schema.resultReason = state.result?.reason ?? "";
  schema.boardLimit = state.boardLimit;
  schema.activeEnvironmentId = state.activeEnvironment?.id ?? "";
  schema.activeEnvironmentName = state.activeEnvironment?.name ?? "";
}

function syncSpecialPhase(target: SpecialPhaseSchema, sp: SpecialPhaseView | undefined): void {
  target.phaseDeadlineAtMs = sp?.phaseDeadlineAtMs ?? 0;
  target.ampSelectedP1 = sp?.amplificationSelected?.player1 ?? false;
  target.ampSelectedP2 = sp?.amplificationSelected?.player2 ?? false;
  target.ampRerollUsedP1 = sp?.amplificationRerollUsed?.player1 ?? false;
  target.ampRerollUsedP2 = sp?.amplificationRerollUsed?.player2 ?? false;
  target.ampRerollRemainingP1 = sp?.amplificationRerollRemaining?.player1 ?? 0;
  target.ampRerollRemainingP2 = sp?.amplificationRerollRemaining?.player2 ?? 0;
  target.voteSubmittedP1 = sp?.voteSubmitted?.player1 ?? false;
  target.voteSubmittedP2 = sp?.voteSubmitted?.player2 ?? false;
  target.voteWeightP1 = sp?.voteWeights?.player1 ?? 0;
  target.voteWeightP2 = sp?.voteWeights?.player2 ?? 0;
  const events = (sp?.voteEvents ?? []).map(toVoteEventSchema);
  // Rebuild the ArraySchema so Colyseus keeps typed array item metadata intact.
  target.voteEvents = new ArraySchema<VoteEventSchema>(...events);
}

function toVoteEventSchema(event: VoteEvent): VoteEventSchema {
  const schema = new VoteEventSchema();
  schema.id = event.id;
  schema.name = event.name;
  schema.option0 = event.options[0] ?? "";
  schema.option1 = event.options[1] ?? "";
  schema.option2 = event.options[2] ?? "";
  return schema;
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
  target.amplificationId = player.amplification?.id ?? "";
  target.amplificationName = player.amplification?.name ?? "";
  target.amplificationTier = player.amplification?.tier ?? "";
  const incoming = player.board.map(toMinionSchema);
  // Rebuild the ArraySchema so Colyseus keeps typed array item metadata intact.
  target.board = new ArraySchema<PublicMinionSchema>(...incoming);
  target.augments = new ArraySchema<AugmentSchema>(...(player.augments ?? []).map(toAugmentSchema));
}

function toAugmentSchema(augment: { id: string; name: string; tier: string }): AugmentSchema {
  const schema = new AugmentSchema();
  schema.id = augment.id;
  schema.name = augment.name;
  schema.tier = augment.tier;
  return schema;
}

function toMinionSchema(minion: PublicMinion): PublicMinionSchema {
  const schema = new PublicMinionSchema();
  copyMinionSchema(schema, minion);
  return schema;
}

function copyMinionSchema(target: PublicMinionSchema, minion: PublicMinion | PublicMinionSchema): void {
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
  target.hasOngoing = minion.hasOngoing ?? false;
}
