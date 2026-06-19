import { describe, expect, it } from "vitest";
import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { createInitialMatch, type MatchState } from "@twcardgame/rules";
import type { GameEvent, RewardSummary, Seat } from "@twcardgame/shared";
import {
  aggregateMatchStats,
  buildMatchHistoryRow,
  createLocalMatchServices,
  emitTaskEvents,
  grantForMatch,
  isHumanUser,
  type MatchLogger,
  type MatchMetadata
} from "./matchServices.js";

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const PVP: MatchMetadata = { isVsAi: false, startedAtMs: 1000 };
const PVE: MatchMetadata = { isVsAi: true, aiDifficulty: "normal", aiTheme: "kmt", startedAtMs: 1000 };
const silent: MatchLogger = { warn: () => {} };

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

function finishedMatch(opts: { p1: string; p2: string; winner: Seat }): MatchState {
  const state = createInitialMatch({
    matchId: "ms-test",
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed: 7,
    nowMs: 1000,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: opts.p1, displayName: "P1", deckIds: legalDeckIds() },
      { seat: "player2", userId: opts.p2, displayName: "P2", deckIds: legalDeckIds() }
    ]
  }).state;
  state.status = "finished";
  state.result = { winnerSeat: opts.winner, reason: "hero_destroyed" };
  state.turn.number = 8;
  return state;
}

function samplePayload(): Omit<RewardSummary, "result"> & { idempotent: boolean } {
  return {
    mode: "pvp",
    source: "pvp",
    aiTheme: null,
    aiDifficulty: null,
    xp: { before: 0, after: 10, gained: 10 },
    level: { before: 1, after: 1 },
    levelUps: [],
    gold: { before: 0, after: 40, gained: 40, breakdown: {} },
    idempotent: false
  };
}

describe("isHumanUser", () => {
  it("accepts UUIDs and rejects dev / bot ids", () => {
    expect(isHumanUser(UUID_1)).toBe(true);
    expect(isHumanUser("u-1")).toBe(false);
    expect(isHumanUser("bot-room")).toBe(false);
    expect(isHumanUser(undefined)).toBe(false);
  });
});

describe("createLocalMatchServices (no backend)", () => {
  it("returns server-authoritative zero summaries flagged rewards_disabled", async () => {
    const services = createLocalMatchServices();
    expect(services.persistsRemotely).toBe(false);

    const summaries = await services.finalize(finishedMatch({ p1: UUID_1, p2: UUID_2, winner: "player1" }), PVP);
    const winner = summaries.get("player1")!;
    expect(winner.result).toBe("win");
    expect(winner.diagnostic).toBe("rewards_disabled");
    expect(winner.gold.gained).toBe(0);
    expect(winner.xp.gained).toBe(0);

    const loser = summaries.get("player2")!;
    expect(loser.result).toBe("loss");
    // Diagnostic is attached only to the winner (mirrors the server's zeroSummary).
    expect(loser.diagnostic).toBeUndefined();
  });
});

describe("grantForMatch", () => {
  it("rewards both PvP humans with winner XP/gold and loser gold", async () => {
    const calls: Array<{ userId: string; pvpXp?: number; pvpGold?: number; mode: string }> = [];
    const apply = async (input: { userId: string; pvpXp?: number; pvpGold?: number; mode: "pvp" | "pve" }) => {
      calls.push(input);
      return samplePayload();
    };

    const summaries = await grantForMatch(apply, finishedMatch({ p1: UUID_1, p2: UUID_2, winner: "player1" }), PVP, silent);
    expect(summaries.get("player1")!.result).toBe("win");
    expect(summaries.get("player2")!.result).toBe("loss");
    expect(calls).toHaveLength(2);

    const winnerCall = calls.find((c) => c.userId === UUID_1)!;
    expect(winnerCall.mode).toBe("pvp");
    expect(winnerCall.pvpXp).toBeGreaterThan(0);
    expect(winnerCall.pvpGold).toBeGreaterThan(0);

    const loserCall = calls.find((c) => c.userId === UUID_2)!;
    expect(loserCall.pvpXp).toBe(0);
    expect(loserCall.pvpGold).toBeGreaterThan(0); // loser still gets the consolation gold
  });

  it("PvE only rewards a human winner and skips the bot seat", async () => {
    const calls: Array<{ userId: string }> = [];
    const apply = async (input: { userId: string }) => {
      calls.push(input);
      return samplePayload();
    };

    const summaries = await grantForMatch(apply, finishedMatch({ p1: UUID_1, p2: "bot-x", winner: "player1" }), PVE, silent);
    expect(calls).toHaveLength(1);
    expect(calls[0].userId).toBe(UUID_1);
    expect(summaries.get("player2")!.gold.gained).toBe(0); // bot → zero summary, no RPC
  });

  it("PvE human loss grants nothing", async () => {
    const calls: unknown[] = [];
    const apply = async (input: unknown) => {
      calls.push(input);
      return samplePayload();
    };
    await grantForMatch(apply, finishedMatch({ p1: UUID_1, p2: "bot-x", winner: "player2" }), PVE, silent);
    expect(calls).toHaveLength(0);
  });

  it("falls back to a zeroSummary (rpc_failed) when the RPC throws", async () => {
    const apply = async () => {
      throw new Error("rpc down");
    };
    const summaries = await grantForMatch(apply, finishedMatch({ p1: UUID_1, p2: UUID_2, winner: "player1" }), PVP, silent);
    expect(summaries.get("player1")!.diagnostic).toBe("rpc_failed");
    expect(summaries.get("player1")!.gold.gained).toBe(0);
  });
});

