import type {
  AmplificationOption,
  GameCommand,
  GameEvent,
  GameStatus,
  HandCardView,
  MatchResult,
  Phase,
  PromptChoiceOffer,
  PublicGameState,
  PublicPlayer,
  Seat
} from "@twcardgame/shared";

/**
 * Wire protocol for the Durable Object realtime layer.
 *
 * Every frame in both directions is a JSON `{ type, payload }` envelope. The
 * server→client `type` strings deliberately mirror the exact Colyseus
 * `room.onMessage(<name>)` events the existing web client already listens for
 * (see docs/cloudflare-migration-roadmap.md §5 and the transport-surface map),
 * so the Phase 3 web adapter is a mechanical translation and the renderer is
 * untouched.
 *
 * The one event the legacy client also consumes is the Colyseus *schema* state
 * (`room.onStateChange`). The server emits that as a plain JSON `state` message
 * carrying the canonical {@link PublicGameState}; the Phase 3 web adapter is
 * responsible for shaping it into the flattened `view.state` object the renderer
 * reads (player1/player2 top-level, etc.). The server stays canonical.
 */
export interface WireEnvelope<T = unknown> {
  type: string;
  payload: T;
}

/* --------------------------------- client → server --------------------------------- */

/** Mirrors `ClientCommandMessage` from @twcardgame/shared. */
export interface CommandClientPayload {
  commandId: string;
  expectedActionSeq: number;
  command: GameCommand;
}

export interface ClientMessageMap {
  command: CommandClientPayload;
  getJoinCode: Record<string, never>;
}

export type ClientMessage = {
  [K in keyof ClientMessageMap]: { type: K; payload: ClientMessageMap[K] };
}[keyof ClientMessageMap];

/* --------------------------------- server → client --------------------------------- */

/** Lightweight per-command sync (mirrors GameRoom.broadcastPublicSync). */
export interface PublicSyncPayload {
  status: GameStatus;
  phase: Phase;
  activeSeat: Seat;
  turnNumber: number;
  turnStartedAtMs?: number;
  turnDeadlineAtMs?: number;
  phaseDeadlineAtMs?: number;
  actionSeq: number;
  result?: MatchResult;
  players: Record<Seat, PublicPlayer>;
  boardLimit: number;
  activeEnvironment?: { id: string; name: string; remainingTurns?: number };
}

export interface ServerMessageMap {
  seat: { seat: Seat };
  joinCode: { code: string };
  reconnectToken: { token: string };
  bot: { seat: Seat; difficulty?: string; theme?: string | null };
  hand: { seat: Seat; cards: HandCardView[] };
  presence: { seat: Seat; connected: boolean; reconnectUntilMs?: number };
  publicSync: PublicSyncPayload;
  /** Canonical full state snapshot; the web adapter maps it onto `view.state`. */
  state: PublicGameState;
  events: GameEvent[];
  amplificationOptions: { options: AmplificationOption[] };
  promptChoice: PromptChoiceOffer;
  error: { message: string };
}

export type ServerMessageType = keyof ServerMessageMap;

export type ServerMessage = {
  [K in ServerMessageType]: { type: K; payload: ServerMessageMap[K] };
}[ServerMessageType];

/** Type-safe constructor so callers can't mismatch a type string with its payload. */
export function serverMessage<K extends ServerMessageType>(
  type: K,
  payload: ServerMessageMap[K]
): ServerMessage {
  return { type, payload } as ServerMessage;
}
