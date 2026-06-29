import type { GameEvent } from "@twcardgame/shared";
import { addEvent } from "../state.js";
import type { MatchState, PlayerState } from "../types.js";

/**
 * 疲勞(抽乾牌庫)機制 —— 獨立模組。
 *
 * 當玩家牌庫已空,卻仍要抽牌時(回合開始的固定抽牌、或卡牌效果造成的抽牌),
 * 就累加一層疲勞並對「自己的英雄」造成等量傷害:第一次 1 點、第二次 2 點、
 * 第三次 3 點…依此類推,整場累加且永不重置(同爐石的 fatigue)。
 *
 * 這裡只負責「層數 +1、扣血、發事件」;是否因此致死交由呼叫端
 * (drawCards 抽完後呼叫 finishIfHeroDead)判定,讓本模組維持單一職責、易測試。
 *
 * 純函式、無 DOM / 無亂數 / 無 Date —— 符合 packages/rules 的決定論不變式。
 */
export function applyFatigue(state: MatchState, player: PlayerState, events: GameEvent[]): void {
  player.fatigue += 1;
  const amount = player.fatigue;
  player.hero.hp -= amount;
  // target / remainingHealth 與 DAMAGE 事件同形,讓客戶端能在命中當下直接落下英雄
  // 的血量數字(不必等被保留的 publicSync flush);fatigue 欄位則供動畫顯示層數。
  addEvent(
    state,
    events,
    "FATIGUE",
    {
      target: `${player.seat}:hero`,
      amount,
      fatigue: amount,
      remainingHealth: player.hero.hp
    },
    player.seat
  );
}
