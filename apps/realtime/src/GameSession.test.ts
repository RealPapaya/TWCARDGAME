import { describe, expect, it } from "vitest";
import type { Seat } from "@twcardgame/shared";
import type { MatchState } from "@twcardgame/rules";
import { GameSession, type PlayerSetup, type SessionHost } from "./GameSession.js";
import type { MatchMetadata } from "./matchServices.js";
import type { PublicSyncPayload, ServerMessage } from "./protocol.js";
import { defaultDeckIds } from "./decks.js";

interface Captured {
  target: "broadcast" | Seat;
  message: ServerMessage;
}

/**
 * Deterministic stand-in for the Durable Object. Captures every outbound
 * message and the requested alarm time, and exposes a controllable clock so the
 * deadline/timeout paths can be exercised without real timers — exactly the
 * purity the migration relies on.
 */
class FakeHost implements SessionHost {
  clock = 1_000_000;
  wakeAt: number | null = null;
  wakeCleared = false;
  completed = false;
  completedMetadata?: MatchMetadata;
  captured: Captured[] = [];

  now(): number {
    return this.clock;
  }
  sendToSeat(seat: Seat, message: ServerMessage): void {
    this.captured.push({ target: seat, message });
  }
  broadcast(message: ServerMessage): void {
    this.captured.push({ target: "broadcast", message });
  }
  scheduleWake(atMs: number | null): void {
    this.wakeAt = atMs;
    if (atMs === null) this.wakeCleared = true;
  }
  onMatchComplete(_match?: MatchState, metadata?: MatchMetadata): void {
    this.completed = true;
    this.completedMetadata = metadata;
  }

  drain(): Captured[] {
    const out = this.captured;
    this.captured = [];
    return out;
  }
  broadcastTypes(): string[] {
    return this.captured.filter((c) => c.target === "broadcast").map((c) => c.message.type);
  }
  lastPayload<T = unknown>(type: string): T | undefined {
    for (let i = this.captured.length - 1; i >= 0; i--) {
      if (this.captured[i].message.type === type) return this.captured[i].message.payload as T;
    }
    return undefined;
  }
  handFor(seat: Seat): { cards: unknown[] } | undefined {
    for (let i = this.captured.length - 1; i >= 0; i--) {
      const c = this.captured[i];
      if (c.target === seat && c.message.type === "hand") return c.message.payload as { cards: unknown[] };
    }
    return undefined;
  }
}

function setup(name: string, userId: string): PlayerSetup {
  return { userId, displayName: name, deckIds: defaultDeckIds() };
}

/** Build a session with both seats filled (match created). Returns helpers. */
function startMatch(matchId = "test-room-1") {
  const host = new FakeHost();
  const session = new GameSession(host, { matchId });
  session.setPlayer("player1", "sid-1", setup("Alice", "u-1"));
  session.setPlayer("player2", "sid-2", setup("Bob", "u-2"));
  const sync = () => host.lastPayload<PublicSyncPayload>("publicSync")!;
  const seatActionSeq = () => sync().actionSeq;
  const submitMulligan = (seat: Seat, commandId: string) =>
    session.applyClientCommand(seat, {
      commandId,
      expectedActionSeq: seatActionSeq(),
      command: { type: "submitMulligan", replaceHandInstanceIds: [] }
    });
  const passMulligan = () => {
    submitMulligan("player1", "m1");
    submitMulligan("player2", "m2");
  };
  return { host, session, sync, seatActionSeq, submitMulligan, passMulligan };
}

