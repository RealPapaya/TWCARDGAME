import type { Seat } from "@twcardgame/shared";
import { defaultDeckIds } from "./decks.js";
import {
  GameSession,
  type GameSessionSnapshot,
  type PlayerSetup,
  type SessionHost
} from "./GameSession.js";
import { serverMessage, type ClientMessage, type ServerMessage } from "./protocol.js";

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

/** Per-connection state stored on the hibernatable socket via serializeAttachment. */
interface Attachment {
  seat: Seat;
  sessionId: string;
}

interface StoredState {
  session: GameSessionSnapshot;
  cleanupAtMs?: number;
}

const STORAGE_KEY = "do";
/** Port of GameRoom's MATCH_CLEANUP_DELAY_MS — hold the room open briefly post-match. */
const MATCH_CLEANUP_DELAY_MS = 10_000;

/**
 * One Durable Object instance == one match room (the Colyseus `GameRoom`
 * replacement). It is a thin transport adapter: WebSocket Hibernation for the
 * connections, a single DO Alarm for every deadline, durable storage so an
 * evicted/hibernated room resumes byte-identically — and it delegates ALL
 * gameplay to {@link GameSession}. See docs/cloudflare-migration-roadmap.md §5.
 */
export class GameDurableObject {
  private session?: GameSession;
  private cleanupAtMs?: number;
  /** Pending alarm request captured during a synchronous GameSession call. */
  private pendingWake: number | null | undefined = undefined;
  private readonly host: SessionHost;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {
    this.host = {
      now: () => Date.now(),
      sendToSeat: (seat, message) => this.sendToSeat(seat, message),
      broadcast: (message) => this.broadcast(message),
      scheduleWake: (atMs) => {
        this.pendingWake = atMs;
      },
      onMatchComplete: () => {
        // No deadline alarm is needed once finished; repurpose the single alarm
        // to evict the room after a short grace window (clients still see the result).
        this.cleanupAtMs = Date.now() + MATCH_CLEANUP_DELAY_MS;
        this.pendingWake = this.cleanupAtMs;
      }
    };
    // Block message/alarm delivery until durable state is rehydrated on wake.
    void this.state.blockConcurrencyWhile(async () => {
      await this.hydrate();
    });
  }

  /* --------------------------------- HTTP / WS entry --------------------------------- */

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({
        ok: true,
        room: this.state.id.toString(),
        hasMatch: Boolean(this.session?.hasMatch()),
        complete: Boolean(this.session?.isComplete())
      });
    }

    this.ensureSession(url);
    const session = this.session!;

    const sessionId = url.searchParams.get("sessionId") || crypto.randomUUID();
    const resolved = session.resolveSeat(sessionId);
    if (!resolved) return new Response("Room is full.", { status: 409 });
    const { seat, reconnect } = resolved;

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server); // hibernation-aware accept
    server.serializeAttachment({ seat, sessionId } satisfies Attachment);

    // Mirror GameRoom.onJoin: tell the client its seat, and the private join code
    // to the room creator (first seat).
    this.sendToSocket(server, serverMessage("seat", { seat }));
    if (session.joinCode && seat === "player1" && !reconnect) {
      this.sendToSocket(server, serverMessage("joinCode", { code: session.joinCode }));
    }

    if (reconnect) {
      session.markReconnected(seat);
    } else {
      // setPlayer broadcasts the initial match state to both seats once full.
      session.setPlayer(seat, sessionId, this.parseSetup(url, sessionId));
    }

    await this.flush();
    return new Response(null, { status: 101, webSocket: client });
  }

  /* --------------------------------- WebSocket handlers --------------------------------- */

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.session) return;
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;

    let parsed: ClientMessage;
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      parsed = JSON.parse(text) as ClientMessage;
    } catch {
      return;
    }

    if (parsed?.type === "command") {
      this.session.applyClientCommand(attachment.seat, parsed.payload);
    } else if (parsed?.type === "getJoinCode") {
      const code = this.session.joinCode;
      if (code) this.sendToSocket(ws, serverMessage("joinCode", { code }));
    }

    await this.flush();
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.handleSocketGone(ws);
    try {
      ws.close(code >= 1000 && code < 5000 ? code : 1000, "closing");
    } catch {
      // already closed
    }
    await this.flush();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.handleSocketGone(ws);
    await this.flush();
  }

  private handleSocketGone(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment || !this.session || this.session.isComplete()) return;
    // Only open a reconnect window once the seat has no remaining live socket.
    const stillConnected = this.state
      .getWebSockets()
      .some((other) => other !== ws && (other.deserializeAttachment() as Attachment | null)?.seat === attachment.seat);
    if (!stillConnected) this.session.markDisconnected(attachment.seat);
  }

  /* --------------------------------- Alarm (deadlines + cleanup) --------------------------------- */

  async alarm(): Promise<void> {
    if (!this.session) return;
    this.session.wake();

    if (this.cleanupAtMs !== undefined && Date.now() >= this.cleanupAtMs && this.session.isComplete()) {
      await this.cleanup();
      return;
    }
    await this.flush();
  }

  private async cleanup(): Promise<void> {
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.close(1000, "match complete");
      } catch {
        // ignore
      }
    }
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
    this.session = undefined;
    this.cleanupAtMs = undefined;
    this.pendingWake = undefined;
  }

  /* --------------------------------- helpers --------------------------------- */

  private ensureSession(url: URL): void {
    if (this.session) return;
    const joinCode = url.searchParams.get("joinCode") ?? undefined;
    this.session = new GameSession(this.host, {
      matchId: this.state.id.toString(),
      joinCode
    });
  }

  private parseSetup(url: URL, sessionId: string): PlayerSetup {
    const params = url.searchParams;
    const deckParam = params.get("deck");
    const deckIds = deckParam ? deckParam.split(",").filter(Boolean) : defaultDeckIds();
    return {
      userId: params.get("userId") || sessionId,
      displayName: params.get("name") || `Player ${sessionId.slice(0, 4)}`,
      deckIds: deckIds.length > 0 ? deckIds : defaultDeckIds()
    };
  }

  private sendToSocket(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // socket gone; ignore
    }
  }

  private sendToSeat(seat: Seat, message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.state.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.seat === seat) {
        try {
          ws.send(data);
        } catch {
          // ignore
        }
      }
    }
  }

  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // ignore
      }
    }
  }

  /* --------------------------------- persistence --------------------------------- */

  private async hydrate(): Promise<void> {
    const stored = await this.state.storage.get<StoredState>(STORAGE_KEY);
    if (stored?.session) {
      this.session = GameSession.fromSnapshot(this.host, stored.session);
      this.cleanupAtMs = stored.cleanupAtMs;
    }
  }

  private async persist(): Promise<void> {
    if (!this.session) return;
    const stored: StoredState = { session: this.session.toSnapshot(), cleanupAtMs: this.cleanupAtMs };
    await this.state.storage.put(STORAGE_KEY, stored);
  }

  /** Persist mutated state and apply any alarm requested during the just-run handler. */
  private async flush(): Promise<void> {
    await this.persist();
    if (this.pendingWake !== undefined) {
      if (this.pendingWake === null) {
        await this.state.storage.deleteAlarm();
      } else {
        await this.state.storage.setAlarm(Math.max(this.pendingWake, Date.now() + 1));
      }
      this.pendingWake = undefined;
    }
  }
}
