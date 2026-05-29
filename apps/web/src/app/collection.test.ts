import { describe, expect, it } from "vitest";
import type { CardDefinition } from "@twcardgame/cards";
import {
  buildCollectionMap,
  collectionQuantity,
  filterOwnedCollectionCards,
  ownedCollectionCards,
  ownedCollectionTypeCount
} from "./collection.js";

const cards = [
  card("A", "Alpha", "COMMON", "News"),
  card("B", "Beta", "RARE", "People"),
  card("C", "Gamma", "EPIC", "News"),
  card("D", "Hidden", "COMMON", "News", false)
];

describe("collection helpers", () => {
  it("uses DB collection rows as the owned-card source of truth", () => {
    const collection = buildCollectionMap([
      { card_id: "A", quantity: 2 },
      { card_id: "B", quantity: 0 },
      { card_id: "Z", quantity: 9 }
    ]);

    expect(collectionQuantity(cards[0], collection)).toBe(2);
    expect(collectionQuantity(cards[1], collection)).toBe(0);
    expect(ownedCollectionCards(cards, collection).map((owned) => owned.id)).toEqual(["A"]);
    expect(ownedCollectionTypeCount(cards, collection)).toBe(1);
  });

  it("never returns unowned or uncollectible cards to the collection grid", () => {
    const collection = buildCollectionMap([
      { card_id: "A", quantity: 1 },
      { card_id: "B", quantity: 0 },
      { card_id: "D", quantity: 5 }
    ]);

    const filtered = filterOwnedCollectionCards(cards, collection, {
      category: "all",
      rarity: "all",
      search: "",
      sort: "cost-asc"
    });

    expect(filtered.map((owned) => owned.id)).toEqual(["A"]);
  });

  it("filters and sorts only within the owned DB-backed set", () => {
    const collection = buildCollectionMap([
      { card_id: "A", quantity: 1 },
      { card_id: "C", quantity: 1 }
    ]);

    const filtered = filterOwnedCollectionCards(cards, collection, {
      category: "News",
      rarity: "all",
      search: "gamma",
      sort: "name"
    });

    expect(filtered.map((owned) => owned.id)).toEqual(["C"]);
  });
});

function card(
  id: string,
  name: string,
  rarity: CardDefinition["rarity"],
  category: string,
  collectible = true
): CardDefinition {
  return {
    id,
    name,
    rarity,
    category,
    collectible,
    type: "NEWS",
    cost: 1,
    description: `${name} description`,
    image: `${id}.webp`
  };
}
