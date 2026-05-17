import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import {
  createInitialMatch,
  reduce,
  toHandView,
  toPublicState,
  validateDeck,
  type MatchState
} from "@twcardgame/rules";
import type { CommandEnvelope, GameCommand, Seat } from "@twcardgame/shared";
import { Room, type Client } from "colyseus";
import { GameStateSchema, syncSchemaFromPublic } from "./schema.js";

interface JoinOptions {
  userId?: string;
  displayName?: string;
  deckIds?: string[];
}

interface CommandMessage {
  commandId?: string;
  command: GameCommand;
}

const TURN_TIME_LIMIT_MS = 60_000;
const RECONNECT_WINDOW_MS = 60_000;

export class GameRoom extends Room<{ state: GameStateSchema }> {
  maxClients = 2;
  private match?: MatchState;
  private seats = new Map<string, Seat>();
  private setup = new Map<Seat, Required<JoinOptions>>();

  onCreate(): void {
    this.setState(new GameStateSchema());
    this.onMessage<CommandMessage>("command", (client, message) => this.handleCommand(client, message));
  }

  onJoin(client: Client, options: JoinOptions = {}): void {
    const seat = this.assignSeat(client);
    this.seats.set(client.sessionId, seat);
    this.setup.set(seat, normalizeJoinOptions(client, options));
    client.send("seat", { seat });

    if (!this.match && this.setup.size === 2) {
      this.createMatch();
    }

    this.sendPrivateState(client);
  }

  async onLeave(client: Client): Promise<void> {
    const seat = this.seats.get(client.sessionId);
    this.seats.delete(client.sessionId);
    if (!seat || !this.match) return;

    this.match.players[seat].connected = false;
    this.match.players[seat].reconnectUntilMs = Date.now() + RECONNECT_WINDOW_MS;
    this.syncPublicState();

    try {
      const reconnecting = await this.allowReconnection(client, RECONNECT_WINDOW_MS / 1000);
      const reconnectSeat = seat;
      this.seats.set(reconnecting.sessionId, reconnectSeat);
      if (this.match) {
        this.match.players[reconnectSeat].connected = true;
        this.match.players[reconnectSeat].reconnectUntilMs = undefined;
        this.syncPublicState();
        this.sendPrivateState(reconnecting);
      }
    } catch {
      if (!this.match || this.match.status === "finished") return;
      this.match.status = "finished";
      this.match.result = { winnerSeat: seat === "player1" ? "player2" : "player1", reason: "disconnect_timeout" };
      this.syncPublicState();
    }
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
    this.syncPublicState();
    this.broadcast("events", created.events);
    this.sendAllPrivateState();
  }

  private handleCommand(client: Client, message: CommandMessage): void {
    if (!this.match) {
      client.send("error", { message: "Match is not ready." });
      return;
    }
    const seat = this.seats.get(client.sessionId);
    if (!seat) {
      client.send("error", { message: "No seat assigned." });
      return;
    }
    const envelope: CommandEnvelope = {
      commandId: message.commandId ?? `${client.sessionId}:${this.match.turn.actionSeq + 1}`,
      seat,
      nowMs: Date.now(),
      command: message.command
    };
    const result = reduce(this.match, envelope, CARD_CATALOG);
    this.match = result.state;
    this.syncPublicState();
    if (result.events.length > 0) this.broadcast("events", result.events);
    this.sendAllPrivateState();
  }

  private syncPublicState(): void {
    if (!this.match) return;
    syncSchemaFromPublic(this.state, toPublicState(this.match));
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
}

function normalizeJoinOptions(client: Client, options: JoinOptions): Required<JoinOptions> {
  const deckIds = validateDeck(options.deckIds ?? [], CARD_CATALOG).valid ? options.deckIds! : defaultDeckIds();
  return {
    userId: options.userId || client.sessionId,
    displayName: options.displayName || `Player ${client.sessionId.slice(0, 4)}`,
    deckIds
  };
}

function defaultDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

function seedFromRoomId(roomId: string): number {
  let seed = 2166136261;
  for (let i = 0; i < roomId.length; i++) {
    seed ^= roomId.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}
