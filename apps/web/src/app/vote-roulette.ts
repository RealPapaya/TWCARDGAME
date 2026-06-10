import type { Seat } from "@twcardgame/shared";
import { playSfx } from "./audio.js";

export interface VoteRouletteChoice {
  seat: Seat;
  eventId: string;
  eventName: string;
}

export interface VoteRouletteData {
  choices: { player1: VoteRouletteChoice; player2: VoteRouletteChoice };
  weights: Record<Seat, number>;
  rollMillionths: number;
  winnerSeat: Seat;
  winnerEventId: string;
  winnerEventName: string;
  mySeat?: Seat;
}

const SPIN_MS = 3200;
const REVEAL_HOLD_MS = 2000;
const FADE_OUT_MS = 280;
const BALLOT_FADE_MS = 420;
const FULL_TURNS = 6;
const ROLL_RESOLUTION = 1_000_000;

export const VOTE_ROULETTE_TOTAL_MS = BALLOT_FADE_MS + SPIN_MS + REVEAL_HOLD_MS + FADE_OUT_MS;
export const VOTE_REVEAL_HOLD_MS = BALLOT_FADE_MS + SPIN_MS;

let rouletteVisible = false;
export function voteRouletteActive(): boolean {
  return rouletteVisible;
}

export function voteRouletteVisible(): boolean {
  return rouletteVisible;
}

let overlayEl: HTMLElement | undefined;
let timers: number[] = [];
let token = 0;
let activeResolve: (() => void) | undefined;
let activeSpinAnimation: Animation | undefined;

export function resetVoteRoulette(): void {
  rouletteVisible = false;
  token += 1;
  for (const timer of timers) window.clearTimeout(timer);
  timers = [];
  activeSpinAnimation?.cancel();
  activeSpinAnimation = undefined;
  overlayEl?.remove();
  overlayEl = undefined;
  const resolve = activeResolve;
  activeResolve = undefined;
  resolve?.();
}

export function playVoteRoulette(data: VoteRouletteData): Promise<void> {
  resetVoteRoulette();
  rouletteVisible = true;
  const myToken = (token += 1);
  const weights = normalizedWeights(data.weights);
  const player1Percent = weights.player1;
  const targetRotation = rollRotation(data.rollMillionths);

  const overlay = document.getElementById("voting-modal") ?? document.createElement("section");
  overlay.id = "voting-modal";
  overlay.classList.add("mulligan-overlay", "vote-overlay", "vote-roulette-overlay", "is-opening-roulette");
  overlay.setAttribute("data-testid", "voting-overlay");
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  let contentEl = overlay.querySelector<HTMLElement>(".vote-content");
  if (!contentEl) {
    contentEl = document.createElement("div");
    contentEl.className = "mulligan-content vote-content";
    overlay.appendChild(contentEl);
  }
  let titleEl = contentEl.querySelector<HTMLElement>("h2");
  if (!titleEl) {
    titleEl = document.createElement("h2");
    contentEl.prepend(titleEl);
  }
  titleEl.textContent = "中選會開票";
  titleEl.dataset.role = "title";
  titleEl.classList.add("vote-roulette-title");

  if (!overlay.isConnected) document.querySelector(".battle-surface")?.appendChild(overlay);
  overlayEl = overlay;

  return new Promise<void>((resolve) => {
    activeResolve = resolve;
    let revealed = false;
    let wheelEl: HTMLElement | null = null;
    let hubStatusEl: HTMLElement | null = null;
    let legendEls: HTMLElement[] = [];

    const finish = (): void => {
      if (myToken !== token) return;
      overlay.classList.add("is-closing");
      timers.push(
        window.setTimeout(() => {
          if (myToken !== token) return;
          rouletteVisible = false;
          overlay.remove();
          if (overlayEl === overlay) overlayEl = undefined;
          activeResolve = undefined;
          resolve();
        }, FADE_OUT_MS)
      );
    };

    const reveal = (): void => {
      if (myToken !== token || revealed) return;
      revealed = true;
      if (wheelEl) wheelEl.style.transform = `rotate(${targetRotation}deg)`;
      activeSpinAnimation?.cancel();
      activeSpinAnimation = undefined;
      overlay.classList.add("is-revealed");
      titleEl?.classList.add("is-winner");
      if (titleEl) titleEl.textContent = `通過：${data.winnerEventName}`;
      if (hubStatusEl) hubStatusEl.textContent = "中選";
      for (const legendEl of legendEls) {
        legendEl.classList.toggle("is-winner", legendEl.dataset.seat === data.winnerSeat);
      }
      playSfx("cardPlayHeavy");
      timers.push(window.setTimeout(finish, REVEAL_HOLD_MS));
    };

    const startSpin = (): void => {
      if (myToken !== token) return;
      for (const child of Array.from(contentEl.children)) {
        if (child !== titleEl) child.remove();
      }
      contentEl.insertAdjacentHTML("beforeend", `
        <div class="vote-roulette-stage">
          <p class="vote-roulette-subtitle">圓餅比例依弱勢族群中選率分配</p>
          <div class="vote-roulette-shell">
            <div class="vote-roulette-pointer" aria-hidden="true"></div>
            <div
              class="vote-roulette-wheel"
              data-role="wheel"
              style="--player1-percent: ${player1Percent}%;"
              aria-label="${wheelAriaLabel(data, weights)}"
            ></div>
            <div class="vote-roulette-hub">
              <span>公投</span>
              <strong data-role="hub-status">開票中</strong>
            </div>
          </div>
          <div class="vote-roulette-legend">
            ${renderLegendItem("player1", data.choices.player1, weights.player1, data.mySeat)}
            ${renderLegendItem("player2", data.choices.player2, weights.player2, data.mySeat)}
          </div>
        </div>
      `);
      overlay.classList.remove("is-opening-roulette");
      overlay.classList.add("is-roulette-visible");
      wheelEl = overlay.querySelector<HTMLElement>("[data-role='wheel']");
      hubStatusEl = overlay.querySelector<HTMLElement>("[data-role='hub-status']");
      legendEls = Array.from(overlay.querySelectorAll<HTMLElement>(".vote-roulette-legend-item"));

      if (!wheelEl) {
        reveal();
        return;
      }
      const animation = wheelEl.animate(
        [
          { transform: "rotate(0deg)" },
          { transform: `rotate(${targetRotation}deg)` }
        ],
        {
          duration: SPIN_MS,
          easing: "cubic-bezier(0.08, 0.72, 0.04, 1)",
          fill: "forwards"
        }
      );
      activeSpinAnimation = animation;
      playSfx("turn", 0.35);
      void animation.finished.then(reveal).catch(() => undefined);

      // Keeps game-state gating from getting stuck if an animation completion
      // event is lost because the tab or renderer is interrupted.
      timers.push(window.setTimeout(reveal, SPIN_MS + 100));
    };

    timers.push(window.setTimeout(startSpin, BALLOT_FADE_MS));
  });
}

