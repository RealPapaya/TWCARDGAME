// Static card / augment / event "as seen in battle" previews for the balance editor.
//
// These call the SAME markup builders the live battle UI uses
// (apps/web/src/app/card-markup.ts), so importing apps/web/src/styles.css gives a
// pixel-faithful preview without booting the game (Colyseus, audio, DOM patching).
// There is no hand-copied markup here to drift — only the editor-specific inputs
// (plain description, image-by-convention) are computed locally.
import type { CardDefinition, AmplificationDbEntry, VoteEventDbEntry } from "@twcardgame/cards";
import { escapeAttr, escapeHtml } from "./ui.js";
import {
  renderCardFaceMarkup,
  renderAugmentOptionMarkup,
  renderVoteOptionMarkup
} from "./app/card-markup.js";

// Mirror of runtime.ts AMP_TIER_CLASS.
const AMP_TIER_CLASS: Record<string, string> = {
  加減賺: "amp-tier-low",
  蕭貪: "amp-tier-mid",
  卯死: "amp-tier-high"
};

/** Augment icon path by convention: /images/augments/<id lowercased>.webp */
function augmentImageSrc(id: string): string {
  return `/images/augments/${id.toLowerCase()}.webp`;
}

/** Vote-event image path by convention: /images/events/<id lowercased>.webp */
function voteEventImageSrc(id: string): string {
  return `/images/events/${id.toLowerCase()}.webp`;
}

/** A card exactly as it appears in hand — wraps the shared card face in `.card`. */
export function renderCardPreview(card: CardDefinition): string {
  const face = renderCardFaceMarkup({
    costClass: "card-cost",
    shownCost: card.cost,
    name: card.name,
    image: card.image,
    category: card.category,
    descriptionHtml: escapeHtml(card.description),
    type: card.type,
    attack: card.attack,
    health: card.health,
    attackClass: "stat-atk",
    healthClass: "stat-hp",
    imgOnError: true
  });
  return `<div class="card rarity-${escapeAttr(card.rarity.toLowerCase())}">${face}</div>`;
}

/** An augment exactly as it appears in the augment pick. */
export function renderAugmentPreview(amp: AmplificationDbEntry): string {
  return renderAugmentOptionMarkup({
    tier: amp.tier,
    tierClass: AMP_TIER_CLASS[amp.tier] ?? "amp-tier-low",
    name: amp.name,
    descriptionHtml: escapeHtml(amp.description),
    imgSrc: augmentImageSrc(amp.id),
    // shown enabled (full colour, as in battle); .be-preview keeps it inert.
    disabled: false
  });
}

/** An event exactly as it appears in the public vote. */
export function renderVoteEventPreview(ve: VoteEventDbEntry): string {
  return renderVoteOptionMarkup({
    name: ve.name,
    optionLabel: ve.options[0] ?? "",
    imgSrc: voteEventImageSrc(ve.id),
    // shown enabled (full colour, as in battle); .be-preview keeps it inert.
    disabled: false
  });
}
