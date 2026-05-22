import type { GameEvent, Seat } from "@twcardgame/shared";
import { cssEscape } from "./dom.js";

/**
 * --- CARD DISCARD DISINTEGRATION (ported from LEGACY v1) ---
 *
 * When a hand card is discarded, it dissolves into ~80 drifting particles
 * (Thanos-style), faithful to LEGACY `animateDiscard` in `LEGACY/js/ui/app.js`.
 * V2 signals a discard with a `DISCARD` game event carrying `{ cardId }` and a
 * `seat`. The discarded card's DOM node is still present when the events
 * handler runs — render() defers the hand rebuild to the next frame — so the
 * element can be captured and disintegrated in place.
 */

const PARTICLE_COUNT = 80;
const PARTICLE_COLORS = ["#a335ee", "#444444", "#888888", "#ffffff"];
const PARTICLE_LIFETIME_MS = 2100;
const CLONE_LIFETIME_MS = 1500;

/** Disintegrates the hand card behind each `DISCARD` event in `events`. */
export function playDiscardAnimations(events: GameEvent[], mySeat: Seat | undefined): void {
  for (const event of events) {
    if (event.type !== "DISCARD") continue;
    const payload = event.payload ?? {};
    const cardId = typeof payload.cardId === "string" ? payload.cardId : undefined;
    if (!cardId) continue;
    const cardEl = locateDiscardedCard(event.seat, mySeat, cardId);
    if (cardEl) disintegrate(cardEl);
  }
}

/** Finds the hand-card element a discard refers to, or undefined if gone. */
function locateDiscardedCard(
  seat: Seat | undefined,
  mySeat: Seat | undefined,
  cardId: string
): HTMLElement | undefined {
  if (seat && seat === mySeat) {
    // The local hand tags each card with its catalog id.
    return (
      document.querySelector<HTMLElement>(`.hand-row .card[data-card-id="${cssEscape(cardId)}"]`) ?? undefined
    );
  }
  // Opponent cards are identical face-down backs — any one stands in.
  const backs = document.querySelectorAll<HTMLElement>(".opponent-hand .card.card-back");
  return backs[backs.length - 1] ?? undefined;
}

/** Clones the card, fades the clone, and bursts it into drifting particles. */
function disintegrate(cardEl: HTMLElement): void {
  const rect = cardEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const clone = cardEl.cloneNode(true) as HTMLElement;
  clone.style.position = "fixed";
  clone.style.top = `${rect.top}px`;
  clone.style.left = `${rect.left}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = "0";
  clone.style.zIndex = "10000";
  clone.style.pointerEvents = "none";
  clone.style.transition = "opacity 0.8s ease-in";
  document.body.appendChild(clone);

  // Hide the real card immediately; the next render() removes it for good.
  cardEl.style.visibility = "hidden";

  for (let i = 0; i < PARTICLE_COUNT; i += 1) spawnParticle(rect);

  // Fade the card body slightly after the particles start crumbling.
  window.setTimeout(() => {
    clone.style.opacity = "0";
  }, 100);
  window.setTimeout(() => clone.remove(), CLONE_LIFETIME_MS);
}

/** One disintegration particle: random colour, origin, size and trajectory. */
function spawnParticle(rect: DOMRect): void {
  const p = document.createElement("div");
  p.className = "disintegrate-particle";
  p.style.background = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)] ?? "#a335ee";

  // Random origin somewhere inside the card.
  p.style.left = `${rect.left + Math.random() * rect.width}px`;
  p.style.top = `${rect.top + Math.random() * rect.height}px`;

  const size = 1 + Math.random() * 5;
  p.style.width = `${size}px`;
  p.style.height = `${size}px`;

  // Expanding sphere with a heavy upward bias, like LEGACY.
  const angle = Math.random() * Math.PI * 2;
  const dist = 50 + Math.random() * 100;
  const dx = Math.cos(angle) * dist + (Math.random() - 0.5) * 100;
  const dy = Math.sin(angle) * dist - (200 + Math.random() * 300);
  const dr = (Math.random() - 0.5) * 720;
  p.style.setProperty("--dx", `${dx}px`);
  p.style.setProperty("--dy", `${dy}px`);
  p.style.setProperty("--dr", `${dr}deg`);

  // Staggered start gives the "crumbling" cascade.
  p.style.animationDelay = `${Math.random() * 0.6}s`;

  document.body.appendChild(p);
  window.setTimeout(() => p.remove(), PARTICLE_LIFETIME_MS);
}
