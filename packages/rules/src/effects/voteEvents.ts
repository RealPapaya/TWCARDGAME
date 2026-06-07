import type { CardDefinition, EffectDefinition } from "@twcardgame/cards";
import { SEATS } from "@twcardgame/shared";
import { nextInt } from "../rng.js";
import { addEvent } from "../state.js";
import type { EffectContext, EffectHandler, MatchState, RuntimeCard } from "../types.js";
import { healUnit, summonCard } from "./core.js";
import { isEnvironmentActive } from "./environment.js";

/**
 * 【第 20 回合公投事件 — 集中模組】
 * 所有新增公投事件的效果邏輯都放在這裡，與既有 domain handler 隔離，方便日後
 * 效果累加而不互相干擾。資料 (DB 條目) 在 packages/cards/src/voteEventDb.ts，
 * 透過 registry 的 `...voteEventHandlers` 接上 `resolveEffect`。
 */

/**
 * 鬼門開：雙方「同時」各從自己墓場隨機復活 `count` 隻隨從到自己場上。
 * 某方場上已滿 7 隻 → 該方無法復活，發 `EVENT_NOTICE` 提醒。墓場不足時只復活現有數量。
 * 依固定 seat 順序處理以維持決定性。
 */
export function summonFromGraveyard(effect: EffectDefinition, context: EffectContext): void {
  const { state, events, catalog } = context;
  const count = effect.count ?? 2;
  for (const seat of SEATS) {
    const player = state.players[seat];
    if (player.board.length >= 7) {
      addEvent(state, events, "EVENT_NOTICE", { text: `鬼門開：${player.displayName} 場上已滿，無法復活` }, seat);
      continue;
    }
    const candidates: RuntimeCard[] = player.graveyard.filter((card) => card.type === "MINION");
    for (let i = 0; i < count && candidates.length > 0; i++) {
      const next = nextInt(state.private.rngState, candidates.length);
      state.private.rngState = next.state;
      const card = candidates.splice(next.value, 1)[0];
      const def = catalog.get(card.cardId);
      if (!def || def.type !== "MINION") continue;
      const summoned = summonCard(state, player, def, events);
      if (!summoned) break; // board full mid-way
      const graveIndex = player.graveyard.indexOf(card);
      if (graveIndex >= 0) player.graveyard.splice(graveIndex, 1);
    }
  }
}

/** 金融海嘯：雙方水晶歸 1 重新累加 (後續 startTurn 會 +1 繼續累加)。 */
export function resetManaAll(_effect: EffectDefinition, context: EffectContext): void {
  for (const seat of SEATS) {
    const player = context.state.players[seat];
    player.mana.max = 1;
    player.mana.current = 1;
  }
}

/** 歡慶 12 強冠軍：雙方英雄血量回滿。 */
export function fullHealBothHeroes(_effect: EffectDefinition, context: EffectContext): void {
  for (const seat of SEATS) {
    const player = context.state.players[seat];
    healUnit(context.state, { owner: player, kind: "HERO", unit: player.hero }, player.hero.maxHp, context.events);
  }
}

/** 媽祖大繞境：全場 (雙方) 隨從獲得光盾。 */
export function giveDivineShieldAllBoard(_effect: EffectDefinition, context: EffectContext): void {
  for (const seat of SEATS) {
    const player = context.state.players[seat];
    for (const minion of player.board) {
      minion.keywords.divineShield = true;
      addEvent(context.state, context.events, "BUFF", { target: minion.instanceId, shield: true }, seat);
    }
  }
}

/** 高雄氣爆：雙方各自最右邊的隨從死亡。 */
export function destroyRightmostMinions(_effect: EffectDefinition, context: EffectContext): void {
  for (const seat of SEATS) {
    const board = context.state.players[seat].board;
    const rightmost = board[board.length - 1];
    if (rightmost) rightmost.currentHealth = 0;
  }
}

/**
 * 普發現金：判斷目前是否處於「下一整輪卡牌費用 0」的環境。
 * 由 `getCardActualCost` 讀取。gate `turn.number > appliedTurn` 排除公投當下
 * (第 20 回合)，讓效果精準落在下一整輪 (第 21、22 回合，durationTurns 2)。
 */
export function environmentForcesZeroCost(state: MatchState): boolean {
  const env = state.currentEnvironment;
  if (!env || env.effect.type !== "ENV_COST_ZERO") return false;
  if (!isEnvironmentActive(state, env)) return false;
  return state.turn.number > env.appliedTurn;
}

export const voteEventHandlers: Record<string, EffectHandler> = {
  SUMMON_FROM_GRAVEYARD: summonFromGraveyard,
  RESET_MANA_ALL: resetManaAll,
  FULL_HEAL_BOTH_HEROES: fullHealBothHeroes,
  GIVE_DIVINE_SHIELD_ALL_BOARD: giveDivineShieldAllBoard,
  DESTROY_RIGHTMOST_MINIONS: destroyRightmostMinions,
  // Passive: the actual zero-cost is applied in getCardActualCost via environmentForcesZeroCost.
  ENV_COST_ZERO: () => {}
};
