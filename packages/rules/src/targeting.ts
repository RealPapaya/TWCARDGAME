import type { EffectDefinition } from "@twcardgame/cards";
import type { TargetRef } from "@twcardgame/shared";

type TargetRuleType = NonNullable<EffectDefinition["target"]>["type"];

export function effectNeedsTarget(effect: EffectDefinition | undefined): boolean {
  return Boolean(effect?.target);
}

export function targetTypesForRule(type: TargetRuleType): Array<TargetRef["type"]> {
  if (type === "MINION") return ["MINION"];
  if (type === "HERO") return ["HERO"];
  return ["HERO", "MINION"];
}
