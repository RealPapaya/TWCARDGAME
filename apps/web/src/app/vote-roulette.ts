import type { Seat } from "@twcardgame/shared";
import { playSfx } from "./audio.js";

/**
 * --- TURN-20 REFERENDUM ROULETTE ---
 *
 * After both players vote, the server resolves the winner via an inverse-HP
 * weighted draw (`resolveVotingPhase` in packages/rules) and immediately closes
 * the special phase. The reactive voting overlay therefore vanishes the instant
 * the result arrives, so this draw is rendered as a *self-contained* imperative
 * overlay built from the `VOTE_RESOLVED` payload snapshot — it does not depend on
 * `view.state.specialPhase`, which is already gone by the time we run.
 *
 * The highlight flips between the two cards the players actually voted for,
 * starting fast and decelerating ("由快到慢"), then lands on and glows the
 * winning card so the player feels the suspense of "正在抽選".
 */

export interface VoteRouletteChoice {
  seat: Seat;
  eventId: string;
  eventName: string;
}

export interface VoteRouletteData {
  choices: { player1: VoteRouletteChoice; player2: VoteRouletteChoice };
  winnerSeat: Seat;
  winnerEventId: string;
  winnerEventName: string;
  mySeat?: Seat;
}

/** Total spin time of the accelerating-to-slow highlight, before the reveal. */
const SPIN_MS = 2000;
/** Fastest / slowest hop interval (ms). The gap widens on an ease-out curve. */
const MIN_STEP_MS = 70;
const MAX_STEP_MS = 360;
/** How long the winner glow holds before the overlay fades out. */
const REVEAL_HOLD_MS = 850;
const FADE_OUT_MS = 280;

/** Total wall-clock of the roulette (spin → reveal hold → fade), for callers that
 * need to wait for it to clear (e.g. holding an event-notice toast). */
export const VOTE_ROULETTE_TOTAL_MS = SPIN_MS + REVEAL_HOLD_MS + FADE_OUT_MS;

/** Time from overlay open until the winner is revealed (`reveal()` fires). The
 * runtime holds the public sync / death cues for this long so the board effect
 * (e.g. 高雄氣爆 destroying minions) only lands AFTER the roulette decides. */
export const VOTE_REVEAL_HOLD_MS = SPIN_MS;

/** True while a roulette overlay is spinning, before the winner is revealed.
 * The runtime gates `flushPendingPublicSync` on this so the effect stays hidden
 * until the decision is shown. Cleared synchronously inside `reveal()`. */
let rouletteSpinning = false;
export function voteRouletteActive(): boolean {
  return rouletteSpinning;
}

interface Slot {
  choice: VoteRouletteChoice;
  seats: Seat[];
}

let overlayEl: HTMLElement | undefined;
let timers: number[] = [];
let token = 0;
let activeResolve: (() => void) | undefined;

/** Tears down any in-flight roulette. Call on match start / teardown. */
export function resetVoteRoulette(): void {
  rouletteSpinning = false;
  token += 1;
  for (const t of timers) window.clearTimeout(t);
  timers = [];
  overlayEl?.remove();
  overlayEl = undefined;
  const resolve = activeResolve;
  activeResolve = undefined;
  resolve?.();
}

/**
 * Plays the referendum roulette overlay and resolves once it has faded out.
 * Safe to fire-and-forget; a second call cancels the first.
 */
