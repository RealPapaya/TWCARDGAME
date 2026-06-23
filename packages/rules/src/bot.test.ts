import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { describe, expect, it } from "vitest";
import { createInitialMatch } from "./engine.js";
import { createRuntimeCard } from "./deck.js";
import { reduce } from "./engine.js";
import { legalMoves } from "./legalMoves.js";
import { decide } from "./bot.js";
import { createMinionFromCard, getCardActualCost, nextInstanceId, toHandView } from "./state.js";
import type { MatchState, RuntimeMinion } from "./types.js";

function legalDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

function startedMatch(seed: number): MatchState {
  let state = createInitialMatch({
    matchId: `bot-${seed}`,
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed,
    nowMs: 1000,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: "p1", displayName: "P1", deckIds: legalDeckIds() },
      { seat: "player2", userId: "p2", displayName: "P2", deckIds: legalDeckIds() }
    ]
  }).state;
  state = reduce(state, { commandId: "m1", seat: "player1", nowMs: 1100, command: { type: "submitMulligan", replaceHandInstanceIds: [] } }, CARD_CATALOG).state;
  state = reduce(state, { commandId: "m2", seat: "player2", nowMs: 1200, command: { type: "submitMulligan", replaceHandInstanceIds: [] } }, CARD_CATALOG).state;
  return state;
}

