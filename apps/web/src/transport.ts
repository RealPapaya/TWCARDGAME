import type {
  AiDifficulty,
  AiTheme,
  AmplificationOption,
  BattleEmotePayload,
  GameEvent,
  HandCardView,
  Phase,
  PromptChoiceOffer,
  PublicGameState,
  PublicPlayer,
  RewardSummary,
  Seat
} from "@twcardgame/shared";
import { defaultServerUrl } from "./app/config.js";
import { projectRealtimeState } from "./transport-state.js";

export type GameTransportMode = "pvp" | "pve";

export interface GameTransportRoom {
  name: GameTransportMode;
  roomId: string;
  state?: any;
  reconnectionToken?: string;
  onStateChange(callback: (state: any) => void): void;
  onMessage<T = unknown>(type: string, callback: (message: T) => void): void;
  send(type: string, payload: unknown): void;
  leave(consented?: boolean): Promise<void>;
}

export type JoinOptions = {
  displayName?: string;
  userId?: string;
  deckIds?: string[];
  difficulty?: AiDifficulty;
  /** Challenge mode (挑戰模式): bot uses the hard engine + per-tier stat handicap. */
  challenge?: boolean;
  theme?: AiTheme;
  joinCode?: string;
  devTest?: unknown;
} & Record<string, unknown>;

type ServerMessageMap = {
  seat: { seat: Seat };
  joinCode: { code: string };
  reconnectToken: { token: string };
  bot: { seat: Seat; difficulty?: string; theme?: string | null };
  hand: { seat?: Seat; cards: HandCardView[] };
  presence: { seat: Seat; connected: boolean; reconnectUntilMs?: number };
  battleEmote: BattleEmotePayload;
  publicSync: {
    status?: string;
    phase?: Phase;
    activeSeat?: Seat;
    turnNumber?: number;
    turnStartedAtMs?: number;
    turnDeadlineAtMs?: number;
    phaseDeadlineAtMs?: number;
    actionSeq?: number;
    result?: unknown;
    players?: Partial<Record<Seat, PublicPlayer>>;
    boardLimit?: number;
    activeEnvironment?: { id: string; name: string; remainingTurns?: number };
  };
  state: PublicGameState;
  events: GameEvent[];
  amplificationOptions: { options: AmplificationOption[] };
  promptChoice: PromptChoiceOffer;
  error: { message?: string };
  reward_summary: RewardSummary;
};

export async function joinOrCreateGameRoom(
  mode: GameTransportMode,
  options: JoinOptions,
  opts: { serverUrl?: string } = {}
): Promise<GameTransportRoom> {
  return realtimeConnect(mode, options, opts.serverUrl);
}

export async function createGameRoom(
  mode: GameTransportMode,
  options: JoinOptions,
  opts: { serverUrl?: string } = {}
): Promise<GameTransportRoom> {
  if (mode !== "pvp") return realtimeConnect(mode, options, opts.serverUrl);
  const serverUrl = opts.serverUrl ?? defaultServerUrl;
  const response = await fetch(toHttpUrl(serverUrl, "/private"), { method: "POST" });
  if (!response.ok) throw new Error(`Unable to create private room (${response.status}).`);
  const record = (await response.json()) as { room: string; joinCode: string };
  return realtimeConnect(mode, { ...options, room: record.room, joinCode: record.joinCode }, serverUrl);
}

export async function reconnectGameRoom(
  token: string,
  opts: { mode?: GameTransportMode; serverUrl?: string } = {}
): Promise<GameTransportRoom> {
  return realtimeConnect(opts.mode ?? "pvp", { token }, opts.serverUrl);
}

async function realtimeConnect(
  mode: GameTransportMode,
  options: JoinOptions,
  serverUrl = defaultServerUrl
): Promise<GameTransportRoom> {
  if (mode === "pve" && options.devTest) return realtimeCreateDevTestPve(options, serverUrl);
  const url = buildRealtimeUrl(serverUrl, mode, options);
  const room = new RealtimeRoom(mode, String(options.room ?? mode));
  await room.connect(url);
  return room;
}

/**
 * Localhost dev-test PvE: POST the scripted board to mint a fresh room (the
 * Worker gates this on a local origin), then connect to it as a normal /pve room.
 * Replaces the old "dev-test requires Colyseus" escape hatch.
 */
