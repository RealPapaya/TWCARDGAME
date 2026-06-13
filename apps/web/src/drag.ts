export type DragLineKind = "damage" | "heal" | "buff" | "bounce" | "destroy";

export interface HandDragOptions {
  pointerId: number;
  startX: number;
  startY: number;
  sourceEl: HTMLElement;
  lineKind: DragLineKind;
  needsTarget: boolean;
  isMinion: boolean;
  playerBoardEl: HTMLElement | null;
  /**
   * News cards must be dropped onto the player's own hero ("黃色區域") to count
   * as played. When set, the hero lights up as a drop zone for the duration of
   * the drag and `onResolve` reports whether the drop landed on it via
   * `overDropZone`.
   */
  needsHeroDrop: boolean;
  heroDropEl: HTMLElement | null;
  isEligibleTarget: (el: HTMLElement) => boolean;
  onResolve: (result: { insertionIndex: number; targetEl: HTMLElement | null; overDropZone: boolean }) => void;
  onCancel: () => void;
}

export interface AttackDragOptions {
  pointerId: number;
  sourceEl: HTMLElement;
  isEligibleTarget: (el: HTMLElement) => boolean;
  onResolve: (targetEl: HTMLElement) => void;
  onCancel: () => void;
}

interface Session {
  kind: "hand" | "attack";
  pointerId: number;
  startX: number;
  startY: number;
  isMinion: boolean;
  needsTarget: boolean;
  lineKind: DragLineKind;
  playerBoardEl: HTMLElement | null;
  needsHeroDrop: boolean;
  heroDropEl: HTMLElement | null;
  overHeroDrop: boolean;
  isEligibleTarget: (el: HTMLElement) => boolean;
  ghostEl: HTMLElement | null;
  indicator: HTMLDivElement | null;
  insertionIndex: number;
  snappedTargetEl: HTMLElement | null;
  resolved: boolean;
  onResolve: (data: { insertionIndex: number; targetEl: HTMLElement | null; overDropZone: boolean }) => void;
  onCancel: () => void;
}

const ARROW_OFFSET = 30;
const ARROW_COLORS: Record<DragLineKind, string> = {
  damage: "#ff0000",
  heal: "#43e97b",
  buff: "#ffa500",
  bounce: "#a335ee",
  destroy: "#000000"
};

let layerReady = false;
let session: Session | null = null;

export function ensureDragLayer(): void {
  if (layerReady && document.getElementById("drag-arrow-layer")) return;

  const existingLayer = document.getElementById("drag-arrow-layer");
  if (existingLayer) existingLayer.remove();
  const existingGhost = document.getElementById("drag-ghost");
  if (existingGhost) existingGhost.remove();

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("id", "drag-arrow-layer");

  const defs = document.createElementNS(svgNs, "defs");
  for (const [name, color] of Object.entries(ARROW_COLORS)) {
    defs.appendChild(buildArrowMarker(svgNs, `arrowhead-${name}`, color));
  }
  svg.appendChild(defs);

  const line = document.createElementNS(svgNs, "line");
  line.setAttribute("id", "drag-line");
  line.setAttribute("x1", "0");
  line.setAttribute("y1", "0");
  line.setAttribute("x2", "0");
  line.setAttribute("y2", "0");
  line.style.display = "none";
  svg.appendChild(line);
  document.body.appendChild(svg);

  const ghost = document.createElement("div");
  ghost.id = "drag-ghost";
  document.body.appendChild(ghost);

  layerReady = true;
}

function buildArrowMarker(ns: string, id: string, color: string): SVGMarkerElement {
  const marker = document.createElementNS(ns, "marker");
  marker.setAttribute("id", id);
  marker.setAttribute("viewBox", "0 0 35 60");
  marker.setAttribute("refX", "2");
  marker.setAttribute("refY", "30");
  marker.setAttribute("markerWidth", "35");
  marker.setAttribute("markerHeight", "60");
  marker.setAttribute("orient", "auto");
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M0,0 L0,60 L35,30 z");
  path.setAttribute("fill", color);
  marker.appendChild(path);
  return marker as SVGMarkerElement;
}

