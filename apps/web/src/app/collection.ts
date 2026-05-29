import type { CardDefinition } from "@twcardgame/cards";
import type { CollectionRow, CollectionSort } from "./types.js";

export interface CollectionFilters {
  category: string;
  rarity: string;
  search: string;
  sort: CollectionSort;
}

export function buildCollectionMap(rows: readonly CollectionRow[]): Map<string, number> {
  const collection = new Map<string, number>();
  for (const row of rows) {
    collection.set(row.card_id, (collection.get(row.card_id) ?? 0) + row.quantity);
  }
  return collection;
}

export function collectionQuantity(card: Pick<CardDefinition, "id">, collectionMap: Map<string, number>): number {
  return collectionMap.get(card.id) ?? 0;
}

export function ownedCollectionCards(
  cards: readonly CardDefinition[],
  collectionMap: Map<string, number>
): CardDefinition[] {
  return cards.filter((card) => card.collectible !== false && collectionQuantity(card, collectionMap) > 0);
}

export function ownedCollectionTypeCount(cards: readonly CardDefinition[], collectionMap: Map<string, number>): number {
  return ownedCollectionCards(cards, collectionMap).length;
}

export function filterOwnedCollectionCards(
  cards: readonly CardDefinition[],
  collectionMap: Map<string, number>,
  filters: CollectionFilters
): CardDefinition[] {
  const search = filters.search.trim().toLowerCase();
  return ownedCollectionCards(cards, collectionMap)
    .filter((card) => {
      if (filters.category !== "all" && card.category !== filters.category) return false;
      if (filters.rarity !== "all" && card.rarity !== filters.rarity) return false;
      if (!search) return true;
      return (
        card.name.toLowerCase().includes(search) ||
        card.category.toLowerCase().includes(search) ||
        card.description.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => compareCollectionCards(a, b, filters.sort));
}

export function compareCollectionCards(a: CardDefinition, b: CardDefinition, sort: CollectionSort): number {
  if (sort === "cost-desc") return b.cost - a.cost || a.name.localeCompare(b.name, "zh-Hant");
  if (sort === "rarity") return rarityRank(b.rarity) - rarityRank(a.rarity) || a.cost - b.cost || a.name.localeCompare(b.name, "zh-Hant");
  if (sort === "name") return a.name.localeCompare(b.name, "zh-Hant");
  return a.cost - b.cost || a.name.localeCompare(b.name, "zh-Hant");
}

function rarityRank(rarity: string): number {
  if (rarity === "LEGENDARY") return 5;
  if (rarity === "EPIC") return 4;
  if (rarity === "RARE") return 3;
  if (rarity === "COMMON") return 2;
  return 1;
}