describe("legalMoves", () => {
  it("always offers endTurn during the active player's turn", () => {
    const state = startedMatch(7);
    const moves = legalMoves(state, state.turn.activeSeat);
    expect(moves.some((m) => m.type === "endTurn")).toBe(true);
  });

  it("returns no moves for the inactive seat during an active turn", () => {
    const state = startedMatch(7);
    const inactive = state.turn.activeSeat === "player1" ? "player2" : "player1";
    expect(legalMoves(state, inactive)).toEqual([]);
  });

  it("excludes unaffordable card plays", () => {
    const state = startedMatch(11);
    const seat = state.turn.activeSeat;
    const player = state.players[seat];
    const moves = legalMoves(state, seat);
    for (const move of moves) {
      if (move.type !== "playCard") continue;
      const card = player.hand.find((c) => c.instanceId === move.handInstanceId);
      expect(card).toBeTruthy();
      const cost = getCardActualCost(state, seat, card!);
      expect(cost).toBeLessThanOrEqual(player.mana.current);
    }
  });

  it("offers two mulligan options when high-cost cards are in hand", () => {
    let state = createInitialMatch({
      matchId: "mull",
      cardCatalogVersion: CARD_CATALOG_VERSION,
      seed: 42,
      nowMs: 1000,
      catalog: CARD_CATALOG,
      players: [
        { seat: "player1", userId: "p1", displayName: "P1", deckIds: legalDeckIds() },
        { seat: "player2", userId: "p2", displayName: "P2", deckIds: legalDeckIds() }
      ]
    }).state;
    // Force-insert a high-cost card into player1's hand so the "replace high" option appears.
    state.players.player1.hand[0] = { ...state.players.player1.hand[0], cost: 7 };
    const moves = legalMoves(state, "player1");
    const mulliganMoves = moves.filter((m) => m.type === "submitMulligan");
    expect(mulliganMoves.length).toBe(2);
  });

  it("plays 查水表 without requiring a target", () => {
    const state = startedMatch(606);
    const seat = state.turn.activeSeat;
    const enemy = seat === "player1" ? "player2" : "player1";
    const checkWater = CARD_CATALOG.find((card) => card.id === "S019")!;
    const targetDef = CARD_CATALOG.find((card) => card.type === "MINION" && card.collectible !== false)!;
    const enemyMinion = createMinionFromCard(state, createRuntimeCard(targetDef, enemy, nextInstanceId(state, "card")), enemy);
    enemyMinion.health = 5;
    enemyMinion.currentHealth = 5;
    state.players[enemy].board = [readyMinion(enemyMinion)];
    state.players[seat].mana = { current: 3, max: 3 };
    state.players[seat].hand = [createRuntimeCard(checkWater, seat, nextInstanceId(state, "card"))];

    expect(toHandView(state, seat)[0]?.needsTarget).toBe(false);
    const move = legalMoves(state, seat).find((candidate) =>
      candidate.type === "playCard" && candidate.handInstanceId === state.players[seat].hand[0]!.instanceId
    );
    expect(move).toEqual({ type: "playCard", handInstanceId: state.players[seat].hand[0]!.instanceId });

    const result = reduce(state, { commandId: "check-water-no-target", seat, nowMs: 2000, command: move! }, CARD_CATALOG);
    expect(result.events.some((event) => event.type === "COMMAND_REJECTED")).toBe(false);
    expect(result.state.players[enemy].board[0]?.currentHealth).toBe(3);
  });

  it("offers every board slot for an adjacency-buff minion so placement is a real choice", () => {
    const state = startedMatch(708);
    const seat = state.turn.activeSeat;
    state.players[seat].board = [];
    placeMinion(state, seat, { attack: 2, health: 2 });
    placeMinion(state, seat, { attack: 2, health: 2 });
    state.players[seat].mana = { current: 5, max: 5 };
    const adjId = giveCard(state, seat, "TW030"); // 朱立倫 — BUFF_ADJACENT, no target

    const slots = legalMoves(state, seat)
      .filter((m) => m.type === "playCard" && m.handInstanceId === adjId)
      .map((m) => (m.type === "playCard" ? m.boardIndex : undefined));
    // With two minions on board there are three insertion slots: 0, 1, 2.
    expect(new Set(slots)).toEqual(new Set([0, 1, 2]));
  });

  it("enumerates target.type ALL battlecries with explicit hero or minion targets", () => {
    const state = startedMatch(607);
    const seat = state.turn.activeSeat;
    const enemy = seat === "player1" ? "player2" : "player1";
    const purge = CARD_CATALOG.find((card) => card.id === "S020")!;
    const targetDef = CARD_CATALOG.find((card) => card.type === "MINION" && card.collectible !== false)!;
    const enemyMinion = createMinionFromCard(state, createRuntimeCard(targetDef, enemy, nextInstanceId(state, "card")), enemy);
    state.players[enemy].board = [readyMinion(enemyMinion)];
    state.players[seat].mana = { current: 5, max: 5 };
    state.players[seat].hand = [createRuntimeCard(purge, seat, nextInstanceId(state, "card"))];

    const plays = legalMoves(state, seat).filter((candidate) =>
      candidate.type === "playCard" && candidate.handInstanceId === state.players[seat].hand[0]!.instanceId
    );

    expect(toHandView(state, seat)[0]?.needsTarget).toBe(true);
    expect(plays).toContainEqual({ type: "playCard", handInstanceId: state.players[seat].hand[0]!.instanceId, target: { type: "HERO", side: enemy } });
    expect(plays).toContainEqual({ type: "playCard", handInstanceId: state.players[seat].hand[0]!.instanceId, target: { type: "MINION", side: enemy, instanceId: enemyMinion.instanceId } });
    expect(plays.some((candidate) => candidate.type === "playCard" && !candidate.target)).toBe(false);
  });
});

function readyMinion(minion: RuntimeMinion): RuntimeMinion {
  minion.sleeping = false;
  minion.canAttack = true;
  return minion;
}

const VANILLA_MINION = CARD_CATALOG.find((card) => card.type === "MINION" && card.collectible !== false)!;

/** A cleared, deterministic position with player1 to act, empty boards/hands, 10 mana. */
function arena(seed: number): { state: MatchState; seat: "player1"; enemy: "player2" } {
  const state = startedMatch(seed);
  state.turn.activeSeat = "player1";
  for (const p of ["player1", "player2"] as const) {
    state.players[p].board = [];
    state.players[p].hand = [];
  }
  state.players.player1.mana = { current: 10, max: 10 };
  return { state, seat: "player1", enemy: "player2" };
}

