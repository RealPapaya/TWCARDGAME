import { CARD_CATALOG } from "@twcardgame/cards";

/**
 * Port of `defaultDeckIds` (apps/server/src/accounts.ts): a legal 30-card dev
 * deck (15 distinct non-legendary collectible cards × 2). Used when a connection
 * arrives without an explicit deck — sufficient for the PoC / PvP-by-room-code
 * flow before Supabase-backed deck resolution is wired in (Phase 2).
 */
export function defaultDeckIds(): string[] {
  return CARD_CATALOG.filter((card) => card.rarity !== "LEGENDARY" && card.collectible !== false)
    .slice(0, 15)
    .flatMap((card) => [card.id, card.id]);
}