export function beginHandDrag(opts: HandDragOptions): void {
  ensureDragLayer();
  finishSession(true);
  endBattlecryTargeting();

  session = {
    kind: "hand",
    pointerId: opts.pointerId,
    startX: opts.startX,
    startY: opts.startY,
    isMinion: opts.isMinion,
    needsTarget: opts.needsTarget,
    lineKind: opts.lineKind,
    playerBoardEl: opts.playerBoardEl,
    needsHeroDrop: opts.needsHeroDrop,
    heroDropEl: opts.heroDropEl,
    overHeroDrop: false,
    isEligibleTarget: opts.isEligibleTarget,
    ghostEl: createGhost(opts.sourceEl),
    indicator: null,
    insertionIndex: -1,
    snappedTargetEl: null,
    resolved: false,
    onResolve: opts.onResolve,
    onCancel: opts.onCancel
  };

  // While a card is held, hovering across the rest of the hand must not pop
  // those cards up (the held card "occupies" the pointer). The body flag lets
  // CSS neutralize the hand-card hover state for the duration of the drag.
  document.body.classList.add("hand-dragging");

  // News cards are only played when dropped on the player's own hero — light it
  // up as a drop zone for the whole drag so the target is obvious.
  if (opts.needsHeroDrop && opts.heroDropEl) opts.heroDropEl.classList.add("news-drop-zone");

  showLine(opts.lineKind, opts.startX, opts.startY);
  positionGhost(opts.startX, opts.startY);
  attachListeners();
}

export function beginAttackDrag(opts: AttackDragOptions): void {
  ensureDragLayer();
  finishSession(true);
  endBattlecryTargeting();
  const sourceRect = opts.sourceEl.getBoundingClientRect();
  const startX = sourceRect.left + sourceRect.width / 2;
  const startY = sourceRect.top + sourceRect.height / 2;

  session = {
    kind: "attack",
    pointerId: opts.pointerId,
    startX,
    startY,
    isMinion: true,
    needsTarget: true,
    lineKind: "damage",
    playerBoardEl: null,
    needsHeroDrop: false,
    heroDropEl: null,
    overHeroDrop: false,
    isEligibleTarget: opts.isEligibleTarget,
    ghostEl: null,
    indicator: null,
    insertionIndex: -1,
    snappedTargetEl: null,
    resolved: false,
    onResolve: ({ targetEl }) => {
      if (targetEl) opts.onResolve(targetEl);
      else opts.onCancel();
    },
    onCancel: opts.onCancel
  };

  showLine("damage", startX, startY);
  attachListeners();
}

function createGhost(sourceEl: HTMLElement): HTMLElement | null {
  const ghost = document.getElementById("drag-ghost") as HTMLElement | null;
  if (!ghost) return null;
  ghost.innerHTML = "";
  const clone = sourceEl.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-hand-id");
  clone.removeAttribute("data-attacker-id");
  clone.removeAttribute("data-target");
  clone.removeAttribute("aria-pressed");
  clone.style.opacity = "1";
  clone.style.pointerEvents = "none";
  clone.style.position = "static";
  ghost.appendChild(clone);
  ghost.style.display = "block";
  return ghost;
}

function showLine(kind: DragLineKind, x: number, y: number): void {
  const line = document.getElementById("drag-line") as SVGLineElement | null;
  if (!line) return;
  line.classList.remove("heal-line", "buff-line", "bounce-line", "destroy-line");
  if (kind !== "damage") line.classList.add(`${kind}-line`);
  line.setAttribute("x1", String(x));
  line.setAttribute("y1", String(y));
  line.setAttribute("x2", String(x));
  line.setAttribute("y2", String(y));
  line.style.display = "block";
}

