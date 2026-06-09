import { CARD_CATALOG_GENERATED } from "./catalog.generated.js";
import type { CardDefinition } from "./types.js";

export const CARD_CATALOG_VERSION = "v1.2.0";
export const CARD_CATALOG: readonly CardDefinition[] = CARD_CATALOG_GENERATED;

const byId = new Map(CARD_CATALOG.map((card) => [card.id, card]));

export function getCardById(id: string): CardDefinition | undefined {
  return byId.get(id);
}
