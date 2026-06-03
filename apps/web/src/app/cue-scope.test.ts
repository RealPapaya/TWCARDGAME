import { describe, expect, it } from "vitest";
import type { GameEvent, GameEventType } from "@twcardgame/shared";
import { classifyBatchScopes, mapEventToCueKind } from "./cue-scope.js";

let nextSeq = 0;
function ev(type: GameEventType, payload?: Record<string, unknown>, seat: GameEvent["seat"] = "player1"): GameEvent {
  return { seq: nextSeq++, type, seat, payload };
}
function reset(): void {
  nextSeq = 0;
}

describe("classifyBatchScopes — combat damage exclusion", () => {
  it("marks the attacker/defender DAMAGE pair after an ATTACK as combat, never AOE", () => {
    reset();
    const attack = ev("ATTACK", { attackerInstanceId: "m1", target: { type: "MINION", instanceId: "m2" } });
    const defender = ev("DAMAGE", { target: "m2", amount: 5 });
    const retaliation = ev("DAMAGE", { target: "m1", amount: 3 });
    const { combatDamageSeqs, aoeClusters } = classifyBatchScopes([attack, defender, retaliation]);
    expect(combatDamageSeqs).toEqual(new Set([defender.seq, retaliation.seq]));
    expect(aoeClusters).toHaveLength(0);
  });

  it("treats a shield pop inside the combat window without ending it", () => {
    reset();
    const attack = ev("ATTACK", { attackerInstanceId: "m1", target: { type: "MINION", instanceId: "m2" } });
    const shield = ev("SHIELD_POPPED", { target: "m2" });
    const retaliation = ev("DAMAGE", { target: "m1", amount: 3 });
    const { combatDamageSeqs } = classifyBatchScopes([attack, shield, retaliation]);
    expect(combatDamageSeqs.has(retaliation.seq)).toBe(true);
  });
});

