import type { GameEvent } from "./index.js";

// Mirrors the client cue timing in apps/web/src/runtime.ts.
//   ATTACK_LUNGE_MS / POST_ATTACK_STATE_SYNC_LAG_MS — lines 83-85
//   CARD_PLAY_* / POST_PLAY_STATE_SYNC_LAG_MS / *_EFFECT_SYNC_LAG_MS — lines 5127-5137
//   cue lifetimes (play/damage/heal/bounce/destroy/summon) — lines 5473-5480
// Keep in lock-step with runtime.ts; this is the single source of truth the
// server uses to pace bot actions behind opponent animations.
export const ANIMATION_COSTS = {
  CARD_PLAY_CUE_TOTAL_MS: 1300,
  CARD_PLAY_FULL_MS: 2100,
  CARD_PLAY_EFFECT_DELAY_MS: 2260,
  POST_PLAY_STATE_SYNC_LAG_MS: 180,
  BOUNCE_EFFECT_SYNC_LAG_MS: 650,
  DESTROY_EFFECT_SYNC_LAG_MS: 820,
  DRAW_ANIMATION_MS: 1400,
  DISCARD_CARD_BODY_MS: 1500,
  ATTACK_LUNGE_MS: 800,
  POST_ATTACK_STATE_SYNC_LAG_MS: 120,
  STANDALONE_EFFECT_MS: 1150,
  STANDALONE_BOUNCE_MS: 900,
  STANDALONE_DESTROY_MS: 700
} as const;

const C = ANIMATION_COSTS;

export function estimateEventAnimationMs(events: GameEvent[]): number {
  if (events.length === 0) return 0;

  let total = 0;
  let playSlots = 0;
  let currentPostPlayDelay = 0;
  let latestDiscardBodyEnd = 0;
  let latestDrawEnd = 0;
  let inAttack = false;

  for (const event of events) {
    switch (event.type) {
      case "CARD_PLAYED": {
        const postPlayDelay =
          playSlots * C.CARD_PLAY_CUE_TOTAL_MS + C.CARD_PLAY_EFFECT_DELAY_MS;
        currentPostPlayDelay = postPlayDelay;
        latestDiscardBodyEnd = 0;
        latestDrawEnd = 0;
        const tail = postPlayDelay + C.POST_PLAY_STATE_SYNC_LAG_MS;
        if (tail > total) total = tail;
        playSlots += 1;
        inAttack = false;
        break;
      }
      case "MINION_SUMMONED": {
        if (currentPostPlayDelay > 0) {
          const tail = currentPostPlayDelay + C.POST_PLAY_STATE_SYNC_LAG_MS;
          if (tail > total) total = tail;
        } else {
          const tail = C.CARD_PLAY_EFFECT_DELAY_MS + C.POST_PLAY_STATE_SYNC_LAG_MS;
          if (tail > total) total = tail;
        }
        break;
      }
      case "ATTACK": {
        inAttack = true;
        currentPostPlayDelay = 0;
        latestDiscardBodyEnd = 0;
        latestDrawEnd = 0;
        const tail = C.ATTACK_LUNGE_MS + C.POST_ATTACK_STATE_SYNC_LAG_MS;
        if (tail > total) total = tail;
        break;
      }
      case "DISCARD": {
        const start = currentPostPlayDelay > 0 ? currentPostPlayDelay : 0;
        const tail = start + C.DISCARD_CARD_BODY_MS;
        latestDiscardBodyEnd = Math.max(latestDiscardBodyEnd, tail);
        if (tail > total) total = tail;
        break;
      }
      case "CARD_DRAWN": {
        const start = Math.max(currentPostPlayDelay, latestDiscardBodyEnd, latestDrawEnd);
        const tail = start + C.DRAW_ANIMATION_MS;
        latestDrawEnd = tail;
        if (tail > total) total = tail;
        break;
      }
      case "BOUNCE": {
        let tail: number;
        if (currentPostPlayDelay > 0) {
          tail = currentPostPlayDelay + C.BOUNCE_EFFECT_SYNC_LAG_MS;
        } else if (inAttack) {
          tail = C.ATTACK_LUNGE_MS + C.BOUNCE_EFFECT_SYNC_LAG_MS;
        } else {
          tail = C.STANDALONE_BOUNCE_MS + C.BOUNCE_EFFECT_SYNC_LAG_MS;
        }
        if (tail > total) total = tail;
        break;
      }
      case "DESTROY": {
        let tail: number;
        if (currentPostPlayDelay > 0) {
          tail = currentPostPlayDelay + C.DESTROY_EFFECT_SYNC_LAG_MS;
        } else if (inAttack) {
          tail = C.ATTACK_LUNGE_MS + C.DESTROY_EFFECT_SYNC_LAG_MS;
        } else {
          tail = C.STANDALONE_DESTROY_MS + C.DESTROY_EFFECT_SYNC_LAG_MS;
        }
        if (tail > total) total = tail;
        break;
      }
      case "DAMAGE":
      case "HEAL":
      case "BUFF":
      case "SHIELD_POPPED": {
        if (currentPostPlayDelay === 0 && !inAttack) {
          if (C.STANDALONE_EFFECT_MS > total) total = C.STANDALONE_EFFECT_MS;
        }
        break;
      }
      default:
        break;
    }
  }

  return total > 0 ? total : 0;
}
