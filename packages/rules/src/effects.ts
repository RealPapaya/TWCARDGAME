export { effectHandlers, resolveEffect } from "./effects/registry.js";
export {
  applyDamage,
  applyNewsPower,
  drawCards,
  finishIfHeroDead,
  handlePlayNews,
  healUnit,
  processEndOfTurn,
  resolveDeaths,
  resolvePostAction,
  startTurn,
  updateAuras,
  updateEnrage
} from "./effects/core.js";
export {
  applyAugmentSelection,
  applyPersistentMinionAugments,
  bumpTier
} from "./effects/augments.js";
export {
  augmentCostMultiplierTenths,
  augmentFlatCostReduction,
  augmentManaRamp,
  defaultAugmentFlags,
  isFrozen,
  isReferendumImmune,
  paysCardCostWithHealth,
  unlockLowHpManaCap
} from "./effects/augmentFlags.js";
