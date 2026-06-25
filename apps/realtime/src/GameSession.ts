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
import {
  SEATS,
  type ClientCommandMessage,
  type CommandEnvelope,
  type GameEvent,
  type Seat
} from "@twcardgame/shared";
import {
  finalizeMatch,
  isMatchComplete,
  nextReconnectBudgetMs,
  pendingMulliganSeats,
  requiresActionSeq,
  seedFromString
} from "./finalize.js";
import type { MatchMetadata } from "./matchServices.js";
import { serverMessage, type ServerMessage } from "./protocol.js";

export const DEFAULT_RECONNECT_WINDOW_MS = 30_000;

/** Deck/identity for one seat. The host resolves this from join options / Supabase. */
export interface PlayerSetup {
  userId: string;
  displayName: string;
  deckIds: string[];
}

/**
 * The host (Durable Object, or a test harness) implements this. It is the ONLY
 * way GameSession reaches the outside world — keeping the session pure and
 * deterministically testable. `now()` is injected instead of `Date.now()` for
 * the same reason the rules engine forbids `Date.now()`.
 */
export interface SessionHost {
  now(): number;
  /** Deliver a message to every live connection bound to `seat`. */
  sendToSeat(seat: Seat, message: ServerMessage): void;
  /** Deliver a message to every live connection in the room. */
  broadcast(message: ServerMessage): void;
  /**
   * Arm a single wake at (or shortly after) `atMs`; `null` clears it. This maps
   * onto a DO Alarm — the migration's replacement for `clock.setTimeout`.
   */
  scheduleWake(atMs: number | null): void;
  /** Fired once when the match reaches a terminal state (persist / reward / cleanup hook). */
  onMatchComplete?(match: MatchState, metadata: MatchMetadata): void;
}

export interface GameSessionOptions {
  matchId: string;
  joinCode?: string;
  reconnectWindowMs?: number;
  mulliganTimeLimitMs?: number;
  turnTimeLimitMs?: number;
}

/** Serialisable session state, persisted to DO storage so it survives hibernation. */
export interface GameSessionSnapshot {
  v: 1;
  /** Discriminator so the host rebuilds the right subclass (see restore.ts). */
  kind: "pvp" | "pve";
  matchId: string;
  joinCode?: string;
  reconnectWindowMs: number;
  mulliganTimeLimitMs: number;
  turnTimeLimitMs: number;
  match?: MatchState;
  setup: Partial<Record<Seat, PlayerSetup>>;
  seatOwner: Partial<Record<Seat, string>>;
  reconnectBudgetMs: Partial<Record<Seat, number>>;
  disconnectedAtMs: Partial<Record<Seat, number>>;
  matchStartedAtMs?: number;
  serverCommandSeq: number;
  /** Subclass-specific persisted state (e.g. bot RNG / pacing — see BotGameSession). */
  extra?: Record<string, unknown>;
}

/**
 * Transport-agnostic port of the gameplay orchestration in
 * apps/server/src/GameRoom.ts. It owns the authoritative {@link MatchState} and
 * drives it through `reduce`, exactly as GameRoom does, but talks to a
 * {@link SessionHost} instead of Colyseus. The Durable Object is a thin adapter
 * over this class; this is where the migration's "byte-identical gameplay"
 * guarantee is kept.
 */
export class GameSession {
  protected match?: MatchState;
  private readonly setup: Partial<Record<Seat, PlayerSetup>> = {};
  /** sessionId that currently owns each seat — used to recognise reconnects. */
  private readonly seatOwner: Partial<Record<Seat, string>> = {};
  private readonly reconnectBudgetMs: Partial<Record<Seat, number>> = {};
  private readonly disconnectedAtMs: Partial<Record<Seat, number>> = {};
  private matchStartedAtMs?: number;
  private serverCommandSeq = 0;

  constructor(
    private readonly host: SessionHost,
    private readonly options: GameSessionOptions
  ) {}

  /* --------------------------------- accessors --------------------------------- */

  get matchId(): string {
    return this.options.matchId;
  }

  get joinCode(): string | undefined {
    return this.options.joinCode;
  }

  hasMatch(): boolean {
    return Boolean(this.match);
  }

  isComplete(): boolean {
    return Boolean(this.match && isMatchComplete(this.match));
  }

