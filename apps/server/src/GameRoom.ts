import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import {
  createInitialMatch,
  DEFAULT_MULLIGAN_TIME_LIMIT_MS,
  DEFAULT_TURN_TIME_LIMIT_MS,
  reduce,
  toHandView,
  toPromptChoiceOffer,
  toPublicState,
  type MatchState
} from "@twcardgame/rules";
import type { ClientCommandMessage, CommandEnvelope, GameEvent, Seat } from "@twcardgame/shared";
import { Room, type Client } from "colyseus";
import {
  createAccountDeckStoreFromEnv,
  resolvePlayerSetup,
  type AccountDeckStore,
  type JoinOptions,
  type PlayerSetup
} from "./accounts.js";
import { logger } from "./logger.js";
import { isMatchComplete, MatchResultFinalizer } from "./matchFinalizer.js";
import { createMatchResultPersistenceFromEnv, type MatchPersistenceMetadata, type MatchResultPersistence } from "./persistence.js";
import { createMatchRewardsFromEnv, type MatchRewardDispatcher } from "./rewards.js";
import { createTaskEventsFromEnv, type MatchTaskEventDispatcher } from "./taskEvents.js";
import { generateUniqueJoinCode, normalizeJoinCode, registerJoinCode, releaseJoinCodeForRoom } from "./privateRooms.js";
import { GameStateSchema, syncSchemaFromPublic } from "./schema.js";

const RECONNECT_WINDOW_MS = parseInt(process.env.RECONNECT_WINDOW_MS ?? "30000", 10);
const MATCH_CLEANUP_DELAY_MS = parseInt(process.env.MATCH_CLEANUP_DELAY_MS ?? "10000", 10);

/**
 * The reconnect window is a single, cumulative budget per seat for the whole
 * match — not a fresh allowance on every disconnect. If a player drops, returns
 * with 20s left, then drops again, they only get those 20s. `usedMs` is how long
 * the player was disconnected during the just-finished gap.
 */
export function nextReconnectBudgetMs(prevBudgetMs: number, usedMs: number): number {
  return Math.max(0, prevBudgetMs - Math.max(0, usedMs));
}

export function pendingMulliganSeats(match: MatchState): Seat[] {
  if (match.status !== "mulligan") return [];
  return (["player1", "player2"] as Seat[]).filter((seat) => !match.players[seat].mulliganReady);
}

export function shouldApplyTimeoutPenalty(match: MatchState): boolean {
  return match.status === "in_progress" && !match.private.turnActionTaken;
}

export interface GameRoomCreateOptions {
  joinCode?: string;
  private?: boolean;
}

export class GameRoom extends Room<{ state: GameStateSchema }> {
  maxClients = 2;
  protected match?: MatchState;
  protected seats = new Map<string, Seat>();
  protected setup = new Map<Seat, PlayerSetup>();
  // Remaining reconnect allowance per seat for the whole match (see
  // nextReconnectBudgetMs). Lives on the room — a connection-layer concern, not
  // gameplay — so the rules engine stays pure.
  private reconnectBudgetMs = new Map<Seat, number>();
  private cleanupScheduled = false;
  private actionDeadlineTimer?: { clear: () => void };
  private serverCommandSeq = 0;
  protected readonly finalizer: MatchResultFinalizer;
  private registeredJoinCode?: string;

  constructor(
    persistence: MatchResultPersistence = createMatchResultPersistenceFromEnv(),
    protected readonly accountStore: AccountDeckStore = createAccountDeckStoreFromEnv(),
    protected readonly rewards: MatchRewardDispatcher = createMatchRewardsFromEnv(),
    protected readonly taskEvents: MatchTaskEventDispatcher = createTaskEventsFromEnv()
  ) {
    super();
    this.finalizer = new MatchResultFinalizer(persistence);
  }

  onCreate(options: GameRoomCreateOptions = {}): void {
    this.setState(new GameStateSchema());
    this.onMessage<ClientCommandMessage>("command", (client, message) => this.handleCommand(client, message));
    this.onMessage("getJoinCode", (client) => {
      if (this.registeredJoinCode) client.send("joinCode", { code: this.registeredJoinCode });
    });

    const incomingCode = options.joinCode ? normalizeJoinCode(options.joinCode) : undefined;
    if (incomingCode || options.private) {
      const code = incomingCode ?? generateUniqueJoinCode();
      registerJoinCode(code, this.roomId);
      this.registeredJoinCode = code;
      this.setPrivate(true);
      this.setMetadata({ joinCode: code });
      // Code is sent to the creator in onJoin (with delay) and also on demand via getJoinCode.
    }
    logger.info("room.create", { roomId: this.roomId, private: Boolean(this.registeredJoinCode) });
  }

