import type { CardDefinition, EffectDefinition } from "./types.js";
import {
  SUPPORTED_BATTLECRY_EFFECTS,
  SUPPORTED_DEATHRATTLE_EFFECTS,
  SUPPORTED_ENRAGE_EFFECTS,
  SUPPORTED_ONGOING_EFFECTS,
  SUPPORTED_ON_DISCARD_ACTIONS,
  SUPPORTED_QUEST_EFFECTS,
  SUPPORTED_TRIGGERED_EFFECTS
} from "./types.js";
import { CardSchema } from "./schema.js";

export interface CatalogValidationResult {
  valid: boolean;
  errors: string[];
}

const battlecryTypes = new Set<string>(SUPPORTED_BATTLECRY_EFFECTS);
const deathrattleTypes = new Set<string>(SUPPORTED_DEATHRATTLE_EFFECTS);
const ongoingTypes = new Set<string>(SUPPORTED_ONGOING_EFFECTS);
const triggeredTypes = new Set<string>(SUPPORTED_TRIGGERED_EFFECTS);
const enrageTypes = new Set<string>(SUPPORTED_ENRAGE_EFFECTS);
const questEffectTypes = new Set<string>(SUPPORTED_QUEST_EFFECTS);
const onDiscardActions = new Set<string>(SUPPORTED_ON_DISCARD_ACTIONS);

