import { AMPLIFICATION_DB, CARD_CATALOG, CARD_CATALOG_VERSION, VOTE_EVENT_DB } from "@twcardgame/cards";
import type { CommandEnvelope, Seat } from "@twcardgame/shared";
import { describe, expect, it } from "vitest";
import { createInitialMatch } from "./engine.js";
import {
  dominantFaction,
  effectHandlers,
  getCardActualCost,
  reduce,
  rollAugmentTiers,
  sampleAugmentOptions,
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
 * the way (turns 7/14 before a target of 20) is force-resolved via server timeout
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
      const player1Boundary = Math.floor((weights.player1 / (weights.player1 + weights.player2)) * 1_000_000);
      expect(pick.seat).toBe(pick.rollMillionths < player1Boundary ? "player1" : "player2");
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

  it("rolls two shared augment tiers reproducibly per seed (≈45/35/20)", () => {
    expect(rollAugmentTiers(123)).toEqual(rollAugmentTiers(123));
    const counts: Record<string, number> = { 加減賺: 0, 蕭貪: 0, 卯死: 0 };
    for (let seed = 0; seed < 3000; seed++) {
      for (const tier of rollAugmentTiers(seed)) counts[tier] += 1;
    }
    const total = 6000;
    expect(counts["加減賺"] / total).toBeGreaterThan(0.4);
    expect(counts["加減賺"] / total).toBeLessThan(0.5);
    expect(counts["卯死"] / total).toBeGreaterThan(0.15);
    expect(counts["卯死"] / total).toBeLessThan(0.25);
  });

  it("samples weighted single-tier options reproducibly, sharing the tier and excluding prior picks", () => {
    const pool = AMPLIFICATION_DB.filter((entry) => entry.tier === "加減賺");
    const base = {
      pool,
      categoryCounts: { 勞工: 10, 平民: 20 } as Record<string, number>,
      excludeIds: new Set<string>(),
      isFirstPhase: true,
      secondPhaseTier: "蕭貪" as const
    };
    const a = sampleAugmentOptions({ rngState: 999, ...base });
    const b = sampleAugmentOptions({ rngState: 999, ...base });
    expect(a.options.map((o) => o.id)).toEqual(b.options.map((o) => o.id));
    expect(a.options.length).toBe(3);
    expect(a.options.every((o) => o.tier === "加減賺")).toBe(true);
    const excluded = sampleAugmentOptions({ rngState: 999, ...base, excludeIds: new Set([a.options[0].id]) });
    expect(excluded.options.map((o) => o.id)).not.toContain(a.options[0].id);
  });

  it("offers first-phase-only low-tier augments only when eligible", () => {
    const low = AMPLIFICATION_DB.filter((entry) => entry.tier === "加減賺");
    const counts: Record<string, number> = { 平民: 30 };
    const all = (isFirstPhase: boolean, secondPhaseTier: "加減賺" | "蕭貪" | "卯死") =>
      sampleAugmentOptions({ rngState: 5, pool: low, categoryCounts: counts, excludeIds: new Set(), isFirstPhase, secondPhaseTier, count: 99 }).options.map((o) => o.id);
    expect(all(true, "蕭貪")).toContain("AMP_0050");
    expect(all(true, "蕭貪")).toContain("AMP_GO_FOR_BROKE");
    expect(all(false, "蕭貪")).not.toContain("AMP_0050");
    expect(all(false, "蕭貪")).not.toContain("AMP_GO_FOR_BROKE");
    expect(all(true, "卯死")).not.toContain("AMP_0050");
    expect(all(true, "卯死")).toContain("AMP_GO_FOR_BROKE");
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

  it("carries related card ids into sampled amplification options", () => {
    const betelNut = AMPLIFICATION_DB.find((entry) => entry.id === "AMP_BETEL_NUT_500");
    expect(betelNut).toBeDefined();
    const sampled = sampleAugmentOptions({
      rngState: 5,
      pool: [betelNut!],
      categoryCounts: { 勞工: 1 },
      excludeIds: new Set(),
      isFirstPhase: true,
      secondPhaseTier: "蕭貪",
      count: 1
    });
    expect(sampled.options[0]?.relatedCardIds).toEqual(["S029"]);
  });
});

describe("amplification phase (turn 7)", () => {
  it("opens AMPLIFICATION_PHASE at turn 7 with three private options per seat", () => {
    const state = advanceToTurn(startMatch(11), 7);
    expect(state.turn.number).toBe(7);
    expect(state.phase).toBe("AMPLIFICATION_PHASE");
    expect(state.specialPhase?.amplificationOptions?.player1).toHaveLength(3);
    expect(state.specialPhase?.amplificationOptions?.player2).toHaveLength(3);
    // Options are private — never projected into public state.
    const pub = toPublicState(state);
    expect(pub.phase).toBe("AMPLIFICATION_PHASE");
    expect((pub.specialPhase as any)?.amplificationOptions).toBeUndefined();
    expect(pub.specialPhase?.amplificationSelected).toEqual({ player1: false, player2: false });
    expect(pub.specialPhase?.amplificationRerollRemaining).toEqual({ player1: 1, player2: 1 });
  });

  it("rejects normal play/attack/endTurn while the phase is open", () => {
    const state = advanceToTurn(startMatch(12), 7);
    const result = reduce(state, env("p", state.turn.activeSeat, { type: "endTurn" }), CARD_CATALOG);
    expect(result.events.some((e) => e.type === "COMMAND_REJECTED")).toBe(true);
    expect(result.state.phase).toBe("AMPLIFICATION_PHASE");
  });

  it("binds the chosen amplification and resumes normal play once both seats select", () => {
    let state = advanceToTurn(startMatch(13), 7);
    const optP1 = state.specialPhase!.amplificationOptions!.player1[0];
    const optP2 = state.specialPhase!.amplificationOptions!.player2[1];
    state = reduce(state, env("a1", "player1", { type: "selectAmplification", optionId: optP1.id }), CARD_CATALOG).state;
    expect(state.phase).toBe("AMPLIFICATION_PHASE"); // still waiting on player2
    state = reduce(state, env("a2", "player2", { type: "selectAmplification", optionId: optP2.id }), CARD_CATALOG).state;
    expect(state.phase).toBe("NORMAL_PLAY");
    expect(state.specialPhase).toBeUndefined();
    expect(state.players.player1.amplification?.id).toBe(optP1.id);
    expect(state.players.player2.amplification?.id).toBe(optP2.id);
    expect(state.turn.number).toBe(7); // the interrupted turn resumes, not re-run
  });

  it("rerolls one seat's amplification options once, keeping the same tier and public flag", () => {
    let state = advanceToTurn(startMatch(131), 7);
    const beforeP1 = state.specialPhase!.amplificationOptions!.player1.map((option) => option.id);
    const beforeP2 = state.specialPhase!.amplificationOptions!.player2.map((option) => option.id);
    const tier = state.specialPhase!.amplificationOptions!.player1[0].tier;

    const result = reduce(state, env("reroll", "player1", { type: "rerollAmplification" }), CARD_CATALOG);
    state = result.state;

    const afterP1 = state.specialPhase!.amplificationOptions!.player1;
    expect(result.events.some((event) => event.type === "AMPLIFICATION_REROLLED")).toBe(true);
    expect(afterP1).toHaveLength(3);
    expect(afterP1.every((option) => option.tier === tier)).toBe(true);
    expect(afterP1.map((option) => option.id)).not.toEqual(beforeP1);
    expect(state.specialPhase!.amplificationOptions!.player2.map((option) => option.id)).toEqual(beforeP2);
    expect(toPublicState(state).specialPhase?.amplificationRerollUsed).toEqual({ player1: true, player2: false });
    expect(toPublicState(state).specialPhase?.amplificationRerollRemaining).toEqual({ player1: 0, player2: 1 });
  });

  it("rejects a second reroll and rejects rerolling after selecting an amplification", () => {
    let state = advanceToTurn(startMatch(132), 7);
    state = reduce(state, env("reroll-once", "player1", { type: "rerollAmplification" }), CARD_CATALOG).state;
    const second = reduce(state, env("reroll-twice", "player1", { type: "rerollAmplification" }), CARD_CATALOG);
    expect(second.events.some((event) => event.type === "COMMAND_REJECTED")).toBe(true);

    state = reduce(second.state, env("pick", "player1", { type: "selectAmplification", optionId: second.state.specialPhase!.amplificationOptions!.player1[0].id }), CARD_CATALOG).state;
    const afterPick = reduce(state, env("reroll-picked", "player1", { type: "rerollAmplification" }), CARD_CATALOG);
    expect(afterPick.events.some((event) => event.type === "COMMAND_REJECTED")).toBe(true);
  });

  it("lets 要拚 add one extra reroll to the next amplification phase", () => {
    let state = advanceToTurn(startMatch(134), 7);
    state = reduce(
      state,
      env("amp-timeout-before-extra", state.turn.activeSeat, { type: "selectAmplification", optionId: "" }, { serverTimeout: true }),
      CARD_CATALOG
    ).state;
    state.players.player1.augmentFlags.extraAmplificationRerollsNextPhase = 1;

    state = advanceToTurn(state, 14);
    expect(state.specialPhase?.amplificationRerollLimit).toEqual({ player1: 2, player2: 1 });
    expect(state.players.player1.augmentFlags.extraAmplificationRerollsNextPhase).toBe(0);
    expect(toPublicState(state).specialPhase?.amplificationRerollRemaining).toEqual({ player1: 2, player2: 1 });

    state = reduce(state, env("go-reroll-1", "player1", { type: "rerollAmplification" }), CARD_CATALOG).state;
    expect(toPublicState(state).specialPhase?.amplificationRerollRemaining?.player1).toBe(1);

    state = reduce(state, env("go-reroll-2", "player1", { type: "rerollAmplification" }), CARD_CATALOG).state;
    expect(toPublicState(state).specialPhase?.amplificationRerollRemaining?.player1).toBe(0);

    const third = reduce(state, env("go-reroll-3", "player1", { type: "rerollAmplification" }), CARD_CATALOG);
    expect(third.events.some((event) => event.type === "COMMAND_REJECTED")).toBe(true);
  });

  it("uses the rerolled options for timeout fallback", () => {
    let state = advanceToTurn(startMatch(133), 7);
    state = reduce(state, env("reroll-timeout", "player1", { type: "rerollAmplification" }), CARD_CATALOG).state;
    const fallback = state.specialPhase!.amplificationOptions!.player1[0];

    state = reduce(
      state,
      env("amp-timeout-reroll", state.turn.activeSeat, { type: "selectAmplification", optionId: "" }, { serverTimeout: true }),
      CARD_CATALOG
    ).state;

    expect(state.phase).toBe("NORMAL_PLAY");
    expect(state.players.player1.amplification?.id).toBe(fallback.id);
  });

  it("force-resolves to tier-1 defaults on a server timeout", () => {
    let state = advanceToTurn(startMatch(14), 7);
    state = reduce(
      state,
      env("amp-timeout", state.turn.activeSeat, { type: "selectAmplification", optionId: "" }, { serverTimeout: true }),
      CARD_CATALOG
    ).state;
    expect(state.phase).toBe("NORMAL_PLAY");
    // Both seats share the phase's rolled tier (no longer always 加減賺).
    expect(state.players.player1.amplification?.tier).toBe(state.augmentTiers[0]);
    expect(state.players.player2.amplification?.tier).toBe(state.augmentTiers[0]);
  });

  it("triggers again at turn 14 but not on the same turn twice", () => {
    let state = advanceToTurn(startMatch(15), 7);
    // resolve turn 7
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
    const ballot = state.specialPhase?.voteEvents ?? [];
    state = reduce(state, env("v1", "player1", { type: "submitVote", optionIndex: 0 }), CARD_CATALOG).state;
    const result = reduce(state, env("v2", "player2", { type: "submitVote", optionIndex: 1 }), CARD_CATALOG);
    expect(result.state.phase).toBe("NORMAL_PLAY");
    expect(result.state.specialPhase).toBeUndefined();
    const resolved = result.events.find((e) => e.type === "VOTE_RESOLVED");
    expect(resolved).toBeDefined();
    expect(typeof resolved?.payload?.processText).toBe("string");

    // The payload carries each seat's ballot pick so the client can animate the
    // roulette flipping between the two voted cards before landing on the winner.
    const choices = resolved?.payload?.choices as
      | Record<"player1" | "player2", { optionIndex: number; eventId: string; eventName: string }>
      | undefined;
    expect(choices?.player1?.optionIndex).toBe(0);
    expect(choices?.player2?.optionIndex).toBe(1);
    expect(choices?.player1?.eventId).toBe(ballot[0]?.id);
    expect(choices?.player2?.eventId).toBe(ballot[1]?.id);
    const winningSeat = resolved?.payload?.winningSeat as "player1" | "player2";
    expect(choices?.[winningSeat]?.eventId).toBe(resolved?.payload?.eventId);
    const weightsInt = resolved?.payload?.weightsInt as Record<"player1" | "player2", number>;
    const rollMillionths = resolved?.payload?.rollMillionths as number;
    const player1Boundary = Math.floor((weightsInt.player1 / (weightsInt.player1 + weightsInt.player2)) * 1_000_000);
    expect(rollMillionths).toBeGreaterThanOrEqual(0);
    expect(rollMillionths).toBeLessThan(1_000_000);
    expect(winningSeat).toBe(rollMillionths < player1Boundary ? "player1" : "player2");
  });

  it("is deterministic: same seed + votes → same winning event and roulette position", () => {
    const run = (): string => {
      let state = advanceToTurn(startMatch(777), 20);
      state = reduce(state, env("rv1", "player1", { type: "submitVote", optionIndex: 0 }), CARD_CATALOG).state;
      const r = reduce(state, env("rv2", "player2", { type: "submitVote", optionIndex: 1 }), CARD_CATALOG);
      const payload = r.events.find((e) => e.type === "VOTE_RESOLVED")?.payload;
      return JSON.stringify({
        eventId: payload?.eventId,
        winningSeat: payload?.winningSeat,
        rollMillionths: payload?.rollMillionths,
        weightsInt: payload?.weightsInt
      });
    };
    expect(run()).toBe(run());
  });

  it("emits VOTE_EVENT_GLOW carrying the units a winning event changes (heal / shield)", () => {
    let state = advanceToTurn(startMatch(123), 20);
    // Damage both heroes so the full-heal event has something to heal, then rig the
    // ballot so that event wins regardless of the inverse-HP roulette outcome.
    state.players.player1.hero.hp = 10;
    state.players.player2.hero.hp = 12;
    const heal = VOTE_EVENT_DB.find((e) => e.id === "VE_BASEBALL_CHAMPION")!;
    const ballot = { id: heal.id, name: heal.name, options: heal.options };
    state.specialPhase!.voteEvents = [ballot, ballot, ballot];
    state = reduce(state, env("g1", "player1", { type: "submitVote", optionIndex: 0 }), CARD_CATALOG).state;
    const result = reduce(state, env("g2", "player2", { type: "submitVote", optionIndex: 0 }), CARD_CATALOG);
    const glow = result.events.find((e) => e.type === "VOTE_EVENT_GLOW");
    expect(glow).toBeDefined();
    expect(glow?.payload?.targets).toEqual(expect.arrayContaining(["player1:hero", "player2:hero"]));
  });

  it("omits VOTE_EVENT_GLOW when a winning event changes no on-board units", () => {
    let state = advanceToTurn(startMatch(123), 20);
    const mana = VOTE_EVENT_DB.find((e) => e.id === "VE_FINANCIAL_CRISIS")!;
    const ballot = { id: mana.id, name: mana.name, options: mana.options };
    state.specialPhase!.voteEvents = [ballot, ballot, ballot];
    state = reduce(state, env("n1", "player1", { type: "submitVote", optionIndex: 0 }), CARD_CATALOG).state;
    const result = reduce(state, env("n2", "player2", { type: "submitVote", optionIndex: 0 }), CARD_CATALOG);
    expect(result.events.some((e) => e.type === "VOTE_EVENT_GLOW")).toBe(false);
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

    // At the first expired turn, the penalty no longer applies.
    state.turn.number = state.currentEnvironment.expiresTurn!;
    expect(getCardActualCost(state, seat, card)).toBe(base);
  });

  it("projects environment countdown from 4 to 1, then hides it", () => {
    const state = startMatch(31);
    state.currentEnvironment = {
      id: "VE_BLACKOUT",
      name: "大停電",
      appliedTurn: state.turn.number,
      expiresTurn: state.turn.number + 4,
      effect: { type: "ENV_SILENCE_ALL" }
    };

    expect(toPublicState(state).activeEnvironment?.remainingTurns).toBe(4);
    state.turn.number = state.currentEnvironment.expiresTurn! - 1;
    expect(toPublicState(state).activeEnvironment?.remainingTurns).toBe(1);
    state.turn.number = state.currentEnvironment.expiresTurn!;
    expect(toPublicState(state).activeEnvironment).toBeUndefined();
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
