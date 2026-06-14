/**
 * Training "ghost-hand" demo for the Social Rookie level.
 *
 * Instead of only telling the player what to do, we *show* them once: a
 * translucent clone of the highlighted source (a hand card, or a glowing
 * minion) presses down, drags onto its target while a mouse cursor follows the
 * gesture, then releases — looping until the player takes over themselves.
 *
 * Two gestures are covered, both driven by the same engine:
 *  - "card"   — drag a hand card onto the player's board (the board lights up
 *               its yellow `drop-highlight`, the same cue the real drag shows).
 *               The card is clamped to the board so it never crosses the
 *               battlefield centre line into enemy territory.
 *  - "attack" — drag a minion onto the enemy hero (the hero already glows via
 *               its training highlight, so no extra target cue is added).
 *
 * Hosting / scaling notes:
 *  - The overlay lives on `document.body`, NOT inside `.battle-surface`. The
 *    arena sits under `.app-shell` which has `transform: scale(--app-scale)`;
 *    a child there would be mis-positioned and could be wiped by the runtime's
 *    HTML patch. Body-hosting (like drag.ts) keeps it stable in viewport space.
 *  - To still pick up the scoped `.battle-surface .minion` / `.card` styling,
 *    the container carries the `battle-surface` class (its own arena visuals are
 *    overridden in CSS). The app-scale is re-applied to the ghost so its size
 *    matches the real board.
 *
 * This is pure client-side presentation. It never sends commands and never
 * mutates game state.
 */

export interface DragDemoOptions {
  /** Stable id for idempotency (e.g. the training step). */
  key: string;
  /** Element to clone as the dragged ghost. */
  sourceSelector: string;
  /** Element to drag the ghost onto. */
  targetSelector: string;
  /** Light the target board's yellow `drop-highlight` while dragging (card → board). */
  highlightDropZone?: boolean;
  /** Keep the ghost from rising above the target's top edge (card → board, so it
   *  stays on the player's side of the centre line). */
  clampToTargetTop?: boolean;
}

const CONTAINER_ID = "training-drag-demo";
const PRESS_MS = 900;
const DRAG_MS = 1700;
const SETTLE_MS = 620;
const RELEASE_MS = 520;
const LOOP_GAP_MS = 950;
const LABEL_DRAG = "按住拖曳";
const LABEL_RELEASE = "放開";
/** The held card/minion floats above the cursor, like a real grab. */
const GHOST_LIFT_PX = 38;
/** Held size relative to the real element (before app-scale). */
const DRAG_SCALE = 0.96;

let activeKey: string | null = null;
let token = 0;
let timers: number[] = [];
let animations: Animation[] = [];
let highlightedEl: HTMLElement | null = null;

/**
 * Start (or keep) the looping demo. Idempotent per `key`: re-calling with the
 * same key while it is already running is a no-op, so it is safe to drive from
 * every render.
 */
export function startDragDemo(opts: DragDemoOptions): void {
  if (activeKey === opts.key) return;
  stopDragDemo();
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  activeKey = opts.key;
  const myToken = ++token;
  runLoop(opts, myToken);
}

/** Cancel the demo and remove all of its DOM / animation side effects. */
export function stopDragDemo(): void {
  token += 1;
  activeKey = null;
  for (const id of timers) window.clearTimeout(id);
  timers = [];
  for (const animation of animations) animation.cancel();
  animations = [];
  if (highlightedEl) {
    highlightedEl.classList.remove("drop-highlight");
    highlightedEl = null;
  }
  document.getElementById(CONTAINER_ID)?.remove();
}

function later(fn: () => void, delay: number): void {
  const id = window.setTimeout(() => {
    timers = timers.filter((timer) => timer !== id);
    fn();
  }, delay);
  timers.push(id);
}

function total(): number {
  return PRESS_MS + DRAG_MS + SETTLE_MS + RELEASE_MS;
}

/** The arena is scaled by `.app-shell { transform: scale(--app-scale) }`. */
function appScale(): number {
  const shell = document.querySelector<HTMLElement>(".app-shell");
  if (!shell) return 1;
  const rect = shell.getBoundingClientRect();
  return shell.offsetWidth > 0 ? rect.width / shell.offsetWidth : 1;
}

