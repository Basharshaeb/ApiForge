/**
 * Overlays: toasts, context menus and modal dialogs (prompt / confirm / choice).
 */
import { h, type Child } from './dom';
import { icon, iconButton } from './icons';

export type ToastKind = 'info' | 'success' | 'error' | 'warning';
export interface MenuItem { label: string; icon?: string; onClick?: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }
export type MenuEntry = MenuItem | 'separator' | null | undefined | false;
export interface MenuOptions { point?: { x: number; y: number }; alignRight?: boolean }
export interface ModalAction { label: string; value?: unknown; primary?: boolean; danger?: boolean; onClick?: () => boolean | void }
export interface ModalOptions { title: string; body: Child; actions?: ModalAction[]; width?: number; onClose?: (result: unknown) => void }
export interface ModalHandle { el: HTMLElement; close: (result?: unknown) => void }

const overlayRoot = (): HTMLElement => document.getElementById('overlay-root') as HTMLElement;
const TOAST_VISIBLE_MS = 3200;
const TOAST_REMOVE_MS = 3600;
const VIEWPORT_MARGIN = 8;

// Toast -------------------------------------------------------------------
function toastHost(): HTMLElement {
  let host = document.querySelector<HTMLElement>('.toast-host');
  if (!host) {
    host = h('div', { class: 'toast-host' });
    overlayRoot().appendChild(host);
  }
  return host;
}

export function toast(message: string, kind: ToastKind = 'info'): void {
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  toastHost().appendChild(el);
  setTimeout(() => el.classList.add('leaving'), TOAST_VISIBLE_MS);
  setTimeout(() => el.remove(), TOAST_REMOVE_MS);
}

// Menu --------------------------------------------------------------------
let openMenuEl: HTMLElement | null = null;

export function closeMenu(): void {
  if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; }
}

function menuItem(item: MenuItem | 'separator'): HTMLElement {
  if (item === 'separator') return h('div', { class: 'menu-sep' });
  return h('button', {
    class: `menu-item${item.danger ? ' danger' : ''}`,
    role: 'menuitem',
    type: 'button',
    disabled: !!item.disabled,
    onclick: (e: Event) => { e.stopPropagation(); closeMenu(); if (item.onClick) item.onClick(); }
  },
  item.icon ? icon(item.icon, 14) : h('span', { class: 'icon' }),
  h('span', { class: 'menu-label' }, item.label),
  item.shortcut ? h('span', { class: 'menu-shortcut' }, item.shortcut) : null);
}

interface Rect { left: number; right: number; top: number; bottom: number }

function anchorRect(anchor: Element | null, options: MenuOptions): Rect {
  if (options.point) return { left: options.point.x, right: options.point.x, bottom: options.point.y, top: options.point.y };
  return (anchor as Element).getBoundingClientRect();
}

function positionMenu(el: HTMLElement, rect: Rect, alignRight?: boolean): void {
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  let left = alignRight ? rect.right - width : rect.left;
  let top = rect.bottom + 4;
  if (left + width > window.innerWidth - VIEWPORT_MARGIN) left = window.innerWidth - width - VIEWPORT_MARGIN;
  if (top + height > window.innerHeight - VIEWPORT_MARGIN) top = Math.max(VIEWPORT_MARGIN, rect.top - height - 4);
  el.style.left = `${Math.max(VIEWPORT_MARGIN, left)}px`;
  el.style.top = `${top}px`;
}

/** Context menu anchored to an element, or at `options.point`. */
export function menu(anchor: Element | null, items: MenuEntry[], options: MenuOptions = {}): HTMLElement {
  closeMenu();
  const entries = items.filter((i): i is MenuItem | 'separator' => !!i);
  const el = h('div', { class: 'menu', role: 'menu' }, entries.map(menuItem));
  overlayRoot().appendChild(el);
  positionMenu(el, anchorRect(anchor, options), options.alignRight);
  openMenuEl = el;
  const first = el.querySelector<HTMLElement>('.menu-item:not([disabled])');
  if (first) first.focus();
  return el;
}