  /** Which seat (if any) this sessionId already owns, and whether it's free for a newcomer. */
  resolveSeat(sessionId: string): { seat: Seat; reconnect: boolean } | null {
    if (this.seatOwner.player1 === sessionId) return { seat: "player1", reconnect: true };
    if (this.seatOwner.player2 === sessionId) return { seat: "player2", reconnect: true };
    if (!this.seatOwner.player1) return { seat: "player1", reconnect: false };
    if (!this.seatOwner.player2) return { seat: "player2", reconnect: false };
    return null; // room full
  }

  /* --------------------------------- subclass hooks --------------------------------- */
  // These mirror the protected hooks on apps/server/src/GameRoom.ts so a
  // subclass (e.g. BotGameSession) can extend behaviour without touching the
  // gameplay path. All default to GameRoom's PvP behaviour.

  protected get kind(): "pvp" | "pve" {
    return "pvp";
  }
  /** Injected clock — subclasses must not call Date.now() either. */
  protected now(): number {
    return this.host.now();
  }
  /** Pre-occupy a seat (e.g. the bot) so it is filled before the human joins. */
  protected fillSeat(seat: Seat, owner: string, setup: PlayerSetup): void {
    this.seatOwner[seat] = owner;
    this.setup[seat] = setup;
  }
  /** PvP uses the turn/phase countdown; PvE (bot) disables it (BotRoom parity). */
  protected usesActionDeadlines(): boolean {
    return true;
  }
  protected afterMatchCreated(): void {}
  protected afterCommandApplied(_envelope: CommandEnvelope, _events: GameEvent[]): void {}
  protected afterReconnect(_seat: Seat): void {}
  protected customizeInitialMatch(_state: MatchState, _events: GameEvent[]): void {}
  /** Extra deadline folded into the single host alarm (e.g. bot-step pacing). */
  protected additionalDeadline(): number | null {
    return null;
  }
  /** Extra work to run when the alarm fires (e.g. take a bot step). */
  protected additionalWake(_now: number): void {}
  protected snapshotExtra(): Record<string, unknown> {
    return {};
  }
  protected restoreExtra(_extra: Record<string, unknown>): void {}
  /**
   * Per-match context handed to the finalize/reward hook. PvP by default; PvE
   * (BotGameSession) overrides this to flag `isVsAi` + the bot difficulty/theme.
   */
  protected matchMetadata(): MatchMetadata {
    return {
      isVsAi: false,
      startedAtMs: this.matchStartedAtMs,
      deckCardIds: { player1: this.setup.player1?.deckIds, player2: this.setup.player2?.deckIds }
    };
  }

  /* --------------------------------- lifecycle --------------------------------- */

  /**
   * Register a newly-seated player. When both seats are filled the match is
   * created and broadcast. Returns true if this call created the match.
   */
  setPlayer(seat: Seat, sessionId: string, setup: PlayerSetup): boolean {
    this.seatOwner[seat] = sessionId;
    this.setup[seat] = setup;
    if (!this.match && this.setup.player1 && this.setup.player2) {
      this.createMatch();
      return true;
    }
    return false;
  }

  private createMatch(): void {
    const player1 = this.setup.player1;
    const player2 = this.setup.player2;
    if (!player1 || !player2) return;

    const startedAtMs = this.host.now();
    this.matchStartedAtMs = startedAtMs;
    const created = createInitialMatch({
      matchId: this.options.matchId,
      cardCatalogVersion: CARD_CATALOG_VERSION,
      seed: seedFromString(this.options.matchId),
      nowMs: startedAtMs,
      mulliganTimeLimitMs: this.options.mulliganTimeLimitMs ?? DEFAULT_MULLIGAN_TIME_LIMIT_MS,
      turnTimeLimitMs: this.options.turnTimeLimitMs ?? DEFAULT_TURN_TIME_LIMIT_MS,
      catalog: CARD_CATALOG,
      players: [
        { seat: "player1", userId: player1.userId, displayName: player1.displayName, deckIds: player1.deckIds },
        { seat: "player2", userId: player2.userId, displayName: player2.displayName, deckIds: player2.deckIds }
      ]
    });
    this.customizeInitialMatch(created.state, created.events);
    this.match = created.state;
    this.broadcastPublicState();
    this.broadcast(serverMessage("events", created.events));
    this.sendAllPrivateState();
    this.scheduleWake();
    this.afterMatchCreated();
  }

  /* --------------------------------- commands --------------------------------- */

