import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { createInitialMatch, type MatchState } from "@twcardgame/rules";
import { describe, expect, it, vi } from "vitest";
import { MatchResultFinalizer } from "./matchFinalizer.js";
import { buildMatchHistoryRow, createMatchResultPersistenceFromEnv, safePersistMatchResult, type MatchResultPersistence } from "./persistence.js";

describe("match result persistence", () => {
  it("is a no-op when Supabase env vars are missing", async () => {
    const persistence = createMatchResultPersistenceFromEnv({});
    expect(persistence.enabled).toBe(false);
    await expect(persistence.persist(finishedMatch())).resolves.toBeUndefined();
  });

  it("builds match history rows with only valid UUID player ids", () => {
    const state = finishedMatch();
    state.players.player1.userId = "550e8400-e29b-41d4-a716-446655440000";
    state.players.player2.userId = "not-a-uuid";

    const row = buildMatchHistoryRow(state, new Date("2026-05-17T00:00:00.000Z"));

    expect(row.id).toBe(state.matchId);
    expect(row.player1_user_id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(row.player2_user_id).toBeNull();
    expect(row.result_reason).toBe("concede");
    expect(row.final_state.result?.winnerSeat).toBe("player2");
  });

  it("records created_at from the match start time when provided", () => {
    const finishedAt = new Date("2026-05-17T00:08:32.000Z");
    const startedAtMs = Date.parse("2026-05-17T00:00:00.000Z");

    const withStart = buildMatchHistoryRow(finishedMatch(), finishedAt, { startedAtMs });
    expect(withStart.created_at).toBe("2026-05-17T00:00:00.000Z");
    expect(withStart.finished_at).toBe("2026-05-17T00:08:32.000Z");

    // No start time → leave created_at unset so the DB default (insert time) applies.
    const withoutStart = buildMatchHistoryRow(finishedMatch(), finishedAt);
    expect(withoutStart.created_at).toBeUndefined();
  });

  it("logs persistence failures without throwing", async () => {
    const warn = vi.fn();
    const persistence: MatchResultPersistence = {
      enabled: true,
      persist: async () => {
        throw new Error("db down");
      }
    };

    await expect(safePersistMatchResult(persistence, finishedMatch(), { warn })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("persists a completed match only once", async () => {
    const persist = vi.fn(async () => undefined);
    const finalizer = new MatchResultFinalizer({ enabled: true, persist });
    const state = finishedMatch();

    await finalizer.persistOnce(state);
    await finalizer.persistOnce(state);

    expect(persist).toHaveBeenCalledOnce();
  });
});

function finishedMatch(): MatchState {
  const state = createInitialMatch({
    matchId: "server-test-match",
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed: 123,
    nowMs: 1000,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: "p1", displayName: "P1", deckIds: legalDeckIds() },
      { seat: "player2", userId: "p2", displayName: "P2", deckIds: legalDeckIds() }
    ]
  }).state;
  state.status = "finished";
  state.result = { winnerSeat: "player2", reason: "concede" };
  return state;
}

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}
