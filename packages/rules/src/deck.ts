import type { CardDefinition } from "@twcardgame/cards";
import type { Seat } from "@twcardgame/shared";
import type { RuntimeCard } from "./types.js";

export interface DeckValidationResult {
  valid: boolean;
  errors: string[];
}

export interface OwnedCardQuantity {
  cardId: string;
  quantity: number;
}

type OwnedCardsInput = readonly string[] | readonly OwnedCardQuantity[] | ReadonlyMap<string, number>;

export function validateDeck(
  deckIds: readonly string[],
  catalog: readonly CardDefinition[],
  ownedCardIds?: OwnedCardsInput
): DeckValidationResult {
  const errors: string[] = [];
  const cardById = new Map(catalog.map((card) => [card.id, card]));
  const ownership = normalizeOwnership(ownedCardIds);
  const counts = new Map<string, number>();

  if (deckIds.length !== 30) errors.push(`Deck must contain exactly 30 cards; got ${deckIds.length}.`);

  for (const id of deckIds) {
    const card = cardById.get(id);
    if (!card) {
      errors.push(`Unknown card id: ${id}`);
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  for (const [id, count] of counts) {
    const card = cardById.get(id);
    if (!card) continue;
    const limit = card.rarity === "LEGENDARY" ? 1 : 2;
    if (count > limit) errors.push(`${id} exceeds copy limit ${limit}; got ${count}.`);
    const ownedQuantity = ownership?.get(id);
    if (ownership && ownedQuantity === undefined) errors.push(`Card not owned: ${id}`);
    else if (ownedQuantity !== undefined && count > ownedQuantity) {
      errors.push(`${id} exceeds owned quantity ${ownedQuantity}; got ${count}.`);
    }
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

function normalizeOwnership(input: OwnedCardsInput | undefined): ReadonlyMap<string, number> | undefined {
  if (!input) return undefined;

  const ownership = new Map<string, number>();
  if (input instanceof Map) {
    for (const [cardId, quantity] of input) ownership.set(cardId, quantity);
    return ownership;
  }

  for (const item of input as readonly (string | OwnedCardQuantity)[]) {
    if (typeof item === "string") ownership.set(item, Number.POSITIVE_INFINITY);
    else ownership.set(item.cardId, item.quantity);
  }
  return ownership;
}
