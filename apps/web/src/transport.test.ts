import { describe, expect, it } from "vitest";
import type { PublicGameState, PublicPlayer } from "@twcardgame/shared";
import { projectRealtimeState } from "./transport-state.js";

function player(displayName: string): PublicPlayer {
  return {
    userId: displayName.toLowerCase(),
    displayName,
    connected: true,
    hero: { hp: 30, maxHp: 30 },
    mana: { current: 1, max: 1 },
    handCount: 3,
    deckCount: 27,
    graveyardCount: 0,
    mulliganReady: false,
    board: [],
    amplification: { id: "amp-a", tier: "加減賺", name: "Amp A" },
    augments: [{ id: "amp-a", tier: "加減賺", name: "Amp A" }]
  };
}

describe("realtime transport state projection", () => {
  it("maps canonical PublicGameState into the existing UI schema shape", () => {
    const projected = projectRealtimeState({
      matchId: "match-1",
      schemaVersion: 1,
      cardCatalogVersion: "cards",
      status: "in_progress",
      phase: "VOTING_PHASE",
      turn: { activeSeat: "player2", number: 7, startedAtMs: 100, deadlineAtMs: 200, actionSeq: 3 },
      players: { player1: player("Alice"), player2: player("Bob") },
      pendingPrompt: { promptId: "prompt-1", seat: "player1", kind: "choice", sourceInstanceId: "s", validTargets: [] },
      specialPhase: {
        phaseDeadlineAtMs: 999,
        voteSubmitted: { player1: true, player2: false },
        voteWeights: { player1: 60, player2: 40 },
        voteEvents: [{ id: "vote-1", name: "Vote", options: ["A", "B", "C"] }]
      },
      result: { winnerSeat: "player1", reason: "hero_destroyed" },
      boardLimit: 3,
      activeEnvironment: { id: "env-1", name: "Field", remainingTurns: 2 }
    } satisfies PublicGameState);

    expect(projected.player1.displayName).toBe("Alice");
    expect(projected.player1.amplificationId).toBe("amp-a");
    expect(projected.pendingPromptId).toBe("prompt-1");
    expect(projected.specialPhase.voteEvents[0]).toMatchObject({ option0: "A", option1: "B", option2: "C" });
    expect(projected.specialPhase.voteWeightP1).toBe(60);
    expect(projected.resultWinnerSeat).toBe("player1");
    expect(projected.activeEnvironmentName).toBe("Field");
  });
});