  async onAuth(client: Client, options: JoinOptions = {}, _context?: any): Promise<PlayerSetup> {
    return resolvePlayerSetup(client.sessionId, options, this.accountStore);
  }

  async onJoin(client: Client, options: JoinOptions = {}, auth?: PlayerSetup): Promise<void> {
    const setup = auth ?? (await resolvePlayerSetup(client.sessionId, options, this.accountStore));
    const seat = this.assignSeat(client);
    this.seats.set(client.sessionId, seat);
    this.setup.set(seat, setup);
    client.send("seat", { seat });

    // If this is a private room, send the join code to the creator (first joiner).
    // Delay 150 ms so the client's create() promise has time to resolve and attach
    // its onMessage("joinCode") listener before this WS frame arrives.
    if (this.registeredJoinCode && this.setup.size === 1) {
      const code = this.registeredJoinCode;
      setTimeout(() => client.send("joinCode", { code }), 150);
    }

    if (!this.match && this.setup.size === 2) {
      this.createMatch();
    }

    this.sendPrivateState(client);
  }

  async onLeave(client: Client): Promise<void> {
    const seat = this.seats.get(client.sessionId);
    this.seats.delete(client.sessionId);
    if (!seat) return;
    if (!this.match) {
      this.setup.delete(seat);
      return;
    }
    if (isMatchComplete(this.match)) return;

    const budget = this.reconnectBudgetMs.get(seat) ?? RECONNECT_WINDOW_MS;
    if (budget <= 0) {
      this.finishDisconnectTimeout(seat);
      return;
    }

    this.match.players[seat].connected = false;
    this.match.players[seat].reconnectUntilMs = Date.now() + budget;
    this.syncPublicState();
    this.broadcast("presence", { seat, connected: false, reconnectUntilMs: this.match.players[seat].reconnectUntilMs });

    const disconnectAt = Date.now();
    try {
      const reconnecting = await this.allowReconnection(client, budget / 1000);
      const reconnectSeat = seat;
      this.seats.set(reconnecting.sessionId, reconnectSeat);
      // Spend the time spent disconnected from this seat's one-time budget.
      this.reconnectBudgetMs.set(reconnectSeat, nextReconnectBudgetMs(budget, Date.now() - disconnectAt));
      if (this.match) {
        this.match.players[reconnectSeat].connected = true;
        this.match.players[reconnectSeat].reconnectUntilMs = undefined;
        this.syncPublicState();
        this.broadcast("presence", { seat: reconnectSeat, connected: true });
        // Re-send the seat so a hard-refreshed client re-learns its perspective.
        reconnecting.send("seat", { seat: reconnectSeat });
        this.sendPrivateState(reconnecting);
        this.afterReconnect(reconnectSeat);
      }
    } catch {
      this.finishDisconnectTimeout(seat);
    }
  }

  private finishDisconnectTimeout(seat: Seat): void {
    if (!this.match || isMatchComplete(this.match)) return;
    logger.info("match.disconnect_timeout", { roomId: this.roomId, matchId: this.match.matchId, seat });
    const events = this.finalizer.finish(this.match, { winnerSeat: seat === "player1" ? "player2" : "player1", reason: "disconnect_timeout" }, seat);
    this.syncPublicState();
    this.broadcastPublicSync();
    if (events.length > 0) this.broadcast("events", events);
    this.afterMatchComplete();
  }

  /** Hook for subclasses; runs after a client successfully reconnects to its seat. */
  protected afterReconnect(_seat: Seat): void {
    // no-op in the base PvP room.
  }

  async onDispose(): Promise<void> {
    releaseJoinCodeForRoom(this.roomId);
    logger.info("room.dispose", { roomId: this.roomId });
    if (!this.match) return;
    if (!this.shouldPersistMatchSideEffects()) {
      if (!isMatchComplete(this.match)) {
        this.finalizer.finish(this.match, { reason: "abandoned" });
      }
      return;
    }
    if (!isMatchComplete(this.match)) {
      this.finalizer.finish(this.match, { reason: "abandoned" });
    }
    await this.finalizer.persistOnce(this.match);
  }

  onBeforeShutdown(): void {
    if (!this.match || isMatchComplete(this.match)) return;
    const events = this.finalizer.finish(this.match, { reason: "abandoned" });
    this.syncPublicState();
    this.broadcastPublicSync();
    if (events.length > 0) this.broadcast("events", events);
    this.afterMatchComplete();
  }