function runLoop(opts: DragDemoOptions, myToken: number): void {
  if (myToken !== token) return;

  const sourceEl = document.querySelector<HTMLElement>(opts.sourceSelector);
  const targetEl = document.querySelector<HTMLElement>(opts.targetSelector);
  if (!sourceEl || !targetEl) {
    // The board/source may not be laid out yet on the first frame; retry shortly.
    later(() => runLoop(opts, myToken), 200);
    return;
  }

  const scale = appScale();
  const sourceRect = sourceEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();
  const from = { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 };

  const { container, ghost, cursor, label } = buildContainer(sourceEl);
  const halfRendered = (ghost.offsetHeight * scale * DRAG_SCALE) / 2;

  // The drag point (where the cursor tip rests). The card floats above it.
  const to = { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height * 0.5 };
  if (opts.clampToTargetTop) {
    // Keep the whole card on the board: its top edge no higher than the board's
    // top, so the gesture never reaches across the centre line.
    to.y = targetRect.top + halfRendered + GHOST_LIFT_PX;
  }

  const ghostAt = (x: number, y: number, s: number) =>
    `translate(${x}px, ${y - GHOST_LIFT_PX}px) translate(-50%, -50%) scale(${scale * s})`;
  const cursorAt = (x: number, y: number) => `translate(${x - 6}px, ${y - 3}px)`;
  // The label sits just below the held card, centred and following the gesture.
  const labelAt = (x: number, y: number) =>
    `translate(${x}px, ${y - GHOST_LIFT_PX + halfRendered + 8}px) translate(-50%, 0)`;

  const dur = total();
  const pressEnd = PRESS_MS / dur;
  const grab = (PRESS_MS + 60) / dur;
  const dragEnd = (PRESS_MS + DRAG_MS) / dur;
  const settleEnd = (PRESS_MS + DRAG_MS + SETTLE_MS) / dur;

  const ghostMove = ghost.animate(
    [
      { transform: ghostAt(from.x, from.y, 0.62), opacity: 0, offset: 0 },
      { transform: ghostAt(from.x, from.y, 0.86), opacity: 1, offset: pressEnd },
      { transform: ghostAt(from.x, from.y, DRAG_SCALE), opacity: 1, offset: grab },
      { transform: ghostAt(to.x, to.y, DRAG_SCALE), opacity: 1, offset: dragEnd },
      { transform: ghostAt(to.x, to.y, DRAG_SCALE), opacity: 1, offset: settleEnd },
      { transform: ghostAt(to.x, to.y, 0.72), opacity: 0, offset: 1 }
    ],
    { duration: dur, easing: "ease-in-out" }
  );
  const cursorMove = cursor.animate(
    [
      { transform: cursorAt(from.x, from.y), opacity: 0, offset: 0 },
      { transform: cursorAt(from.x, from.y), opacity: 1, offset: pressEnd },
      { transform: cursorAt(from.x, from.y), opacity: 1, offset: grab },
      { transform: cursorAt(to.x, to.y), opacity: 1, offset: dragEnd },
      { transform: cursorAt(to.x, to.y), opacity: 1, offset: settleEnd },
      { transform: cursorAt(to.x, to.y), opacity: 0, offset: 1 }
    ],
    { duration: dur, easing: "ease-in-out" }
  );
  const labelMove = label.animate(
    [
      { transform: labelAt(from.x, from.y), opacity: 0, offset: 0 },
      { transform: labelAt(from.x, from.y), opacity: 1, offset: pressEnd },
      { transform: labelAt(from.x, from.y), opacity: 1, offset: grab },
      { transform: labelAt(to.x, to.y), opacity: 1, offset: dragEnd },
      { transform: labelAt(to.x, to.y), opacity: 1, offset: settleEnd },
      { transform: labelAt(to.x, to.y), opacity: 0, offset: 1 }
    ],
    { duration: dur, easing: "ease-in-out" }
  );
  animations.push(ghostMove, cursorMove, labelMove);

  // "按住拖曳" while moving, then "放開" once it reaches the target.
  label.textContent = LABEL_DRAG;
  label.classList.remove("is-release");
  later(() => {
    if (myToken !== token) return;
    label.textContent = LABEL_RELEASE;
    label.classList.add("is-release");
  }, PRESS_MS + DRAG_MS);

  if (opts.highlightDropZone) {
    // Light up the yellow drop zone for the dragging + settle portion, mirroring
    // the real drag's `drop-highlight` so the demo points at the live cue.
    later(() => {
      if (myToken === token) {
        targetEl.classList.add("drop-highlight");
        highlightedEl = targetEl;
      }
    }, PRESS_MS + 40);
    later(() => {
      targetEl.classList.remove("drop-highlight");
      if (highlightedEl === targetEl) highlightedEl = null;
    }, PRESS_MS + DRAG_MS + SETTLE_MS);
  }

  ghostMove.onfinish = () => {
    if (myToken !== token) return;
    container.remove();
    later(() => runLoop(opts, myToken), LOOP_GAP_MS);
  };
}

function buildContainer(sourceEl: HTMLElement): {
  container: HTMLElement;
  ghost: HTMLElement;
  cursor: HTMLElement;
  label: HTMLElement;
} {
  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  // Carry the arena class so scoped `.battle-surface .minion` / `.card` styles
  // apply to the clone (the container's own arena visuals are reset in CSS).
  container.className = "battle-surface";

  const ghost = document.createElement("div");
  ghost.className = "training-demo-ghost";
  ghost.style.width = `${sourceEl.offsetWidth}px`;

  const clone = sourceEl.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-hand-id");
  clone.removeAttribute("data-attacker-id");
  clone.removeAttribute("data-target");
  clone.removeAttribute("id");
  clone.style.margin = "0";
  clone.style.transform = "none";
  clone.style.pointerEvents = "none";
  ghost.appendChild(clone);

  const cursor = document.createElement("div");
  cursor.className = "training-demo-cursor";

  const label = document.createElement("div");
  label.className = "training-demo-label";

  container.appendChild(ghost);
  container.appendChild(label);
  container.appendChild(cursor);
  document.body.appendChild(container);
  return { container, ghost, cursor, label };
}
