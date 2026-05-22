type Listener = EventListenerOrEventListenerObject;

const boundListeners = new WeakMap<EventTarget, Set<string>>();

export function bindOnce(
  target: EventTarget | null | undefined,
  type: string,
  key: string,
  listener: Listener,
  options?: AddEventListenerOptions | boolean
): void {
  if (!target) return;
  const token = `${type}:${key}`;
  let bound = boundListeners.get(target);
  if (!bound) {
    bound = new Set();
    boundListeners.set(target, bound);
  }
  if (bound.has(token)) return;
  bound.add(token);
  target.addEventListener(type, listener, options);
}

export function patchHtml(target: HTMLElement, html: string): void {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  patchChildren(target, template.content);
}

export function patchChildren(target: ParentNode, nextParent: ParentNode): void {
  const oldChildren = Array.from(target.childNodes);
  const keyedOld = new Map<string, Node>();
  for (const child of oldChildren) {
    const key = nodeKey(child);
    if (key && !keyedOld.has(key)) keyedOld.set(key, child);
  }

  const used = new Set<Node>();
  let oldCursor = 0;
  const nextChildren = Array.from(nextParent.childNodes);

  for (let index = 0; index < nextChildren.length; index++) {
    const nextChild = nextChildren[index];
    const key = nodeKey(nextChild);
    let current = key ? keyedOld.get(key) : undefined;

    if (!current) {
      while (oldCursor < oldChildren.length) {
        const candidate = oldChildren[oldCursor++];
        if (!used.has(candidate) && !nodeKey(candidate)) {
          current = candidate;
          break;
        }
      }
    }

    if (current && !used.has(current)) {
      const patched = patchNode(current, nextChild);
      used.add(patched);
      const before = target.childNodes[index] ?? null;
      if (patched !== before) target.insertBefore(patched, before);
    } else {
      const inserted = nextChild.cloneNode(true);
      const before = target.childNodes[index] ?? null;
      target.insertBefore(inserted, before);
    }
  }

  for (const child of oldChildren) {
    if (!used.has(child) && child.parentNode === target) child.remove();
  }
}

function patchNode(current: Node, next: Node): Node {
  if (current.nodeType !== next.nodeType) return replaceNode(current, next);
  if (current.nodeType === Node.TEXT_NODE) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return current;
  }
  if (current.nodeType !== Node.ELEMENT_NODE || next.nodeType !== Node.ELEMENT_NODE) {
    return replaceNode(current, next);
  }

  const currentEl = current as HTMLElement;
  const nextEl = next as HTMLElement;
  if (currentEl.tagName !== nextEl.tagName) return replaceNode(current, next);

  patchAttributes(currentEl, nextEl);
  syncFormState(currentEl, nextEl);
  patchChildren(currentEl, nextEl);
  return currentEl;
}

function replaceNode(current: Node, next: Node): Node {
  const replacement = next.cloneNode(true);
  current.parentNode?.replaceChild(replacement, current);
  return replacement;
}

function patchAttributes(current: Element, next: Element): void {
  for (const attr of Array.from(current.attributes)) {
    if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  }
  for (const attr of Array.from(next.attributes)) {
    if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  }
}

function syncFormState(current: Element, next: Element): void {
  if (current instanceof HTMLInputElement && next instanceof HTMLInputElement) {
    if (current.value !== next.value) current.value = next.value;
    if (current.checked !== next.checked) current.checked = next.checked;
    current.defaultChecked = next.defaultChecked;
    return;
  }
  if (current instanceof HTMLTextAreaElement && next instanceof HTMLTextAreaElement) {
    if (current.value !== next.value) current.value = next.value;
    return;
  }
  if (current instanceof HTMLSelectElement && next instanceof HTMLSelectElement) {
    if (current.value !== next.value) current.value = next.value;
  }
}

function nodeKey(node: Node): string | undefined {
  if (node.nodeType !== Node.ELEMENT_NODE) return undefined;
  const el = node as Element;
  return el.getAttribute("data-dom-key") || (el.id ? `#${el.id}` : undefined);
}