async function realtimeCreateDevTestPve(options: JoinOptions, serverUrl: string): Promise<GameTransportRoom> {
  const response = await fetch(toHttpUrl(serverUrl, "/pve/devtest"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ devTest: options.devTest })
  });
  if (!response.ok) throw new Error(`Unable to start dev-test match (${response.status}).`);
  const { room } = (await response.json()) as { room: string };
  return realtimeConnect("pve", { ...options, devTest: undefined, room }, serverUrl);
}

function buildRealtimeUrl(serverUrl: string, mode: GameTransportMode, options: JoinOptions): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = `/${mode}`;
  url.search = "";
  appendString(url, "room", options.room);
  appendString(url, "joinCode", options.joinCode);
  appendString(url, "token", options.token);
  appendString(url, "reconnectToken", options.reconnectToken);
  appendString(url, "name", options.displayName ?? options.name);
  appendString(url, "userId", options.userId);
  appendString(url, "difficulty", options.difficulty);
  if (options.challenge) url.searchParams.set("challenge", "1");
  appendString(url, "theme", options.theme);
  // Supabase-backed deck resolution (server validates ownership + legality). Sent
  // only when present; otherwise the server uses the explicit `deck` list / dev deck.
  appendString(url, "deckId", options.deckId);
  appendString(url, "accessToken", options.accessToken);
  if (Array.isArray(options.deckIds) && options.deckIds.length > 0) url.searchParams.set("deck", options.deckIds.join(","));
  return url.toString();
}

function toHttpUrl(serverUrl: string, pathname: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "wss:" || url.protocol === "https:" ? "https:" : "http:";
  url.pathname = pathname;
  url.search = "";
  return url.toString();
}

function appendString(url: URL, name: string, value: unknown): void {
  if (typeof value === "string" && value.length > 0) url.searchParams.set(name, value);
}

class RealtimeRoom implements GameTransportRoom {
  state?: any;
  reconnectionToken?: string;
  private ws?: WebSocket;
  private readonly messageHandlers = new Map<string, Set<(message: unknown) => void>>();
  private readonly pendingMessages = new Map<string, unknown[]>();
  private readonly stateHandlers = new Set<(state: any) => void>();

  constructor(
    readonly name: GameTransportMode,
    public roomId: string
  ) {}

  connect(url: string): Promise<void> {
    this.ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      let opened = false;
      this.ws!.addEventListener("open", () => {
        opened = true;
        resolve();
      });
      this.ws!.addEventListener("message", (event) => this.handleMessage(event.data));
      this.ws!.addEventListener("error", () => {
        if (!opened) reject(new Error("Unable to connect to realtime server."));
      });
      this.ws!.addEventListener("close", (event) => {
        if (!opened) reject(new Error(event.reason || "Realtime connection closed before opening."));
      });
    });
  }

  onStateChange(callback: (state: any) => void): void {
    this.stateHandlers.add(callback);
  }

  onMessage<T = unknown>(type: string, callback: (message: T) => void): void {
    const handlers = this.messageHandlers.get(type) ?? new Set<(message: unknown) => void>();
    handlers.add(callback as (message: unknown) => void);
    this.messageHandlers.set(type, handlers);

    const pending = this.pendingMessages.get(type);
    if (!pending) return;
    this.pendingMessages.delete(type);
    for (const message of pending) callback(message as T);
  }

  send(type: string, payload: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, payload }));
  }

  async leave(_consented?: boolean): Promise<void> {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return;
    this.ws.close(1000, "leaving");
  }

  private handleMessage(raw: unknown): void {
    let envelope: { type?: string; payload?: unknown };
    try {
      envelope = JSON.parse(String(raw)) as { type?: string; payload?: unknown };
    } catch {
      return;
    }
    if (!envelope.type) return;

    if (envelope.type === "state") {
      this.state = projectRealtimeState(envelope.payload as PublicGameState);
      if (typeof this.state?.matchId === "string" && this.state.matchId) this.roomId = this.state.matchId;
      for (const callback of this.stateHandlers) callback(this.state);
      return;
    }

    if (envelope.type === "reconnectToken") {
      const token = (envelope.payload as { token?: string } | undefined)?.token;
      if (token) this.reconnectionToken = token;
    }

    this.emitMessage(envelope.type, envelope.payload);
  }

  private emitMessage(type: string, payload: unknown): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers && handlers.size > 0) {
      for (const callback of handlers) callback(payload);
      return;
    }
    const pending = this.pendingMessages.get(type) ?? [];
    pending.push(payload);
    this.pendingMessages.set(type, pending);
  }
}