function placeMinion(
  state: MatchState,
  seat: "player1" | "player2",
  opts: { attack: number; health: number; ready?: boolean; divineShield?: boolean; taunt?: boolean }
): RuntimeMinion {
  const minion = createMinionFromCard(state, createRuntimeCard(VANILLA_MINION, seat, nextInstanceId(state, "card")), seat);
  minion.attack = opts.attack;
  minion.baseAttack = opts.attack;
  minion.health = opts.health;
  minion.currentHealth = opts.health;
  minion.keywords = { ...minion.keywords, divineShield: opts.divineShield ?? false, taunt: opts.taunt ?? false };
  if (opts.ready) {
    minion.sleeping = false;
    minion.canAttack = true;
    minion.lockedTurns = 0;
  } else {
    minion.sleeping = true;
    minion.canAttack = false;
  }
  state.players[seat].board.push(minion);
  return minion;
}

function giveCard(state: MatchState, seat: "player1" | "player2", cardId: string): string {
  const def = CARD_CATALOG.find((card) => card.id === cardId)!;
  const card = createRuntimeCard(def, seat, nextInstanceId(state, "card"));
  state.players[seat].hand.push(card);
  return card.instanceId;
}

/** A vanilla minion card placed in hand with overridden stats/cost/keywords. */
function giveMinionCard(
  state: MatchState,
  seat: "player1" | "player2",
  opts: { attack: number; health: number; cost: number; taunt?: boolean }
): string {
  const id = giveCard(state, seat, VANILLA_MINION.id);
  const card = state.players[seat].hand.find((c) => c.instanceId === id)!;
  card.attack = opts.attack;
  card.health = opts.health;
  card.cost = opts.cost;
  card.keywords = { ...card.keywords, taunt: opts.taunt ?? false };
  return id;
}

