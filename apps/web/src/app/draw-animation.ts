import { playSfx } from "./audio.js";

/**
 * --- GOLD STANDARD DRAW ANIMATION (ported from v1) ---
 *
 * When a card is drawn, a fixed-position clone of its destination element flies
 * from the deck pile to the card's slot in the hand, scaling 0.5x -> 1x with an
 * elastic overshoot. Faithful to the v1 `animateCardFromDeck` — do not change
 * the timing or bezier without request.
 *
 * V2 re-renders the whole hand on every sync, so the real destination card is
 * replaced mid-flight. We therefore track in-flight cards by `data-hand-id`
 * (player) and re-query on cleanup; `renderHandCard` keeps any tracked card
 * hidden via `isHandCardAnimating`.
 */

type Side = "player" | "opponent";

// v1 timing — see `animateCardFromDeck`.
const FLIGHT_MS = 850;
const FLIGHT_EASING = "cubic-bezier(0.18, 0.89, 0.32, 1.15)";
const FAIL_SAFE_MS = 1400;
export const DRAW_ANIMATION_MS = FAIL_SAFE_MS;

// 疲勞(牌庫抽乾):骷髏卡從牌庫飛向英雄所需時間。runtime 以此把傷害數字/血量落下
// 對齊到命中當下(readyAtMs = now + FATIGUE_DRAW_MS),共享端的 bot 配速常數見
// packages/shared/src/animationTiming.ts FATIGUE_DRAW_MS(務必同步)。
export const FATIGUE_DRAW_MS = 900;
const FATIGUE_FAIL_SAFE_MS = 1600;
// Scale of the card as it leaves the deck, before it settles onto its slot.
// Higher = a larger flying card (was 0.5 in the v1 port).
const START_SCALE = 0.8;

// `instanceId` for the previous local hand sync, in slot order. The first sync
// of a match seeds this (no animation for the opening hand).
let prevPlayerHandIds: string[] | undefined;
// Opponent hand size for the previous publicSync. Undefined until the first.
let prevOpponentHandCount: number | undefined;

// Local hand cards currently mid-flight; their real elements stay hidden.
const animatingHandIds = new Set<string>();
// Count of opponent card-backs currently flying in. The trailing N backs of the
// opponent fan are kept hidden (they land at the end of the fan, in order) so the
// real back isn't sitting full-size in the hand while its clone is still flying.
let animatingOpponentCount = 0;
const drawQueue: Array<{ side: Side; slotIndex: number; handId?: string }> = [];
let drawQueueActive = false;
let drawQueueGeneration = 0;

/** Clears all draw tracking. Call on match start/teardown. */
export function resetDrawTracking(): void {
  prevPlayerHandIds = undefined;
  prevOpponentHandCount = undefined;
  animatingHandIds.clear();
  animatingOpponentCount = 0;
  drawQueue.length = 0;
  drawQueueActive = false;
  drawQueueGeneration += 1;
}

/** True while a drawn local hand card is still flying — used by renderHandCard. */
export function isHandCardAnimating(instanceId: string): boolean {
  return animatingHandIds.has(instanceId);
}

/**
 * How many trailing opponent card-backs are mid-flight and must render hidden —
 * used by renderOpponentHand so a re-render during the flight keeps the real
 * back invisible until its clone lands.
 */
export function opponentDrawHiddenCount(): number {
  return animatingOpponentCount;
}

/**
 * Applies the in-flight hide to the live opponent fan: the last
 * `animatingOpponentCount` backs are hidden, the rest revealed. Called whenever
 * the count changes so the DOM stays correct between full re-renders.
 */
function syncOpponentHiddenBacks(): void {
  const backs = document.querySelectorAll<HTMLElement>(".opponent-hand .card.card-back");
  const hideFrom = backs.length - animatingOpponentCount;
  backs.forEach((back, index) => {
    if (index >= hideFrom) {
      back.style.opacity = "0";
    } else if (back.style.opacity === "0") {
      back.style.opacity = "";
    }
  });
}

/**
 * Called after a local `hand` sync has been applied and render() requested.
 * Animates any card whose `instanceId` was not present in the previous hand.
 * The first call of a match only seeds the baseline (opening hand, no fly-in).
 */
