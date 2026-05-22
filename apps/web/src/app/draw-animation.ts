import { playSfx } from "./audio.js";

/**
 * --- GOLD STANDARD DRAW ANIMATION (ported from LEGACY v1) ---
 *
 * When a card is drawn, a fixed-position clone of its destination element flies
 * from the deck pile to the card's slot in the hand, scaling 0.5x -> 1x with an
 * elastic overshoot. Faithful to LEGACY `animateCardFromDeck` in
 * `LEGACY/js/ui/app.js` — do not change the timing or bezier without request.
 *
 * V2 re-renders the whole hand on every sync, so the real destination card is
 * replaced mid-flight. We therefore track in-flight cards by `data-hand-id`
 * (player) and re-query on cleanup; `renderHandCard` keeps any tracked card
 * hidden via `isHandCardAnimating`.
 */

type Side = "player" | "opponent";

// LEGACY timing — see `animateCardFromDeck`.
const FLIGHT_MS = 600;
const FLIGHT_EASING = "cubic-bezier(0.18, 0.89, 0.32, 1.15)";
const FAIL_SAFE_MS = 1000;

// `instanceId` for the previous local hand sync, in slot order. The first sync
// of a match seeds this (no animation for the opening hand).
let prevPlayerHandIds: string[] | undefined;
// Opponent hand size for the previous publicSync. Undefined until the first.
let prevOpponentHandCount: number | undefined;

// Local hand cards currently mid-flight; their real elements stay hidden.
const animatingHandIds = new Set<string>();

/** Clears all draw tracking. Call on match start/teardown. */
export function resetDrawTracking(): void {
  prevPlayerHandIds = undefined;
  prevOpponentHandCount = undefined;
  animatingHandIds.clear();
}

/** True while a drawn local hand card is still flying — used by renderHandCard. */
export function isHandCardAnimating(instanceId: string): boolean {
  return animatingHandIds.has(instanceId);
}

/**
 * Called after a local `hand` sync has been applied and render() requested.
 * Animates any card whose `instanceId` was not present in the previous hand.
 * The first call of a match only seeds the baseline (opening hand, no fly-in).
 */
export function notePlayerHandSync(handIds: string[]): void {
  const previous = prevPlayerHandIds;
  prevPlayerHandIds = [...handIds];
  if (previous === undefined) return; // opening hand — baseline only

  const prevSet = new Set(previous);
  for (let slot = 0; slot < handIds.length; slot += 1) {
    const id = handIds[slot];
    if (prevSet.has(id)) continue;
    animatingHandIds.add(id);
    animateCardFromDeck("player", slot, id);
  }
}

/**
 * Called after a publicSync flush. Animates a card-back fly-in for each card
 * the opponent gained since the previous sync. The first call seeds baseline.
 */
export function noteOpponentHandSync(handCount: number): void {
  const previous = prevOpponentHandCount;
  prevOpponentHandCount = handCount;
  if (previous === undefined) return; // baseline only

  const drawn = handCount - previous;
  if (drawn <= 0 || drawn > 15) return; // ignore shrink / implausible jumps
  for (let i = 0; i < drawn; i += 1) {
    // New opponent cards land at the end of the fan.
    animateCardFromDeck("opponent", handCount - drawn + i);
  }
}

/**
 * Clones the card at `slotIndex` and flies it from the deck pile, mirroring
 * LEGACY `animateCardFromDeck`. `handId` is set for the local player so the
 * real card can be re-found after a re-render; omitted for the opponent.
 */
function animateCardFromDeck(side: Side, slotIndex: number, handId?: string): void {
  playSfx("cardDraw");

  // Wait two frames so the freshly rendered hand has stable coordinates
  // (render() defers the DOM update by a frame). The deck pile must be
  // re-queried *inside* this wait: render() rebuilds the whole battle surface,
  // so any node captured before the rebuild is detached and would measure as
  // (0,0) — flying the card from the top-left corner instead of the deck.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const deckEl = document.querySelector<HTMLElement>(`.deck-pile.battle-deck-pile.${side}-deck`);
      const targetEl = resolveSlotElement(side, slotIndex, handId);
      if (!deckEl || !targetEl) {
        if (handId) animatingHandIds.delete(handId);
        return;
      }

      const deckRect = deckEl.getBoundingClientRect();
      const cardRect = targetEl.getBoundingClientRect();
      // Layout not ready — skip rather than fly to (0,0).
      if (
        cardRect.width === 0 ||
        deckRect.width === 0 ||
        (cardRect.left === 0 && cardRect.top === 0) ||
        (deckRect.left === 0 && deckRect.top === 0)
      ) {
        if (handId) animatingHandIds.delete(handId);
        return;
      }

      const cloneW = targetEl.offsetWidth || 128;
      const cloneH = targetEl.offsetHeight || 184;
      // Anchor by centre, not top-left: a hand card (128x184) dwarfs the deck
      // pile (54x72), so a corner anchor would start the flight well below and
      // right of the deck. Centring makes the card visibly fly *out of* the
      // deck pile. `scale()` keeps the centre fixed, so the shrunk start frame
      // also sits centred on the deck.
      const startX = deckRect.left + deckRect.width / 2 - cloneW / 2;
      const startY = deckRect.top + deckRect.height / 2 - cloneH / 2;
      const endX = cardRect.left + cardRect.width / 2 - cloneW / 2;
      const endY = cardRect.top + cardRect.height / 2 - cloneH / 2;

      const clone = targetEl.cloneNode(true) as HTMLElement;
      clone.style.position = "fixed";
      clone.style.left = "0";
      clone.style.top = "0";
      clone.style.width = `${cloneW}px`;
      clone.style.height = `${cloneH}px`;
      clone.style.margin = "0";
      clone.style.zIndex = "9999";
      clone.style.pointerEvents = "none";
      clone.style.opacity = "1";
      clone.style.transition = "none";
      clone.style.transform = `translate(${startX}px, ${startY}px) scale(0.5)`;

      document.body.appendChild(clone);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          clone.style.transition = `transform ${FLIGHT_MS}ms ${FLIGHT_EASING}, opacity 0.3s ease`;
          clone.style.transform = `translate(${endX}px, ${endY}px) scale(1)`;
        });
      });

      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        clone.removeEventListener("transitionend", onEnd);
        window.clearTimeout(failSafe);
        clone.remove();
        if (handId) {
          animatingHandIds.delete(handId);
          // The hand may have re-rendered; re-find the card to reveal it.
          const real = document.querySelector<HTMLElement>(
            `.hand-row .card[data-hand-id="${cssAttr(handId)}"]`
          );
          if (real) real.style.opacity = "";
        }
      };
      const onEnd = (event: TransitionEvent): void => {
        if (event.propertyName === "transform") cleanup();
      };
      clone.addEventListener("transitionend", onEnd);
      const failSafe = window.setTimeout(cleanup, FAIL_SAFE_MS);
    });
  });
}

/** Resolves the live hand-slot element for a side, or undefined if absent. */
function resolveSlotElement(side: Side, slotIndex: number, handId?: string): HTMLElement | undefined {
  if (side === "player") {
    if (handId) {
      const byId = document.querySelector<HTMLElement>(
        `.hand-row .card[data-hand-id="${cssAttr(handId)}"]`
      );
      if (byId) return byId;
    }
    return document.querySelectorAll<HTMLElement>(".hand-row .card")[slotIndex] ?? undefined;
  }
  return document.querySelectorAll<HTMLElement>(".opponent-hand .card.card-back")[slotIndex] ?? undefined;
}

/** Escapes a value for safe use inside a `[attr="..."]` selector. */
function cssAttr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
