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
  isEligibleTarget: (el: HTMLElement) => boolean;
  onResolve: (result: { insertionIndex: number; targetEl: HTMLElement | null }) => void;
  onCancel: () => void;
}

export interface AttackDragOptions {
  pointerId: number;
  startX: number;
  startY: number;
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
  isEligibleTarget: (el: HTMLElement) => boolean;
  ghostEl: HTMLElement | null;
  indicator: HTMLDivElement | null;
  insertionIndex: number;
  snappedTargetEl: HTMLElement | null;
  resolved: boolean;
  onResolve: (data: { insertionIndex: number; targetEl: HTMLElement | null }) => void;
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
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "4");
  marker.setAttribute("markerHeight", "4");
  marker.setAttribute("orient", "auto-start-reverse");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  path.setAttribute("fill", color);
  marker.appendChild(path);
  return marker as SVGMarkerElement;
}

export function beginHandDrag(opts: HandDragOptions): void {
  ensureDragLayer();
  finishSession(true);

  session = {
    kind: "hand",
    pointerId: opts.pointerId,
    startX: opts.startX,
    startY: opts.startY,
    isMinion: opts.isMinion,
    needsTarget: opts.needsTarget,
    lineKind: opts.lineKind,
    playerBoardEl: opts.playerBoardEl,
    isEligibleTarget: opts.isEligibleTarget,
    ghostEl: createGhost(opts.sourceEl),
    indicator: null,
    insertionIndex: -1,
    snappedTargetEl: null,
    resolved: false,
    onResolve: opts.onResolve,
    onCancel: opts.onCancel
  };

  showLine(opts.lineKind, opts.startX, opts.startY);
  positionGhost(opts.startX, opts.startY);
  attachListeners();
}

export function beginAttackDrag(opts: AttackDragOptions): void {
  ensureDragLayer();
  finishSession(true);

  session = {
    kind: "attack",
    pointerId: opts.pointerId,
    startX: opts.startX,
    startY: opts.startY,
    isMinion: true,
    needsTarget: true,
    lineKind: "damage",
    playerBoardEl: null,
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

  showLine("damage", opts.startX, opts.startY);
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
  } else {
    drawLineTo(x, y);
  }
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
  const overBoard = Boolean(targetEl?.closest('[data-testid="player-board"]')) || board.contains(targetEl);

  if (!overBoard) {
    board.classList.remove("drop-highlight");
    if (session.indicator) session.indicator.classList.remove("active");
    session.insertionIndex = -1;
    drawLineTo(x, y);
    return;
  }

  board.classList.add("drop-highlight");
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
  const data = { insertionIndex: session.insertionIndex, targetEl: session.snappedTargetEl };
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
  if (!session) {
    detachListeners();
    return;
  }
  session.resolved = true;
  const board = session.playerBoardEl;
  if (board) {
    board.classList.remove("drop-highlight");
    const indicator = board.querySelector(".placement-indicator");
    if (indicator) indicator.remove();
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

export function classifyEffectKind(effectType: string | undefined): DragLineKind {
  if (!effectType) return "damage";
  if (effectType.startsWith("HEAL") || effectType === "FULL_HEAL" || effectType === "FULL_HEAL_AND_DRAW") return "heal";
  if (effectType.startsWith("BUFF_")) return "buff";
  if (effectType.startsWith("BOUNCE")) return "bounce";
  if (effectType.startsWith("DESTROY")) return "destroy";
  return "damage";
}