export function playVoteRoulette(data: VoteRouletteData): Promise<void> {
  resetVoteRoulette();
  rouletteSpinning = true;
  const myToken = (token += 1);

  const slots = buildSlots(data);
  const winnerSlot = Math.max(0, slots.findIndex((slot) => slot.seats.includes(data.winnerSeat)));

  const overlay = document.createElement("div");
  overlay.className = "vote-roulette-overlay";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = `
    <div class="vote-roulette-stage">
      <h2 class="vote-roulette-title" data-role="title">開票中…</h2>
      <div class="vote-roulette-cards">
        ${slots.map((slot, index) => renderCard(slot, index, data.mySeat)).join("")}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlayEl = overlay;

  const cardEls = Array.from(overlay.querySelectorAll<HTMLElement>(".vote-roulette-card"));
  const titleEl = overlay.querySelector<HTMLElement>("[data-role='title']");

  return new Promise<void>((resolve) => {
    activeResolve = resolve;
    const finish = (): void => {
      if (myToken !== token) return;
      for (const t of timers) window.clearTimeout(t);
      timers = [];
      overlay.classList.add("is-closing");
      const removeAt = window.setTimeout(() => {
        if (myToken !== token) return;
        overlay.remove();
        if (overlayEl === overlay) overlayEl = undefined;
        activeResolve = undefined;
        resolve();
      }, FADE_OUT_MS);
      timers.push(removeAt);
    };

    const reveal = (): void => {
      if (myToken !== token) return;
      // Winner is now shown — release the held public sync / death cues so the
      // board effect lands on this beat, not under the spin.
      rouletteSpinning = false;
      for (const el of cardEls) el.classList.remove("is-drawing");
      cardEls[winnerSlot]?.classList.add("is-winner");
      if (titleEl) {
        titleEl.classList.add("is-winner");
        titleEl.textContent = `通過！「${data.winnerEventName}」`;
      }
      playSfx("cardPlayHeavy");
      timers.push(window.setTimeout(finish, REVEAL_HOLD_MS));
    };

    // A single card (both players voted the same case) has nothing to flip
    // between — give a short suspense pulse, then reveal.
    if (cardEls.length < 2) {
      cardEls[0]?.classList.add("is-drawing");
      let tick = 0;
      const pulse = (): void => {
        if (myToken !== token) return;
        cardEls[0]?.classList.toggle("is-drawing");
        playSfx("turn", 0.35);
        if (++tick < 6) timers.push(window.setTimeout(pulse, 130 + tick * 35));
        else reveal();
      };
      timers.push(window.setTimeout(pulse, 160));
      return;
    }

    const steps = buildStepIntervals();
    // Alternate the highlight between the two cards; pick the starting card so
    // that the final hop lands exactly on the winning card.
    const start = (winnerSlot + steps.length - 1) % 2;
    let elapsed = 0;
    steps.forEach((interval, step) => {
      elapsed += interval;
      timers.push(
        window.setTimeout(() => {
          if (myToken !== token) return;
          const lit = (start + step) % 2;
          for (let i = 0; i < cardEls.length; i++) cardEls[i].classList.toggle("is-drawing", i === lit);
          playSfx("turn", 0.3);
          if (step === steps.length - 1) reveal();
        }, elapsed)
      );
    });
  });
}

/** Two distinct ballot cards, or a single shared one when both voted alike. */
function buildSlots(data: VoteRouletteData): Slot[] {
  const { player1, player2 } = data.choices;
  if (player1.eventId === player2.eventId) {
    return [{ choice: player1, seats: ["player1", "player2"] }];
  }
  return [
    { choice: player1, seats: ["player1"] },
    { choice: player2, seats: ["player2"] }
  ];
}

/** Hop intervals that grow on an ease-out curve, summing to ~SPIN_MS (fast → slow). */
function buildStepIntervals(): number[] {
  const steps: number[] = [];
  let elapsed = 0;
  while (elapsed < SPIN_MS) {
    const progress = elapsed / SPIN_MS; // 0 → 1
    const interval = MIN_STEP_MS + (MAX_STEP_MS - MIN_STEP_MS) * (progress * progress);
    steps.push(interval);
    elapsed += interval;
  }
  return steps;
}

function renderCard(slot: Slot, index: number, mySeat: Seat | undefined): string {
  return `
    <div class="card mulligan-card vote-option vote-roulette-card" data-slot="${index}">
      <span class="vote-roulette-chooser">${chooserLabel(slot.seats, mySeat)}</span>
      <span class="vote-option-name">${escapeHtml(slot.choice.eventName)}</span>
    </div>
  `;
}

function chooserLabel(seats: Seat[], mySeat: Seat | undefined): string {
  if (seats.length > 1) return "雙方一致";
  return seats[0] === mySeat ? "你投的" : "對手投的";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
