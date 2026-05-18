import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import {
  createInitialMatch,
  reduce,
  toHandView,
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
import { isMatchComplete, MatchResultFinalizer } from "./matchFinalizer.js";
import { createMatchResultPersistenceFromEnv, type MatchResultPersistence } from "./persistence.js";
import { GameStateSchema, syncSchemaFromPublic } from "./schema.js";

const TURN_TIME_LIMIT_MS = 60_000;
const RECONNECT_WINDOW_MS = parseInt(process.env.RECONNECT_WINDOW_MS ?? "60000", 10);
const MATCH_CLEANUP_DELAY_MS = parseInt(process.env.MATCH_CLEANUP_DELAY_MS ?? "10000", 10);

export class GameRoom extends Room<{ state: GameStateSchema }> {
  maxClients = 2;
  private match?: MatchState;
  private seats = new Map<string, Seat>();
  private setup = new Map<Seat, PlayerSetup>();
  private cleanupScheduled = false;
  private readonly finalizer: MatchResultFinalizer;

  constructor(
    persistence: MatchResultPersistence = createMatchResultPersistenceFromEnv(),
    private readonly accountStore: AccountDeckStore = createAccountDeckStoreFromEnv()
  ) {
    super();
    this.finalizer = new MatchResultFinalizer(persistence);
  }

  onCreate(): void {
    this.setState(new GameStateSchema());
    this.onMessage<ClientCommandMessage>("command", (client, message) => this.handleCommand(client, message));
  }

  async onAuth(client: Client, options: JoinOptions = {}): Promise<PlayerSetup> {
    return resolvePlayerSetup(client.sessionId, options, this.accountStore);
  }

  async onJoin(client: Client, options: JoinOptions = {}, auth?: PlayerSetup): Promise<void> {
    const setup = auth ?? (await resolvePlayerSetup(client.sessionId, options, this.accountStore));
    const seat = this.assignSeat(client);
    this.seats.set(client.sessionId, seat);
    this.setup.set(seat, setup);
    client.send("seat", { seat });

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

    this.match.players[seat].connected = false;
    this.match.players[seat].reconnectUntilMs = Date.now() + RECONNECT_WINDOW_MS;
    this.syncPublicState();
    this.broadcast("presence", { seat, connected: false, reconnectUntilMs: this.match.players[seat].reconnectUntilMs });

    try {
      const reconnecting = await this.allowReconnection(client, RECONNECT_WINDOW_MS / 1000);
      const reconnectSeat = seat;
      this.seats.set(reconnecting.sessionId, reconnectSeat);
      if (this.match) {
        this.match.players[reconnectSeat].connected = true;
        this.match.players[reconnectSeat].reconnectUntilMs = undefined;
        this.syncPublicState();
        this.broadcast("presence", { seat: reconnectSeat, connected: true });
        this.sendPrivateState(reconnecting);
      }
    } catch {
      if (!this.match || isMatchComplete(this.match)) return;
      const events = this.finalizer.finish(this.match, { winnerSeat: seat === "player1" ? "player2" : "player1", reason: "disconnect_timeout" }, seat);
      this.syncPublicState();
      this.broadcastPublicSync();
      if (events.length > 0) this.broadcast("events", events);
      this.afterMatchComplete();
    }
  }

  async onDispose(): Promise<void> {
    if (!this.match) return;
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

  private createMatch(): void {
    const player1 = this.setup.get("player1");
    const player2 = this.setup.get("player2");
    if (!player1 || !player2) return;

    const created = createInitialMatch({
      matchId: this.roomId,
      cardCatalogVersion: CARD_CATALOG_VERSION,
      seed: seedFromRoomId(this.roomId),
      nowMs: Date.now(),
      turnTimeLimitMs: TURN_TIME_LIMIT_MS,
      catalog: CARD_CATALOG,
      players: [
        { seat: "player1", userId: player1.userId, displayName: player1.displayName, deckIds: player1.deckIds },
        { seat: "player2", userId: player2.userId, displayName: player2.displayName, deckIds: player2.deckIds }
      ]
    });
    this.match = created.state;
    void this.lock();
    this.syncPublicState();
    this.broadcastPublicSync();
    this.broadcast("events", created.events);
    this.sendAllPrivateState();
  }

  private handleCommand(client: Client, message: ClientCommandMessage): void {
    if (!this.match) {
      client.send("error", { message: "Match is not ready." });
      return;
    }
    const seat = this.seats.get(client.sessionId);
    if (!seat) {
      client.send("error", { message: "No seat assigned." });
      return;
    }
    if (!message || typeof message.commandId !== "string" || !message.command) {
      this.rejectCommand(seat, "Invalid command message.");
      return;
    }
    if (this.match.private.processedCommandIds.includes(message.commandId)) {
      return;
    }
    if (requiresActionSeq(message.command.type) && message.expectedActionSeq !== this.match.turn.actionSeq) {
      this.rejectCommand(seat, "Command sequence is stale.");
      return;
    }
    const envelope: CommandEnvelope = {
      commandId: message.commandId,
      seat,
      nowMs: Date.now(),
      command: message.command
    };
    const result = reduce(this.match, envelope, CARD_CATALOG);
    this.match = result.state;
    this.syncPublicState();
    this.broadcastPublicSync();
    if (result.events.length > 0) this.broadcast("events", result.events);
    this.sendAllPrivateState();
    this.afterMatchComplete();
  }

  private syncPublicState(): void {
    if (!this.match) return;
    syncSchemaFromPublic(this.state, toPublicState(this.match));
  }

  private broadcastPublicSync(): void {
    if (!this.match) return;
    const publicState = toPublicState(this.match);
    this.broadcast("publicSync", {
      status: this.match.status,
      activeSeat: this.match.turn.activeSeat,
      turnNumber: this.match.turn.number,
      actionSeq: this.match.turn.actionSeq,
      result: this.match.result,
      players: publicState.players
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

  private afterMatchComplete(): void {
    if (!this.match || !isMatchComplete(this.match)) return;
    void this.finalizer.persistOnce(this.match);
    this.scheduleCleanup();
  }

  private scheduleCleanup(): void {
    if (this.cleanupScheduled) return;
    this.cleanupScheduled = true;
    this.clock.setTimeout(() => {
      void this.disconnect();
    }, Math.max(0, MATCH_CLEANUP_DELAY_MS));
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
  return commandType !== "submitMulligan" && commandType !== "reconnect";
}
