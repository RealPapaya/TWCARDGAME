import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { createInitialMatch, type MatchState } from "@twcardgame/rules";
import type { GameEvent, Seat } from "@twcardgame/shared";
import type { EmitUserEventInput } from "@twcardgame/db";
import { describe, expect, it, vi } from "vitest";
import { aggregateMatchStats, createTaskEventsWithEmit, noopTaskEvents } from "./taskEvents.js";

const HUMAN_USER_1 = "11111111-1111-4111-8111-111111111111";
const HUMAN_USER_2 = "22222222-2222-4222-8222-222222222222";
const BOT_USER = "bot-room-xyz";

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

function finishedMatch(opts: { winnerSeat: Seat; player1UserId?: string; player2UserId?: string }): MatchState {
  const state = createInitialMatch({
    matchId: "550e8400-e29b-41d4-a716-446655440000",
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed: 1,
    nowMs: 1,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: opts.player1UserId ?? HUMAN_USER_1, displayName: "P1", deckIds: legalDeckIds() },
      { seat: "player2", userId: opts.player2UserId ?? HUMAN_USER_2, displayName: "P2", deckIds: legalDeckIds() }
    ]
  }).state;
  state.status = "finished";
  state.result = { winnerSeat: opts.winnerSeat, reason: "hero_destroyed" };
  return state;
}

function recordingEmit() {
  const calls: EmitUserEventInput[] = [];
  const emit = vi.fn(async (input: EmitUserEventInput) => {
    calls.push(input);
  });
  return { emit, calls };
}

function eventTypesFor(calls: EmitUserEventInput[], userId: string): string[] {
  return calls.filter((c) => c.userId === userId).map((c) => c.eventType);
}

function ev(type: GameEvent["type"], seat: Seat | undefined, payload?: Record<string, unknown>): GameEvent {
  return { seq: 0, type, seat, payload };
}

describe("createTaskEventsWithEmit", () => {
  it("PvP win: winner gets match_played + match_won, no pve_win; loser gets only match_played", async () => {
    const state = finishedMatch({ winnerSeat: "player1" });
    const { emit, calls } = recordingEmit();
    await createTaskEventsWithEmit(emit).emitForMatch(state, { isVsAi: false });

    expect(eventTypesFor(calls, HUMAN_USER_1)).toEqual(["match_played", "match_won"]);
    expect(eventTypesFor(calls, HUMAN_USER_2)).toEqual(["match_played"]);
    expect(calls.some((c) => c.eventType === "pve_win")).toBe(false);
    // mode flows through metadata for analytics.
    expect(calls.find((c) => c.eventType === "match_played")?.metadata).toMatchObject({ mode: "pvp" });
  });

  it("PvE win: winner gets match_played + match_won + pve_win; bot seat gets nothing", async () => {
    const state = finishedMatch({ winnerSeat: "player1", player2UserId: BOT_USER });
    const { emit, calls } = recordingEmit();
    await createTaskEventsWithEmit(emit).emitForMatch(state, {
      isVsAi: true,
      aiTheme: "dpp",
      aiDifficulty: "normal"
    });

    expect(eventTypesFor(calls, HUMAN_USER_1)).toEqual(["match_played", "match_won", "pve_win"]);
    expect(calls.some((c) => c.userId === BOT_USER)).toBe(false);
  });

  it("emits aggregated per-seat stats from the event log (winner side)", async () => {
    const state = finishedMatch({ winnerSeat: "player1", player2UserId: BOT_USER });
    state.private.eventLog.push(
      ev("CARD_PLAYED", "player1"),
      ev("CARD_PLAYED", "player1"),
      ev("CARD_PLAYED", "player1"),
      ev("MINION_SUMMONED", "player1"),
      ev("MINION_SUMMONED", "player1"),
      ev("DAMAGE", "player2", { target: "player2:hero", amount: 5 }),
      ev("DAMAGE", "player2", { target: "player2:hero", amount: 7 }),
      ev("DAMAGE", "player1", { target: "player1:hero", amount: 2, payment: "HEALTH", lifeLoss: true })
    );
    const { emit, calls } = recordingEmit();
    await createTaskEventsWithEmit(emit).emitForMatch(state, { isVsAi: true });

    const byType = new Map(calls.filter((c) => c.userId === HUMAN_USER_1).map((c) => [c.eventType, c]));
    expect(byType.get("cards_played")?.amount).toBe(3);
    expect(byType.get("minions_summoned")?.amount).toBe(2);
    // 5 + 7 dealt to the enemy hero; the self health-payment is excluded.
    expect(byType.get("damage_dealt")?.amount).toBe(12);
  });

  it("omits zero-valued stat events", async () => {
    const state = finishedMatch({ winnerSeat: "player1", player2UserId: BOT_USER });
    // No gameplay events logged → no stat events.
    const { emit, calls } = recordingEmit();
    await createTaskEventsWithEmit(emit).emitForMatch(state, { isVsAi: true });
    expect(calls.some((c) => ["cards_played", "minions_summoned", "damage_dealt"].includes(c.eventType))).toBe(false);
  });

  it("isolates a failing emit per seat and logs a warning", async () => {
    const state = finishedMatch({ winnerSeat: "player1" });
    const emit = vi.fn(async () => {
      throw new Error("emit boom");
    });
    const warn = vi.fn();
    await createTaskEventsWithEmit(emit, { warn }).emitForMatch(state, { isVsAi: false });
    // Both human seats attempted; both failures caught and logged.
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("noopTaskEvents", () => {
  it("resolves without emitting", async () => {
    const state = finishedMatch({ winnerSeat: "player1" });
    await expect(noopTaskEvents.emitForMatch(state, { isVsAi: false })).resolves.toBeUndefined();
    expect(noopTaskEvents.enabled).toBe(false);
  });
});

describe("aggregateMatchStats", () => {
  it("counts cards/summons by acting seat and credits enemy-hero damage to the dealer", () => {
    const log: GameEvent[] = [
      ev("CARD_PLAYED", "player1"),
      ev("CARD_PLAYED", "player1"),
      ev("CARD_PLAYED", "player2"),
      ev("MINION_SUMMONED", "player1"),
      ev("DAMAGE", "player2", { target: "player2:hero", amount: 5 }), // player1 → p2 hero
      ev("DAMAGE", "player2", { target: "player2:hero", amount: 7 }), // player1 → p2 hero
      ev("DAMAGE", "player1", { target: "player1:hero", amount: 4 }), // player2 → p1 hero
      ev("DAMAGE", "player1", { target: "player1:hero", amount: 2, payment: "HEALTH", lifeLoss: true }), // self, excluded
      ev("DAMAGE", "player2", { target: "minion-instance-1", amount: 9 }) // minion dmg, not attributed
    ];
    const stats = aggregateMatchStats(log);
    expect(stats.player1).toEqual({ cardsPlayed: 2, minionsSummoned: 1, damageDealt: 12 });
    expect(stats.player2).toEqual({ cardsPlayed: 1, minionsSummoned: 0, damageDealt: 4 });
  });
});