  private assignSeat(client: Client): Seat {
    for (const existing of this.seats.values()) {
      if (existing === "player1" && ![...this.seats.values()].includes("player2")) return "player2";
    }
    return this.seats.size === 0 ? "player1" : "player2";
  }

  protected createMatch(): void {
    const player1 = this.setup.get("player1");
    const player2 = this.setup.get("player2");
    if (!player1 || !player2) return;

    const created = createInitialMatch({
      matchId: this.roomId,
      cardCatalogVersion: CARD_CATALOG_VERSION,
      seed: seedFromRoomId(this.roomId),
      nowMs: Date.now(),
      mulliganTimeLimitMs: DEFAULT_MULLIGAN_TIME_LIMIT_MS,
      turnTimeLimitMs: DEFAULT_TURN_TIME_LIMIT_MS,
      catalog: CARD_CATALOG,
      players: [
        { seat: "player1", userId: player1.userId, displayName: player1.displayName, deckIds: player1.deckIds },
        { seat: "player2", userId: player2.userId, displayName: player2.displayName, deckIds: player2.deckIds }
      ]
    });
    this.customizeInitialMatch(created.state, created.events);
    this.match = created.state;
    void this.lock();
    this.syncPublicState();
    this.broadcastPublicSync();
    this.broadcast("events", created.events);
    this.sendAllPrivateState();
    this.scheduleActionDeadline();
    this.afterMatchCreated();
  }

  /** Hook for subclasses; runs once after the initial match state is built. */
  protected afterMatchCreated(): void {
    // no-op in the base PvP room.
  }

  /** Hook for subclasses to adjust initial match state before first sync/broadcast. */
  protected customizeInitialMatch(_state: MatchState, _events: GameEvent[]): void {
    // no-op in the base PvP room.
  }

  private handleCommand(client: Client, message: ClientCommandMessage): void {
    if (!this.match) {
      client.send("error", { message: "對局尚未準備完成。" });
      return;
    }
    const seat = this.seats.get(client.sessionId);
    if (!seat) {
      client.send("error", { message: "尚未分配玩家座位。" });
      return;
    }
    logger.info("server.handleCommand", { seat, command: message?.command });
    if (!message || typeof message.commandId !== "string" || !message.command) {
      this.rejectCommand(seat, "動作資料無效。");
      return;
    }
    if (this.match.private.processedCommandIds.includes(message.commandId)) {
      return;
    }
    if (requiresActionSeq(message.command.type) && message.expectedActionSeq !== this.match.turn.actionSeq) {
      this.rejectCommand(seat, "動作已過期，請依照最新局面操作。");
      return;
    }
    const envelope: CommandEnvelope = {
      commandId: message.commandId,
      seat,
      nowMs: Date.now(),
      command: message.command
    };
    this.applyEnvelope(envelope);
  }

  /**
   * Inner command-application path shared by the WebSocket handler and
   * subclasses that need to inject server-driven commands (e.g. `BotRoom`).
   * The caller is responsible for sequence validation when applicable.
   */
  protected applyEnvelope(envelope: CommandEnvelope): void {
    if (!this.match) return;
    logger.info("server.applyEnvelope", { seat: envelope.seat, type: envelope.command.type });
    const result = reduce(this.match, envelope, CARD_CATALOG);
    this.match = result.state;
    this.syncPublicState();
    this.broadcastPublicSync();
    if (result.events.length > 0) this.broadcast("events", result.events);
    this.sendAllPrivateState();
    this.afterMatchComplete();
    this.scheduleActionDeadline();
    this.afterCommandApplied(envelope, result.events);
  }

  /** Hook for subclasses; runs after a successful command application. */
  protected afterCommandApplied(_envelope: CommandEnvelope, _events: GameEvent[]): void {
    // no-op in the base PvP room.
  }

  private syncPublicState(): void {
    if (!this.match) return;
    syncSchemaFromPublic(this.state, toPublicState(this.match));
  }

  private broadcastPublicSync(): void {
    if (!this.match) return;
    const publicState = toPublicState(this.match);
    const inSpecialPhase = this.match.phase !== "NORMAL_PLAY";
    // The turn countdown is frozen while a special phase is open; surface the
    // phase deadline instead so the client can run the phase countdown.
    const deadlineSync = this.usesActionDeadlines() && !inSpecialPhase
      ? {
          turnStartedAtMs: this.match.turn.startedAtMs,
          turnDeadlineAtMs: this.match.turn.deadlineAtMs
        }
      : {};
    const phaseSync = inSpecialPhase && this.match.specialPhase
      ? { phaseDeadlineAtMs: this.match.specialPhase.phaseDeadlineAtMs }
      : {};
    this.broadcast("publicSync", {
      status: this.match.status,
      phase: this.match.phase,
      activeSeat: this.match.turn.activeSeat,
      turnNumber: this.match.turn.number,
      ...deadlineSync,
      ...phaseSync,
      actionSeq: this.match.turn.actionSeq,
      result: this.match.result,
      players: publicState.players,
      boardLimit: publicState.boardLimit,
      activeEnvironment: publicState.activeEnvironment
    });
  }

