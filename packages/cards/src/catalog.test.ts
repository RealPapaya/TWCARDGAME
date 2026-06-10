import { describe, expect, it } from "vitest";
import { CARD_CATALOG } from "./catalog.js";
import { SUPPORTED_BATTLECRY_EFFECTS, type CardDefinition } from "./types.js";
import { validateCatalog } from "./validation.js";

describe("card catalog", () => {
  it("validates the seeded v2 catalog", () => {
    const result = validateCatalog(CARD_CATALOG);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("defines nuclear waste as a non-collectible token with owner-damage deathrattle", () => {
    const waste = CARD_CATALOG.find((card) => card.id === "TW077");
    expect(waste).toMatchObject({
      name: "核廢料",
      category: "物品",
      cost: 1,
      attack: 0,
      health: 2,
      collectible: false,
      keywords: { deathrattle: { type: "DAMAGE_OWN_HERO", value: 2 } }
    });
  });

  it("defines betel nut as a 4-cost full heal with +2 health and labor attack", () => {
    const betelNut = CARD_CATALOG.find((card) => card.id === "S029");
    expect(betelNut).toMatchObject({
      name: "檳榔",
      cost: 4,
      description: "將一名隨從生命全部恢復，並增加2點生命。如果是勞工，再增加2點攻擊。",
      keywords: {
        battlecry: {
          type: "FULL_HEAL_BUFF_TARGET_CATEGORY_BONUS",
          value: 2,
          bonus_value: 2,
          target_category_includes: "勞工"
        }
      }
    });
  });

  it("keeps every current battlecry effect in the supported list", () => {
    const effectTypes = new Set(
      CARD_CATALOG.map((card) => card.keywords?.battlecry?.type).filter((type): type is string => !!type)
    );

    for (const type of effectTypes) {
      expect(SUPPORTED_BATTLECRY_EFFECTS).toContain(type);
    }
  });

  it("rejects effects that omit required high-risk fields", () => {
    const result = validateCatalog([
      testMinion("A", { keywords: { battlecry: { type: "DAMAGE" } } })
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("A: battlecry effect DAMAGE requires target");
    expect(result.errors).toContain("A: battlecry effect DAMAGE requires value");
  });

  it("rejects unsupported hook types and on-discard actions", () => {
    const result = validateCatalog([
      testMinion("A", { keywords: { enrage: { type: "BUFF_HEALTH", value: 1, stat: "HEALTH" } } }),
      testMinion("B", { keywords: { onDiscard: "DRAW" } })
    ]);

    expect(result.errors).toContain("A: unsupported enrage effect BUFF_HEALTH");
    expect(result.errors).toContain("B: unsupported onDiscard action DRAW");
  });

  it("rejects bad nested quest effects", () => {
    const result = validateCatalog([
      testMinion("A", { keywords: { quest: { turns: 2, effect: { type: "DAMAGE", value: 1 } } } }),
      testMinion("B", { keywords: { quest: { turns: 2, effect: { type: "DAMAGE_ALL_MINIONS" } } } })
    ]);

    expect(result.errors).toContain("A: unsupported quest.effect effect DAMAGE");
    expect(result.errors).toContain("B: quest.effect effect DAMAGE_ALL_MINIONS requires value");
  });

  it("rejects missing referenced cards across nested effects", () => {
    const result = validateCatalog([
      testMinion("A", { keywords: { battlecry: { type: "ADD_CARD_TO_HAND", cardId: "MISSING" } } }),
      testMinion("B", { keywords: { quest: { turns: 1, summonCardId: "ALSO_MISSING" } } })
    ]);

    expect(result.errors).toContain("A: references missing card MISSING");
    expect(result.errors).toContain("B: references missing card ALSO_MISSING");
  });
});

function testMinion(id: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: id,
    category: "test",
    cost: 1,
    type: "MINION",
    rarity: "COMMON",
    description: "",
    image: "x.webp",
    attack: 1,
    health: 1,
    ...overrides
  };
}
