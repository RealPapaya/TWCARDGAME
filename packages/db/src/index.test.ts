import { describe, expect, it } from "vitest";
import { assertDeckOwnership, type DeckRow } from "./index.js";

describe("db ownership helpers", () => {
  it("accepts decks owned by the requested user", () => {
    expect(() => assertDeckOwnership(deck("deck-1", "user-1"), "user-1")).not.toThrow();
  });

  it("rejects missing decks", () => {
    expect(() => assertDeckOwnership(null, "user-1")).toThrow("Deck not found.");
  });

  it("rejects decks owned by another user", () => {
    expect(() => assertDeckOwnership(deck("deck-1", "user-2"), "user-1")).toThrow("does not belong");
  });
});

function deck(id: string, userId: string): DeckRow {
  return {
    id,
    user_id: userId,
    name: "Test Deck",
    card_catalog_version: "test",
    card_ids: []
  };
}
