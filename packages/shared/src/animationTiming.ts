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
  // 抽乾牌庫(疲勞)：骷髏卡從牌庫飛向英雄(FATIGUE_DRAW_MS)後,傷害數字停留一段時間。
  // 客戶端的飛行時間見 apps/web/src/app/draw-animation.ts FATIGUE_DRAW_MS。
  FATIGUE_DRAW_MS: 900,
  FATIGUE_DAMAGE_LINGER_MS: 1150,
  DISCARD_CARD_BODY_MS: 1500,
  ATTACK_LUNGE_MS: 800,
  POST_ATTACK_STATE_SYNC_LAG_MS: 120,
  TECH_ENFORCEMENT_DAMAGE_GAP_MS: 360,
  MINION_DEATH_FADE_MS: 780,
  SUMMON_POP_MS: 600,
  STANDALONE_EFFECT_MS: 1150,
  STANDALONE_BOUNCE_MS: 900,
  STANDALONE_DESTROY_MS: 700,
  // 遺志 soul plume (applyDeathrattlePlume in runtime.ts runs ~1200ms). The bot
  // must wait this out, or it acts over the opponent's deathrattle animation.
  DEATHRATTLE_EFFECT_MS: 1200,
  STANDALONE_DEATHRATTLE_MS: 1350
} as const;

const C = ANIMATION_COSTS;

export function estimateEventAnimationMs(events: GameEvent[]): number {
  if (events.length === 0) return 0;

  let total = 0;
  let playSlots = 0;
  let currentPostPlayDelay = 0;
  let latestDiscardBodyEnd = 0;
  let latestDrawEnd = 0;
  let latestDeathExit = 0;
  let inAttack = false;

  for (const event of events) {
    switch (event.type) {
      case "CARD_PLAYED": {
        inAttack = false;
        latestDeathExit = 0;
        const postPlayDelay =
          playSlots * C.CARD_PLAY_CUE_TOTAL_MS + C.CARD_PLAY_EFFECT_DELAY_MS;
        currentPostPlayDelay = postPlayDelay;
        latestDiscardBodyEnd = 0;
        latestDrawEnd = 0;
        const tail = postPlayDelay + C.POST_PLAY_STATE_SYNC_LAG_MS;
        if (tail > total) total = tail;
        playSlots += 1;
        break;
      }
      case "MINION_SUMMONED": {
        const start = Math.max(currentPostPlayDelay, latestDeathExit);
        if (start > 0) {
          const tail = start + (latestDeathExit > currentPostPlayDelay ? C.SUMMON_POP_MS : C.POST_PLAY_STATE_SYNC_LAG_MS);
          if (tail > total) total = tail;
        } else {
          const tail = C.SUMMON_POP_MS;
          if (tail > total) total = tail;
        }
        break;
      }
      case "ATTACK": {
        inAttack = true;
        currentPostPlayDelay = 0;
        latestDiscardBodyEnd = 0;
        latestDrawEnd = 0;
        latestDeathExit = 0;
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
      case "FATIGUE": {
        // 疲勞:骷髏卡飛行 + 命中後傷害數字停留。讓 bot 等過整段動畫再行動。
        const start = Math.max(currentPostPlayDelay, latestDiscardBodyEnd, latestDrawEnd);
        const tail = start + C.FATIGUE_DRAW_MS + C.FATIGUE_DAMAGE_LINGER_MS;
        latestDrawEnd = tail;
        if (tail > total) total = tail;
        break;
      }
      case "BOUNCE": {
        let tail: number;
        let start: number;
        if (currentPostPlayDelay > 0) {
          start = currentPostPlayDelay;
        } else if (inAttack) {
          start = C.ATTACK_LUNGE_MS;
        } else {
          start = C.STANDALONE_BOUNCE_MS;
        }
        start = Math.max(start, latestDeathExit);
        tail = start + C.BOUNCE_EFFECT_SYNC_LAG_MS;
        if (tail > total) total = tail;
        break;
      }
      case "DESTROY": {
        let tail: number;
        let start: number;
        if (currentPostPlayDelay > 0) {
          start = currentPostPlayDelay;
        } else if (inAttack) {
          start = C.ATTACK_LUNGE_MS;
        } else {
          start = C.STANDALONE_DESTROY_MS;
        }
        tail = start + C.DESTROY_EFFECT_SYNC_LAG_MS;
        latestDeathExit = Math.max(latestDeathExit, start + C.MINION_DEATH_FADE_MS);
        if (tail > total) total = tail;
        break;
      }
      case "DEATHRATTLE": {
        // The plume starts when its destroy/play/attack delay clears, then
        // runs DEATHRATTLE_EFFECT_MS. Mirror the BOUNCE/DESTROY shape.
        let tail: number;
        let start: number;
        if (currentPostPlayDelay > 0) {
          start = currentPostPlayDelay;
        } else if (inAttack) {
          start = C.ATTACK_LUNGE_MS;
        } else {
          start = 0;
        }
        start = Math.max(start, latestDeathExit);
        tail = start > 0 ? start + C.DEATHRATTLE_EFFECT_MS : C.STANDALONE_DEATHRATTLE_MS;
        if (tail > total) total = tail;
        break;
      }
      case "DAMAGE":
      case "HEAL":
      case "BUFF":
      case "SHIELD_POPPED": {
        if (event.type === "DAMAGE" && inAttack && event.payload?.source === "TECH_ENFORCEMENT") {
          const impactDelay = Math.round(C.ATTACK_LUNGE_MS * 0.7);
          const tail = impactDelay + C.TECH_ENFORCEMENT_DAMAGE_GAP_MS + C.POST_ATTACK_STATE_SYNC_LAG_MS;
          if (tail > total) total = tail;
        }
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