  private sendAllPrivateState(): void {
    for (const client of this.clients) this.sendPrivateState(client);
  }

  private sendPrivateState(client: Client): void {
    if (!this.match) return;
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    client.send("hand", { seat, cards: toHandView(this.match, seat) });
    // Amplification options are private per-seat: deliver only this seat's three.
    if (this.match.phase === "AMPLIFICATION_PHASE" && this.match.specialPhase?.amplificationOptions) {
      client.send("amplificationOptions", { options: this.match.specialPhase.amplificationOptions[seat] ?? [] });
    }
    // 教召 / Discover: the candidate cards are private to the prompted seat (revealing
    // them publicly would leak deck order), so deliver them only here.
    const promptChoice = toPromptChoiceOffer(this.match, seat);
    if (promptChoice) client.send("promptChoice", promptChoice);
  }

  private rejectCommand(seat: Seat, reason: string): void {
    if (!this.match) return;
    const event: GameEvent = {
      seq: this.match.private.nextEventSeq++,
      type: "COMMAND_REJECTED",
      seat,
      payload: { reason }
    };
    this.match.private.eventLog.push(event);
    this.broadcastPublicSync();
    this.broadcast("events", [event]);
  }

  protected afterMatchComplete(): void {
    if (!this.match || !isMatchComplete(this.match)) return;
    this.clearActionDeadline();
    this.lock();
    if (!this.shouldPersistMatchSideEffects()) {
      this.scheduleCleanup();
      return;
    }
    const metadata = this.getMatchPersistenceMetadata();
    void this.finalizeAndReward(metadata);
    this.scheduleCleanup();
  }

  protected shouldPersistMatchSideEffects(): boolean {
    return true;
  }

  private async finalizeAndReward(metadata: MatchPersistenceMetadata | undefined): Promise<void> {
    if (!this.match) return;
    // Persist first so the match_history row exists before reward events
    // reference it (the RPC uses match_id as source_id in user_events).
    await this.finalizer.persistOnce(this.match, metadata);
    try {
      const summaries = await this.rewards.grantForMatch(this.match, metadata);
      for (const client of this.clients) {
        const seat = this.seats.get(client.sessionId);
        if (!seat) continue;
        const summary = summaries.get(seat);
        if (summary) client.send("reward_summary", summary);
      }
    } catch (error) {
      logger.warn("match.rewards.dispatch_failed", { matchId: this.match.matchId, error });
    }
    // Emit task/achievement progress events after rewards (so level_up events from
    // grantForMatch precede level quests), and isolated so a failure never blocks
    // reward delivery. Runs once per match via the same single-call guarantee.
    try {
      await this.taskEvents.emitForMatch(this.match, metadata);
    } catch (error) {
      logger.warn("match.taskEvents.failed", { matchId: this.match.matchId, error });
    }
  }

  protected getMatchPersistenceMetadata(): MatchPersistenceMetadata | undefined {
    return undefined;
  }

  protected usesActionDeadlines(): boolean {
    return true;
  }

  protected scheduleCleanup(): void {
    if (this.cleanupScheduled) return;
    this.cleanupScheduled = true;
    if (this.match) {
      logger.info("match.finish", {
        roomId: this.roomId,
        matchId: this.match.matchId,
        reason: this.match.result?.reason,
        winnerSeat: this.match.result?.winnerSeat
      });
    }
    this.clock.setTimeout(() => {
      void this.disconnect();
    }, Math.max(0, MATCH_CLEANUP_DELAY_MS));
  }

