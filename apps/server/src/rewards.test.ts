import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { createInitialMatch, type MatchState } from "@twcardgame/rules";
import { calculatePvPExp, calculatePvPGold, type Seat } from "@twcardgame/shared";
import { describe, expect, it, vi } from "vitest";
import type { ApplyMatchRewardsInput } from "@twcardgame/db";
import { createMatchRewardsWithClient, isHumanUser, noopMatchRewards } from "./rewards.js";

const HUMAN_USER_1 = "11111111-1111-4111-8111-111111111111";
const HUMAN_USER_2 = "22222222-2222-4222-8222-222222222222";
const BOT_USER = "bot-room-xyz";

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

function finishedMatch(opts: {
  winnerSeat: Seat;
  player1UserId?: string;
  player2UserId?: string;
  winnerHp?: number;
  turnNumber?: number;
}): MatchState {
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
  if (opts.winnerHp !== undefined) state.players[opts.winnerSeat].hero.hp = opts.winnerHp;
  if (opts.turnNumber !== undefined) state.turn.number = opts.turnNumber;
  return state;
}

interface RecordedCall {
  input: ApplyMatchRewardsInput;
}

function makeRpc(handler: (input: ApplyMatchRewardsInput) => Record<string, unknown>) {
  const calls: RecordedCall[] = [];
  const rpc = vi.fn(async (input: ApplyMatchRewardsInput) => {
    calls.push({ input });
    const raw = handler(input);
    return raw as Awaited<ReturnType<typeof import("@twcardgame/db").applyMatchRewards>>;
  });
  return { rpc, calls };
}

describe("isHumanUser", () => {
  it("accepts a UUID", () => {
    expect(isHumanUser(HUMAN_USER_1)).toBe(true);
  });
  it("rejects bot-style ids and falsy values", () => {
    expect(isHumanUser(BOT_USER)).toBe(false);
    expect(isHumanUser(undefined)).toBe(false);
    expect(isHumanUser("")).toBe(false);
  });
});

describe("noopMatchRewards", () => {
  it("returns zero summaries without calling any RPC", async () => {
    const state = finishedMatch({ winnerSeat: "player1" });
    const result = await noopMatchRewards.grantForMatch(state, { isVsAi: false });
    expect(result.get("player1")?.result).toBe("win");
    expect(result.get("player1")?.xp.gained).toBe(0);
    expect(result.get("player1")?.diagnostic).toBe("rewards_disabled");
    expect(result.get("player2")?.result).toBe("loss");
    expect(result.get("player2")?.diagnostic).toBeUndefined();
  });
});