export function notePlayerHandSync(handIds: string[], opts: { suppressNewIds?: readonly string[] } = {}): void {
  const previous = prevPlayerHandIds;
  prevPlayerHandIds = [...handIds];
  if (previous === undefined) return; // opening hand — baseline only

  const prevSet = new Set(previous);
  const suppressed = new Set(opts.suppressNewIds ?? []);
  for (let slot = 0; slot < handIds.length; slot += 1) {
    const id = handIds[slot];
    if (prevSet.has(id) || suppressed.has(id)) continue;
    animatingHandIds.add(id);
    // render() ran before this call, so the freshly drawn card is already in the
    // DOM at full size — hide it now so only the flying clone shows. Subsequent
    // re-renders keep it hidden via isHandCardAnimating(); cleanup re-reveals it.
    const el = document.querySelector<HTMLElement>(`.hand-row .card[data-hand-id="${cssAttr(id)}"]`);
    if (el) {
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
    }
    enqueueDrawAnimation("player", slot, id);
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
    // New opponent cards land at the end of the fan. Mark them hidden now so the
    // real back doesn't sit full-size in the fan while its clone is still flying.
    animatingOpponentCount += 1;
    enqueueDrawAnimation("opponent", handCount - drawn + i);
  }
  // renderNow() ran before this call — hide the just-added backs in place.
  syncOpponentHiddenBacks();
}

function enqueueDrawAnimation(side: Side, slotIndex: number, handId?: string): void {
  drawQueue.push({ side, slotIndex, handId });
  if (!drawQueueActive) playNextDrawAnimation();
}

function playNextDrawAnimation(): void {
  const next = drawQueue.shift();
  if (!next) {
    drawQueueActive = false;
    return;
  }
  drawQueueActive = true;
  const generation = drawQueueGeneration;
  animateCardFromDeck(next.side, next.slotIndex, next.handId, () => {
    if (generation !== drawQueueGeneration) return;
    playNextDrawAnimation();
  });
}

/**
 * Clones the card at `slotIndex` and flies it from the deck pile, mirroring
 * the v1 `animateCardFromDeck`. `handId` is set for the local player so the
 * real card can be re-found after a re-render; omitted for the opponent.
 */
function animateCardFromDeck(side: Side, slotIndex: number, handId?: string, onDone?: () => void): void {
  let doneCalled = false;
  const done = (): void => {
    if (doneCalled) return;
    doneCalled = true;
    onDone?.();
  };

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
        if (handId) {
          animatingHandIds.delete(handId);
        } else {
          animatingOpponentCount = Math.max(0, animatingOpponentCount - 1);
          syncOpponentHiddenBacks();
        }
        done();
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
        if (handId) {
          animatingHandIds.delete(handId);
        } else {
          animatingOpponentCount = Math.max(0, animatingOpponentCount - 1);
          syncOpponentHiddenBacks();
        }
        done();
        return;
      }

      // Slot (resting) size of the real card the clone must land on.
      const slotW = targetEl.offsetWidth || (side === "player" ? 128 : 80);
      const slotH = targetEl.offsetHeight || (side === "player" ? 184 : 110);

      // The clone's base box, plus the scale at takeoff (deck) and landing (slot).
      // Player: fly at the slot size, growing START_SCALE -> 1. Opponent: the
      // opponent hand back is tiny (~80px), so fly at the player's card size for
      // legibility and shrink into the small slot (endScale < 1), preserving the
      // back's aspect ratio.
      let cloneW = slotW;
      let cloneH = slotH;
      let startScale = START_SCALE;
      let endScale = 1;
      if (side === "opponent") {
        const playerCardW = document.querySelector<HTMLElement>(".hand-row .card")?.offsetWidth;
        cloneW = playerCardW || 128;
        cloneH = cloneW * (slotH / slotW);
        endScale = slotW / cloneW; // land exactly on the small slot
        startScale = Math.max(endScale, 0.95); // emerge near full size, tuck in
      }

      // Anchor by centre, not top-left: the flying card dwarfs the deck pile
      // (54x72), so a corner anchor would start the flight well below and right
      // of the deck. Centring makes the card visibly fly *out of* the deck pile.
      // With `transform-origin: center`, scale() keeps that centre fixed.
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
      // `.card` defines `transform-origin: center 130%` for the fan tilt, which
      // would pivot the scale well below the card — the start frame computed for
      // a centre anchor would then sit ~0.4H too low and grow off-axis. Pin the
      // clone's pivot to its centre so it emerges from the deck and settles onto
      // the slot at the matching size.
      clone.style.transformOrigin = "center center";

      // Land at the destination card's resting fan rotation so the hand-off to
      // the real card is seamless. The opponent fan is mirrored and flipped
      // upside-down (`rotate(180deg - --rot)` in CSS), so its clone must fly
      // flipped too; the player's fan is just `rotate(--rot)`.
      const rot = clone.style.getPropertyValue("--rot").trim() || "0deg";
      const startRotate = side === "opponent" ? "rotate(180deg)" : "";
      const endRotate = side === "opponent" ? `rotate(calc(180deg - ${rot}))` : `rotate(${rot})`;
      const startTransform = `translate(${startX}px, ${startY}px) ${startRotate} scale(${startScale})`;
      const endTransform = `translate(${endX}px, ${endY}px) ${endRotate} scale(${endScale})`;
      clone.style.transform = startTransform;

      document.body.appendChild(clone);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          clone.style.transition = `transform ${FLIGHT_MS}ms ${FLIGHT_EASING}, opacity 0.3s ease`;
          clone.style.transform = endTransform;
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
          if (real) {
            real.style.opacity = "";
            real.style.pointerEvents = "";
          }
        } else {
          // Opponent back has landed — drop the hide on one trailing back.
          animatingOpponentCount = Math.max(0, animatingOpponentCount - 1);
          syncOpponentHiddenBacks();
        }
        done();
      };
      const onEnd = (event: TransitionEvent): void => {
        if (event.propertyName === "transform") cleanup();
      };
      clone.addEventListener("transitionend", onEnd);
      const failSafe = window.setTimeout(cleanup, FAIL_SAFE_MS);
    });
  });
}

