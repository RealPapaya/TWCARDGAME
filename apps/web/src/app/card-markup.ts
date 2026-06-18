// Single source of truth for the in-game card / augment / vote-event markup.
//
// Both the live battle UI (runtime.ts) and the balance-editor preview import
// these functions so the editor renders cards/augments/events EXACTLY as they
// appear in battle — there is no hand-copied mirror to drift out of sync.
//
// These functions are pure markup builders: they take already-computed strings
// (dynamic classes, resolved image src, pre-rendered description HTML) and emit
// the same `.card` / `.amp-option` / `.vote-option` structure the game's CSS
// (styles.css) styles. They must not read runtime/battle state — the caller
// computes the dynamic parts and passes them in.
import { assetUrl, escapeHtml, escapeAttr } from "../ui.js";

// ── card face (inner contents of `.card`) ───────────────────────────
export interface CardFaceMarkupInput {
  /** Full class for the cost pill (e.g. "card-cost" plus any delta/highlight classes). */
  costClass: string;
  /** Cost value to display (may differ from the live cost while a glow is pending). */
  shownCost: number | string;
  name: string;
  image: string;
  category: string;
  /** Pre-rendered (already escaped / decorated) description HTML. */
  descriptionHtml: string;
  type: string;
  attack?: number;
  health?: number;
  attackClass: string;
  healthClass: string;
  /** Hide the art on load error — used by the editor preview where images may be missing. */
  imgOnError?: boolean;
}

/** Inner markup of a `.card` face — mirror this nowhere; call it. */
export function renderCardFaceMarkup(c: CardFaceMarkupInput): string {
  const onError = c.imgOnError ? ` onerror="this.hidden=true"` : "";
  return `
    <span class="${c.costClass}"><span>${c.shownCost}</span></span>
    <strong class="card-title">${escapeHtml(c.name)}</strong>
    <img class="card-art-box" src="${escapeAttr(assetUrl(c.image))}" alt="" loading="lazy" draggable="false"${onError} />
    <span class="card-category">${escapeHtml(c.category)}</span>
    <span class="card-desc">${c.descriptionHtml}</span>
    ${
      c.type === "MINION"
        ? `<span class="minion-stats"><span class="${c.attackClass}"><span>${c.attack ?? 0}</span></span><span class="${c.healthClass}">${c.health ?? 0}</span></span>`
        : ""
    }
  `;
}

// ── augment option (`.amp-option` button) ───────────────────────────
export interface AugmentOptionMarkupInput {
  tier: string;
  tierClass: string;
  name: string;
  /** Pre-rendered (already escaped / decorated) description HTML. */
  descriptionHtml: string;
  imgSrc: string | undefined;
  /** Extra attributes injected into the <button> (e.g. data-amp-id, data-dom-key). */
  extraAttrs?: string;
  disabled: boolean;
}

export function renderAugmentOptionMarkup(a: AugmentOptionMarkupInput): string {
  return `
    <button
      class="card mulligan-card amp-option ${a.tierClass}"
      ${a.extraAttrs ?? ""}
      ${a.disabled ? "disabled" : ""}
    >
      <span class="amp-tier-badge">${escapeHtml(a.tier)}</span>
      ${a.imgSrc ? `<img class="amp-option-art" src="${escapeAttr(a.imgSrc)}" alt="${escapeAttr(a.name)}" draggable="false" loading="eager" onerror="this.hidden=true" />` : ""}
      <span class="amp-option-name">${escapeHtml(a.name)}</span>
      <span class="amp-option-desc">${a.descriptionHtml}</span>
    </button>
  `;
}

// ── vote-event option (`.vote-option` button) ───────────────────────
export interface VoteOptionMarkupInput {
  name: string;
  /** First ballot option, shown as the description line. */
  optionLabel: string;
  imgSrc: string | undefined;
  /** Extra attributes injected into the <button> (e.g. data-vote-index, data-dom-key). */
  extraAttrs?: string;
  disabled: boolean;
}

export function renderVoteOptionMarkup(v: VoteOptionMarkupInput): string {
  return `
    <button
      class="card mulligan-card vote-option"
      ${v.extraAttrs ?? ""}
      ${v.disabled ? "disabled" : ""}
    >
      <span class="vote-option-name">${escapeHtml(v.name)}</span>
      ${v.imgSrc ? `<img class="vote-option-art" src="${escapeAttr(v.imgSrc)}" alt="${escapeAttr(v.name)}" draggable="false" loading="eager" onerror="this.hidden=true" />` : ""}
      <span class="vote-option-desc">${escapeHtml(v.optionLabel)}</span>
    </button>
  `;
}