  /** Port of GameRoom.handleCommand: validate, then apply. */
  applyClientCommand(seat: Seat, message: ClientCommandMessage): void {
    if (!this.match) {
      this.sendError(seat, "對局尚未準備完成。");
      return;
    }
    if (!message || typeof message.commandId !== "string" || !message.command) {
      this.rejectCommand(seat, "動作資料無效。");
      return;
    }
    if (this.match.private.processedCommandIds.includes(message.commandId)) {
      return; // idempotent replay
    }
    if (requiresActionSeq(message.command.type) && message.expectedActionSeq !== this.match.turn.actionSeq) {
      this.rejectCommand(seat, "動作已過期，請依照最新局面操作。");
      return;
    }
    this.applyEnvelope({
      commandId: message.commandId,
      seat,
      nowMs: this.host.now(),
      command: message.command
    });
  }

  /** Port of GameRoom.applyEnvelope: the single reduce → sync → events → private path. */
  private applyEnvelope(envelope: CommandEnvelope): void {
    if (!this.match) return;
    const result = reduce(this.match, envelope, CARD_CATALOG);
    this.match = result.state;
    this.broadcastPublicState();
    if (result.events.length > 0) this.broadcast(serverMessage("events", result.events));
    this.sendAllPrivateState();
    if (isMatchComplete(this.match)) {
      this.onComplete();
    } else {
      this.scheduleWake();
    }
    this.afterCommandApplied(envelope, result.events);
  }

  protected applyServerCommand(
    seat: Seat,
    tag: string,
    command: CommandEnvelope["command"],
    opts: { serverTimeout?: boolean } = {}
  ): void {
    this.applyEnvelope({
      commandId: `server-${this.options.matchId}-${tag}-${++this.serverCommandSeq}`,
      seat,
      nowMs: this.host.now(),
      command,
      serverTimeout: opts.serverTimeout
    });
  }

  /* --------------------------------- deadlines (DO Alarm) --------------------------------- */

  /**
   * Single unified wake handler — the DO Alarm fires this. Replaces GameRoom's
   * three Colyseus timers (scheduleActionDeadline / handlePhaseDeadline /
   * onLeave reconnect window) with one re-evaluated deadline.
   */
  wake(): void {
    if (!this.match || isMatchComplete(this.match)) return;
    const now = this.host.now();

    // 1) Reconnect windows (mirrors GameRoom.onLeave's allowReconnection timeout).
    for (const seat of SEATS) {
      const player = this.match.players[seat];
      if (!player.connected && player.reconnectUntilMs !== undefined && now >= player.reconnectUntilMs) {
        this.finishDisconnectTimeout(seat);
        return; // match finished
      }
    }

    // 2) Phase / turn deadlines — only when this room uses them (PvP).
    if (this.usesActionDeadlines()) {
      if (this.match.phase !== "NORMAL_PLAY" && this.match.specialPhase) {
        // Special-phase deadline (mirrors handlePhaseDeadline).
        if (now >= this.match.specialPhase.phaseDeadlineAtMs) this.resolvePhaseTimeout();
      } else if (
        // Mulligan / turn deadline (mirrors handleActionDeadline).
        (this.match.status === "mulligan" || this.match.status === "in_progress") &&
        now >= this.match.turn.deadlineAtMs
      ) {
        this.resolveTurnTimeout();
      }
    }

    // 3) Subclass pacing (e.g. bot step) shares the same single alarm.
    if (this.match && !isMatchComplete(this.match)) this.additionalWake(now);

    if (this.match && !isMatchComplete(this.match)) this.scheduleWake();
  }

  private resolveTurnTimeout(): void {
    if (!this.match) return;
    if (this.match.status === "mulligan") {
      for (const seat of pendingMulliganSeats(this.match)) {
        this.applyServerCommand(seat, "mulligan-timeout", { type: "submitMulligan", replaceHandInstanceIds: [] });
      }
      return;
    }
    if (this.match.status === "in_progress") {
      const timedOutSeat = this.match.turn.activeSeat;
      this.applyServerCommand(timedOutSeat, "turn-timeout", { type: "endTurn" }, { serverTimeout: true });
    }
  }

  private resolvePhaseTimeout(): void {
    if (!this.match) return;
    const seat = this.match.turn.activeSeat;
    if (this.match.phase === "AMPLIFICATION_PHASE") {
      this.applyServerCommand(seat, "amp-timeout", { type: "selectAmplification", optionId: "" }, { serverTimeout: true });
    } else if (this.match.phase === "VOTING_PHASE") {
      this.applyServerCommand(seat, "vote-timeout", { type: "submitVote", optionIndex: 0 }, { serverTimeout: true });
    }
  }

