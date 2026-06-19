import { describe, expect, it } from "vitest";
import type { AmplificationOption, GameEvent, Seat } from "@twcardgame/shared";
import { BotGameSession } from "./BotGameSession.js";
import { defaultDeckIds } from "./decks.js";
import type { PlayerSetup, SessionHost } from "./GameSession.js";
import type { PublicSyncPayload, ServerMessage } from "./protocol.js";
import { restoreSession } from "./restore.js";

class FakeHost implements SessionHost {
  clock = 1_000_000;
  wakeAt: number | null = null;
  completed = false;
  events: GameEvent[] = [];
  /** Latest private amplification options offered to player1 (the human under test). */
  p1AmpOptions: AmplificationOption[] = [];
  private captured: ServerMessage[] = [];

  now(): number {
    return this.clock;
  }
  sendToSeat(seat: Seat, message: ServerMessage): void {
    if (seat === "player1" && message.type === "amplificationOptions") {
      this.p1AmpOptions = message.payload.options;
    }
    this.record(message);
  }
  broadcast(message: ServerMessage): void {
    this.record(message);
  }
  scheduleWake(atMs: number | null): void {
    this.wakeAt = atMs;
  }
  onMatchComplete(): void {
    this.completed = true;
  }

  private record(message: ServerMessage): void {
    this.captured.push(message);
    if (message.type === "events") this.events.push(...message.payload);
  }
  sync(): PublicSyncPayload | undefined {
    for (let i = this.captured.length - 1; i >= 0; i--) {
      if (this.captured[i].type === "publicSync") return this.captured[i].payload as PublicSyncPayload;
    }
    return undefined;
  }
}

function human(): PlayerSetup {
  return { userId: "human-1", displayName: "Human", deckIds: defaultDeckIds() };
}

/** Drive a PvE match: advance to each pending alarm; otherwise auto-act for the human. */
function drive(host: FakeHost, session: BotGameSession, maxSteps = 4000): number {
  let steps = 0;
  while (!session.isComplete() && steps < maxSteps) {
    steps++;
    if (host.wakeAt !== null) {
      host.clock = host.wakeAt + 1;
      session.wake();
      continue;
    }
    const sync = host.sync();
    if (!sync) break;
    const cmd = { commandId: `h-${steps}`, expectedActionSeq: sync.actionSeq };
    if (sync.status === "mulligan") {
      session.applyClientCommand("player1", { ...cmd, command: { type: "submitMulligan", replaceHandInstanceIds: [] } });
    } else if (sync.phase === "AMPLIFICATION_PHASE") {
      // A real client must pick an offered option id (empty id is only the
      // server-timeout default); take the first option the session offered us.
      const optionId = host.p1AmpOptions[0]?.id ?? "";
      session.applyClientCommand("player1", { ...cmd, command: { type: "selectAmplification", optionId } });
    } else if (sync.phase === "VOTING_PHASE") {
      session.applyClientCommand("player1", { ...cmd, command: { type: "submitVote", optionIndex: 0 } });
    } else if (sync.status === "in_progress" && sync.activeSeat === "player1") {
      session.applyClientCommand("player1", { ...cmd, command: { type: "endTurn" } });
    } else {
      break; // no pending alarm and nothing for the human to do — stuck
    }
  }
  return steps;
}

describe("BotGameSession (PvE)", () => {
  it("pre-fills the bot seat and starts + auto-mulligans on the human's join", () => {
    const host = new FakeHost();
    const session = new BotGameSession(host, { matchId: "pve-room", difficulty: "normal" });

    // The lone human's join is enough to create the match (bot is player2).
    const created = session.setPlayer("player1", "human", human());
    expect(created).toBe(true);
    expect(session.hasMatch()).toBe(true);
    expect(host.sync()?.status).toBe("mulligan");

    // A bot step (its mulligan) is armed on the single alarm.
    expect(host.wakeAt).not.toBeNull();
    host.clock = host.wakeAt! + 1;
    session.wake();
    expect(host.sync()?.players.player2.mulliganReady).toBe(true);

    expect(session.botInfo).toMatchObject({ seat: "player2", difficulty: "normal" });
  });

  it("plays a full game against a passive human and finishes (bot wins)", () => {
    const host = new FakeHost();
    const session = new BotGameSession(host, { matchId: "pve-full", difficulty: "normal" });
    session.setPlayer("player1", "human", human());

    const steps = drive(host, session);

    expect(session.isComplete()).toBe(true);
    expect(host.completed).toBe(true);
    expect(steps).toBeLessThan(4000);
    const result = host.sync()?.result;
    expect(result?.reason).toBe("hero_destroyed");
    expect(result?.winnerSeat).toBe("player2");
    // The bot actually played: it summoned minions / attacked along the way.
    expect(host.events.some((e) => e.seat === "player2" && (e.type === "MINION_SUMMONED" || e.type === "ATTACK"))).toBe(true);
  });

  it("round-trips through restoreSession as a PvE session and keeps playing", () => {
    const host = new FakeHost();
    const session = new BotGameSession(host, { matchId: "pve-snap", difficulty: "hard", theme: "kmt" });
    session.setPlayer("player1", "human", human());
    // The bot's first step (its mulligan) is armed on the alarm — capture it: in
    // the real DO the storage alarm persists across hibernation independently of
    // the session snapshot.
    const persistedAlarm = host.wakeAt;
    expect(persistedAlarm).not.toBeNull();

    const snapshot = JSON.parse(JSON.stringify(session.toSnapshot()));
    expect(snapshot.kind).toBe("pve");
    expect(snapshot.extra.botRng).toBeDefined();

    const host2 = new FakeHost();
    host2.clock = host.clock;
    host2.wakeAt = persistedAlarm; // the surviving storage alarm
    const restored = restoreSession(host2, snapshot);
    expect(restored).toBeInstanceOf(BotGameSession);
    expect(restored.hasMatch()).toBe(true);

    // The restored PvE session can be driven to completion.
    drive(host2, restored as BotGameSession);
    expect(restored.isComplete()).toBe(true);
  });
});