function positionGhost(x: number, y: number): void {
  if (!session?.ghostEl) return;
  session.ghostEl.style.transform = `translate3d(${x - 60}px, ${y - 85}px, 0) scale(1.05)`;
}

function attachListeners(): void {
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("keydown", onKeyDown);
}

function detachListeners(): void {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerCancel);
  window.removeEventListener("keydown", onKeyDown);
}

function onPointerMove(event: PointerEvent): void {
  if (!session || event.pointerId !== session.pointerId) return;
  event.preventDefault();
  const x = event.clientX;
  const y = event.clientY;

  if (session.kind === "hand") {
    positionGhost(x, y);
    if (session.isMinion && !session.needsTarget) {
      updatePlacementIndicator(x, y);
    }
  }

  if (session.needsTarget || session.kind === "attack") {
    updateSnappedTarget(x, y);
  } else if (session.needsHeroDrop) {
    updateHeroDropZone(x, y);
  } else {
    drawLineTo(x, y);
  }
}

function updateHeroDropZone(x: number, y: number): void {
  if (!session) return;
  const hero = session.heroDropEl;
  if (!hero) {
    session.overHeroDrop = false;
    drawLineTo(x, y);
    return;
  }
  const rect = hero.getBoundingClientRect();
  const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  const hit = document.elementFromPoint(x, y);
  const over = inside || Boolean(hit?.closest('[data-testid="player-hero"]')) || hero.contains(hit);
  session.overHeroDrop = over;
  hero.classList.toggle("news-drop-hot", over);
  drawLineTo(x, y);
}

function onPointerUp(event: PointerEvent): void {
  if (!session || event.pointerId !== session.pointerId) return;
  event.preventDefault();
  resolveSession();
}

function onPointerCancel(event: PointerEvent): void {
  if (!session || event.pointerId !== session.pointerId) return;
  cancelSession();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape" && session) cancelSession();
}

function updatePlacementIndicator(x: number, y: number): void {
  if (!session) return;
  const board = session.playerBoardEl;
  if (!board) {
    drawLineTo(x, y);
    return;
  }
  const targetEl = document.elementFromPoint(x, y);
  const boardRect = board.getBoundingClientRect();
  const insideBoardRect = x >= boardRect.left && x <= boardRect.right && y >= boardRect.top && y <= boardRect.bottom;
  const overBoard = insideBoardRect || Boolean(targetEl?.closest('[data-testid="player-board"]')) || board.contains(targetEl);

  if (!overBoard) {
    board.classList.remove("drop-highlight");
    if (session.indicator) session.indicator.classList.remove("active");
    session.insertionIndex = -1;
    drawLineTo(x, y);
    return;
  }

  board.classList.add("drop-highlight");
  // Hide the empty-board placeholder slots for the rest of the drag (not just
  // while over the board), so the indicator's collapse animation on the way out
  // doesn't snap to the grid-overflow position. Cleared in finishSession.
  board.classList.add("placing");
  let indicator = session.indicator;
  if (!indicator || indicator.parentElement !== board) {
    indicator = ensureIndicator(board);
    session.indicator = indicator;
  }

  const minions = Array.from(board.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.matches(".minion")
  );

  if (minions.length === 0) {
    session.insertionIndex = 0;
    if (indicator.parentElement !== board) board.appendChild(indicator);
  } else {
    let placed = false;
    for (let i = 0; i < minions.length; i++) {
      const rect = minions[i].getBoundingClientRect();
      if (x < rect.left + rect.width / 2) {
        session.insertionIndex = i;
        if (board.children[i] !== indicator) board.insertBefore(indicator, minions[i]);
        placed = true;
        break;
      }
    }
    if (!placed) {
      session.insertionIndex = minions.length;
      if (board.lastElementChild !== indicator) board.appendChild(indicator);
    }
  }
  indicator.classList.add("active");
  drawLineTo(x, y);
}

