/**
 * Element builder and DOM helpers.
 */
export type Child = Node | string | number | boolean | null | undefined | Child[];
export type Attrs = Record<string, unknown>;

function appendChildren(el: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

function applyAttribute(el: HTMLElement, key: string, value: unknown): void {
  if (value === undefined || value === null || value === false) return;
  if (key === 'class') el.className = String(value);
  else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
  else if (key === 'dataset') Object.assign(el.dataset, value);
  else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
  else if (key === 'html') el.innerHTML = String(value);
  else if (key in el && typeof value !== 'string') (el as unknown as Record<string, unknown>)[key] = value;
  else el.setAttribute(key, value === true ? '' : String(value));
}

/** h('div', { class, onclick, ... }, ...children) — null/false children are skipped. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([key, value]) => applyAttribute(el, key, value));
  appendChildren(el, children);
  return el;
}

export function clear<T extends Element>(el: T): T {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Like Element.append but skips null/undefined/false (native append would insert the text "null"). */
export function append<T extends Element>(el: T, ...children: Child[]): T {
  appendChildren(el, children);
  return el;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
