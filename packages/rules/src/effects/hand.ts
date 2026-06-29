import type { EffectHandler } from "../types.js";
import {
  addCardToHand,
  discardDraw,
  discardRandom,
  drawEffect,
  drawIfCardOnBoard,
  drawMinionReduceCost,
  drawNews,
  reduceCostAllHand
} from "./core.js";

export const handHandlers: Record<string, EffectHandler> = {
  ADD_CARD_TO_HAND: addCardToHand,
  DISCARD_DRAW: discardDraw,
  DISCARD_RANDOM: discardRandom,
  DRAW: drawEffect,
  DRAW_IF_CARD_ON_BOARD: drawIfCardOnBoard,
  DRAW_MINION_REDUCE_COST: drawMinionReduceCost,
  DRAW_NEWS: drawNews,
  REDUCE_COST_ALL_HAND: reduceCostAllHand
};
