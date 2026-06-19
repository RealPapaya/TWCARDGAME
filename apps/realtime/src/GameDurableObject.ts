import type { MatchState } from "@twcardgame/rules";
import { SEATS, type AiDifficulty, type AiTheme, type DevTestMatchSetup, type RewardSummary, type Seat } from "@twcardgame/shared";
import { createAccountStore, type AccountStore } from "./accounts.js";
import { BotGameSession } from "./BotGameSession.js";
import {
  GameSession,
  type GameSessionSnapshot,
  type PlayerSetup,
  type SessionHost
} from "./GameSession.js";
import { createMatchServices, type MatchMetadata, type MatchServices } from "./matchServices.js";
import { serverMessage, type ClientMessage, type ServerMessage } from "./protocol.js";
import { restoreSession } from "./restore.js";
import { encodeReconnectToken, type RealtimeMode } from "./tokens.js";

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  /** Optional: when set, match results persist + grant rewards via Supabase (Plan B). */
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/** Per-connection state stored on the hibernatable socket via serializeAttachment. */
interface Attachment {
  seat: Seat;
  sessionId: string;
}

interface StoredState {
  session: GameSessionSnapshot;
  cleanupAtMs?: number;
  /** Whether the finalize side-effects already ran (survives hibernation, so they run once). */
  finalized?: boolean;
}