function moveMenuFocus(direction: number): void {
  if (!openMenuEl) return;
  const items = [...openMenuEl.querySelectorAll<HTMLElement>('.menu-item:not([disabled])')];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next = items[(index + direction + items.length) % items.length];
  if (next) next.focus();
}

document.addEventListener('mousedown', (e) => { if (openMenuEl && !openMenuEl.contains(e.target as Node)) closeMenu(); });
document.addEventListener('keydown', (e) => {
  if (!openMenuEl) return;
  if (e.key === 'Escape') closeMenu();
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveMenuFocus(e.key === 'ArrowDown' ? 1 : -1); }
});
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

// Modal -------------------------------------------------------------------
function modalButton(action: ModalAction, close: (result?: unknown) => void): HTMLButtonElement {
  const kind = action.primary ? 'btn-primary' : action.danger ? 'btn-danger' : 'btn-secondary';
  return h('button', { class: `btn ${kind}`, type: 'button', onclick: () => { if (!action.onClick || action.onClick() !== false) close(action.value); } }, action.label);
}

function focusFirstField(dialog: HTMLElement): void {
  const field = dialog.querySelector<HTMLInputElement>('input, textarea, select');
  if (!field) return;
  setTimeout(() => { field.focus(); if (field.select) field.select(); }, 0);
}

/** Generic modal. */
export function modal({ title, body, actions, width, onClose }: ModalOptions): ModalHandle {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = (result?: unknown): void => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose(result);
  };
  const footer = actions && actions.length ? h('div', { class: 'modal-footer' }, actions.map((a) => modalButton(a, close))) : null;
  const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: width ? { width: `${width}px` } : null },
    h('div', { class: 'modal-header' }, h('h2', null, title), iconButton('x', 'Close', () => close(undefined))),
    h('div', { class: 'modal-body' }, body),
    footer);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.stopPropagation(); close(undefined); return; }
    if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName === 'INPUT' && footer) {
      const primary = footer.querySelector<HTMLElement>('.btn-primary');
      if (primary) { e.preventDefault(); primary.click(); }
    }
  };
  backdrop.appendChild(dialog);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(undefined); });
  document.addEventListener('keydown', onKey, true);
  overlayRoot().appendChild(backdrop);
  focusFirstField(dialog);
  return { el: dialog, close };
}

export function prompt({ title, label, value, placeholder, okLabel }: { title: string; label?: string; value?: string; placeholder?: string; okLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value: value || '', placeholder: placeholder || '' });
    let answered = false;
    modal({
      title,
      body: h('label', { class: 'field' }, h('span', { class: 'field-label' }, label || 'Name'), input),
      actions: [
        { label: 'Cancel', value: null },
        { label: okLabel || 'Save', primary: true, onClick: () => {
          if (!input.value.trim()) { input.focus(); return false; }
          answered = true;
          resolve(input.value.trim());
          return true;
        } }
      ],
      onClose: () => { if (!answered) resolve(null); }
    });
  });
}

export function confirm({ title, message, okLabel, danger }: { title: string; message: string; okLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title,
      body: h('p', { class: 'modal-message' }, message),
      actions: [
        { label: 'Cancel', value: false },
        { label: okLabel || 'OK', primary: !danger, danger: !!danger, onClick: () => { answered = true; resolve(true); } }
      ],
      onClose: () => { if (!answered) resolve(false); }
    });
  });
}

export interface ChoiceOption<T> { label: string; value: T; primary?: boolean; danger?: boolean }

/** Multi-way choice (e.g. Save / Don't save / Cancel). Resolves the chosen value, or null. */
export function choice<T>({ title, message, options }: { title: string; message: string; options: ChoiceOption<T>[] }): Promise<T | null> {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title,
      body: h('p', { class: 'modal-message' }, message),
      actions: options.map((o) => ({ label: o.label, primary: o.primary, danger: o.danger, onClick: () => { answered = true; resolve(o.value); } })),
      onClose: () => { if (!answered) resolve(null); }
    });
  });
}
