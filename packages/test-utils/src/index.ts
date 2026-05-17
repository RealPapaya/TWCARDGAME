import { CARD_CATALOG, CARD_CATALOG_VERSION } from "@twcardgame/cards";
import { createInitialMatch } from "@twcardgame/rules";

export function legalSeedDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}

export function createSeededTestMatch(seed = 1234) {
  return createInitialMatch({
    matchId: `test-${seed}`,
    cardCatalogVersion: CARD_CATALOG_VERSION,
    seed,
    nowMs: 1000,
    catalog: CARD_CATALOG,
    players: [
      { seat: "player1", userId: "p1", displayName: "P1", deckIds: legalSeedDeckIds() },
      { seat: "player2", userId: "p2", displayName: "P2", deckIds: legalSeedDeckIds() }
    ]
  });
}
