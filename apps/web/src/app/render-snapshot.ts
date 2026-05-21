import { cssEscape } from "./dom.js";

export type RenderSnapshot = {
  activeSelector?: string;
  activeValue?: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  scroll: Array<{ selector: string; top: number; left: number }>;
};

export function captureRenderSnapshot(): RenderSnapshot {
  const active = document.activeElement;
  const input = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : undefined;
  const activeSelector = input ? stableElementSelector(input) : undefined;
  const selection = input ? readInputSelection(input) : undefined;
  return {
    activeSelector,
    activeValue: input?.value,
    selectionStart: selection?.start,
    selectionEnd: selection?.end,
    scroll: Array.from(document.querySelectorAll<HTMLElement>("[data-preserve-scroll]"))
      .map((el) => ({ selector: stableElementSelector(el), top: el.scrollTop, left: el.scrollLeft }))
      .filter((item) => item.selector)
  };
}

export function restoreRenderSnapshot(snapshot: RenderSnapshot): void {
  for (const item of snapshot.scroll) {
    const el = document.querySelector<HTMLElement>(item.selector);
    if (!el) continue;
    el.scrollTop = item.top;
    el.scrollLeft = item.left;
  }
  if (!snapshot.activeSelector) return;
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(snapshot.activeSelector);
  if (!input) return;
  if (snapshot.activeValue !== undefined && input.value !== snapshot.activeValue) input.value = snapshot.activeValue;
  input.focus();
  if (snapshot.selectionStart !== null && snapshot.selectionStart !== undefined) {
    try {
      input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd ?? snapshot.selectionStart);
    } catch {
      // Non-text inputs such as sliders do not support selection ranges.
    }
  }
}

function readInputSelection(input: HTMLInputElement | HTMLTextAreaElement): { start: number | null; end: number | null } | undefined {
  try {
    return { start: input.selectionStart, end: input.selectionEnd };
  } catch {
    return undefined;
  }
}

function stableElementSelector(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${cssEscape(testId)}"]`;
  const screen = el.getAttribute("data-screen");
  if (screen) return `[data-screen="${cssEscape(screen)}"]`;
  const className = Array.from(el.classList)[0];
  return className ? `.${cssEscape(className)}` : "";
}
