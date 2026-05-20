import { CARD_CATALOG } from "@twcardgame/cards";
import { AI_THEMES, AI_THEME_DECKS, type AiTheme } from "@twcardgame/shared";
import { describe, expect, it } from "vitest";
import { validateDeck } from "./deck.js";

// The PvE bot plays these fixed themed decks (ported from LEGACY v1). If a deck
// fails validation the BotRoom cannot create a match, so guard every theme.
describe("AI theme decks", () => {
  for (const theme of AI_THEMES) {
    it(`theme "${theme.id}" (${theme.name}) is a legal 30-card deck`, () => {
      const result = validateDeck(AI_THEME_DECKS[theme.id], CARD_CATALOG);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }

  it("every theme's hero card id exists in the catalog and is in its deck", () => {
    for (const theme of AI_THEMES) {
      const hero = CARD_CATALOG.find((card) => card.id === theme.heroCardId);
      expect(hero, `hero ${theme.heroCardId} for ${theme.id}`).toBeDefined();
      expect(AI_THEME_DECKS[theme.id]).toContain(theme.heroCardId);
    }
  });

  it("AI_THEME_DECKS covers exactly the declared themes", () => {
    const declared = AI_THEMES.map((theme) => theme.id).sort();
    const keys = (Object.keys(AI_THEME_DECKS) as AiTheme[]).sort();
    expect(keys).toEqual(declared);
  });
});