describe("GameSession lifecycle", () => {
  it("only creates the match once both seats are filled", () => {
    const host = new FakeHost();
    const session = new GameSession(host, { matchId: "room-a" });

    expect(session.setPlayer("player1", "sid-1", setup("Alice", "u-1"))).toBe(false);
    expect(session.hasMatch()).toBe(false);
    expect(host.captured).toHaveLength(0);

    expect(session.setPlayer("player2", "sid-2", setup("Bob", "u-2"))).toBe(true);
    expect(session.hasMatch()).toBe(true);
  });

  it("broadcasts initial public state + private hands and arms the mulligan deadline", () => {
    const { host, sync } = startMatch();

    // Public projection goes to everyone; hands go privately per seat.
    expect(host.broadcastTypes()).toEqual(expect.arrayContaining(["state", "publicSync", "events"]));
    expect(host.handFor("player1")?.cards).toHaveLength(3);
    expect(host.handFor("player2")?.cards).toHaveLength(3);

    expect(sync().status).toBe("mulligan");
    // A wake is armed for the mulligan deadline, in the future.
    expect(host.wakeAt).not.toBeNull();
    expect(host.wakeAt!).toBeGreaterThan(host.clock);
  });

  it("keeps each seat's hand private (different instance ids)", () => {
    const { host } = startMatch();
    const p1 = host.handFor("player1")!.cards as Array<{ instanceId: string }>;
    const p2 = host.handFor("player2")!.cards as Array<{ instanceId: string }>;
    const p1Ids = new Set(p1.map((c) => c.instanceId));
    const overlap = p2.filter((c) => p1Ids.has(c.instanceId));
    expect(overlap).toHaveLength(0);
  });

  it("reaches in_progress after both players mulligan", () => {
    const { passMulligan, sync } = startMatch();
    passMulligan();
    expect(sync().status).toBe("in_progress");
    expect(["player1", "player2"]).toContain(sync().activeSeat);
  });
});

describe("GameSession command validation", () => {
  it("ignores a duplicate commandId", () => {
    const { host, session, sync, seatActionSeq } = startMatch();
    // Drive to in_progress.
    session.applyClientCommand("player1", {
      commandId: "m1",
      expectedActionSeq: seatActionSeq(),
      command: { type: "submitMulligan", replaceHandInstanceIds: [] }
    });
    session.applyClientCommand("player2", {
      commandId: "m2",
      expectedActionSeq: seatActionSeq(),
      command: { type: "submitMulligan", replaceHandInstanceIds: [] }
    });
    expect(sync().status).toBe("in_progress");

    const active = sync().activeSeat;
    const seq = seatActionSeq();
    session.applyClientCommand(active, {
      commandId: "end-1",
      expectedActionSeq: seq,
      command: { type: "endTurn" }
    });

    host.drain();
    // Replaying the same commandId returns before any reduce/broadcast — a fully
    // idempotent no-op, so nothing at all is emitted.
    session.applyClientCommand(active, {
      commandId: "end-1",
      expectedActionSeq: seq,
      command: { type: "endTurn" }
    });
    expect(host.captured).toHaveLength(0);
  });

  it("rejects a stale actionSeq with COMMAND_REJECTED", () => {
    const { host, session, sync, passMulligan } = startMatch();
    passMulligan();
    const active = sync().activeSeat;

    host.drain();
    session.applyClientCommand(active, {
      commandId: "stale-1",
      expectedActionSeq: 9999,
      command: { type: "endTurn" }
    });
    const events = host.lastPayload<Array<{ type: string }>>("events");
    expect(events?.some((e) => e.type === "COMMAND_REJECTED")).toBe(true);
  });
});

describe("GameSession deadlines (single DO alarm)", () => {
  it("ends the active turn when the turn deadline is reached", () => {
    const { host, session, sync, passMulligan } = startMatch();
    passMulligan();
    const before = sync();
    expect(before.status).toBe("in_progress");

    host.clock = before.turnDeadlineAtMs! + 1;
    session.wake();

    const after = sync();
    expect(after.turnNumber).toBeGreaterThan(before.turnNumber);
    expect(after.activeSeat).not.toBe(before.activeSeat);
  });

  it("finalizes the match for the opponent when a reconnect window expires", () => {
    const { host, session, sync, passMulligan } = startMatch();
    passMulligan();

    session.markDisconnected("player1");
    const presence = host.lastPayload<{ seat: Seat; connected: boolean; reconnectUntilMs?: number }>("presence");
    expect(presence).toMatchObject({ seat: "player1", connected: false });
    expect(host.wakeAt).toBe(presence!.reconnectUntilMs);

    host.clock = presence!.reconnectUntilMs! + 1;
    session.wake();

    expect(host.completed).toBe(true);
    const result = sync().result;
    expect(result).toMatchObject({ reason: "disconnect_timeout", winnerSeat: "player2" });
  });
});