const STORAGE_KEY = "do";
/** Pending dev-test board setup, stashed by the worker before the WS connect. */
const DEVTEST_KEY = "devtest";
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
  /** Match awaiting persistence/reward dispatch (queued in onMatchComplete, run on flush). */
  private pendingFinalize?: { match: MatchState; metadata: MatchMetadata };
  /** Set once finalize side-effects have run; persisted so hibernation can't re-run them. */
  private finalized = false;
  private readonly host: SessionHost;
  private readonly services: MatchServices;
  private readonly accounts: AccountStore;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {
    this.services = createMatchServices(env);
    this.accounts = createAccountStore(env);
    this.host = {
      now: () => Date.now(),
      sendToSeat: (seat, message) => this.sendToSeat(seat, message),
      broadcast: (message) => this.broadcast(message),
      scheduleWake: (atMs) => {
        this.pendingWake = atMs;
      },
      onMatchComplete: (match, metadata) => {
        // No deadline alarm is needed once finished; repurpose the single alarm
        // to evict the room after a short grace window (clients still see the result).
        this.cleanupAtMs = Date.now() + MATCH_CLEANUP_DELAY_MS;
        this.pendingWake = this.cleanupAtMs;
        // The session call chain is synchronous; the persist/reward writes are
        // async, so queue them for the next flush (run once, guarded by `finalized`).
        // Dev-test matches are throwaway (BotRoom.shouldPersistMatchSideEffects ===
        // false): clean up the room but skip persistence/rewards/reward_summary.
        if (!this.finalized && !metadata.devTest) this.pendingFinalize = { match, metadata };
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

    // Internal (worker → DO): stash a localhost dev-test board setup for the next
    // match this room creates. The WS connect that follows reads it in
    // ensureSession. The worker gates this on a local origin before forwarding.
    if (request.method === "POST" && url.pathname === "/devtest-setup") {
      const setup = (await request.json()) as DevTestMatchSetup;
      await this.state.storage.put(DEVTEST_KEY, setup);
      return Response.json({ ok: true });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({
        ok: true,
        room: this.state.id.toString(),
        hasMatch: Boolean(this.session?.hasMatch()),
        complete: Boolean(this.session?.isComplete())
      });
    }

    await this.ensureSession(url);
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
    this.sendToSocket(server, serverMessage("reconnectToken", { token: this.createReconnectToken(url, sessionId) }));
    if (session.joinCode && seat === "player1" && !reconnect) {
      this.sendToSocket(server, serverMessage("joinCode", { code: session.joinCode }));
    }
    if (session instanceof BotGameSession) {
      // Mirror BotRoom.onJoin: client.send("bot", { seat, difficulty, theme }).
      this.sendToSocket(server, serverMessage("bot", session.botInfo));
    }

    if (reconnect) {
      session.markReconnected(seat);
    } else {
      // setPlayer broadcasts the initial match state to both seats once full.
      session.setPlayer(seat, sessionId, await this.resolveSetup(url, sessionId));
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
    const joinCode = this.session?.joinCode;
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.close(1000, "match complete");
      } catch {
        // ignore
      }
    }
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
    if (joinCode) await this.releaseJoinCode(joinCode);
    this.session = undefined;
    this.cleanupAtMs = undefined;
    this.pendingWake = undefined;
    this.finalized = false;
    this.pendingFinalize = undefined;
  }

  /* --------------------------------- helpers --------------------------------- */

  private async ensureSession(url: URL): Promise<void> {
    if (this.session) return;
    const matchId = this.state.id.toString();
    const joinCode = url.searchParams.get("joinCode") ?? undefined;
    if (url.searchParams.get("mode") === "pve") {
      // A dev-test setup (if any) was stashed by the worker just before this connect.
      const devTest = await this.state.storage.get<DevTestMatchSetup>(DEVTEST_KEY);
      this.session = new BotGameSession(this.host, {
        matchId,
        joinCode,
        difficulty: (url.searchParams.get("difficulty") as AiDifficulty | null) ?? undefined,
        theme: (url.searchParams.get("theme") as AiTheme | null) ?? undefined,
        devTest
      });
    } else {
      this.session = new GameSession(this.host, { matchId, joinCode });
    }
  }

  private async resolveSetup(url: URL, sessionId: string): Promise<PlayerSetup> {
    const params = url.searchParams;
    const deckParam = params.get("deck");
    // The account store validates the deck (dev or Supabase) and resolves identity;
    // an absent/invalid deck falls back to the dev deck rather than entering illegally.
    return this.accounts.resolvePlayerSetup(sessionId, {
      userId: params.get("userId") || undefined,
      displayName: params.get("name") || undefined,
      deckIds: deckParam ? deckParam.split(",").filter(Boolean) : undefined,
      deckId: params.get("deckId") || undefined,
      accessToken: params.get("accessToken") || undefined
    });
  }

  private createReconnectToken(url: URL, sessionId: string): string {
    return encodeReconnectToken({
      v: 1,
      mode: (url.searchParams.get("mode") as RealtimeMode | null) ?? "pvp",
      room: url.searchParams.get("room") || this.state.id.toString(),
      sessionId,
      issuedAtMs: Date.now()
    });
  }

  private async releaseJoinCode(joinCode: string): Promise<void> {
    try {
      const id = this.env.LOBBY.idFromName("global");
      const stub = this.env.LOBBY.get(id);
      await stub.fetch(`https://lobby/private/${encodeURIComponent(joinCode)}`, { method: "DELETE" });
    } catch {
      // Lobby cleanup is best-effort; the match DO must still be able to evict.
    }
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
      this.session = restoreSession(this.host, stored.session);
      this.cleanupAtMs = stored.cleanupAtMs;
      this.finalized = stored.finalized ?? false;
    }
  }

  private async persist(): Promise<void> {
    if (!this.session) return;
    const stored: StoredState = {
      session: this.session.toSnapshot(),
      cleanupAtMs: this.cleanupAtMs,
      finalized: this.finalized
    };
    await this.state.storage.put(STORAGE_KEY, stored);
  }

  /** Persist mutated state and apply any alarm requested during the just-run handler. */
  private async flush(): Promise<void> {
    await this.runPendingFinalize();
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

  /**
   * Persist history + grant rewards + emit quest events once for a finished match,
   * then push each seat its `reward_summary`. Best-effort: a failure never blocks
   * the room from evicting (mirrors GameRoom.finalizeAndReward's isolation).
   */
  private async runPendingFinalize(): Promise<void> {
    if (!this.pendingFinalize || this.finalized) return;
    this.finalized = true;
    const { match, metadata } = this.pendingFinalize;
    this.pendingFinalize = undefined;
    let summaries: Map<Seat, RewardSummary>;
    try {
      summaries = await this.services.finalize(match, metadata);
    } catch (error) {
      console.warn("match.finalize.failed", { matchId: match.matchId, error: String(error) });
      return;
    }
    for (const seat of SEATS) {
      const summary = summaries.get(seat);
      if (summary) this.sendToSeat(seat, serverMessage("reward_summary", summary));
    }
  }
}