describe("createMatchRewardsWithClient", () => {
  it("PvE first-victory: calls RPC for winner only, passes theme+difficulty, returns shaped summary", async () => {
    const state = finishedMatch({
      winnerSeat: "player1",
      player2UserId: BOT_USER
    });
    const { rpc, calls } = makeRpc(() => ({
      mode: "pve",
      source: "pve_first",
      aiTheme: "dpp",
      aiDifficulty: "normal",
      xp: { before: 0, after: 70, gained: 100 },
      level: { before: 1, after: 4 },
      levelUps: [
        { level: 2, goldAwarded: 100 },
        { level: 3, goldAwarded: 100 },
        { level: 4, goldAwarded: 100 }
      ],
      gold: {
        before: 100,
        after: 600,
        gained: 500,
        breakdown: { firstVictory: 200, levelUps: 300 }
      },
      idempotent: false
    }));
    const dispatcher = createMatchRewardsWithClient(rpc);
    const summaries = await dispatcher.grantForMatch(state, {
      isVsAi: true,
      aiTheme: "dpp",
      aiDifficulty: "normal"
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(calls[0]!.input).toMatchObject({
      userId: HUMAN_USER_1,
      mode: "pve",
      aiTheme: "dpp",
      aiDifficulty: "normal",
      pvpXp: 0
    });
    const winner = summaries.get("player1")!;
    expect(winner.result).toBe("win");
    expect(winner.source).toBe("pve_first");
    expect(winner.levelUps).toHaveLength(3);
    expect(winner.gold.breakdown.firstVictory).toBe(200);
    const loser = summaries.get("player2")!;
    expect(loser.result).toBe("loss");
    expect(loser.xp.gained).toBe(0);
  });

  it("PvE repeat-victory: source = pve_repeat, no first-victory gold", async () => {
    const state = finishedMatch({
      winnerSeat: "player1",
      player2UserId: BOT_USER
    });
    const { rpc } = makeRpc(() => ({
      mode: "pve",
      source: "pve_repeat",
      aiTheme: "kmt",
      aiDifficulty: "hard",
      xp: { before: 50, after: 75, gained: 25 },
      level: { before: 5, after: 5 },
      levelUps: [],
      gold: { before: 500, after: 500, gained: 0, breakdown: {} },
      idempotent: false
    }));
    const dispatcher = createMatchRewardsWithClient(rpc);
    const summaries = await dispatcher.grantForMatch(state, {
      isVsAi: true,
      aiTheme: "kmt",
      aiDifficulty: "hard"
    });
    const winner = summaries.get("player1")!;
    expect(winner.source).toBe("pve_repeat");
    expect(winner.gold.gained).toBe(0);
    expect(winner.levelUps).toHaveLength(0);
  });

  it("PvP: calls RPC for both players; winner gets pvpXp and winnerGold, loser gets loserGold", async () => {
    const state = finishedMatch({ winnerSeat: "player2", winnerHp: 21, turnNumber: 8 });
    const expectedXp = calculatePvPExp(21, 8); // = 8 + floor((21/30)*4)=2 + 2 = 12
    // In the test state, the loser's hp is still 30 (finishedMatch only sets winnerHp).
    // The real game would have loser at ≤0, but reward.ts reads whatever hp is on state.
    const { winnerGold, loserGold } = calculatePvPGold(21, 30, 8);
    const { rpc, calls } = makeRpc((input) => ({
      mode: "pvp",
      source: "pvp",
      aiTheme: null,
      aiDifficulty: null,
      xp: { before: 10, after: 10 + input.pvpXp!, gained: input.pvpXp! },
      level: { before: 2, after: 2 },
      levelUps: [],
      gold: { before: 200, after: 200 + input.pvpGold!, gained: input.pvpGold!, breakdown: { matchWin: input.pvpGold } },
      idempotent: false
    }));
    const dispatcher = createMatchRewardsWithClient(rpc);
    const summaries = await dispatcher.grantForMatch(state, { isVsAi: false });
    expect(rpc).toHaveBeenCalledTimes(2);
    // winner call
    const winnerCall = calls.find((c) => c.input.userId === HUMAN_USER_2)!;
    expect(winnerCall.input.mode).toBe("pvp");
    expect(winnerCall.input.pvpXp).toBe(expectedXp);
    expect(winnerCall.input.pvpGold).toBe(winnerGold);
    // loser call
    const loserCall = calls.find((c) => c.input.userId === HUMAN_USER_1)!;
    expect(loserCall.input.pvpXp).toBe(0);
    expect(loserCall.input.pvpGold).toBe(loserGold);
    const winner = summaries.get("player2")!;
    expect(winner.result).toBe("win");
    expect(winner.source).toBe("pvp");
    expect(winner.xp.gained).toBe(expectedXp);
    const loser = summaries.get("player1")!;
    expect(loser.result).toBe("loss");
    expect(loser.gold.gained).toBe(loserGold);
  });

  it("falls back to zero summary if the RPC throws and logs the failure", async () => {
    const state = finishedMatch({ winnerSeat: "player1", player2UserId: BOT_USER });
    const rpc = vi.fn(async () => {
      throw new Error("rpc boom");
    });
    const warn = vi.fn();
    const dispatcher = createMatchRewardsWithClient(rpc as never, { warn });
    const summaries = await dispatcher.grantForMatch(state, {
      isVsAi: true,
      aiTheme: "dpp",
      aiDifficulty: "easy"
    });
    expect(warn).toHaveBeenCalledOnce();
    const winner = summaries.get("player1")!;
    expect(winner.result).toBe("win");
    expect(winner.source).toBe("none");
    expect(winner.xp.gained).toBe(0);
    expect(winner.diagnostic).toBe("rpc_failed");
  });

  it("never calls the RPC for a bot opponent's seat", async () => {
    const state = finishedMatch({ winnerSeat: "player2", player2UserId: BOT_USER });
    const { rpc } = makeRpc(() => {
      throw new Error("should not be invoked");
    });
    const dispatcher = createMatchRewardsWithClient(rpc);
    const summaries = await dispatcher.grantForMatch(state, {
      isVsAi: true,
      aiTheme: "dpp",
      aiDifficulty: "normal"
    });
    expect(rpc).not.toHaveBeenCalled();
    // Both seats get a summary, but the bot seat's summary is never delivered
    // (no client). What matters is that no RPC was called for the bot.
    expect(summaries.get("player1")?.result).toBe("loss");
    expect(summaries.get("player1")?.xp.gained).toBe(0);
  });
});