export function validateCatalog(cards: readonly CardDefinition[]): CatalogValidationResult {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const [index, card] of cards.entries()) {
    const parsed = CardSchema.safeParse(card);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${card.id || `card[${index}]`}: ${issue.path.join(".") || "card"} ${issue.message}`);
      }
      continue;
    }

    if (ids.has(card.id)) errors.push(`${card.id}: duplicate card id`);
    ids.add(card.id);

    checkEffect(errors, card.id, "battlecry", card.keywords?.battlecry, battlecryTypes);
    checkEffect(errors, card.id, "deathrattle", card.keywords?.deathrattle, deathrattleTypes);
    checkEffect(errors, card.id, "ongoing", card.keywords?.ongoing, ongoingTypes);
    checkEffect(errors, card.id, "triggered", card.keywords?.triggered, triggeredTypes);
    checkEffect(errors, card.id, "enrage", card.keywords?.enrage, enrageTypes);
    checkQuest(errors, card);
    checkOnDiscard(errors, card);
  }

  for (const card of cards) {
    const refs = referencedCards(card);
    for (const ref of refs) {
      if (!ids.has(ref)) errors.push(`${card.id}: references missing card ${ref}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function checkEffect(
  errors: string[],
  cardId: string,
  label: string,
  effect: EffectDefinition | undefined,
  supported: Set<string>
): void {
  if (!effect) return;
  if (!effect.type) {
    errors.push(`${cardId}: ${label} effect requires type`);
    return;
  }
  if (!supported.has(effect.type)) errors.push(`${cardId}: unsupported ${label} effect ${effect.type}`);
  checkRequiredFields(errors, cardId, label, effect);
}

function checkQuest(errors: string[], card: CardDefinition): void {
  const quest = card.keywords?.quest;
  if (!quest) return;
  if (typeof quest.turns !== "number" || quest.turns < 1) {
    errors.push(`${card.id}: quest requires positive turns`);
  }
  if (!quest.summonCardId && !quest.effect) {
    errors.push(`${card.id}: quest requires summonCardId or effect`);
  }
  if (quest.effect) checkEffect(errors, card.id, "quest.effect", quest.effect, questEffectTypes);
}

function checkOnDiscard(errors: string[], card: CardDefinition): void {
  const action = card.keywords?.onDiscard;
  if (!action) return;
  if (!onDiscardActions.has(action)) errors.push(`${card.id}: unsupported onDiscard action ${action}`);
}

function checkRequiredFields(errors: string[], cardId: string, label: string, effect: EffectDefinition): void {
  switch (effect.type) {
    case "ADD_CARD_TO_HAND":
      requireCardId(errors, cardId, label, effect);
      break;
    case "BOUNCE":
    case "BOUNCE_CATEGORY":
    case "BOUNCE_TARGET":
    case "BUFF_HEALTH_AND_TAUNT_TARGET":
    case "BUFF_STAT_TARGET":
    case "BUFF_STAT_TARGET_CATEGORY_BONUS":
    case "BUFF_STAT_TARGET_TEMP":
    case "DAMAGE":
    case "DAMAGE_AND_DRAW_IF_KILL":
    case "DAMAGE_NON_CATEGORY":
    case "DESTROY":
    case "DESTROY_DAMAGED":
    case "DESTROY_HIGH_ATTACK":
    case "DESTROY_LOCKED":
    case "DESTROY_LOW_ATTACK":
    case "EAT_FRIENDLY":
    case "FULL_HEAL":
    case "FULL_HEAL_AND_DRAW":
    case "FULL_HEAL_BUFF_TARGET_CATEGORY_BONUS":
    case "GIVE_DIVINE_SHIELD":
    case "HEAL":
    case "HEAL_CATEGORY_BONUS":
    case "LOCK_ATTACK":
    case "SET_DEATH_TIMER":
    case "SWAP_ATTACK_HEALTH":
    case "UNLOCK_AND_BUFF_HEALTH":
      requireTarget(errors, cardId, label, effect);
      break;
  }

  switch (effect.type) {
    case "BUFF_ADJACENT":
    case "BUFF_ADJACENT_HEALTH":
    case "BUFF_ALL":
    case "BUFF_CATEGORY":
    case "BUFF_HEALTH_AND_TAUNT_TARGET":
    case "BUFF_STAT_TARGET":
    case "BUFF_STAT_TARGET_CATEGORY_BONUS":
    case "BUFF_STAT_TARGET_TEMP":
    case "DAMAGE":
    case "DAMAGE_ALL_ENEMY_MINIONS":
    case "DAMAGE_ALL_NON_CATEGORIES":
    case "DAMAGE_AND_DRAW_IF_KILL":
    case "DAMAGE_NON_CATEGORY":
    case "DAMAGE_RANDOM_FRIENDLY":
    case "DAMAGE_SELF":
    case "DRAW":
    case "DRAW_IF_CARD_ON_BOARD":
    case "DRAW_IF_HAND_EMPTY":
    case "DRAW_MINION_REDUCE_COST":
    case "FULL_HEAL_BUFF_TARGET_CATEGORY_BONUS":
    case "HEAL":
    case "HEAL_CATEGORY_BONUS":
    case "LOCK_ALL_AND_BUFF_CATEGORY":
    case "LOCK_ALL_ENEMY":
    case "LOCK_ATTACK":
    case "LOCK_SELF":
    case "MULTI_DAMAGE":
    case "REDUCE_COST_ALL_HAND":
    case "SET_ATTACK_ALL":
    case "SET_DEATH_TIMER":
    case "UNLOCK_AND_BUFF_HEALTH":
    case "BUFF_STAT":
    case "DAMAGE_ALL_MINIONS":
      requireNumber(errors, cardId, label, effect, "value");
      break;
  }

  switch (effect.type) {
    case "BUFF_ALL":
    case "BUFF_CATEGORY":
    case "BUFF_STAT_TARGET":
    case "BUFF_STAT_TARGET_CATEGORY_BONUS":
    case "BUFF_STAT":
      requireString(errors, cardId, label, effect.stat, "stat");
      break;
  }

  switch (effect.type) {
    case "BOUNCE_ALL_CATEGORY":
    case "BOUNCE_CATEGORY":
    case "BUFF_STAT_TARGET_CATEGORY_BONUS":
    case "DAMAGE_NON_CATEGORY":
    case "FULL_HEAL_BUFF_TARGET_CATEGORY_BONUS":
    case "HEAL_CATEGORY_BONUS":
      requireAnyString(errors, cardId, label, effect, ["target_category_includes", "target_category"]);
      break;
    case "BUFF_CATEGORY":
    case "GIVE_DIVINE_SHIELD_CATEGORY":
    case "LOCK_ALL_AND_BUFF_CATEGORY":
      requireString(errors, cardId, label, effect.target_category, "target_category");
      break;
  }

  switch (effect.type) {
    case "DAMAGE_ALL_NON_CATEGORIES":
      if (!effect.excluded_categories || effect.excluded_categories.length === 0) {
        errors.push(`${cardId}: ${label} effect ${effect.type} requires excluded_categories`);
      }
      break;
    case "DISCARD_DRAW":
      requireNumber(errors, cardId, label, effect, "discardCount");
      requireNumber(errors, cardId, label, effect, "drawCount");
      break;
    case "GIVE_KEYWORD_ADJACENT":
      requireString(errors, cardId, label, effect.keyword, "keyword");
      break;
    case "LOCK_ALL_AND_BUFF_CATEGORY":
      requireString(errors, cardId, label, effect.buff_stat, "buff_stat");
      requireNumber(errors, cardId, label, effect, "buff_value");
      break;
    case "SUMMON":
    case "AUG_ADD_CARD_TO_HAND":
    case "AUG_SUMMON_CARD":
    case "DRAW_IF_CARD_ON_BOARD":
      requireCardId(errors, cardId, label, effect);
      break;
    case "SUMMON_MULTIPLE":
      requireCardId(errors, cardId, label, effect);
      requireNumber(errors, cardId, label, effect, "count");
      break;
    case "DAMAGE_OWN_HERO":
      requireNumber(errors, cardId, label, effect, "value");
      break;
  }

  if (effect.summon && effect.summon.length === 0) {
    errors.push(`${cardId}: ${label} effect ${effect.type} requires summon to include at least one card id`);
  }
}

function referencedCards(card: CardDefinition): string[] {
  const refs: string[] = [];
  const collect = (effect?: EffectDefinition) => {
    if (!effect) return;
    if (effect.cardId) refs.push(effect.cardId);
    if (effect.summonCardId) refs.push(effect.summonCardId);
    if (effect.summon) refs.push(...effect.summon);
    if (effect.effect) collect(effect.effect);
  };
  collect(card.keywords?.battlecry);
  collect(card.keywords?.deathrattle);
  collect(card.keywords?.ongoing);
  collect(card.keywords?.enrage);
  collect(card.keywords?.triggered);
  collect(card.keywords?.quest);
  return refs;
}

function requireTarget(errors: string[], cardId: string, label: string, effect: EffectDefinition): void {
  if (!effect.target) errors.push(`${cardId}: ${label} effect ${effect.type} requires target`);
}

function requireCardId(errors: string[], cardId: string, label: string, effect: EffectDefinition): void {
  requireString(errors, cardId, label, effect.cardId, "cardId");
}

function requireNumber(
  errors: string[],
  cardId: string,
  label: string,
  effect: EffectDefinition,
  field: keyof Pick<EffectDefinition, "value" | "count" | "discardCount" | "drawCount" | "buff_value">
): void {
  if (typeof effect[field] !== "number") errors.push(`${cardId}: ${label} effect ${effect.type} requires ${field}`);
}

function requireString(
  errors: string[],
  cardId: string,
  label: string,
  value: string | undefined,
  field: string
): void {
  if (!value) errors.push(`${cardId}: ${label} effect requires ${field}`);
}

function requireAnyString(
  errors: string[],
  cardId: string,
  label: string,
  effect: EffectDefinition,
  fields: Array<keyof Pick<EffectDefinition, "target_category" | "target_category_includes">>
): void {
  if (!fields.some((field) => typeof effect[field] === "string" && effect[field]!.length > 0)) {
    errors.push(`${cardId}: ${label} effect ${effect.type} requires ${fields.join(" or ")}`);
  }
}