describe("classifyBatchScopes — AOE clustering", () => {
  it("clusters a board-wide damage (damage-all) into one AOE", () => {
    reset();
    const a = ev("DAMAGE", { target: "e1", amount: 2 }, "player2");
    const b = ev("DAMAGE", { target: "e2", amount: 2 }, "player2");
    const c = ev("DAMAGE", { target: "e3", amount: 2 }, "player2");
    const { aoeClusters, aoeSeqs, combatDamageSeqs } = classifyBatchScopes([a, b, c]);
    expect(combatDamageSeqs.size).toBe(0);
    expect(aoeClusters).toHaveLength(1);
    expect(aoeClusters[0]).toMatchObject({ kind: "aoeSweep", variant: "damage", seat: "player2" });
    expect(aoeClusters[0].memberSeqs).toEqual([a.seq, b.seq, c.seq]);
    expect(aoeSeqs).toEqual(new Set([a.seq, b.seq, c.seq]));
  });

  it("does NOT cluster a single-target battlecry damage", () => {
    reset();
    const played = ev("CARD_PLAYED", { cardId: "x" });
    const dmg = ev("DAMAGE", { target: "e1", amount: 4 }, "player2");
    const { aoeClusters, combatDamageSeqs } = classifyBatchScopes([played, dmg]);
    expect(aoeClusters).toHaveLength(0);
    expect(combatDamageSeqs.size).toBe(0);
  });

  it("excludes combat damage but still clusters a trailing AOE in the same batch", () => {
    reset();
    const attack = ev("ATTACK", { attackerInstanceId: "m1", target: { type: "MINION", instanceId: "m2" } });
    const def = ev("DAMAGE", { target: "m2", amount: 5 });
    const ret = ev("DAMAGE", { target: "m1", amount: 3 });
    const a = ev("DAMAGE", { target: "e1", amount: 1 }, "player2");
    const b = ev("DAMAGE", { target: "e2", amount: 1 }, "player2");
    const { combatDamageSeqs, aoeClusters } = classifyBatchScopes([attack, def, ret, a, b]);
    expect(combatDamageSeqs).toEqual(new Set([def.seq, ret.seq]));
    expect(aoeClusters).toHaveLength(1);
    expect(aoeClusters[0].memberSeqs).toEqual([a.seq, b.seq]);
  });

  it("clusters shield-all and lock-all separately and not with a stat buff", () => {
    reset();
    const shieldA = ev("BUFF", { target: "m1", shield: true });
    const shieldB = ev("BUFF", { target: "m2", shield: true });
    const stat = ev("BUFF", { target: "m3", stat: "ATTACK", value: 2 });
    const { aoeClusters } = classifyBatchScopes([shieldA, shieldB, stat]);
    // shield grant + stat both fall in the "buff" family → one cluster of 3.
    expect(aoeClusters).toHaveLength(1);
    expect(aoeClusters[0].variant).toBe("buff");
  });

  it("clusters lock-all (BUFF with lockedTurns) as a lock sweep, distinct from buffs", () => {
    reset();
    const lockA = ev("BUFF", { target: "e1", lockedTurns: 1 }, "player2");
    const lockB = ev("BUFF", { target: "e2", lockedTurns: 1 }, "player2");
    const buff = ev("BUFF", { target: "m1", stat: "ATTACK", value: 1 });
    const { aoeClusters } = classifyBatchScopes([lockA, lockB, buff]);
    expect(aoeClusters).toHaveLength(1);
    expect(aoeClusters[0]).toMatchObject({ variant: "lock", seat: "player2" });
  });

  it("suppresses a destroy sweep when AOE damage already swept (no double overlay)", () => {
    reset();
    const d1 = ev("DAMAGE", { target: "e1", amount: 9 }, "player2");
    const d2 = ev("DAMAGE", { target: "e2", amount: 9 }, "player2");
    const k1 = ev("DESTROY", { target: "e1", cardId: "c1" }, "player2");
    const k2 = ev("DESTROY", { target: "e2", cardId: "c2" }, "player2");
    const { aoeClusters } = classifyBatchScopes([d1, d2, k1, k2]);
    expect(aoeClusters.map((c) => c.variant)).toEqual(["damage"]);
  });

  it("clusters a pure board-wipe (DESTROY-all, no damage) as a destroy sweep", () => {
    reset();
    const k1 = ev("DESTROY", { target: "e1", cardId: "c1" }, "player2");
    const k2 = ev("DESTROY", { target: "e2", cardId: "c2" }, "player2");
    const { aoeClusters } = classifyBatchScopes([k1, k2]);
    expect(aoeClusters).toHaveLength(1);
    expect(aoeClusters[0]).toMatchObject({ variant: "destroy", seat: "player2" });
  });

  it("sweeps each board separately for a both-board wipe (destroy-all minions)", () => {
    reset();
    const a1 = ev("DESTROY", { target: "m1", cardId: "c1" }, "player1");
    const a2 = ev("DESTROY", { target: "m2", cardId: "c2" }, "player1");
    const b1 = ev("DESTROY", { target: "e1", cardId: "c3" }, "player2");
    const b2 = ev("DESTROY", { target: "e2", cardId: "c4" }, "player2");
    const { aoeClusters } = classifyBatchScopes([a1, a2, b1, b2]);
    expect(aoeClusters).toHaveLength(2);
    expect(aoeClusters.every((c) => c.variant === "destroy")).toBe(true);
    expect(new Set(aoeClusters.map((c) => c.seat))).toEqual(new Set(["player1", "player2"]));
  });

  it("requires ≥2 distinct targets — a single destroy does not sweep", () => {
    reset();
    const k1 = ev("DESTROY", { target: "m1", cardId: "c1" });
    const { aoeClusters } = classifyBatchScopes([k1]);
    expect(aoeClusters).toHaveLength(0);
  });
});

describe("mapEventToCueKind", () => {
  it("splits combat vs effect damage", () => {
    reset();
    expect(mapEventToCueKind(ev("DAMAGE", { target: "m1", amount: 1 }), true)).toBe("damage");
    expect(mapEventToCueKind(ev("DAMAGE", { target: "m1", amount: 1 }), false)).toBe("effectStrike");
  });

  it("maps the remaining effect events", () => {
    reset();
    expect(mapEventToCueKind(ev("HEAL", { target: "m1", amount: 2 }), false)).toBe("heal");
    expect(mapEventToCueKind(ev("SHIELD_POPPED", { target: "m1" }), false)).toBe("shieldPop");
    expect(mapEventToCueKind(ev("BUFF", { target: "m1", lockedTurns: 2 }), false)).toBe("lock");
    expect(mapEventToCueKind(ev("BUFF", { target: "m1", stat: "ATTACK", value: 1 }), false)).toBe("buff");
    expect(mapEventToCueKind(ev("BOUNCE", { target: "m1", cardId: "c" }), false)).toBe("bounce");
    expect(mapEventToCueKind(ev("DESTROY", { target: "m1", cardId: "c" }), false)).toBe("destroy");
    expect(mapEventToCueKind(ev("DEATHRATTLE", { source: "m1", type: "SUMMON" }), false)).toBe("deathrattle");
    expect(mapEventToCueKind(ev("TURN_STARTED", { turn: 2 }), false)).toBeUndefined();
  });
});