  /** Earliest pending deadline across reconnect windows + the active phase/turn clock. */
  private nextDeadline(): number | null {
    if (!this.match || isMatchComplete(this.match)) return null;
    const candidates: number[] = [];
    for (const seat of SEATS) {
      const player = this.match.players[seat];
      if (!player.connected && player.reconnectUntilMs !== undefined) candidates.push(player.reconnectUntilMs);
    }
    if (this.usesActionDeadlines()) {
      if (this.match.phase !== "NORMAL_PLAY" && this.match.specialPhase) {
        candidates.push(this.match.specialPhase.phaseDeadlineAtMs);
      } else if (this.match.status === "mulligan" || this.match.status === "in_progress") {
        candidates.push(this.match.turn.deadlineAtMs);
      }
    }
    const extra = this.additionalDeadline();
    if (extra !== null) candidates.push(extra);
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }

  protected scheduleWake(): void {
    this.host.scheduleWake(this.nextDeadline());
  }

  /* --------------------------------- disconnect / reconnect --------------------------------- */

  /** Port of GameRoom.onLeave: open a (cumulative) reconnect window for the seat. */
  markDisconnected(seat: Seat): void {
    if (!this.match || isMatchComplete(this.match)) return;
    const budget = this.reconnectBudgetMs[seat] ?? this.reconnectWindowMs;
    if (budget <= 0) {
      this.finishDisconnectTimeout(seat);
      return;
    }
    this.match.players[seat].connected = false;
    this.match.players[seat].reconnectUntilMs = this.host.now() + budget;
    this.disconnectedAtMs[seat] = this.host.now();
    this.broadcastPublicState();
    this.broadcast(
      serverMessage("presence", {
        seat,
        connected: false,
        reconnectUntilMs: this.match.players[seat].reconnectUntilMs
      })
    );
    this.scheduleWake();
  }

  /** Port of the reconnect branch of GameRoom.onLeave (spend the budget, resync). */
  markReconnected(seat: Seat): void {
    if (!this.match) return;
    const disconnectAt = this.disconnectedAtMs[seat];
    if (disconnectAt !== undefined) {
      const budget = this.reconnectBudgetMs[seat] ?? this.reconnectWindowMs;
      this.reconnectBudgetMs[seat] = nextReconnectBudgetMs(budget, this.host.now() - disconnectAt);
      this.disconnectedAtMs[seat] = undefined;
    }
    this.match.players[seat].connected = true;
    this.match.players[seat].reconnectUntilMs = undefined;
    this.broadcastPublicState();
    this.broadcast(serverMessage("presence", { seat, connected: true }));
    this.sendStateToSeat(seat);
    this.sendPrivateState(seat);
    this.scheduleWake();
    this.afterReconnect(seat);
  }

  private finishDisconnectTimeout(seat: Seat): void {
    if (!this.match || isMatchComplete(this.match)) return;
    const winnerSeat: Seat = seat === "player1" ? "player2" : "player1";
    const events = finalizeMatch(this.match, { winnerSeat, reason: "disconnect_timeout" }, seat);
    this.broadcastPublicState();
    if (events.length > 0) this.broadcast(serverMessage("events", events));
    this.onComplete();
  }

  private get reconnectWindowMs(): number {
    return this.options.reconnectWindowMs ?? DEFAULT_RECONNECT_WINDOW_MS;
  }

  /* --------------------------------- outbound projection --------------------------------- */

  /** Re-send full state + private state to one seat (used right after a connect). */
  resync(seat: Seat): void {
    this.sendStateToSeat(seat);
    this.sendPrivateState(seat);
  }

  private buildPublicMessages(): ServerMessage[] {
    if (!this.match) return [];
    const pub = toPublicState(this.match);
    const inSpecialPhase = this.match.phase !== "NORMAL_PLAY";
    const deadlineSync = !inSpecialPhase
      ? { turnStartedAtMs: this.match.turn.startedAtMs, turnDeadlineAtMs: this.match.turn.deadlineAtMs }
      : {};
    const phaseSync =
      inSpecialPhase && this.match.specialPhase ? { phaseDeadlineAtMs: this.match.specialPhase.phaseDeadlineAtMs } : {};
    return [
      // Canonical full snapshot — the web adapter maps this onto `view.state`.
      serverMessage("state", pub),
      // Lightweight publicSync mirroring GameRoom.broadcastPublicSync.
      serverMessage("publicSync", {
        status: this.match.status,
        phase: this.match.phase,
        activeSeat: this.match.turn.activeSeat,
        turnNumber: this.match.turn.number,
        ...deadlineSync,
        ...phaseSync,
        actionSeq: this.match.turn.actionSeq,
        result: this.match.result,
        players: pub.players,
        boardLimit: pub.boardLimit,
        activeEnvironment: pub.activeEnvironment
      })
    ];
  }