/**
 * 疲勞抽牌動畫:牌庫已空卻仍要抽牌時,從牌庫飛出一張寫著「卡牌已抽乾」+ 骷髏的卡,
 * 飛向該玩家的英雄,於命中(FATIGUE_DRAW_MS)時呼叫 `onImpact`(由 runtime 用來
 * 對齊傷害數字/血量落下),接著卡牌碎裂淡出。命令式、body 層級,不受主 render 重繪
 * 影響(同 applyKnifeStrike 的理由)。`heroTargetKey` 形如 "player1:hero"。
 */
export function playFatigueDraw(side: Side, heroTargetKey: string, onImpact?: () => void): void {
  let impacted = false;
  const fireImpact = (): void => {
    if (impacted) return;
    impacted = true;
    onImpact?.();
  };

  playSfx("cardDraw");

  // 等兩個 frame 讓重繪後的牌庫/英雄座標穩定(同 animateCardFromDeck 的理由)。
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const deckEl = document.querySelector<HTMLElement>(`.deck-pile.battle-deck-pile.${side}-deck`);
      const heroEl = document.querySelector<HTMLElement>(`[data-target-key="${cssAttr(heroTargetKey)}"]`);
      const heroAnchor = heroEl?.querySelector<HTMLElement>(".avatar") ?? heroEl;
      if (!deckEl || !heroAnchor) {
        fireImpact();
        return;
      }
      const deckRect = deckEl.getBoundingClientRect();
      const heroRect = heroAnchor.getBoundingClientRect();
      if (deckRect.width === 0 || heroRect.width === 0) {
        fireImpact();
        return;
      }

      const cardW = 132;
      const cardH = 188;
      const startX = deckRect.left + deckRect.width / 2 - cardW / 2;
      const startY = deckRect.top + deckRect.height / 2 - cardH / 2;
      const endX = heroRect.left + heroRect.width / 2 - cardW / 2;
      const endY = heroRect.top + heroRect.height / 2 - cardH / 2;

      const card = document.createElement("div");
      card.className = "fatigue-card";
      card.setAttribute("aria-hidden", "true");
      card.style.position = "fixed";
      card.style.left = "0";
      card.style.top = "0";
      card.style.width = `${cardW}px`;
      card.style.height = `${cardH}px`;
      card.style.zIndex = "9999";
      card.style.pointerEvents = "none";
      card.style.transformOrigin = "center center";
      card.style.transform = `translate(${startX}px, ${startY}px) scale(0.6) rotate(-8deg)`;
      card.style.transition = "none";
      card.innerHTML =
        `<span class="fatigue-card-skull">☠</span>` +
        `<span class="fatigue-card-label">卡牌已抽乾</span>`;
      document.body.appendChild(card);

      // 飛行段:從牌庫放大飛到英雄。
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          card.style.transition = `transform ${FATIGUE_DRAW_MS}ms ${FLIGHT_EASING}`;
          card.style.transform = `translate(${endX}px, ${endY}px) scale(1) rotate(4deg)`;
        });
      });

      // 命中:落下傷害數字(onImpact),卡牌抖一下後碎裂淡出。
      window.setTimeout(() => {
        fireImpact();
        playSfx("death");
        card.classList.add("fatigue-card-impact");
        card.style.transition = "transform 360ms ease-in, opacity 360ms ease-in";
        card.style.transform = `translate(${endX}px, ${endY}px) scale(1.18) rotate(-6deg)`;
        card.style.opacity = "0";
      }, FATIGUE_DRAW_MS);

      window.setTimeout(() => card.remove(), FATIGUE_FAIL_SAFE_MS);
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
