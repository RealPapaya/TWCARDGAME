import { describe, expect, it } from "vitest";
import { CARD_CATALOG } from "@twcardgame/cards";
import type { GameEvent, PublicGameState, Seat } from "@twcardgame/shared";
import type { MatchState } from "@twcardgame/rules";
import { BotGameSession } from "./BotGameSession.js";
import { defaultDeckIds } from "./decks.js";
import { isDevTestAllowed } from "./devTest.js";
import type { PlayerSetup, SessionHost } from "./GameSession.js";
import type { MatchMetadata } from "./matchServices.js";
import type { ServerMessage } from "./protocol.js";
import { restoreSession } from "./restore.js";

const MINION_ID = CARD_CATALOG.find((card) => card.type === "MINION")!.id;

class FakeHost implements SessionHost {
  clock = 1_000_000;
  wakeAt: number | null = null;
  completed = false;
  completedMetadata?: MatchMetadata;
  captured: ServerMessage[] = [];

  now(): number {
    return this.clock;
  }
  sendToSeat(_seat: Seat, message: ServerMessage): void {
    this.captured.push(message);
  }
  broadcast(message: ServerMessage): void {
    this.captured.push(message);
  }
  scheduleWake(atMs: number | null): void {
    this.wakeAt = atMs;
  }
  onMatchComplete(_match: MatchState, metadata: MatchMetadata): void {
    this.completed = true;
    this.completedMetadata = metadata;
  }

  state(): PublicGameState | undefined {
    for (let i = this.captured.length - 1; i >= 0; i--) {
      if (this.captured[i].type === "state") return this.captured[i].payload as PublicGameState;
    }
    return undefined;
  }
  has(type: string): boolean {
    return this.captured.some((message) => message.type === type);
  }
}

function human(): PlayerSetup {
  return { userId: "human-1", displayName: "Human", deckIds: defaultDeckIds() };
}

describe("isDevTestAllowed", () => {
  it("allows a local request from the Vite origin", () => {
    const request = new Request("http://127.0.0.1:8787/pve/devtest", {
      method: "POST",
      headers: { origin: "http://localhost:5173" }
    });
    expect(isDevTestAllowed(request)).toBe(true);
  });

  it("allows a local request with no Origin header", () => {
    expect(isDevTestAllowed(new Request("http://localhost:8787/pve/devtest", { method: "POST" }))).toBe(true);
  });

  it("blocks a deployed (public) Worker URL", () => {
    const request = new Request("https://realtime.example.com/pve/devtest", {
      method: "POST",
      headers: { origin: "https://app.example.com" }
    });
    expect(isDevTestAllowed(request)).toBe(false);
  });

  it("blocks a remote Origin even on a local endpoint", () => {
    const request = new Request("http://localhost:8787/pve/devtest", {
      method: "POST",
      headers: { origin: "https://evil.example.com" }
    });
    expect(isDevTestAllowed(request)).toBe(false);
  });
});

describe("BotGameSession dev-test setup", () => {
  it("stamps the scripted board and starts in_progress (no mulligan)", () => {
    const host = new FakeHost();
    const session = new BotGameSession(host, {
      matchId: "pve-devtest",
      difficulty: "normal",
      devTest: {
        activeSeat: "player1",
        turnNumber: 5,
        playerHp: 12,
        opponentHp: 7,
        playerMana: { current: 8, max: 8 },
        playerBoardCardIds: [MINION_ID],
        opponentBoardCardIds: [MINION_ID, MINION_ID]
      }
    });

    session.setPlayer("player1", "human", human());

    const state = host.state();
    expect(state?.status).toBe("in_progress");
    expect(state?.turn.number).toBe(5);
    expect(state?.turn.activeSeat).toBe("player1");
    expect(state?.players.player1.hero.hp).toBe(12);
    expect(state?.players.player2.hero.hp).toBe(7);
    expect(state?.players.player1.mana).toMatchObject({ current: 8, max: 8 });
    expect(state?.players.player1.board).toHaveLength(1);
    expect(state?.players.player2.board).toHaveLength(2);
  });

  it("persists devTestActive across a hibernation snapshot round-trip", () => {
    const host = new FakeHost();
    const session = new BotGameSession(host, {
      matchId: "pve-devtest-snap",
      difficulty: "hard",
      devTest: { activeSeat: "player1" }
    });
    session.setPlayer("player1", "human", human());

    const snapshot = JSON.parse(JSON.stringify(session.toSnapshot()));
    expect(snapshot.extra.devTestActive).toBe(true);

    const restored = restoreSession(new FakeHost(), snapshot);
    expect(restored).toBeInstanceOf(BotGameSession);
    expect(JSON.parse(JSON.stringify(restored.toSnapshot())).extra.devTestActive).toBe(true);
  });

  it("skips finalize side-effects: completion metadata flags the match as dev-test", () => {
    const host = new FakeHost();
    const session = new BotGameSession(host, {
      matchId: "pve-devtest-finalize",
      difficulty: "normal",
      devTest: { activeSeat: "player1" }
    });
    session.setPlayer("player1", "human", human());
    expect(host.state()?.status).toBe("in_progress");

    // Drive the deterministic disconnect-timeout finalize path (no bot-AI / card
    // dependence): the human drops, the reconnect window expires, the match ends.
    // wake() checks the reconnect window first, so advancing well past the 30s
    // budget finalizes regardless of any armed bot-step alarm.
    session.markDisconnected("player1");
    host.clock += 60_000;
    session.wake();

    expect(session.isComplete()).toBe(true);
    expect(host.completed).toBe(true);
    expect(host.completedMetadata?.devTest).toBe(true);
    // The DO uses metadata.devTest to skip persistence/rewards, so no reward_summary.
    expect(host.has("reward_summary")).toBe(false);
  });

  it("a normal (non dev-test) PvE match is not flagged dev-test", () => {
    const host = new FakeHost();
    const session = new BotGameSession(host, { matchId: "pve-normal", difficulty: "normal" });
    session.setPlayer("player1", "human", human());
    expect(host.state()?.status).toBe("mulligan");

    session.markDisconnected("player1");
    host.clock += 60_000;
    session.wake();

    expect(host.completed).toBe(true);
    expect(host.completedMetadata?.devTest).toBeFalsy();
  });
});
