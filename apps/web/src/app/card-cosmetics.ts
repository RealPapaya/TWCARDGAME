// 炫彩包 (Splendor pack) — special alternate card-art cosmetics.
//
// A "炫彩" is an alternate image for a catalog card that a player can OWN
// (granted by opening a 炫彩包) and then CHOOSE to display in place of the
// default art. This module is the single source of truth for the framework:
//
//   - which cards have a 炫彩 image available  → CARD_COSMETICS (the registry,
//     the cardId→asset mapping; assets ship in the web bundle / R2)
//   - which the current player owns            → ownership set (DB: profiles.owned_card_arts)
//   - which the player has switched on         → selection set (DB: profiles.selected_card_arts)
//   - the image a card should actually render  → cosmeticCardImage()
//
// Ownership and the display selection are SERVER TRUTH, mirroring card
// ownership — the account loader feeds both sets, the collection toggle persists
// via the set_user_card_art RPC, and 炫彩包 rewards grant ownership through
// grant_user_cosmetic (kind='card_art'). See packages/db/migrations/0033.

import type { CardDefinition } from "@twcardgame/cards";

export interface CardCosmetic {
  /** Catalog card this alternate art belongs to. */
  cardId: string;
  /** Asset path of the special art — same `assetUrl` conventions as card.image. */
  image: string;
  /** Optional label for the cosmetic; defaults to the card name in the UI. */
  label?: string;
}

/**
 * Registry of available 炫彩 alternate arts, keyed by cardId.
 *
 * Convention: special images live under `images/cards/cosmetic/<cardId>.webp`.
 * Add an entry per card once its 炫彩 art exists, e.g.:
 *
 *   export const CARD_COSMETICS = {
 *     "minion_xxx": { cardId: "minion_xxx", image: "images/cards/cosmetic/minion_xxx.webp" },
 *   } as const;
 */
export const CARD_COSMETICS: Readonly<Record<string, CardCosmetic>> = {
  // 韓國瑜 — first 炫彩 art.
  TW032: { cardId: "TW032", image: "images/cards_skin/1.webp", label: "炫彩・韓國瑜" }
};

export function getCardCosmetic(cardId: string): CardCosmetic | undefined {
  return CARD_COSMETICS[cardId];
}

/** All registered 炫彩 arts (for a gallery listing). */
export function allCardCosmetics(): CardCosmetic[] {
  return Object.values(CARD_COSMETICS);
}

/** The 炫彩 arts the player currently owns — the collection "特殊卡皮" gallery. */
export function ownedCardCosmetics(): CardCosmetic[] {
  return allCardCosmetics().filter((cosmetic) => ownsCardCosmetic(cosmetic.cardId));
}

export function hasCardCosmetic(cardId: string): boolean {
  return cardId in CARD_COSMETICS;
}

// ── ownership + display selection (DB-authoritative) ─────────────────
// Both sets are server truth, mirroring card ownership: ownership comes from
// profiles.owned_card_arts (kept by grant_user_cosmetic), and the display
// selection from profiles.selected_card_arts (toggled via set_user_card_art).
// The account loader feeds both on sign-in; both clear on sign-out. There is no
// localStorage — the player's choice follows their account across devices.

let ownedCosmetics = new Set<string>();
let selectedCosmetics = new Set<string>();

/** Feed owned 炫彩 cardIds (profiles.owned_card_arts) on account load. */
export function setOwnedCardCosmetics(cardIds: Iterable<string>): void {
  ownedCosmetics = new Set(cardIds);
}

/** Feed displayed 炫彩 cardIds (profiles.selected_card_arts) on account load. */
export function setSelectedCardCosmetics(cardIds: Iterable<string>): void {
  selectedCosmetics = new Set(
    [...cardIds].filter((cardId) => hasCardCosmetic(cardId) && ownsCardCosmetic(cardId))
  );
}

/** Clear in-memory cosmetic state (call on sign-out). */
export function clearCosmeticState(): void {
  ownedCosmetics = new Set();
  selectedCosmetics = new Set();
}

export function ownsCardCosmetic(cardId: string): boolean {
  return ownedCosmetics.has(cardId);
}

/** A card can be toggled only when its 炫彩 exists AND the player owns it. */
export function canToggleCardCosmetic(cardId: string): boolean {
  return hasCardCosmetic(cardId) && ownsCardCosmetic(cardId);
}

export function isCardCosmeticEnabled(cardId: string): boolean {
  return ownsCardCosmetic(cardId) && selectedCosmetics.has(cardId);
}

/**
 * Optimistic local mirror of the display selection. The runtime applies this
 * immediately for a snappy toggle, calls set_user_card_art, then reconciles
 * from the reloaded profile (reverting this on RPC failure).
 */
export function applyCardCosmeticSelection(cardId: string, enabled: boolean): void {
  if (enabled && canToggleCardCosmetic(cardId)) selectedCosmetics.add(cardId);
  else selectedCosmetics.delete(cardId);
}

// ── resolution ───────────────────────────────────────────────────────

/**
 * The image a card should render with: the 炫彩 art when it exists, is owned,
 * and is switched on; otherwise the default catalog art. Safe to call for every
 * card — falls through to `card.image` for the common (no-cosmetic) case.
 */
export function cosmeticCardImage(card: Pick<CardDefinition, "id" | "image">): string {
  const cosmetic = CARD_COSMETICS[card.id];
  if (cosmetic && ownsCardCosmetic(card.id) && isCardCosmeticEnabled(card.id)) {
    return cosmetic.image;
  }
  return card.image;
}