describe("GameSession seating + reconnect", () => {
  it("resolveSeat assigns free seats, recognises owners, and rejects a full room", () => {
    const host = new FakeHost();
    const session = new GameSession(host, { matchId: "seat-room" });

    expect(session.resolveSeat("sid-1")).toEqual({ seat: "player1", reconnect: false });
    session.setPlayer("player1", "sid-1", setup("Alice", "u-1"));
    // The same sessionId is now recognised as a reconnect on its own seat.
    expect(session.resolveSeat("sid-1")).toEqual({ seat: "player1", reconnect: true });
    expect(session.resolveSeat("sid-2")).toEqual({ seat: "player2", reconnect: false });
    session.setPlayer("player2", "sid-2", setup("Bob", "u-2"));
    expect(session.resolveSeat("sid-2")).toEqual({ seat: "player2", reconnect: true });
    // A third, unknown sessionId finds no seat.
    expect(session.resolveSeat("sid-3")).toBeNull();
  });

  it("restores a disconnected seat and spends its reconnect budget cumulatively", () => {
    const { host, passMulligan, session } = startMatch("rc-room");
    passMulligan();
    const t0 = host.clock;

    session.markDisconnected("player1");
    expect(host.lastPayload<{ connected: boolean }>("presence")?.connected).toBe(false);

    // Return 10s later (well within the 30s window).
    host.clock = t0 + 10_000;
    host.drain();
    session.markReconnected("player1");
    expect(host.lastPayload<{ seat: Seat; connected: boolean }>("presence")).toMatchObject({
      seat: "player1",
      connected: true
    });
    // Full state + private hand are resynced to the returning seat.
    expect(host.handFor("player1")?.cards).toHaveLength(3);

    // Drop again immediately: only the REMAINING 20s budget is granted (cumulative,
    // not reset) — this is the load-bearing reconnect-budget invariant.
    session.markDisconnected("player1");
    expect(host.lastPayload<{ reconnectUntilMs?: number }>("presence")?.reconnectUntilMs).toBe(host.clock + 20_000);
  });

  it("preserves reconnect budget + the disconnected seat across a snapshot round-trip", () => {
    const { host, passMulligan, session } = startMatch("hib-rc-room");
    passMulligan();
    const t0 = host.clock;
    session.markDisconnected("player1");

    const snapshot = JSON.parse(JSON.stringify(session.toSnapshot()));
    expect(snapshot.disconnectedAtMs.player1).toBe(t0);

    // Rehydrate in a fresh host 8s later and reconnect.
    const host2 = new FakeHost();
    host2.clock = t0 + 8_000;
    const restored = GameSession.fromSnapshot(host2, snapshot);
    restored.markReconnected("player1");

    // 8s of the 30s budget was spent → 22s recorded, disconnect timestamp cleared.
    const after = restored.toSnapshot();
    expect(after.reconnectBudgetMs.player1).toBe(22_000);
    expect(after.disconnectedAtMs.player1).toBeUndefined();
  });
});

describe("GameSession terminal completion", () => {
  it("finishes a PvP match on concede and reports PvP metadata to the finalize hook", () => {
    const { host, session, sync, seatActionSeq, passMulligan } = startMatch("concede-room");
    passMulligan();

    session.applyClientCommand("player1", {
      commandId: "give-up",
      expectedActionSeq: seatActionSeq(),
      command: { type: "concede" }
    });

    expect(session.isComplete()).toBe(true);
    expect(host.completed).toBe(true);
    // The finalize/reward hook receives PvP metadata (drives reward_summary + persistence).
    expect(host.completedMetadata?.isVsAi).toBe(false);
    expect(sync().result?.winnerSeat).toBe("player2");
  });
});

describe("GameSession persistence (hibernation)", () => {
  it("survives a JSON snapshot round-trip", () => {
    const { session, sync } = startMatch("snap-room");
    const statusBefore = sync().status;

    // Serialise exactly as DO storage would, to prove the snapshot is JSON-safe.
    const snapshot = JSON.parse(JSON.stringify(session.toSnapshot()));

    const host2 = new FakeHost();
    const restored = GameSession.fromSnapshot(host2, snapshot);
    expect(restored.matchId).toBe("snap-room");
    expect(restored.hasMatch()).toBe(true);

    // Resync a seat from the restored session and confirm it re-emits state + hand.
    restored.resync("player1");
    expect(host2.lastPayload<PublicSyncPayload>("publicSync")?.status).toBe(statusBefore);
    expect(host2.handFor("player1")?.cards).toHaveLength(3);
  });
});
