import { describe, expect, it } from "vitest";
import {
  computeMatchStats,
  formatDuration,
  matchDurationMs,
  matchKind,
  matchLengthLabel,
  matchOutcome,
  matchTurns,
  matchTypeLabel,
  opponentLabel,
  overallMatchStats
} from "./match-history.js";
import type { MatchHistoryRow } from "./types.js";

const ME = "11111111-1111-1111-1111-111111111111";
const FOE = "22222222-2222-2222-2222-222222222222";

function row(overrides: Partial<MatchHistoryRow> = {}): MatchHistoryRow {
  return {
    id: "m1",
    result_reason: "concede",
    player1_user_id: ME,
    player2_user_id: FOE,
    winner_seat: "player1",
    ...overrides
  };
}

describe("matchKind", () => {
  it("classifies PvP vs PvE from is_vs_ai", () => {
    expect(matchKind(row({ is_vs_ai: false }))).toBe("pvp");
    expect(matchKind(row({ is_vs_ai: true }))).toBe("pve");
    expect(matchKind(row({ is_vs_ai: null }))).toBe("pvp");
    expect(matchKind(row({}))).toBe("pvp");
  });
});

describe("matchOutcome", () => {
  it("reads outcome from the viewer's seat", () => {
    expect(matchOutcome(row({ winner_seat: "player1" }), ME)).toBe("win");
    expect(matchOutcome(row({ winner_seat: "player2" }), ME)).toBe("loss");
    expect(matchOutcome(row({ winner_seat: null }), ME)).toBe("draw");
  });

  it("treats the human as the winner when they sat in player2", () => {
    const r = row({ player1_user_id: FOE, player2_user_id: ME, winner_seat: "player2" });
    expect(matchOutcome(r, ME)).toBe("win");
  });

  it("is a draw when the viewer was not a participant", () => {
    expect(matchOutcome(row({ winner_seat: "player1" }), "someone-else")).toBe("draw");
  });
});

describe("computeMatchStats", () => {
  const rows: MatchHistoryRow[] = [
    row({ id: "a", is_vs_ai: false, winner_seat: "player1" }), // pvp win
    row({ id: "b", is_vs_ai: false, winner_seat: "player2" }), // pvp loss
    row({ id: "c", is_vs_ai: false, winner_seat: null }), // pvp draw
    row({ id: "d", is_vs_ai: true, player2_user_id: null, winner_seat: "player1" }), // pve win
    row({ id: "e", is_vs_ai: true, player2_user_id: null, winner_seat: "player2" }) // pve loss
  ];

  it("tallies only the requested kind", () => {
    expect(computeMatchStats(rows, ME, "pvp")).toEqual({ wins: 1, losses: 1, draws: 1, total: 3 });
    expect(computeMatchStats(rows, ME, "pve")).toEqual({ wins: 1, losses: 1, draws: 0, total: 2 });
  });

  it("returns zeros for an empty history", () => {
    expect(computeMatchStats([], ME, "pvp")).toEqual({ wins: 0, losses: 0, draws: 0, total: 0 });
  });

  it("overallMatchStats sums across both kinds", () => {
    expect(overallMatchStats(rows, ME)).toEqual({ wins: 2, losses: 2, draws: 1, total: 5 });
  });
});

describe("matchTypeLabel", () => {
  it("labels PvP and PvE (with difficulty) in Chinese", () => {
    expect(matchTypeLabel(row({ is_vs_ai: false }))).toBe("玩家對戰");
    expect(matchTypeLabel(row({ is_vs_ai: true, ai_difficulty: "hard" }))).toBe("電腦對戰 · 困難");
    expect(matchTypeLabel(row({ is_vs_ai: true, ai_difficulty: null }))).toBe("電腦對戰");
  });
});

describe("opponentLabel", () => {
  it("uses the AI persona name for PvE", () => {
    expect(opponentLabel(row({ is_vs_ai: true, ai_theme: "dpp" }), ME)).toBe("賴清德");
    expect(opponentLabel(row({ is_vs_ai: true, ai_theme: null }), ME)).toBe("電腦 AI");
  });

  it("uses the other player's display name for PvP", () => {
    const r = row({
      is_vs_ai: false,
      players_view: { player1: { displayName: "我" }, player2: { displayName: "對方玩家" } }
    });
    expect(opponentLabel(r, ME)).toBe("對方玩家");
  });

  it("falls back to a generic label when the name is unknown", () => {
    expect(opponentLabel(row({ is_vs_ai: false, players_view: null }), ME)).toBe("對手");
  });
});

describe("duration", () => {
  it("formats mm:ss and h:mm:ss", () => {
    expect(formatDuration(512_000)).toBe("08:32");
    expect(formatDuration(3_600_000 + 8 * 60_000 + 32_000)).toBe("1:08:32");
  });

  it("returns real elapsed ms for new rows", () => {
    const r = row({
      created_at: "2026-06-11T14:11:28.000Z",
      finished_at: "2026-06-11T14:20:00.000Z"
    });
    expect(matchDurationMs(r)).toBe(512_000);
    expect(matchLengthLabel({ ...r, turn_view: { number: 12 } })).toBe("08:32 · 12 回合");
  });

  it("treats legacy near-zero spans as having no duration", () => {
    const r = row({
      created_at: "2026-06-11T14:20:00.000Z",
      finished_at: "2026-06-11T14:20:00.400Z",
      turn_view: { number: 9 }
    });
    expect(matchDurationMs(r)).toBeNull();
    expect(matchLengthLabel(r)).toBe("9 回合");
  });

  it("recovers turn count from string or number, and shows — when nothing is known", () => {
    expect(matchTurns(row({ turn_view: { number: "12" } }))).toBe(12);
    expect(matchTurns(row({ turn_view: { number: 0 } }))).toBeNull();
    expect(matchLengthLabel(row({}))).toBe("—");
  });
});
