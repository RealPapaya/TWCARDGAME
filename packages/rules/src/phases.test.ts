import { AMPLIFICATION_DB, CARD_CATALOG, CARD_CATALOG_VERSION, VOTE_EVENT_DB } from "@twcardgame/cards";
import type { CommandEnvelope, Seat } from "@twcardgame/shared";
import { describe, expect, it } from "vitest";
import { createInitialMatch } from "./engine.js";
import {
  dominantFaction,
  effectHandlers,
  getCardActualCost,
  reduce,
  sampleAmplificationOptions,
  sampleVoteEvents,
  toPublicState,
  voteWeightsDisplay,
  voteWeightsInt,
  weightedPickSeat
} from "./index.js";
import type { MatchState } from "./types.js";

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

function startMatch(seed: number): MatchState {
  let state = createInitialMatch({
    matchId: `phase-${seed}`,
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed,
    nowMs: 1000,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: "p1", displayName: "甲", deckIds: legalDeckIds() },
      { seat: "player2", userId: "p2", displayName: "乙", deckIds: legalDeckIds() }
    ]
  }).state;
  state = reduce(state, env("m1", "player1", { type: "submitMulligan", replaceHandInstanceIds: [] }), CARD_CATALOG).state;
  state = reduce(state, env("m2", "player2", { type: "submitMulligan", replaceHandInstanceIds: [] }), CARD_CATALOG).state;
  return state;
}

let cmdSeq = 0;
function env(id: string, seat: Seat, command: CommandEnvelope["command"], opts: { serverTimeout?: boolean } = {}): CommandEnvelope {
  cmdSeq += 1;
  return { commandId: `${id}-${cmdSeq}`, seat, nowMs: 2000 + cmdSeq, command, serverTimeout: opts.serverTimeout };
}

/**
 * Drives the match toward `turn.number === target`. Any special phase opened on
 * the way (turns 6/14 before a target of 20) is force-resolved via server timeout
 * so play continues; the target turn's own phase is left OPEN for the caller.
 */
function advanceToTurn(state: MatchState, target: number): MatchState {
  let current = state;
  let guard = 0;
  while (current.turn.number < target && current.status === "in_progress" && guard < 200) {
    if (current.phase === "AMPLIFICATION_PHASE") {
      current = reduce(current, env("auto-amp", current.turn.activeSeat, { type: "selectAmplification", optionId: "" }, { serverTimeout: true }), CARD_CATALOG).state;
    } else if (current.phase === "VOTING_PHASE") {
      current = reduce(current, env("auto-vote", current.turn.activeSeat, { type: "submitVote", optionIndex: 0 }, { serverTimeout: true }), CARD_CATALOG).state;
    } else {
      current = reduce(current, env("adv", current.turn.activeSeat, { type: "endTurn" }), CARD_CATALOG).state;
    }
    guard += 1;
  }
  return current;
}