  private scheduleActionDeadline(): void {
    this.clearActionDeadline();
    if (!this.usesActionDeadlines()) return;
    if (!this.match || isMatchComplete(this.match)) return;

    // Special phases (amplification/voting) run their own 30s deadline instead of
    // the turn clock; on timeout the rules engine fills defaults for both seats.
    if (this.match.phase !== "NORMAL_PLAY" && this.match.specialPhase) {
      const phaseExpected = { phase: this.match.phase, deadlineAtMs: this.match.specialPhase.phaseDeadlineAtMs };
      const phaseDelayMs = Math.max(0, phaseExpected.deadlineAtMs - Date.now());
      this.actionDeadlineTimer = this.clock.setTimeout(() => {
        this.actionDeadlineTimer = undefined;
        this.handlePhaseDeadline(phaseExpected);
      }, phaseDelayMs);
      return;
    }

    if (this.match.status !== "mulligan" && this.match.status !== "in_progress") return;

    const expected = {
      status: this.match.status,
      turnNumber: this.match.turn.number,
      actionSeq: this.match.turn.actionSeq,
      deadlineAtMs: this.match.turn.deadlineAtMs
    };
    const delayMs = Math.max(0, expected.deadlineAtMs - Date.now());
    this.actionDeadlineTimer = this.clock.setTimeout(() => {
      this.actionDeadlineTimer = undefined;
      this.handleActionDeadline(expected);
    }, delayMs);
  }

  private handlePhaseDeadline(expected: { phase: string; deadlineAtMs: number }): void {
    if (!this.match || isMatchComplete(this.match)) return;
    if (this.match.phase !== expected.phase || this.match.specialPhase?.phaseDeadlineAtMs !== expected.deadlineAtMs) {
      this.scheduleActionDeadline();
      return;
    }
    if (Date.now() < expected.deadlineAtMs) {
      this.scheduleActionDeadline();
      return;
    }
    // A single server-timeout command resolves the whole phase: the rules engine
    // fills tier-1 / index-0 defaults for every seat that hasn't chosen.
    const seat = this.match.turn.activeSeat;
    if (this.match.phase === "AMPLIFICATION_PHASE") {
      this.applyServerCommand(seat, "amp-timeout", { type: "selectAmplification", optionId: "" }, { serverTimeout: true });
    } else if (this.match.phase === "VOTING_PHASE") {
      this.applyServerCommand(seat, "vote-timeout", { type: "submitVote", optionIndex: 0 }, { serverTimeout: true });
    }
    this.scheduleActionDeadline();
  }

  private clearActionDeadline(): void {
    this.actionDeadlineTimer?.clear();
    this.actionDeadlineTimer = undefined;
  }

  private handleActionDeadline(expected: { status: string; turnNumber: number; actionSeq: number; deadlineAtMs: number }): void {
    if (!this.match || isMatchComplete(this.match)) return;
    if (
      this.match.status !== expected.status ||
      this.match.turn.number !== expected.turnNumber ||
      this.match.turn.actionSeq !== expected.actionSeq ||
      this.match.turn.deadlineAtMs !== expected.deadlineAtMs
    ) {
      this.scheduleActionDeadline();
      return;
    }

    if (Date.now() < expected.deadlineAtMs) {
      this.scheduleActionDeadline();
      return;
    }

    if (this.match.status === "mulligan") {
      for (const seat of pendingMulliganSeats(this.match)) {
        this.applyServerCommand(seat, "mulligan-timeout", { type: "submitMulligan", replaceHandInstanceIds: [] });
      }
      this.scheduleActionDeadline();
      return;
    }

    if (this.match.status === "in_progress") {
      const timedOutSeat = this.match.turn.activeSeat;
      this.applyServerCommand(timedOutSeat, "turn-timeout", { type: "endTurn" }, { serverTimeout: true });
      this.scheduleActionDeadline();
    }
  }

  private applyServerCommand(seat: Seat, tag: string, command: CommandEnvelope["command"], opts: { serverTimeout?: boolean } = {}): void {
    this.applyEnvelope({
      commandId: `server-${this.roomId}-${tag}-${++this.serverCommandSeq}`,
      seat,
      nowMs: Date.now(),
      command,
      serverTimeout: opts.serverTimeout
    });
  }
}

function seedFromRoomId(roomId: string): number {
  let seed = 2166136261;
  for (let i = 0; i < roomId.length; i++) {
    seed ^= roomId.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function requiresActionSeq(commandType: ClientCommandMessage["command"]["type"]): boolean {
  // Concede finalizes the match deterministically and may be sent off-turn (and
  // by a just-reconnected client that doesn't know the current actionSeq), so it
  // is not gated by sequence freshness. Special-phase commands are phase-scoped
  // (both seats act simultaneously), not turn-scoped, so they skip the gate too.
  return (
    commandType !== "submitMulligan" &&
    commandType !== "reconnect" &&
    commandType !== "concede" &&
    commandType !== "selectAmplification" &&
    commandType !== "rerollAmplification" &&
    commandType !== "submitVote"
  );
}