function normalizedWeights(weights: Record<Seat, number>): Record<Seat, number> {
  const player1 = Math.max(0, Number(weights.player1) || 0);
  const player2 = Math.max(0, Number(weights.player2) || 0);
  const total = player1 + player2;
  if (total <= 0) return { player1: 50, player2: 50 };
  const player1Boundary = Math.floor((player1 / total) * ROLL_RESOLUTION);
  const player1Percent = (player1Boundary / ROLL_RESOLUTION) * 100;
  return {
    player1: player1Percent,
    player2: 100 - player1Percent
  };
}

function rollRotation(rollMillionths: number): number {
  const normalizedRoll = Math.min(ROLL_RESOLUTION - 1, Math.max(0, Math.floor(rollMillionths)));
  const winningAngle = (normalizedRoll / ROLL_RESOLUTION) * 360;
  return FULL_TURNS * 360 + ((360 - winningAngle) % 360);
}

function renderLegendItem(seat: Seat, choice: VoteRouletteChoice, percent: number, mySeat: Seat | undefined): string {
  return `
    <div class="vote-roulette-legend-item ${seat}" data-seat="${seat}">
      <span class="vote-roulette-swatch" aria-hidden="true"></span>
      <span class="vote-roulette-choice">
        <strong>${escapeHtml(choice.eventName)}</strong>
        <small>${chooserLabel(seat, mySeat)}</small>
      </span>
      <span class="vote-roulette-percent">${formatPercent(percent)}%</span>
    </div>
  `;
}

function chooserLabel(seat: Seat, mySeat: Seat | undefined): string {
  return seat === mySeat ? "你的提案" : "對手提案";
}

function formatPercent(percent: number): string {
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}

function wheelAriaLabel(data: VoteRouletteData, weights: Record<Seat, number>): string {
  return escapeHtml(
    `${chooserLabel("player1", data.mySeat)} ${data.choices.player1.eventName} ${formatPercent(weights.player1)}%，` +
      `${chooserLabel("player2", data.mySeat)} ${data.choices.player2.eventName} ${formatPercent(weights.player2)}%`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