describe("bot engines (refactored)", () => {
  it("each engine is deterministic under a fixed RNG seed", () => {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const a = startedMatch(909);
      const b = startedMatch(909);
      const moveA = decide(a, a.turn.activeSeat, difficulty, { state: 4242 }, CARD_CATALOG, 2000);
      const moveB = decide(b, b.turn.activeSeat, difficulty, { state: 4242 }, CARD_CATALOG, 2000);
      expect(JSON.stringify(moveA)).toEqual(JSON.stringify(moveB));
    }
  });

  it("hard takes lethal on the enemy hero when it is on the board", () => {
    const { state, seat, enemy } = arena(1);
    state.players[enemy].hero = { hp: 6, maxHp: 30 };
    placeMinion(state, seat, { attack: 5, health: 5, ready: true });
    placeMinion(state, seat, { attack: 4, health: 4, ready: true });

    const move = decide(state, seat, "hard", { state: 1 }, CARD_CATALOG, 2000);
    expect(move?.type).toBe("attack");
    expect(move?.type === "attack" && move.target.type).toBe("HERO");
  });

  it("hard puts a single-target divine shield on the highest-attack friendly minion", () => {
    const { state, seat, enemy } = arena(2);
    const big = placeMinion(state, seat, { attack: 5, health: 3 }); // best body — should be shielded
    placeMinion(state, seat, { attack: 1, health: 4 });
    placeMinion(state, enemy, { attack: 6, health: 6 }); // a tempting but wrong (enemy) target
    state.players[seat].mana = { current: 4, max: 4 };
    const shieldId = giveCard(state, seat, "TW015"); // GIVE_DIVINE_SHIELD, target ALL MINION

    const move = decide(state, seat, "hard", { state: 1 }, CARD_CATALOG, 2000);
    expect(move?.type).toBe("playCard");
    expect(move?.type === "playCard" && move.handInstanceId).toBe(shieldId);
    expect(move?.type === "playCard" && move.target?.side).toBe(seat);
    expect(move?.type === "playCard" && move.target?.instanceId).toBe(big.instanceId);
  });

  it("hard sacrifices the worst minion and lets it attack first (EAT_FRIENDLY)", () => {
    const { state: base, seat, enemy } = arena(3);
    base.players[enemy].hero = { hp: 30, maxHp: 30 };
    const weak = placeMinion(base, seat, { attack: 1, health: 1, ready: true }); // worst — should be eaten
    placeMinion(base, seat, { attack: 4, health: 5, ready: true });
    base.players[seat].mana = { current: 6, max: 6 };
    const eatId = giveCard(base, seat, "TW034"); // EAT_FRIENDLY, target FRIENDLY MINION

    // Drive the bot's whole turn the way BotGameSession does.
    let state = base;
    const log: { type: string; attacker?: string; play?: string; targetInstance?: string }[] = [];
    const rng = { state: 5 };
    for (let i = 0; i < 12; i++) {
      if (state.turn.activeSeat !== seat) break;
      const move = decide(state, seat, "hard", rng, CARD_CATALOG, 2000 + i);
      if (!move || move.type === "endTurn") break;
      if (move.type === "attack") log.push({ type: "attack", attacker: move.attackerInstanceId });
      if (move.type === "playCard") log.push({ type: "playCard", play: move.handInstanceId, targetInstance: move.target?.instanceId });
      state = reduce(state, { commandId: `eat-${i}`, seat, nowMs: 2000 + i, command: move }, CARD_CATALOG).state;
    }

    const eatIndex = log.findIndex((e) => e.type === "playCard" && e.play === eatId);
    const weakAttackIndex = log.findIndex((e) => e.type === "attack" && e.attacker === weak.instanceId);
    expect(eatIndex).toBeGreaterThanOrEqual(0); // it did play the sacrifice card
    expect(log[eatIndex].targetInstance).toBe(weak.instanceId); // and ate the WORST minion
    expect(weakAttackIndex).toBeGreaterThanOrEqual(0); // the worst minion swung...
    expect(weakAttackIndex).toBeLessThan(eatIndex); // ...BEFORE being sacrificed
  });

  it("hard plays a taunt to block lethal instead of the bigger non-taunt body (opponent-aware)", () => {
    const { state, seat, enemy } = arena(77);
    state.players[seat].hero = { hp: 8, maxHp: 30 };
    state.players[enemy].hero = { hp: 30, maxHp: 30 };
    // Enemy already has lethal on board for next turn if left unblocked: 5 + 4 = 9 >= 8.
    placeMinion(state, enemy, { attack: 5, health: 5, ready: true });
    placeMinion(state, enemy, { attack: 4, health: 4, ready: true });
    // Only enough mana for ONE play, so the bot must choose between them.
    state.players[seat].mana = { current: 5, max: 5 };
    const bigId = giveMinionCard(state, seat, { attack: 7, health: 7, cost: 5 }); // higher static value...
    const tauntId = giveMinionCard(state, seat, { attack: 1, health: 8, cost: 5, taunt: true }); // ...but only this survives

    const move = decide(state, seat, "hard", { state: 1 }, CARD_CATALOG, 2000);
    // A self-only optimizer prefers the 7/7 (more board value) and dies to the swing-back;
    // the 2-ply minimax sees the lethal reply and walls up instead.
    expect(move?.type).toBe("playCard");
    expect(move?.type === "playCard" && move.handInstanceId).toBe(tauntId);
    expect(move?.type === "playCard" && move.handInstanceId).not.toBe(bigId);
  });

  it("hard finds lethal through a taunt: clears the wall, then swings face for the kill", () => {
    const { state: base, seat, enemy } = arena(88);
    base.players[enemy].hero = { hp: 5, maxHp: 30 };
    placeMinion(base, enemy, { attack: 0, health: 3, taunt: true }); // wall: must die first
    placeMinion(base, seat, { attack: 3, health: 3, ready: true }); // exactly clears the taunt
    placeMinion(base, seat, { attack: 5, health: 5, ready: true }); // then this is lethal (5 >= 5)

    // Drive the whole turn the way BotGameSession does.
    let state = base;
    const rng = { state: 9 };
    for (let i = 0; i < 12; i++) {
      if (state.status !== "in_progress" || state.turn.activeSeat !== seat) break;
      const move = decide(state, seat, "hard", rng, CARD_CATALOG, 2000 + i);
      if (!move || move.type === "endTurn") break;
      state = reduce(state, { commandId: `lethal-${i}`, seat, nowMs: 2000 + i, command: move }, CARD_CATALOG).state;
    }
    expect(state.status).toBe("finished");
    expect(state.result?.winnerSeat).toBe(seat);
  });

  it("hard finds burn lethal: throws a damage card at the face to close the game", () => {
    const { state, seat, enemy } = arena(89);
    state.players[enemy].hero = { hp: 1, maxHp: 30 };
    state.players[seat].mana = { current: 1, max: 1 };
    const burnId = giveCard(state, seat, "TW002"); // DAMAGE 1, target ALL/ALL

    const move = decide(state, seat, "hard", { state: 1 }, CARD_CATALOG, 2000);
    expect(move?.type).toBe("playCard");
    expect(move?.type === "playCard" && move.handInstanceId).toBe(burnId);
    expect(move?.type === "playCard" && move.target?.side).toBe(enemy);
    expect(move?.type === "playCard" && move.target?.type).toBe("HERO");
  });

  it("hard places an adjacency buffer between two bodies so both sides get buffed (放中間)", () => {
    const { state, seat } = arena(710);
    placeMinion(state, seat, { attack: 3, health: 3 }); // left body
    placeMinion(state, seat, { attack: 3, health: 3 }); // right body
    state.players[seat].mana = { current: 5, max: 5 };
    const adjId = giveCard(state, seat, "TW030"); // 朱立倫 — BUFF_ADJACENT +1/+1 to both neighbours

    const move = decide(state, seat, "hard", { state: 1 }, CARD_CATALOG, 2000);
    expect(move?.type).toBe("playCard");
    expect(move?.type === "playCard" && move.handInstanceId).toBe(adjId);
    // boardIndex 1 slots it between the two minions, so the +1/+1 hits both, not one.
    expect(move?.type === "playCard" && move.boardIndex).toBe(1);
  });

  it("normal is divine-shield aware: it does not waste a swing into a shielded defender", () => {
    const { state, seat, enemy } = arena(4);
    state.players[enemy].hero = { hp: 30, maxHp: 30 };
    placeMinion(state, seat, { attack: 3, health: 3, ready: true });
    const shielded = placeMinion(state, enemy, { attack: 3, health: 1, divineShield: true }); // popping this kills our attacker
    placeMinion(state, enemy, { attack: 6, health: 3 }); // a real trade target

    const move = decide(state, seat, "normal", { state: 1 }, CARD_CATALOG, 2000);
    expect(move?.type).toBe("attack");
    // The suicidal swing into the shielded minion must NOT be chosen.
    expect(move?.type === "attack" && move.target.instanceId).not.toBe(shielded.instanceId);
  });

  it("difficulty ladder: normal walls up to survive a lethal threat that easy ignores", () => {
    const build = (seed: number) => {
      const { state, seat, enemy } = arena(seed);
      state.players[seat].hero = { hp: 8, maxHp: 30 };
      state.players[enemy].hero = { hp: 30, maxHp: 30 };
      placeMinion(state, enemy, { attack: 5, health: 5, ready: true });
      placeMinion(state, enemy, { attack: 4, health: 4, ready: true }); // 9 face >= 8 = lethal
      state.players[seat].mana = { current: 5, max: 5 };
      const bigId = giveMinionCard(state, seat, { attack: 7, health: 7, cost: 5 }); // greedy bait
      const tauntId = giveMinionCard(state, seat, { attack: 1, health: 8, cost: 5, taunt: true });
      return { state, seat, bigId, tauntId };
    };

    const easy = build(91);
    const easyMove = decide(easy.state, easy.seat, "easy", { state: 1 }, CARD_CATALOG, 2000);
    // Greedy has no survival instinct: it grabs the bigger body and dies next turn.
    expect(easyMove?.type === "playCard" && easyMove.handInstanceId).toBe(easy.bigId);

    const normal = build(91);
    const normalMove = decide(normal.state, normal.seat, "normal", { state: 1 }, CARD_CATALOG, 2000);
    // Normal now sees the incoming lethal and walls up instead.
    expect(normalMove?.type === "playCard" && normalMove.handInstanceId).toBe(normal.tauntId);
  });

  it("normal routes a harmful battlecry onto the enemy, never a friendly minion", () => {
    const { state, seat, enemy } = arena(5);
    state.players[enemy].hero = { hp: 30, maxHp: 30 };
    placeMinion(state, seat, { attack: 2, health: 2 }); // friendly — must not be the target
    placeMinion(state, enemy, { attack: 2, health: 2 });
    state.players[seat].mana = { current: 1, max: 1 };
    const dmgId = giveCard(state, seat, "TW002"); // DAMAGE 1, target ALL/ALL

    const move = decide(state, seat, "normal", { state: 1 }, CARD_CATALOG, 2000);
    expect(move?.type).toBe("playCard");
    expect(move?.type === "playCard" && move.handInstanceId).toBe(dmgId);
    expect(move?.type === "playCard" && move.target?.side).toBe(enemy);
  });
});

