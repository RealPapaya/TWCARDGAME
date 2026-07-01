import { CARD_CATALOG_GENERATED } from "./catalog.generated.js";
import type { CardDefinition } from "./types.js";

export const CARD_CATALOG_VERSION = "v1.2.0";
export const CARD_CATALOG: readonly CardDefinition[] = CARD_CATALOG_GENERATED;

const byId = new Map(CARD_CATALOG.map((card) => [card.id, card]));

export function getCardById(id: string): CardDefinition | undefined {
  return byId.get(id);
}

/**
 * Canonical art path for a card, derived purely from its `id`.
 * Card art files are named `<id>.webp` (single source of truth); this is the
 * only place that convention is encoded, so the catalog's `image` field is
 * redundant and must always equal `cardImagePath(card.id)`.
 */
export function cardImagePath(id: string): string {
  return `assets/images/cards/${id}.webp`;
}