describe("buildMatchHistoryRow", () => {
  it("maps result + ai metadata and nulls non-UUID seats", () => {
    const row = buildMatchHistoryRow(finishedMatch({ p1: UUID_1, p2: "bot-x", winner: "player1" }), new Date(5000), PVE);
    expect(row.id).toBe("ms-test");
    expect(row.winner_seat).toBe("player1");
    expect(row.result_reason).toBe("hero_destroyed");
    expect(row.is_vs_ai).toBe(true);
    expect(row.ai_difficulty).toBe("normal");
    expect(row.player1_user_id).toBe(UUID_1);
    expect(row.player2_user_id).toBeNull(); // bot id is not a UUID
    expect(row.created_at).toBe(new Date(1000).toISOString());
    expect(row.finished_at).toBe(new Date(5000).toISOString());
  });
});

describe("emitTaskEvents", () => {
  it("emits played/won for the winner and played/lost for the loser (humans only)", async () => {
    const events: Array<{ userId: string; eventType: string }> = [];
    await emitTaskEvents(async (input) => {
      events.push(input);
    }, finishedMatch({ p1: UUID_1, p2: UUID_2, winner: "player1" }), PVP, silent);

    const winnerTypes = events.filter((e) => e.userId === UUID_1).map((e) => e.eventType);
    expect(winnerTypes).toContain("match_played");
    expect(winnerTypes).toContain("match_won");

    const loserTypes = events.filter((e) => e.userId === UUID_2).map((e) => e.eventType);
    expect(loserTypes).toContain("match_played");
    expect(loserTypes).toContain("match_lost");
  });

  it("skips non-human seats entirely", async () => {
    const events: Array<{ userId: string }> = [];
    await emitTaskEvents(async (input) => {
      events.push(input);
    }, finishedMatch({ p1: UUID_1, p2: "bot-x", winner: "player1" }), PVE, silent);
    expect(events.every((e) => e.userId === UUID_1)).toBe(true);
  });
});

describe("aggregateMatchStats", () => {
  it("credits combat stats from the authoritative event log", () => {
    const log = [
      { seq: 1, type: "CARD_PLAYED", seat: "player1", payload: {} },
      { seq: 2, type: "MINION_SUMMONED", seat: "player1", payload: {} },
      // Damage to player2's hero is credited to its opponent (player1).
      { seq: 3, type: "DAMAGE", seat: "player2", payload: { target: "player2:hero", amount: 5 } },
      // Self-inflicted health payment is excluded.
      { seq: 4, type: "DAMAGE", seat: "player1", payload: { target: "player1:hero", amount: 2, payment: "HEALTH" } },
      // A destroyed player2 minion is a player1 kill.
      { seq: 5, type: "DESTROY", seat: "player2", payload: {} },
      { seq: 6, type: "HEAL", seat: "player1", payload: { amount: 3 } }
    ] as unknown as GameEvent[];

    const stats = aggregateMatchStats(log);
    expect(stats.player1.cardsPlayed).toBe(1);
    expect(stats.player1.minionsSummoned).toBe(1);
    expect(stats.player1.damageDealt).toBe(5);
    expect(stats.player1.minionsKilled).toBe(1);
    expect(stats.player1.healthRestored).toBe(3);
    // The HEALTH-payment self damage must not count as dealt damage.
    expect(stats.player2.damageDealt).toBe(0);
  });
});
