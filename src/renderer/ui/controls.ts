/**
 * Small controls: tab strips, radio groups, selects, toggles, empty states,
 * splitters and clipboard.
 */
import { h, type Attrs } from './dom';
import { icon } from './icons';
import { toast } from './overlays';

export interface TabItem { id: string; label: string; badge?: string | number | null; badgeClass?: string; dot?: boolean }
export type Option = readonly [string, string];

function tabBadge(item: TabItem): HTMLElement | null {
  if (item.badge === undefined || item.badge === null || item.badge === '') return null;
  return h('span', { class: `badge${item.badgeClass ? ` ${item.badgeClass}` : ''}` }, item.badge);
}

export function tabStrip(items: TabItem[], activeId: string, onSelect: (id: string) => void, className = ''): HTMLElement {
  return h('div', { class: `subtabs ${className}`, role: 'tablist' }, items.map((item) => h('button', {
    class: `subtab${item.id === activeId ? ' active' : ''}`,
    role: 'tab',
    type: 'button',
    'aria-selected': String(item.id === activeId),
    onclick: () => onSelect(item.id)
  }, item.label, tabBadge(item), item.dot ? h('span', { class: 'dot' }) : null)));
}

export function radioGroup(name: string, options: Option[], value: string, onChange: (value: string) => void): HTMLElement {
  return h('div', { class: 'radio-group', role: 'radiogroup' }, options.map(([v, label]) => h('label', { class: `radio${v === value ? ' checked' : ''}` },
    h('input', { type: 'radio', name, value: v, checked: v === value, onchange: () => onChange(v) }), label)));
}

export function selectEl(options: ReadonlyArray<Option>, value: string, onChange: (value: string) => void, attrs: Attrs = {}): HTMLSelectElement {
  return h('select', { class: 'select', ...attrs, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
    options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
}

export function toggle(label: string, checked: boolean | undefined, onChange: (checked: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: !!checked, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) });
  return h('label', { class: 'toggle' }, input, h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })), h('span', null, label));
}

export function emptyState(iconName: string, title: string, text?: string, action?: HTMLElement | null): HTMLElement {
  return h('div', { class: 'empty-state' }, icon(iconName, 40), h('div', { class: 'empty-title' }, title), text ? h('div', { class: 'empty-text' }, text) : null, action || null);
}

export interface SplitterOptions<C> { axis: 'x' | 'y'; onStart?: () => C; onMove: (delta: number, ctx: C) => void; onEnd?: () => void }

/** Drag handle: onStart() -> ctx, onMove(delta, ctx), onEnd(). */
export function splitter<C = undefined>(handle: HTMLElement, { axis, onStart, onMove, onEnd }: SplitterOptions<C>): void {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const origin = axis === 'x' ? e.clientX : e.clientY;
    const ctx = (onStart ? onStart() : undefined) as C;
    const cursorClass = axis === 'x' ? 'resizing-x' : 'resizing-y';
    document.body.classList.add(cursorClass);
    const move = (ev: MouseEvent): void => onMove((axis === 'x' ? ev.clientX : ev.clientY) - origin, ctx);
    const up = (): void => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove(cursorClass);
      if (onEnd) onEnd();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard', 'success');
  } catch {
    toast('Could not copy to clipboard', 'error');
  }
}