function ensureIndicator(board: HTMLElement): HTMLDivElement {
  const existing = board.querySelector<HTMLDivElement>(".placement-indicator");
  if (existing) return existing;
  const div = document.createElement("div");
  div.className = "placement-indicator";
  board.appendChild(div);
  return div;
}

function updateSnappedTarget(x: number, y: number): void {
  if (!session) return;
  const hit = document.elementFromPoint(x, y);
  const candidate = hit?.closest<HTMLElement>("[data-target]");
  if (candidate && session.isEligibleTarget(candidate)) {
    session.snappedTargetEl = candidate;
    const rect = candidate.getBoundingClientRect();
    drawLineTo(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return;
  }
  session.snappedTargetEl = null;
  drawLineTo(x, y);
}

function drawLineTo(x: number, y: number): void {
  if (!session) return;
  const line = document.getElementById("drag-line") as SVGLineElement | null;
  if (!line) return;
  const dx = x - session.startX;
  const dy = y - session.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  let x2 = x;
  let y2 = y;
  if (dist > ARROW_OFFSET) {
    const ratio = (dist - ARROW_OFFSET) / dist;
    x2 = session.startX + dx * ratio;
    y2 = session.startY + dy * ratio;
  }
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
}

function resolveSession(): void {
  if (!session) return;
  const data = {
    insertionIndex: session.insertionIndex,
    targetEl: session.snappedTargetEl,
    overDropZone: session.overHeroDrop
  };
  const cb = session.onResolve;
  finishSession(false);
  cb(data);
}

function cancelSession(): void {
  if (!session) return;
  const cb = session.onCancel;
  finishSession(false);
  cb();
}

function finishSession(silent: boolean): void {
  document.body.classList.remove("hand-dragging");
  if (!session) {
    detachListeners();
    return;
  }
  session.resolved = true;
  const board = session.playerBoardEl;
  if (board) {
    board.classList.remove("drop-highlight");
    board.classList.remove("placing");
    const indicator = board.querySelector(".placement-indicator");
    if (indicator) indicator.remove();
  }
  if (session.heroDropEl) {
    session.heroDropEl.classList.remove("news-drop-zone", "news-drop-hot");
  }
  hideLine();
  hideGhost();
  detachListeners();
  session = null;
  if (silent) return;
}

function hideLine(): void {
  const line = document.getElementById("drag-line") as SVGLineElement | null;
  if (!line) return;
  line.style.display = "none";
  line.classList.remove("heal-line", "buff-line", "bounce-line", "destroy-line");
}

function hideGhost(): void {
  const ghost = document.getElementById("drag-ghost") as HTMLElement | null;
  if (!ghost) return;
  ghost.innerHTML = "";
  ghost.style.display = "none";
  ghost.style.transform = "translate3d(-9999px, -9999px, 0)";
}

/**
 * --- BATTLECRY TARGETING (v1 parity) ---
 *
 * After a targeted-battlecry card is dropped onto the field, the player aims a
 * *separate* arrow at the effect's target. Unlike a hand/attack drag, this is a
 * free-aim gesture with no pointer button held: the arrow follows the pointer
 * and a click resolves it. The anchor is recomputed every frame so the arrow
 * tracks the preview minion across the re-renders the v2 client performs.
 */
export interface BattlecryTargetingOptions {
  lineKind: DragLineKind;
  /** Live screen-space origin of the arrow (preview minion / hero centre). */
  getAnchor: () => { x: number; y: number } | null;
  isEligibleTarget: (el: HTMLElement) => boolean;
  /** A legal target was clicked. */
  onCommit: (targetEl: HTMLElement) => void;
  /** A unit was clicked, but it is not a legal target — keep aiming. */
  onInvalid: (targetEl: HTMLElement) => void;
  /** Empty space / non-unit clicked, or Escape — abort and refund. */
  onCancel: () => void;
}

interface TargetingState extends BattlecryTargetingOptions {
  pointerX: number;
  pointerY: number;
  clickArmed: boolean;
}

let targeting: TargetingState | null = null;

export function isBattlecryTargetingActive(): boolean {
  return targeting !== null;
}

export function beginBattlecryTargeting(opts: BattlecryTargetingOptions): void {
  ensureDragLayer();
  finishSession(true);
  endBattlecryTargeting();

  targeting = { ...opts, pointerX: 0, pointerY: 0, clickArmed: false };

  window.addEventListener("pointermove", onTargetingMove, { passive: false });
  window.addEventListener("keydown", onTargetingKey);

  // The same pointerup that dropped the card can emit a trailing synthetic
  // click. Arm the resolver on the next frame so that click is ignored, and
  // draw the initial arrow once render() has flushed the preview minion.
  requestAnimationFrame(() => {
    if (!targeting) return;
    targeting.clickArmed = true;
    window.addEventListener("click", onTargetingClick, true);
    const anchor = targeting.getAnchor();
    if (anchor) {
      targeting.pointerX = anchor.x;
      targeting.pointerY = anchor.y;
      showLine(targeting.lineKind, anchor.x, anchor.y);
      drawTargetingLine();
    }
  });
}

export function endBattlecryTargeting(): void {
  if (!targeting) return;
  targeting = null;
  window.removeEventListener("pointermove", onTargetingMove);
  window.removeEventListener("keydown", onTargetingKey);
  window.removeEventListener("click", onTargetingClick, true);
  hideLine();
}

function onTargetingMove(event: PointerEvent): void {
  if (!targeting) return;
  event.preventDefault();
  targeting.pointerX = event.clientX;
  targeting.pointerY = event.clientY;
  drawTargetingLine();
}

function drawTargetingLine(): void {
  if (!targeting) return;
  const line = document.getElementById("drag-line") as SVGLineElement | null;
  const anchor = targeting.getAnchor();
  if (!line || !anchor) return;

  let endX = targeting.pointerX;
  let endY = targeting.pointerY;
  const hit = document.elementFromPoint(targeting.pointerX, targeting.pointerY);
  const candidate = hit?.closest<HTMLElement>("[data-target]");
  if (candidate && targeting.isEligibleTarget(candidate)) {
    const rect = candidate.getBoundingClientRect();
    endX = rect.left + rect.width / 2;
    endY = rect.top + rect.height / 2;
  }

  const dx = endX - anchor.x;
  const dy = endY - anchor.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > ARROW_OFFSET) {
    const ratio = (dist - ARROW_OFFSET) / dist;
    endX = anchor.x + dx * ratio;
    endY = anchor.y + dy * ratio;
  }
  line.setAttribute("x1", String(anchor.x));
  line.setAttribute("y1", String(anchor.y));
  line.setAttribute("x2", String(endX));
  line.setAttribute("y2", String(endY));
}

function onTargetingKey(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !targeting) return;
  const cancel = targeting.onCancel;
  endBattlecryTargeting();
  cancel();
}

function onTargetingClick(event: MouseEvent): void {
  if (!targeting || !targeting.clickArmed) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const state = targeting;
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const unit = hit?.closest<HTMLElement>("[data-target]");
  if (unit && state.isEligibleTarget(unit)) {
    state.onCommit(unit);
  } else if (unit) {
    state.onInvalid(unit); // a unit, but not a legal target — stay in targeting
  } else {
    endBattlecryTargeting();
    state.onCancel();
  }
}

export function classifyEffectKind(effectType: string | undefined): DragLineKind {
  if (!effectType) return "damage";
  if (effectType.startsWith("HEAL") || effectType === "FULL_HEAL" || effectType === "FULL_HEAL_AND_DRAW") return "heal";
  if (effectType.startsWith("BUFF_")) return "buff";
  if (effectType.startsWith("BOUNCE")) return "bounce";
  if (effectType.startsWith("DESTROY")) return "destroy";
  return "damage";
}