describe("phase pure helpers", () => {
  it("computes inverse-HP weights and display percentages (8 vs 25 → 76/24)", () => {
    const weights = voteWeightsInt(8, 25);
    expect(weights).toEqual({ player1: 25, player2: 8 });
    expect(voteWeightsDisplay(weights)).toEqual({ player1: 76, player2: 24 });
  });

  it("weightedPickSeat favors the underdog at roughly the display rate", () => {
    const weights = voteWeightsInt(8, 25); // player1 (low HP) favored ~76%
    let player1Wins = 0;
    const trials = 2000;
    let rng = 12345;
    for (let i = 0; i < trials; i++) {
      const pick = weightedPickSeat(rng, weights);
      rng = pick.rngState;
      if (pick.seat === "player1") player1Wins += 1;
    }
    expect(player1Wins / trials).toBeGreaterThan(0.7);
    expect(player1Wins / trials).toBeLessThan(0.82);
  });

  it("even weights when both players are at 0 HP", () => {
    expect(voteWeightsInt(0, 0)).toEqual({ player1: 1, player2: 1 });
    expect(voteWeightsDisplay({ player1: 1, player2: 1 })).toEqual({ player1: 50, player2: 50 });
  });

  it("dominantFaction picks the highest-proportion party, or undefined when none", () => {
    expect(dominantFaction({ 國民黨政治人物: 5, 民進黨政治人物: 2, 勞工: 9 })).toMatchObject({
      dominantCategory: "國民黨政治人物",
      dominantParty: "國民黨"
    });
    expect(dominantFaction({ 勞工: 10, 學生: 5 }).dominantCategory).toBeUndefined();
  });

  it("samples three distinct-tier amplification options, reproducibly per seed", () => {
    const a = sampleAmplificationOptions(999, AMPLIFICATION_DB);
    const b = sampleAmplificationOptions(999, AMPLIFICATION_DB);
    expect(a.options.map((o) => o.id)).toEqual(b.options.map((o) => o.id));
    expect(new Set(a.options.map((o) => o.tier)).size).toBe(a.options.length);
    expect(a.options.length).toBe(3);
  });

  it("draws three unique vote events, reproducibly per seed", () => {
    const a = sampleVoteEvents(424242, VOTE_EVENT_DB);
    const b = sampleVoteEvents(424242, VOTE_EVENT_DB);
    expect(a.events.map((e) => e.id)).toEqual(b.events.map((e) => e.id));
    expect(new Set(a.events.map((e) => e.id)).size).toBe(3);
  });

  it("registers a NOOP handler so stubbed DB effects never throw", () => {
    expect(effectHandlers.NOOP).toBeTypeOf("function");
    expect(effectHandlers.ENV_SILENCE_ALL).toBeTypeOf("function");
    expect(effectHandlers.ENV_COST_PLUS_CAPPED).toBeTypeOf("function");
  });
});

describe("amplification phase (turn 6)", () => {
  it("opens AMPLIFICATION_PHASE at turn 6 with three private options per seat", () => {
    const state = advanceToTurn(startMatch(11), 6);
    expect(state.turn.number).toBe(6);
    expect(state.phase).toBe("AMPLIFICATION_PHASE");
    expect(state.specialPhase?.amplificationOptions?.player1).toHaveLength(3);
    expect(state.specialPhase?.amplificationOptions?.player2).toHaveLength(3);
    // Options are private — never projected into public state.
    const pub = toPublicState(state);
    expect(pub.phase).toBe("AMPLIFICATION_PHASE");
    expect((pub.specialPhase as any)?.amplificationOptions).toBeUndefined();
    expect(pub.specialPhase?.amplificationSelected).toEqual({ player1: false, player2: false });
  });

  it("rejects normal play/attack/endTurn while the phase is open", () => {
    const state = advanceToTurn(startMatch(12), 6);
    const result = reduce(state, env("p", state.turn.activeSeat, { type: "endTurn" }), CARD_CATALOG);
    expect(result.events.some((e) => e.type === "COMMAND_REJECTED")).toBe(true);
    expect(result.state.phase).toBe("AMPLIFICATION_PHASE");
  });

  it("binds the chosen amplification and resumes normal play once both seats select", () => {
    let state = advanceToTurn(startMatch(13), 6);
    const optP1 = state.specialPhase!.amplificationOptions!.player1[0];
    const optP2 = state.specialPhase!.amplificationOptions!.player2[1];
    state = reduce(state, env("a1", "player1", { type: "selectAmplification", optionId: optP1.id }), CARD_CATALOG).state;
    expect(state.phase).toBe("AMPLIFICATION_PHASE"); // still waiting on player2
    state = reduce(state, env("a2", "player2", { type: "selectAmplification", optionId: optP2.id }), CARD_CATALOG).state;
    expect(state.phase).toBe("NORMAL_PLAY");
    expect(state.specialPhase).toBeUndefined();
    expect(state.players.player1.amplification?.id).toBe(optP1.id);
    expect(state.players.player2.amplification?.id).toBe(optP2.id);
    expect(state.turn.number).toBe(6); // the interrupted turn resumes, not re-run
  });

  it("force-resolves to tier-1 defaults on a server timeout", () => {
    let state = advanceToTurn(startMatch(14), 6);
    state = reduce(
      state,
      env("amp-timeout", state.turn.activeSeat, { type: "selectAmplification", optionId: "" }, { serverTimeout: true }),
      CARD_CATALOG
    ).state;
    expect(state.phase).toBe("NORMAL_PLAY");
    expect(state.players.player1.amplification?.tier).toBe("加減賺");
    expect(state.players.player2.amplification?.tier).toBe("加減賺");
  });

  it("triggers again at turn 14 but not on the same turn twice", () => {
    let state = advanceToTurn(startMatch(15), 6);
    // resolve turn 6
    state = reduce(state, env("t6a", "player1", { type: "selectAmplification", optionId: "" }, { serverTimeout: true }), CARD_CATALOG).state;
    expect(state.phase).toBe("NORMAL_PLAY");
    state = advanceToTurn(state, 14);
    expect(state.turn.number).toBe(14);
    expect(state.phase).toBe("AMPLIFICATION_PHASE");
  });
});

