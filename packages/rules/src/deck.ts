import type { CardDefinition } from "@twcardgame/cards";
import type { Seat } from "@twcardgame/shared";
import type { RuntimeCard } from "./types.js";

export interface DeckValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateDeck(
  deckIds: readonly string[],
  catalog: readonly CardDefinition[],
  ownedCardIds?: readonly string[]
): DeckValidationResult {
  const errors: string[] = [];
  const cardById = new Map(catalog.map((card) => [card.id, card]));
  const owned = ownedCardIds ? new Set(ownedCardIds) : undefined;
  const counts = new Map<string, number>();

  if (deckIds.length !== 30) errors.push(`Deck must contain exactly 30 cards; got ${deckIds.length}.`);

  for (const id of deckIds) {
    const card = cardById.get(id);
    if (!card) {
      errors.push(`Unknown card id: ${id}`);
      continue;
    }
    if (owned && !owned.has(id)) errors.push(`Card not owned: ${id}`);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  for (const [id, count] of counts) {
    const card = cardById.get(id);
    if (!card) continue;
    const limit = card.rarity === "LEGENDARY" ? 1 : 2;
    if (count > limit) errors.push(`${id} exceeds copy limit ${limit}; got ${count}.`);
  }

  return { valid: errors.length === 0, errors };
}

export function createRuntimeCard(card: CardDefinition, ownerSeat: Seat, instanceId: string): RuntimeCard {
  return {
    instanceId,
    cardId: card.id,
    ownerSeat,
    name: card.name,
    category: card.category,
    cost: card.cost,
    type: card.type,
    rarity: card.rarity,
    description: card.description,
    image: card.image,
    attack: card.attack,
    health: card.health,
    keywords: structuredClone(card.keywords ?? {}),
    bounce_bonus: card.bounce_bonus
  };
}
