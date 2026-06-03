import { describe, expect, it } from "vitest";
import { ANIMATION_COSTS, estimateEventAnimationMs } from "./animationTiming.js";
import type { GameEvent, GameEventType } from "./index.js";

const C = ANIMATION_COSTS;

function ev(type: GameEventType, seq = 0): GameEvent {
  return { seq, type };
}

describe("estimateEventAnimationMs", () => {
  it("returns 0 for empty event list", () => {
    expect(estimateEventAnimationMs([])).toBe(0);
  });

  it("returns 0 for non-visual events only (AURA_UPDATED, TURN_STARTED)", () => {
    expect(
      estimateEventAnimationMs([ev("AURA_UPDATED"), ev("TURN_STARTED")])
    ).toBe(0);
  });

  it("CARD_DRAWN queues multiple draw flights one by one", () => {
    expect(estimateEventAnimationMs([ev("CARD_DRAWN"), ev("CARD_DRAWN")])).toBe(
      C.DRAW_ANIMATION_MS * 2
    );
  });

  it("CARD_PLAYED reserves a full card-play slot tail", () => {
    const tail = estimateEventAnimationMs([ev("CARD_PLAYED")]);
    expect(tail).toBe(C.CARD_PLAY_EFFECT_DELAY_MS + C.POST_PLAY_STATE_SYNC_LAG_MS);
  });

  it("CARD_PLAYED + MINION_SUMMONED do not double-count (same slot)", () => {
    const tail = estimateEventAnimationMs([ev("CARD_PLAYED"), ev("MINION_SUMMONED")]);
    expect(tail).toBe(C.CARD_PLAY_EFFECT_DELAY_MS + C.POST_PLAY_STATE_SYNC_LAG_MS);
  });

  it("CARD_PLAYED + DAMAGE (single-target battlecry) absorbs damage into play tail", () => {
    const tail = estimateEventAnimationMs([ev("CARD_PLAYED"), ev("DAMAGE")]);
    expect(tail).toBe(C.CARD_PLAY_EFFECT_DELAY_MS + C.POST_PLAY_STATE_SYNC_LAG_MS);
  });

  it("CARD_PLAYED + CARD_DRAWN waits for the play effect point before drawing", () => {
    const tail = estimateEventAnimationMs([ev("CARD_PLAYED"), ev("CARD_DRAWN")]);
    expect(tail).toBe(C.CARD_PLAY_EFFECT_DELAY_MS + C.DRAW_ANIMATION_MS);
  });

  it("CARD_PLAYED + DISCARD + two draws waits for discard body before queued draws", () => {
    const tail = estimateEventAnimationMs([
      ev("CARD_PLAYED"),
      ev("DISCARD"),
      ev("CARD_DRAWN"),
      ev("CARD_DRAWN")
    ]);
    expect(tail).toBe(
      C.CARD_PLAY_EFFECT_DELAY_MS + C.DISCARD_CARD_BODY_MS + C.DRAW_ANIMATION_MS * 2
    );
  });

  it("CARD_PLAYED + DESTROY (mass-destroy battlecry) extends to destroy sync lag", () => {
    const tail = estimateEventAnimationMs([ev("CARD_PLAYED"), ev("DESTROY"), ev("DESTROY")]);
    expect(tail).toBe(C.CARD_PLAY_EFFECT_DELAY_MS + C.DESTROY_EFFECT_SYNC_LAG_MS);
  });

  it("CARD_PLAYED + BOUNCE extends to bounce sync lag", () => {
    const tail = estimateEventAnimationMs([ev("CARD_PLAYED"), ev("BOUNCE")]);
    expect(tail).toBe(C.CARD_PLAY_EFFECT_DELAY_MS + C.BOUNCE_EFFECT_SYNC_LAG_MS);
  });

  it("SUMMON_MULTIPLE (CARD_PLAYED + 2 summons) stays within one play slot", () => {
    const tail = estimateEventAnimationMs([
      ev("CARD_PLAYED"),
      ev("MINION_SUMMONED"),
      ev("MINION_SUMMONED")
    ]);
    expect(tail).toBe(C.CARD_PLAY_EFFECT_DELAY_MS + C.POST_PLAY_STATE_SYNC_LAG_MS);
  });

  it("ATTACK + DAMAGE matches lunge tail (no over-count)", () => {
    const tail = estimateEventAnimationMs([ev("ATTACK"), ev("DAMAGE")]);
    expect(tail).toBe(C.ATTACK_LUNGE_MS + C.POST_ATTACK_STATE_SYNC_LAG_MS);
  });

  it("ATTACK with DESTROY uses lunge + destroy sync lag", () => {
    const tail = estimateEventAnimationMs([ev("ATTACK"), ev("DAMAGE"), ev("DESTROY")]);
    expect(tail).toBe(C.ATTACK_LUNGE_MS + C.DESTROY_EFFECT_SYNC_LAG_MS);
  });

  it("standalone DAMAGE without play/attack uses standalone effect duration", () => {
    expect(estimateEventAnimationMs([ev("DAMAGE")])).toBe(C.STANDALONE_EFFECT_MS);
  });

  it("standalone DESTROY uses standalone destroy + sync lag", () => {
    expect(estimateEventAnimationMs([ev("DESTROY")])).toBe(
      C.STANDALONE_DESTROY_MS + C.DESTROY_EFFECT_SYNC_LAG_MS
    );
  });

  it("standalone DEATHRATTLE waits out the soul plume", () => {
    expect(estimateEventAnimationMs([ev("DEATHRATTLE")])).toBe(C.STANDALONE_DEATHRATTLE_MS);
  });

  it("combat kill with DEATHRATTLE extends past the lunge to cover the plume", () => {
    const tail = estimateEventAnimationMs([
      ev("ATTACK"),
      ev("DAMAGE"),
      ev("DESTROY"),
      ev("DEATHRATTLE")
    ]);
    expect(tail).toBe(C.ATTACK_LUNGE_MS + C.DEATHRATTLE_EFFECT_MS);
  });

  it("battlecry-triggered DEATHRATTLE waits past the play effect point", () => {
    const tail = estimateEventAnimationMs([ev("CARD_PLAYED"), ev("DESTROY"), ev("DEATHRATTLE")]);
    expect(tail).toBe(C.CARD_PLAY_EFFECT_DELAY_MS + C.DEATHRATTLE_EFFECT_MS);
  });

  it("is deterministic across repeated calls", () => {
    const events: GameEvent[] = [
      ev("CARD_PLAYED"),
      ev("MINION_SUMMONED"),
      ev("DAMAGE"),
      ev("DESTROY")
    ];
    const a = estimateEventAnimationMs(events);
    const b = estimateEventAnimationMs(events);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(
      C.CARD_PLAY_EFFECT_DELAY_MS + C.DESTROY_EFFECT_SYNC_LAG_MS
    );
  });
});
