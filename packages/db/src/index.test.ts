import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { assertDeckOwnership, emitUserProgressEvent, type DeckRow } from "./index.js";

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

describe("emitUserProgressEvent", () => {
  it("maps input to the emit_user_progress_event RPC, defaulting amount to 1", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const client = { rpc } as unknown as SupabaseClient;
    await emitUserProgressEvent(client, {
      userId: "u1",
      eventType: "match_won",
      sourceType: "match",
      sourceId: "m1"
    });
    expect(rpc).toHaveBeenCalledWith("emit_user_progress_event", {
      p_user_id: "u1",
      p_event_type: "match_won",
      p_amount: 1,
      p_source_type: "match",
      p_source_id: "m1",
      p_metadata: {}
    });
  });

  it("passes an explicit amount and throws on RPC error", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: new Error("boom") }));
    const client = { rpc } as unknown as SupabaseClient;
    await expect(
      emitUserProgressEvent(client, { userId: "u1", eventType: "damage_dealt", amount: 30 })
    ).rejects.toThrow("boom");
    expect(rpc).toHaveBeenCalledWith("emit_user_progress_event", expect.objectContaining({ p_amount: 30 }));
  });
});