describe("voting phase (turn 20)", () => {
  it("opens VOTING_PHASE at turn 20 with three public events and weights", () => {
    const state = advanceToTurn(startMatch(21), 20);
    expect(state.turn.number).toBe(20);
    expect(state.phase).toBe("VOTING_PHASE");
    expect(state.specialPhase?.voteEvents).toHaveLength(3);
    const pub = toPublicState(state);
    expect(pub.specialPhase?.voteEvents).toHaveLength(3);
    expect(pub.specialPhase?.voteWeights).toBeDefined();
  });

  it("resolves a winning event, logs the process text, and returns to normal play", () => {
    let state = advanceToTurn(startMatch(22), 20);
    state = reduce(state, env("v1", "player1", { type: "submitVote", optionIndex: 0 }), CARD_CATALOG).state;
    const result = reduce(state, env("v2", "player2", { type: "submitVote", optionIndex: 1 }), CARD_CATALOG);
    expect(result.state.phase).toBe("NORMAL_PLAY");
    expect(result.state.specialPhase).toBeUndefined();
    const resolved = result.events.find((e) => e.type === "VOTE_RESOLVED");
    expect(resolved).toBeDefined();
    expect(typeof resolved?.payload?.processText).toBe("string");
  });

  it("is deterministic: same seed + votes → same winning event", () => {
    const run = (): string => {
      let state = advanceToTurn(startMatch(777), 20);
      state = reduce(state, env("rv1", "player1", { type: "submitVote", optionIndex: 0 }), CARD_CATALOG).state;
      const r = reduce(state, env("rv2", "player2", { type: "submitVote", optionIndex: 1 }), CARD_CATALOG);
      return String(r.events.find((e) => e.type === "VOTE_RESOLVED")?.payload?.eventId);
    };
    expect(run()).toBe(run());
  });
});

describe("environment effects", () => {
  it("applies a capped cost penalty through getCardActualCost and reverts on expiry", () => {
    const state = startMatch(31);
    const seat = state.turn.activeSeat;
    const card = state.players[seat].hand[0];
    const base = getCardActualCost(state, seat, card);

    state.currentEnvironment = {
      id: "VE_UTILITY_HIKE",
      name: "油電雙漲",
      appliedTurn: state.turn.number,
      expiresTurn: state.turn.number + 4,
      effect: { type: "ENV_COST_PLUS_CAPPED", value: 2 }
    };
    expect(getCardActualCost(state, seat, card)).toBe(Math.min(10, base + 2));

    // Past its window the penalty no longer applies.
    state.turn.number = state.currentEnvironment.expiresTurn! + 1;
    expect(getCardActualCost(state, seat, card)).toBe(base);
  });

  it("caps the cost penalty at 10", () => {
    const state = startMatch(32);
    const seat = state.turn.activeSeat;
    const card = state.players[seat].hand[0];
    card.cost = 9;
    state.currentEnvironment = {
      id: "VE_UTILITY_HIKE",
      name: "油電雙漲",
      appliedTurn: state.turn.number,
      effect: { type: "ENV_COST_PLUS_CAPPED", value: 5 }
    };
    expect(getCardActualCost(state, seat, card)).toBe(10);
  });
});