  private broadcastPublicState(): void {
    for (const message of this.buildPublicMessages()) this.broadcast(message);
  }

  private sendStateToSeat(seat: Seat): void {
    for (const message of this.buildPublicMessages()) this.host.sendToSeat(seat, message);
  }

  private sendAllPrivateState(): void {
    for (const seat of SEATS) if (this.setup[seat]) this.sendPrivateState(seat);
  }

  /** Port of GameRoom.sendPrivateState — per-seat hand + private special-phase offers. */
  private sendPrivateState(seat: Seat): void {
    if (!this.match) return;
    this.host.sendToSeat(seat, serverMessage("hand", { seat, cards: toHandView(this.match, seat) }));
    // Amplification options are private per-seat: deliver only this seat's three.
    if (this.match.phase === "AMPLIFICATION_PHASE" && this.match.specialPhase?.amplificationOptions) {
      this.host.sendToSeat(
        seat,
        serverMessage("amplificationOptions", { options: this.match.specialPhase.amplificationOptions[seat] ?? [] })
      );
    }
    // 教召 / Discover candidates are private to the prompted seat (would leak deck order).
    const promptChoice = toPromptChoiceOffer(this.match, seat);
    if (promptChoice) this.host.sendToSeat(seat, serverMessage("promptChoice", promptChoice));
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
    this.broadcastPublicState();
    this.broadcast(serverMessage("events", [event]));
  }

  private sendError(seat: Seat, message: string): void {
    this.host.sendToSeat(seat, serverMessage("error", { message }));
  }

  private broadcast(message: ServerMessage): void {
    this.host.broadcast(message);
  }

  private onComplete(): void {
    this.host.scheduleWake(null);
    if (this.match) this.host.onMatchComplete?.(this.match, this.matchMetadata());
  }

  /* --------------------------------- persistence --------------------------------- */

  toSnapshot(): GameSessionSnapshot {
    return {
      v: 1,
      kind: this.kind,
      matchId: this.options.matchId,
      joinCode: this.options.joinCode,
      reconnectWindowMs: this.reconnectWindowMs,
      mulliganTimeLimitMs: this.options.mulliganTimeLimitMs ?? DEFAULT_MULLIGAN_TIME_LIMIT_MS,
      turnTimeLimitMs: this.options.turnTimeLimitMs ?? DEFAULT_TURN_TIME_LIMIT_MS,
      match: this.match,
      setup: { ...this.setup },
      seatOwner: { ...this.seatOwner },
      reconnectBudgetMs: { ...this.reconnectBudgetMs },
      disconnectedAtMs: { ...this.disconnectedAtMs },
      matchStartedAtMs: this.matchStartedAtMs,
      serverCommandSeq: this.serverCommandSeq,
      extra: this.snapshotExtra()
    };
  }

  /** Restore base fields onto an already-constructed session (the host picks the subclass). */
  applySnapshot(snapshot: GameSessionSnapshot): void {
    this.match = snapshot.match;
    Object.assign(this.setup, snapshot.setup);
    Object.assign(this.seatOwner, snapshot.seatOwner);
    Object.assign(this.reconnectBudgetMs, snapshot.reconnectBudgetMs);
    Object.assign(this.disconnectedAtMs, snapshot.disconnectedAtMs);
    this.matchStartedAtMs = snapshot.matchStartedAtMs;
    this.serverCommandSeq = snapshot.serverCommandSeq;
    this.restoreExtra(snapshot.extra ?? {});
  }

  /** Rebuild a base (PvP) session from a snapshot. PvE goes through restore.ts. */
  static fromSnapshot(host: SessionHost, snapshot: GameSessionSnapshot): GameSession {
    const session = new GameSession(host, {
      matchId: snapshot.matchId,
      joinCode: snapshot.joinCode,
      reconnectWindowMs: snapshot.reconnectWindowMs,
      mulliganTimeLimitMs: snapshot.mulliganTimeLimitMs,
      turnTimeLimitMs: snapshot.turnTimeLimitMs
    });
    session.applySnapshot(snapshot);
    return session;
  }
}