describe("bot.decide", () => {
  it("returns deterministic moves for difficulty=easy with a fixed RNG seed", () => {
    const stateA = startedMatch(101);
    const stateB = startedMatch(101);
    const seatA = stateA.turn.activeSeat;
    const seatB = stateB.turn.activeSeat;
    const moveA = decide(stateA, seatA, "easy", { state: 12345 }, CARD_CATALOG, 2000);
    const moveB = decide(stateB, seatB, "easy", { state: 12345 }, CARD_CATALOG, 2000);
    expect(JSON.stringify(moveA)).toEqual(JSON.stringify(moveB));
  });

  it("prefers a non-end-turn move when legal plays exist (normal difficulty)", () => {
    const state = startedMatch(202);
    const seat = state.turn.activeSeat;
    // Skip the test if the bot has nothing to do but end turn.
    const moves = legalMoves(state, seat);
    const hasPlay = moves.some((m) => m.type === "playCard");
    if (!hasPlay) return;
    const move = decide(state, seat, "normal", { state: 1 }, CARD_CATALOG, 2000);
    expect(move?.type).not.toBe("endTurn");
  });

  it("falls back gracefully when no legal moves exist", () => {
    const state = startedMatch(303);
    const inactive = state.turn.activeSeat === "player1" ? "player2" : "player1";
    const move = decide(state, inactive, "normal", { state: 1 }, CARD_CATALOG, 2000);
    expect(move).toBeUndefined();
  });

  it("hard difficulty still returns a legal command", () => {
    const state = startedMatch(404);
    const seat = state.turn.activeSeat;
    const move = decide(state, seat, "hard", { state: 1 }, CARD_CATALOG, 2000);
    expect(move).toBeDefined();
    // Round-trip the move through reduce — it should not be rejected.
    const result = reduce(
      state,
      { commandId: "bot-hard-1", seat, nowMs: 2000, command: move! },
      CARD_CATALOG
    );
    const rejected = result.events.some((e) => e.type === "COMMAND_REJECTED");
    expect(rejected).toBe(false);
  });

  it("plays a card and ends its turn when driven in a loop", () => {
    // Walks the same loop BotRoom.runBotTurnStep performs: legalMoves -> decide
    // -> reduce, capped at 20 iterations. The test passes if within that
    // budget the bot plays at least one card AND ends its turn.
    let state = startedMatch(505);
    const botSeat = state.turn.activeSeat;
    state.players[botSeat].mana = { current: 3, max: 3 };
    let playedCount = 0;
    let endedTurn = false;
    const rng: { state: number } = { state: 7 };
    let nowMs = 2000;
    for (let i = 0; i < 20; i++) {
      if (state.turn.activeSeat !== botSeat) break;
      const move = decide(state, botSeat, "normal", rng, CARD_CATALOG, nowMs);
      if (!move) break;
      const result = reduce(
        state,
        { commandId: `bot-loop-${i}`, seat: botSeat, nowMs, command: move },
        CARD_CATALOG
      );
      state = result.state;
      if (move.type === "playCard") playedCount += 1;
      if (move.type === "endTurn") {
        endedTurn = true;
        break;
      }
      nowMs += 100;
    }
    expect(endedTurn).toBe(true);
    expect(playedCount).toBeGreaterThanOrEqual(1);
  });
});
