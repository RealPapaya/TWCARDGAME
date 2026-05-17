import { describe, expect, it } from "vitest";
import { CARD_CATALOG } from "./catalog.js";
import { SUPPORTED_BATTLECRY_EFFECTS } from "./types.js";
import { validateCatalog } from "./validation.js";

describe("card catalog", () => {
  it("validates the seeded v2 catalog", () => {
    const result = validateCatalog(CARD_CATALOG);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("keeps every current battlecry effect in the supported list", () => {
    const effectTypes = new Set(
      CARD_CATALOG.map((card) => card.keywords?.battlecry?.type).filter((type): type is string => !!type)
    );

    for (const type of effectTypes) {
      expect(SUPPORTED_BATTLECRY_EFFECTS).toContain(type);
    }
  });
});
