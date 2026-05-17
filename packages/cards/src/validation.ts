import type { CardDefinition, EffectDefinition } from "./types.js";
import {
  SUPPORTED_BATTLECRY_EFFECTS,
  SUPPORTED_DEATHRATTLE_EFFECTS,
  SUPPORTED_ONGOING_EFFECTS,
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
    checkQuest(errors, card);
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
  collect(card.keywords?.quest);
  return refs;
}
